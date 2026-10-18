"""
Accounts: the identity table, and the only place SQL touches `users`.

An Account is a person: who they are, how to reach them, and what they may do to
the system. Deliberately nothing about money. `role` answers "may this person use
the system"; whether they may use the paid data is answered by their Subscription,
evaluated separately. Keeping the two apart is why there is no `subscriber` value
anywhere in this file. See CONTEXT.md.

Blocking carries its reason with it (`blocked_reason`: 'admin' or
'subscription_expired'). Two writers, two doors: `set_blocked` is the
administrator's — it records 'admin', and only `POST /v1/admin/accounts/{id}/unblock`
may clear that. `reopen_after_payment` is the payment path's — its WHERE clause
only matches 'subscription_expired', so money can clear the suspension it is
paying for and can never open an admin ban. One statement, guard and write
together: a check in Python around a separate UPDATE would leave a window where
the reason could change between reading and clearing.

Raw SQL by choice (ADR-0001): five tables do not buy an ORM, and the driver is
already asyncpg.
"""

import hashlib
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import asyncpg
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
    # Why the account is closed — 'admin' or 'subscription_expired'. The two
    # carry different doors openers may use; None exactly when blocked_at is.
    blocked_reason: str | None
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
                   u.blocked_at, u.blocked_reason, u.created_at
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
        RETURNING id, email, full_name, phone_number, role,
                  blocked_at, blocked_reason, created_at
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
        SELECT id, email, full_name, phone_number, role,
               blocked_at, blocked_reason, created_at, password_hash
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
        SELECT id, email, full_name, phone_number, role,
               blocked_at, blocked_reason, created_at
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
        RETURNING id, email, full_name, phone_number, role,
                  blocked_at, blocked_reason, created_at
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


async def set_blocked(
    account_id: uuid.UUID, blocked: bool, *, reason: Literal["admin"]
) -> Account:
    """Block or unblock an account. Returns the updated account.

    This is the only per-account writer of `blocked_at`/`blocked_reason` in the
    codebase. One function for both directions because two writers would mean
    two places to get it wrong, and the failure mode of a half-applied block is
    an account that still has access.

    A block always names its reason, and the only reason this function writes is
    'admin' — the endpoint that calls it is the administrator's. The beat that
    suspends lapsed subscriptions writes 'subscription_expired' through its own
    single guarded statement, never here: if those two ever merged, a lapsed
    account and a banned one would become indistinguishable, and so would the
    doors that may open them. The type annotation is that boundary restated.

    `blocked=False` is the administrator's own unblock — it clears both columns
    whatever the reason was, because the person who wrote a ban may undo it,
    and `POST /v1/admin/accounts/{id}/unblock` is the only caller.

    Blocking is immediate, not "on the next request after a cache expires":
    `authenticate()` already reads the block in its single JOIN, so nothing else
    has to change for a block to take hold. That is also why the session rows are
    deliberately left in place — CONTEXT.md rule 8 puts disabling access on the
    Account, not on the Subscription, and the block is checked on every request
    rather than trusted to a session that might still be listed.

    Raises:
        HTTPException 404 — no such account. Distinct from "no rows updated",
            which would let a caller believe an account had been blocked when the
            id they passed did not exist.
        HTTPException 503 — the database is unreachable, so the write did not
            happen. Reporting success here would be a lie the caller cannot detect.
    """
    try:
        pool = await get_pool()
        row = await pool.fetchrow(
            """
            UPDATE users SET blocked_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
                   blocked_reason = CASE WHEN $2 THEN $3::text ELSE NULL END
             WHERE id = $1
            RETURNING id, email, full_name, phone_number, role,
                      blocked_at, blocked_reason, created_at
            """,
            str(account_id),
            blocked,
            reason,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("accounts: cannot set blocked=%s for %s — %s", blocked, account_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot change the account's access right now.",
        ) from exc

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found.",
        )
    logger.info(
        "accounts: %s %s", "blocked" if blocked else "unblocked", account_id
    )
    return _to_account(row)


async def reopen_after_payment(
    account_id: uuid.UUID | str, conn: "asyncpg.Connection | None" = None
) -> bool:
    """Clear a suspension a payment may clear — and nothing else.

    Called from `subscriptions.grant`, on the connection of whatever transaction
    is writing the Subscription, so the period and the reopening commit together:
    a crash between them rolls back both, and retrying the payment does both
    again. A new period without the reopening would leave a paying person locked
    out; a reopening without a new period would be the beat re-suspending them
    on its next run.

    The guard is inside the statement: only a row whose reason is
    'subscription_expired' is matched. An admin ban never is — that is rule this
    plan exists to enforce, and it holds even if a caller races or a reason were
    changed, because the check and the clear are the same UPDATE. Returns whether
    anything was cleared; a not-suspended account is a normal False, not an error.
    """
    db = conn if conn is not None else await get_pool()
    row = await db.fetchrow(
        """
        UPDATE users SET blocked_reason = NULL, blocked_at = NULL
         WHERE id = $1
           AND blocked_at IS NOT NULL
           AND blocked_reason = 'subscription_expired'
        RETURNING id
        """,
        str(account_id),
    )
    if row is not None:
        logger.info("accounts: payment reopened suspended account %s", account_id)
    return row is not None


# The place the suspension beat reads and writes: one statement, guard and write
# together, so an account that pays and reopens between a candidate's selection
# and the UPDATE cannot be caught by stale data — the same snapshot that finds
# the row is the one that closes it or leaves it alone.
_LAPSED_PREDICATE = """
WHERE {alias}.blocked_at IS NULL
  AND EXISTS (
        SELECT 1 FROM subscriptions s
         WHERE s.user_id = {alias}.id)
  AND NOT EXISTS (
        SELECT 1 FROM subscriptions a
         WHERE a.user_id = {alias}.id
           AND a.expires_at > NOW())
"""


async def find_lapsed_accounts(limit: int = 500) -> list[dict]:
    """Accounts that once had a Subscription and have none left that is live.

    Three conditions, all inside the statement on purpose:

    * `blocked_at IS NULL` — an already closed account is not a candidate. That
      is what keeps the beat from ever touching `blocked_reason = 'admin'`: an
      admin ban is not an expired subscription, and "fixing" the reason column
      would convert a ban into something payment can satisfy.
    * EXISTS any subscription row at all — a person who signed up and never paid
      has no lapsed subscription to suspend. Without this clause an empty
      `subscriptions` table on a fresh install would close the door on every
      free registration, which is the bug-shaped rule this plan forbids.
    * NOT EXISTS a period still running — `expires_at > NOW()` on any row means
      the account has future access; expiry is the absence of that, not the
      presence of a past one.

    Read-side companion of `suspend_lapsed_accounts`, for the CLI's dry run and
    for any operator who wants to look before anything moves.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        SELECT u.id, u.email
          FROM users u
        {_LAPSED_PREDICATE.format(alias="u")}
        ORDER BY u.created_at, u.id
        LIMIT $1
        """,
        limit,
    )
    return [{"id": r["id"], "email": r["email"]} for r in rows]


async def suspend_lapsed_accounts() -> list[dict]:
    """Suspend every lapsed account, and return the rows it closed.

    The same predicate as `find_lapsed_accounts`, as an UPDATE — selection and
    write in one statement, so the beat is exactly twice idempotent (nothing
    changed the second time) and exactly as race-free as a single transaction.
    It writes 'subscription_expired' and nothing else: a `subscriptions` row is
    never created, changed or removed here — the beat closes access that the
    expiry already ended, and rule 1 stays intact.

    Admin bans are unreachable from this statement, at both ends: they are
    filtered out by `blocked_at IS NULL`, and the reason written can only be
    'subscription_expired'.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        UPDATE users u SET blocked_at = NOW(),
               blocked_reason = 'subscription_expired'
        {_LAPSED_PREDICATE.format(alias="u")}
        RETURNING u.id, u.email
        """
    )
    if rows:
        logger.info("accounts: suspended %d lapsed account(s)", len(rows))
    return [{"id": r["id"], "email": r["email"]} for r in rows]


async def list_accounts(limit: int = 100, offset: int = 0) -> list[Account]:
    """Accounts newest first, for the admin list.

    Paged rather than unpaged: an unpaged list of every account becomes a slow
    query and a large response exactly when the table is most worth looking at.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, email, full_name, phone_number, role,
               blocked_at, blocked_reason, created_at
        FROM users
        ORDER BY created_at DESC, id
        LIMIT $1 OFFSET $2
        """,
        limit,
        offset,
    )
    return [_to_account(r) for r in rows]


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
        RETURNING id, email, full_name, phone_number, role,
                  blocked_at, blocked_reason, created_at
        """,
        normalised,
    )
    if row is not None:
        return _to_account(row)
    # Conflict: another request or an earlier run already created it.
    row = await pool.fetchrow(
        """
        SELECT id, email, full_name, phone_number, role,
               blocked_at, blocked_reason, created_at
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
        blocked_reason=row.get("blocked_reason"),
        created_at=row["created_at"],
    )


def _affected(status: str) -> int:
    """asyncpg returns 'UPDATE n' / 'DELETE n'; anything else means zero."""
    try:
        return int(str(status).rsplit(" ", 1)[-1])
    except (ValueError, IndexError):
        return 0