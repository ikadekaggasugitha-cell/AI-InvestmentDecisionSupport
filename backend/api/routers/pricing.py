"""
What the product costs.

The price lives in `system_settings` and this is where the public reads it. It is
deliberately the only unauthenticated data endpoint in the app.

It has to be. A price that can only be read after signing up is not a price: the
person deciding whether to subscribe is, by definition, not yet subscribed. The
same circularity keeps `GET /v1/subscription/current` outside the entitlement gate
— the account the gate refuses is exactly the one that needs to be told what the
data costs.

It exposes two numbers and a timestamp. Nothing else. There is no account data,
no enumeration surface, and no path from here to anything but the price.
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from api.services.settings import PricingUnavailable, read_pricing

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/subscriptions", tags=["pricing"])


class PricingResponse(BaseModel):
    """The price, in whole rupiah.

    There is no currency field because there is only one: the amounts are IDR and
    every consumer formats them as such. A currency selector here would be a
    second thing to keep true.
    """

    monthly: int = Field(description="Bulanan, dalam rupiah penuh")
    annual: int = Field(description="Tahunan, dalam rupiah penuh")
    # Not the row's creation time and not a plan name. It is when this number was
    # last changed, which is the only one of those a reader would ask about.
    updatedAt: str | None = Field(
        default=None, description="Kapan harga terakhir diubah (ISO 8601)"
    )


@router.get(
    "/pricing",
    response_model=PricingResponse,
    summary="What a subscription costs",
    description=(
        "Public by design. A price that can only be read after signing up is not a\n"
        "price.\n\n"
        "Read from `system_settings`, which is the only place the price is written.\n"
        "Answers 503 rather than a number when that row is missing: an install whose\n"
        "migrations have not run has no price, and publishing zero would quote a\n"
        "real customer for free."
    ),
    responses={503: {"description": "No price is configured on this install"}},
)
async def current_pricing() -> PricingResponse:
    try:
        pricing = await read_pricing()
    except PricingUnavailable as exc:
        # Logged at error because this means a broken install, not a request the
        # caller did anything wrong with.
        logger.error("pricing: system_settings has no usable price — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No pricing is configured on this server.",
        ) from exc

    return PricingResponse(
        monthly=pricing.monthly,
        annual=pricing.annual,
        updatedAt=pricing.updated_at,
    )