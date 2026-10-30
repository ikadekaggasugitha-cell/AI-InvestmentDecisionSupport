"""Manual subscription grants — the admin-side path into grant()."""

import logging
import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from api.core.auth import AdminUser
from api.services.account_service import get_account
from api.services.subscription_service import InvalidGrant, grant

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ── Manual subscription grants ───────────────────────────────────────────────

class SubscriptionGrantRequest(BaseModel):
    """The period to grant, in whole days.

    `days` is validated in the service, not here, for the same reason the price
    range is: a bound written in two places is a bound that disagrees with
    itself. What counts as a period of access is a billing decision.
    """

    days: int = Field(description="Panjang periode yang diberikan, dalam hari")
    reason: str | None = Field(None, max_length=280)


class SubscriptionGrantResponse(BaseModel):
    """The period created by the grant, read back from the service.

    `expiresAt` comes from the row, not from the body — the caller asked for a
    number of days and does not decide when the period ends.
    """

    accountId: str
    subscriptionId: str
    expiresAt: str


@router.post(
    "/accounts/{account_id}/subscription",
    response_model=SubscriptionGrantResponse,
    summary="Grant a subscription period manually",
    description=(
        "Adds an unexpired period for the account, `days` counted from now. In an\n"
        "install without payments this is the only way an account can come to\n"
        "hold one, including the operator's own.\n\n"
        "`require_admin` rather than `require_entitlement` (CONTEXT.md rule 6):\n"
        "granting is running the product, not using the paid analysis, and an\n"
        "administrator often has no subscription of their own. A non-admin is\n"
        "refused with 403 — not a billing refusal, so not 402.\n\n"
        "A blocked account can still be granted: the block decides access, not\n"
        "what the account is entitled to (CONTEXT.md rule 8)."
    ),
    responses={
        403: {"description": "Administrator access required"},
        404: {"description": "No such account"},
        422: {"description": "The period as asked cannot exist"},
    },
)
async def admin_grant_subscription(
    account_id: uuid.UUID,
    admin: AdminUser,
    body: SubscriptionGrantRequest,
) -> SubscriptionGrantResponse:
    """Grant `body.days` of access to `account_id`, operator-requested.

    No payment row exists on this path, so every call is a new period and there
    is no idempotency key — repeating the action grants again, which is what an
    operator extending someone's access would expect.
    """
    account = await get_account(account_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found.",
        )

    try:
        period = await grant(account_id, days=body.days)
    except InvalidGrant as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        # 503, not 404 and not 403: the account exists, the role checked out,
        # and the write failed for a reason neither the caller nor the operator
        # chose. Reporting success here would claim access was granted when it
        # was not.
        logger.error(
            "admin: cannot grant %s days to %s — %s", body.days, account_id, exc
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot grant the subscription right now.",
        ) from exc

    if body.reason:
        logger.info(
            "admin: subscription grant reason for %s: %s", account_id, body.reason
        )
    return SubscriptionGrantResponse(
        accountId=str(period.user_id),
        subscriptionId=str(period.id),
        expiresAt=period.expires_at.isoformat(),
    )
