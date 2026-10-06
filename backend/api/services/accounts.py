"""
Accounts: the identity table, and the only place SQL touches `users`.

An Account is a person: who they are, how to reach them, and what they may do to
the system. Deliberately nothing about money. `role` answers "may this person use
the system"; whether they may use the paid data is answered by their Subscription,
evaluated separately. Keeping the two apart is why there is no `subscriber` value
anywhere in this file. See CONTEXT.md.

Raw SQL by choice (ADR-0001): five tables do not buy an ORM, and the driver is
already asyncpg.
"""

import hashlib
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException, status

from api.core.db import get_pool

logger = logging.getLogger(__name__)

# Indonesian mobile numbers, in the two shapes people actually type: 08xx
# (national) and +62/62 (international). legal-and-consent.md makes this a
# registration requirement, so it is validated rather than stored as noise.
_PHONE_RE = re.compile(r"^(?:\+?62|0)\d{8,13}$")

EMAIL_MAX = 255


@dataclass(frozen=True)
class Account:
    id: uuid.UUID
    email: str
    full_name: str
    phone_number: str
    role: str
    blocked_at: datetime | None
    created_at: datetime


def normalise_email(raw: str) -> str:
    """Lowercase and trim an email for storage and lookup.

    Uniqueness is additionally enforced by a database index on lower(email), so a
    second write path cannot create a duplicate account by skipping this. The
    normalisation is here because the stored value has to match what the index
    compares, not as the guarantee.
    """
    return raw.strip().lower()


def is_valid_phone(raw: str) -> bool:
    """True for an Indonesian mobile number in national or international form."""
    return bool(_PHONE_RE.match(raw.strip()))


def hash_session_token(token: str) -> str:
    """The database key for a session cookie.

    Kept here rather than in services.sessions so that authentication and session
    creation cannot disagree about it: the two must be the same function or a
    freshly issued session will not resolve.
    """
    return hashlib.sha256(token.encode()).hexdigest()


async def authenticate(token: str) -> Account | None:
    """Resolve a session cookie to its account, in one round trip.

    Returns None for an unknown, expired or deleted session. A blocked account is
    returned rather than hidden, so the caller can answer 403 with a reason instead
    of pretending the person never signed in.

    There is no cache on this path, and that is a deliberate reversal of an
    earlier plan to cache session lookups in Redis. A cached lookup means a
    revoked session keeps working until the entry expires, so `DELETE FROM
    sessions` stops being revocation and becomes a suggestion, which is the one
    property opaque sessions were chosen for. The lookup is a primary-key hit on a
    local database, so removing the cache costs less than it appears to, and
    joining `users` here means it is also the only query a request makes.
    """
    if not token:
        return None
    try:
        pool = await get_pool()
        row = await pool.fetchrow(
            """
            SELECT u.id, u.email, u.full_name, u.phone_number, u.role,
                   u.blocked_at, u.created_at
              FROM sessions s
              JOIN users u ON u.id = s.user_id
             WHERE s.id = $1
               AND s.expires_at > NOW()
            """,
            hash_session_token(token),
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        # 503, not 401 and not 403. We do not know who this is, which is a
        # different failure from knowing and refusing, same as the ownership
        # check in portfolio_access. Falling through to "not authenticated" here
        # would turn a database outage into every signed-in user being logged out
        # with a misleading status.
        logger.error("authenticate: session lookup failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot verify the session right now.",
        ) from exc
    return _to_account(row) if row else None


async def create_account(
    *,
    email: str,
    password_hash: str,
    full_name: str,
    phone_number: str,
    role: str = "user",
) -> Account | None:
    """Insert a new account, or return None if the email is already registered.

    Returning None rather than raising keeps "email already taken" a normal
    outcome the router maps to 409. The uniqueness guarantee is the database's:
    the expression index on lower(email) is what actually stops a duplicate, and
    the bare ON CONFLICT DO NOTHING is deliberate because `ON CONFLICT (email)`
    does not match an expression index.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO users (email, password_hash, full_name, phone_number, role)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
        RETURNING id, email, full_name, phone_number, role, blocked_at, created_at
        """,
        normalise_email(email),
        password_hash,
        full_name.strip(),
        phone_number.strip(),
        role,
    )
    if row is None:
        return None
    return _to_account(row)


async def get_account_by_email(email: str) -> tuple[Account, str] | None:
    """Fetch an account together with its password hash, for login.

    The hash comes back with the row because verification needs it and a second
    round trip would be one more thing to get wrong under load.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT id, email, full_name, phone_number, role, blocked_at, created_at,
               password_hash
          FROM users
         WHERE lower(email) = lower($1)
        """,
        email.strip(),
    )
    if row is None:
        return None
    return _to_account(row), row["password_hash"]


async def get_account(account_id: uuid.UUID | str) -> Account | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT id, email, full_name, phone_number, role, blocked_at, created_at
          FROM users
         WHERE id = $1
        """,
        str(account_id),
    )
    return _to_account(row) if row else None


async def update_profile(
    account_id: uuid.UUID,
    *,
    full_name: str,
    phone_number: str,
) -> Account:
    """Change the two fields a person is allowed to change about themselves.

    Email is not editable here and never will be through this path: it is the
    login identifier and the uniqueness guarantee, so changing it means issuing a
    new credential rather than renaming a row. Role and blocked_at are not here
    either, for the same reason: a person does not promote themselves.

    Normalises the name's whitespace and rejects an empty one, because a blank
    name is not a name and every screen that shows it would show nothing.
    """
    cleaned = " ".join(full_name.split())
    if not cleaned:
        raise ValueError("full_name cannot be empty")
    if len(cleaned) > 150:
        raise ValueError("full_name is longer than 150 characters")

    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE users
           SET full_name = $2, phone_number = $3
         WHERE id = $1
        RETURNING id, email, full_name, phone_number, role, blocked_at, created_at
        """,
        str(account_id),
        cleaned,
        phone_number.strip(),
    )
    if row is None:  # pragma: no cover - the session proved this row exists
        raise ValueError("account no longer exists")
    return _to_account(row)


async def update_password_hash(account_id: uuid.UUID, password_hash: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "UPDATE users SET password_hash = $2 WHERE id = $1",
        str(account_id),
        password_hash,
    )


async def revoke_all_sessions(account_id: uuid.UUID) -> int:
    """Delete every session for an account. Returns how many were removed.

    Called when the password changes. Revocation is the absence of rows, not a
    flag, so there is no second representation of the same fact to fall out of
    sync (ADR-0004). There is no cache to invalidate, which is the other half of
    why this is instantaneous.
    """
    pool = await get_pool()
    result = await pool.execute("DELETE FROM sessions WHERE user_id = $1", str(account_id))
    return _affected(result)


async def get_or_create_bypass_account(email: str) -> Account:
    """The Account behind AUTH_BYPASS, created on first use.

    AUTH_BYPASS has to keep working: 400-odd tests and the whole local dev setup
    rely on it. But the principal it returns needs to be a real row, because
    portfolios.user_id is a foreign key and a synthetic id cannot own anything.
    So bypass resolves to, or creates, an actual Account, which is exactly the
    "Operator Tunggal" in CONTEXT.md: a person using the system personally, with
    no Subscription and no need for one.

    Development-only. `_reject_unsafe_production` refuses to boot production with
    AUTH_BYPASS on, so this never runs there.
    """
    pool = await get_pool()
    normalised = normalise_email(email)
    row = await pool.fetchrow(
        """
        INSERT INTO users (email, password_hash, full_name, phone_number, role)
        VALUES ($1, '!bypass', 'Operator Tunggal', '000000000000', 'admin')
        ON CONFLICT DO NOTHING
        RETURNING id, email, full_name, phone_number, role, blocked_at, created_at
        """,
        normalised,
    )
    if row is not None:
        return _to_account(row)
    # Conflict: another request or an earlier run already created it.
    row = await pool.fetchrow(
        """
        SELECT id, email, full_name, phone_number, role, blocked_at, created_at
          FROM users
         WHERE lower(email) = lower($1)
        """,
        normalised,
    )
    if row is None:  # pragma: no cover - only if the row vanished mid-request
        raise RuntimeError("bypass account could not be resolved")
    return _to_account(row)


def _to_account(row) -> Account:
    return Account(
        id=row["id"] if isinstance(row["id"], uuid.UUID) else uuid.UUID(str(row["id"])),
        email=row["email"],
        full_name=row["full_name"],
        phone_number=row["phone_number"],
        role=row["role"],
        blocked_at=row["blocked_at"],
        created_at=row["created_at"],
    )


def _affected(status: str) -> int:
    """asyncpg returns 'UPDATE n' / 'DELETE n'; anything else means zero."""
    try:
        return int(str(status).rsplit(" ", 1)[-1])
    except (ValueError, IndexError):
        return 0