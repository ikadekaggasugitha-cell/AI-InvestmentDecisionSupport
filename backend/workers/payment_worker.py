"""
Payment Worker — the manual queue's only clock.

Ages declared manual transfers: a row still `pending` past the configured
window (settings.manual_transaction_ttl_seconds, one day by default) becomes
`expire`, so the admin queue shows what needs a human today and shows it apart
from week-old noise.

Since suspensions exist, it also carries the beat that closes accounts whose
subscription lapsed: one guarded UPDATE writing 'subscription_expired', run
through services.accounts so there is no second opinion about what a
suspension is. It suspends only people who once had a subscription — a
registration that never paid is not a lapsed anything.

What expiry deliberately does NOT do
------------------------------------
It grants nothing, removes nothing, and reopens nothing. A settled payment is
unreachable from here, a denied one stays denied, and no Subscription row is
touched — `subscriptions.expires_at` remains the only thing that decides
access (CONTEXT.md rule 1). An expired transaction is still money someone may
have sent: it stays approvable in the queue, which is why the beat never
deletes and the endpoint never refuses it.

Cadence
-------
Expiry every 10 minutes, around the clock. The queue does not follow the
market — transfers arrive whenever a buyer decides to pay — and the job is a
guarded single UPDATE, so running it often is cheap and idempotent: a second
pass over the same window moves nothing.

Suspension hourly, at :05 — hourly is enough because a lapse keeps its queue
open at `/v1/payments` and the person reopens the moment they pay; five past
the hour keeps it out of the minute-0 stampede the market-hours jobs share.
"""

import asyncio
import logging

from workers.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _expire_pending() -> dict:
    """One guarded ageing pass, on the API's own DB access layer.

    Uses services.payments (and its pool) so the beat and the endpoints move
    the same table through the same one writer — a second UPDATE path here
    would be a second opinion about what expiry means.
    """
    from api.core.config import get_settings
    from api.core.db import close_pool
    from api.services.payments import expire_pending

    try:
        aged = await expire_pending(get_settings().manual_transaction_ttl_seconds)
        return {"status": "ok", "expired": aged}
    finally:
        # One-shot asyncio.run: the pool outlives the useful work by exactly
        # this line, and an unclosed pool on a torn-down loop is the noise a
        # short-lived task must not leave behind.
        try:
            await close_pool()
        except Exception:  # noqa: BLE001 — a half-open pool must not fail the task
            pass


@celery_app.task(
    name="workers.payment_worker.expire_pending_transactions",
    bind=True,
    max_retries=3,
    default_retry_delay=300,
    acks_late=True,
)
def expire_pending_transactions(self) -> dict:
    """Age the queue. Runs every 10 minutes, market hours or not."""
    result = asyncio.run(_expire_pending())
    try:
        from api.core.redis_client import record_run

        asyncio.run(record_run(
            "expire-payments",
            status=result.get("status", "ok"),
            detail={"expired": result.get("expired")},
        ))
    except Exception as exc:  # noqa: BLE001 — heartbeat must never fail the task
        logger.debug("payment_worker: heartbeat write skipped — %s", exc)
    return result


async def _suspend_lapsed() -> dict:
    """One suspension pass, through the accounts service's own writer.

    `services.accounts` owns the users table's SQL and the guarded statement is
    its suspension decision; the worker is a clock, not a second opinion.
    """
    from api.core.db import close_pool
    from api.services.accounts import suspend_lapsed_accounts

    try:
        suspended = await suspend_lapsed_accounts()
        return {"status": "ok", "suspended": len(suspended)}
    finally:
        try:
            await close_pool()
        except Exception:  # noqa: BLE001 — a half-open pool must not fail the task
            pass


@celery_app.task(
    name="workers.payment_worker.suspend_lapsed_subscriptions",
    bind=True,
    max_retries=3,
    default_retry_delay=300,
    acks_late=True,
)
def suspend_lapsed_subscriptions(self) -> dict:
    """Close accounts whose last subscription ended. Hourly, at :05 WIB."""
    result = asyncio.run(_suspend_lapsed())
    try:
        from api.core.redis_client import record_run

        asyncio.run(record_run(
            "suspend-lapsed",
            status=result.get("status", "ok"),
            detail={"suspended": result.get("suspended")},
        ))
    except Exception as exc:  # noqa: BLE001 — heartbeat must never fail the task
        logger.debug("payment_worker: heartbeat write skipped — %s", exc)
    return result
