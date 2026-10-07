"""
The caller's own subscription state.

Read-only, and deliberately not behind the entitlement gate.

That last point is the whole design decision. `require_entitlement` exists to keep
paid *data* away from people who have not paid for it, and this endpoint is not
that: it is the answer to "do I have a subscription?", asked by the account
itself. Gating it would be circular — an account with no subscription would be
refused the information that it has no subscription, and the Settings page could
never explain why the paid data is missing.

There is also no way to *acquire* a subscription here, and there will not be until
billing exists. `docs/status.md` records that as deferred to Phase 2. This endpoint
exists so the Settings page can tell the truth about the state rather than showing an
empty box with no explanation.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from api.core.auth import CurrentUser
from api.core.db import get_pool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/subscription", tags=["subscription"])


class CurrentSubscriptionResponse(BaseModel):
    """The account's own subscription state.

    `active` is true and the rest is filled in, or `active` is false and
    `expiresAt` is null. There is no third shape where an expired period is
    returned with a flag — that would be a status column on a Subscription, which
    CONTEXT.md rule 1 rules out, and it would be a second place for the expiry date
    to disagree with itself.

    `expiresAt` is null rather than a past date when there is nothing active. The
    expired periods still exist as rows; reporting one of them as "your
    subscription" would show a date in the past and a `daysRemaining` of zero,
    which reads as "you have one" rather than "you do not".
    """

    active: bool
    expiresAt: str | None = None
    daysRemaining: int | None = None
    # Not reported because it is not stored. `subscriptions` has `expires_at` and
    # no `start_date`, so any start date would be reconstructed rather than read,
    # and a reconstructed one is a guess presented as a fact. When billing exists
    # and a period's start is recorded, this is where it belongs.
    startDate: str | None = None


@router.get(
    "/current",
    response_model=CurrentSubscriptionResponse,
    summary="Whether this account has an active subscription",
    description=(
        "Answers for the signed-in account only, derived from `expires_at`.\n"
        "\n"
        "Authenticated but not entitlement-gated: the question cannot be asked by\n"
        "someone the gate has already refused."
    ),
)
async def current_subscription(user: CurrentUser) -> CurrentSubscriptionResponse:
    try:
        pool = await get_pool()
        row = await pool.fetchrow(
            """
            SELECT expires_at
              FROM subscriptions
             WHERE user_id = $1
               AND expires_at > NOW()
             ORDER BY expires_at DESC
             LIMIT 1
            """,
            str(user.user_id),
        )
    except Exception as exc:  # noqa: BLE001
        # Not None. "We could not check" and "you have none" look identical from the
        # outside, and the first would leave the Settings page telling someone with
        # an active subscription that they have none.
        logger.error("subscription/current: lookup failed for %s — %s", user.user_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot read your subscription right now.",
        ) from exc

    if row is None:
        return CurrentSubscriptionResponse(active=False)

    expires_at: datetime = row["expires_at"]
    # Computed here rather than left to the client: the browser's clock and the
    # database's are not the same clock, and a day count derived from the wrong one
    # is a number nobody can explain.
    remaining = expires_at - datetime.now(timezone.utc)
    days = max(remaining.days, 0)

    return CurrentSubscriptionResponse(
        active=True,
        expiresAt=expires_at.isoformat(),
        daysRemaining=days,
    )