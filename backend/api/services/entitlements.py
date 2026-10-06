"""
Entitlement — whether an Account may use the paid data.

One query, and it answers by reading the Subscription's expiry rather than any
stored status. That is deliberate: the column this replaced would have been a
second source of truth for the same fact, kept in step by a nightly beat job, and
the first time it drifted would have been someone's access quietly disappearing.

`MAX(expires_at) WHERE expires_at > NOW()` also handles an early renewal for free.
Two overlapping periods are both legitimate, so "active" is not a slot that can be
uniquely constrained — and a partial unique index on it is not possible anyway,
because a partial index predicate must be IMMUTABLE and NOW() is STABLE.

Fails closed. An unreachable database means no access, because the alternative is
granting paid data to anyone who can trigger a connection error.
"""

import logging
import uuid

from api.core.db import get_pool

logger = logging.getLogger(__name__)


async def has_active_subscription(account_id: uuid.UUID | str) -> bool:
    """True when the account has at least one unexpired period.

    Never raises. Callers use the return value to make an access decision, so a
    raised connection error would either become a 500 (fails closed by accident,
    with a confusing status) or be caught by a caller that chose the other
    default. Denying here makes the failure explicit and quiet.
    """
    try:
        pool = await get_pool()
        found = await pool.fetchval(
            """
            SELECT 1
              FROM subscriptions
             WHERE user_id = $1
               AND expires_at > NOW()
             LIMIT 1
            """,
            str(account_id),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "entitlement check failed for account %s — denying access: %s", account_id, exc
        )
        return False
    return found is not None


async def current_subscription(account_id: uuid.UUID | str) -> dict | None:
    """The unexpired period that runs longest, for display. None when there is none."""
    try:
        pool = await get_pool()
        row = await pool.fetchrow(
            """
            SELECT id, expires_at
              FROM subscriptions
             WHERE user_id = $1
               AND expires_at > NOW()
             ORDER BY expires_at DESC
             LIMIT 1
            """,
            str(account_id),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("subscription lookup failed for %s: %s", account_id, exc)
        return None
    return dict(row) if row else None