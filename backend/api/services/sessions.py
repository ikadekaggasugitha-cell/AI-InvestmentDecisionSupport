"""
Opaque sessions — the replacement for the JWT (ADR-0004).

The cookie carries 64 random hex characters. What the database stores is their
SHA-256, so read access to Postgres or to one backup does not hand over live
sessions: the attacker still has to guess 256 bits of entropy rather than copy a
usable token out of a table.

This module owns the token lifecycle — create, destroy, purge. Resolving a token
to an account is `accounts.authenticate`, which does it in one joined query and
is deliberately uncached. An earlier version of this file read through Redis, and
that turned out to break revocation rather than speed it up: a revoked session
stayed usable until its cached entry expired, so `DELETE FROM sessions` stopped
meaning "signed out" and started meaning "signed out in five minutes". The cost
of dropping the cache is one primary-key lookup, which the join in `authenticate`
pays for anyway.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from api.core.db import get_pool
from api.services.accounts import hash_session_token

TOKEN_BYTES = 32  # 64 hex characters, stored as the sha256 of the cookie value

SESSION_COOKIE = "aidss_session"


@dataclass(frozen=True)
class Session:
    user_id: uuid.UUID
    expires_at: datetime


def generate_token() -> str:
    """A fresh session token. Cryptographically random, never derived from anything."""
    return secrets.token_hex(TOKEN_BYTES)


async def create_session(account_id: uuid.UUID, ttl_days: int) -> tuple[str, datetime]:
    """Register a session and return the raw token plus its expiry.

    The raw token is returned exactly once, to be handed to the client in a cookie.
    Only its hash is persisted.
    """
    token = generate_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO sessions (id, user_id, expires_at)
        VALUES ($1, $2, $3)
        """,
        hash_session_token(token),
        str(account_id),
        expires_at,
    )
    return token, expires_at


async def destroy_session(token: str) -> bool:
    """Log one device out. Returns False if the token was already gone."""
    digest = hash_session_token(token)
    pool = await get_pool()
    deleted = await pool.execute("DELETE FROM sessions WHERE id = $1", digest)
    return str(deleted).endswith("1")


async def purge_expired_sessions() -> int:
    """Delete sessions whose expiry has passed. Returns the number removed.

    A maintenance operation rather than a Celery task. Beat schedules in this repo
    have a WIB/UTC history, and idx_sessions_expires_at makes this an indexed
    delete — there is no reason to add a new trap for it.
    """
    pool = await get_pool()
    result = await pool.execute("DELETE FROM sessions WHERE expires_at < NOW()")
    try:
        return int(str(result).rsplit(" ", 1)[-1])
    except (ValueError, IndexError):
        return 0
