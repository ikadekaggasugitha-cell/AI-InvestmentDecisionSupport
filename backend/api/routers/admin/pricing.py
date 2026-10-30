"""The price the platform sells at, read and written through system settings."""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from api.core.auth import AdminUser
from api.services.system_settings_service import (
    PriceOutOfRange,
    PricingUnavailable,
    read_pricing,
    write_pricing,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ── Pricing ──────────────────────────────────────────────────────────────────

class PricingResponse(BaseModel):
    """The current price, as the operator sees it.

    Same four fields as the public endpoint. It is a second read of one fact, and
    that is deliberate: the public one answers for a prospective buyer and never
    fails with 403, while this one answers for somebody who is already an operator
    and says so plainly when they are not. Without it the admin form would either
    render its prices without knowing it is allowed to, or ask a public endpoint
    and lose the refusal entirely.
    """

    weekly: int
    monthly: int
    annual: int
    updatedAt: str | None = None


@router.get(
    "/settings/pricing",
    response_model=PricingResponse,
    summary="Read the current subscription price",
    description=(
        "What the operator is looking at before changing it. Same source as the\n"
        "public `GET /v1/subscriptions/pricing`; separated so that a non-administrator\n"
        "gets 403 here rather than being quietly handed the answer anyway."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_get_pricing(admin: AdminUser) -> PricingResponse:
    try:
        pricing = await read_pricing()
    except PricingUnavailable as exc:
        logger.error("admin pricing: system_settings has no usable price — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No pricing is configured on this server.",
        ) from exc
    return PricingResponse(
        weekly=pricing.weekly,
        monthly=pricing.monthly,
        annual=pricing.annual,
        updatedAt=pricing.updated_at,
    )


class PricingUpdateRequest(BaseModel):
    """All three prices, or none.

    Required rather than optional on purpose. A partial body would apply one
    price from this moment beside the others from the last, and that
    combination was never chosen by anyone.
    """

    weekly: int = Field(description="Harga mingguan dalam rupiah penuh")
    monthly: int = Field(description="Harga bulanan dalam rupiah penuh")
    annual: int = Field(description="Harga tahunan dalam rupiah penuh")


@router.put(
    "/settings/pricing",
    response_model=PricingResponse,
    summary="Set the subscription price",
    description=(
        "Replaces both prices. Written as one statement, so a reader can never see a\n"
        "new monthly price beside an old annual one.\n\n"
        "`require_admin`, not `require_entitlement`: setting the price is running the\n"
        "product, which is a different question from using the paid analysis\n"
        "(CONTEXT.md rule 6). A non-admin is refused with 403, not 402 — they have\n"
        "not run into a billing problem."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_set_pricing(
    admin: AdminUser,
    body: PricingUpdateRequest,
) -> PricingResponse:
    """Set `body.weekly`, `body.monthly`, and `body.annual`.

    The range check lives in the service, not here. This router rejects a body
    that is the wrong shape; deciding what counts as an amount of money is the
    service's job, and putting the bound in both places guarantees the two
    disagree eventually.
    """
    try:
        pricing = await write_pricing(body.weekly, body.monthly, body.annual)
    except PriceOutOfRange as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return PricingResponse(
        weekly=pricing.weekly,
        monthly=pricing.monthly,
        annual=pricing.annual,
        updatedAt=pricing.updated_at,
    )
