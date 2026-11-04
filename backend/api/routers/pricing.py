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

from api.services import channel_registry
from api.services.system_settings_service import (
    BankAccountsUnavailable,
    PaymentChannelsUnavailable,
    PricingUnavailable,
    read_bank_accounts,
    read_payment_channels,
    read_pricing,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/subscriptions", tags=["pricing"])


class PricingResponse(BaseModel):
    """The price, in whole rupiah.

    There is no currency field because there is only one: the amounts are IDR and
    every consumer formats them as such. A currency selector here would be a
    second thing to keep true.
    """

    weekly: int = Field(description="Mingguan, dalam rupiah penuh")
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
        weekly=pricing.weekly,
        monthly=pricing.monthly,
        annual=pricing.annual,
        updatedAt=pricing.updated_at,
    )

# ── Rekening tujuan ──────────────────────────────────────────────────────────

class BankAccountResponse(BaseModel):
    """One transfer destination, public for the same reason the price is.

    A person deciding to transfer to what they cannot yet read is a person
    guessing. `accountNumber` is digits-only as stored; there is no formatting
    promise here, so a consumer renders it exactly.
    """

    bank: str
    accountNumber: str
    holderName: str


class BankAccountsResponse(BaseModel):
    """The destinations as installed. An empty list is an honest answer.

    Not yet configured is not an error state for the visitor: the front
    end turns `"accounts": []` into "belum ada rekening tujuan", one message,
    rather than rendering an empty list that looks like a list that lost its
    contents.
    """

    accounts: list[BankAccountResponse]


@router.get(
    "/bank-accounts",
    response_model=BankAccountsResponse,
    summary="Where to pay, before an account exists",
    description=(
        "Public with the price: someone who has not signed up yet still needs to\n"
        "know where the transfer goes.\n\n"
        "Only destinations the operator chose to show are listed. A hidden row\n"
        "is not sent with a flag for the browser to ignore — it is not sent, so\n"
        "a retired or half-prepared account number cannot reach a customer by way\n"
        "of a frontend that forgot to check.\n\n"
        "Answers `\"accounts\": []` when nothing was ever written, or when\n"
        "everything written is hidden — the reader's cue to say so, not a list to\n"
        "render empty. A row that holds something unusable answers 503, because\n"
        "installed state that reads as noise was written by something else, and\n"
        "repeating it here would serve it as fact."
    ),
    responses={503: {"description": "The stored list is unreadable"}},
)
async def public_bank_accounts() -> BankAccountsResponse:
    try:
        entries, _updated = await read_bank_accounts()
    except BankAccountsUnavailable as exc:
        logger.error("bank-accounts: system_settings holds an unusable list: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The transfer destinations on this server are unreadable.",
        ) from exc

    return BankAccountsResponse(
        accounts=[
            BankAccountResponse(
                bank=e.bank,
                accountNumber=e.account_number,
                holderName=e.holder_name,
            )
            for e in entries
            if e.enabled
        ]
    )


# ── Which ways to pay this install offers ────────────────────────────────────

class PaymentChannelResponse(BaseModel):
    key: str
    label: str


class PaymentChannelsResponse(BaseModel):
    """The channels a payer may choose, and whether the operator has chosen them.

    `restricted` is the field the payment screen reads. When it is false nobody
    has set a list yet, and the gateway's own dashboard is what decides which
    methods appear on its page — so the screen offers one unrestricted "pay
    online" action rather than a list of channels this server cannot vouch for.
    Showing a picker in that state would be presenting our registry as the
    install's configuration, which it is not.
    """

    restricted: bool
    channels: list[PaymentChannelResponse]


@router.get(
    "/payment-channels",
    response_model=PaymentChannelsResponse,
    summary="Ways to pay online that this install offers",
    description=(
        "Public, like the price and the destinations: someone choosing how to pay\n"
        "needs to know what they can choose before they commit to a path.\n\n"
        "Only the keys and labels leave this endpoint. The gateway's own codes\n"
        "stay in the service that maps them, so the browser cannot learn, or\n"
        "supply, the words the gateway understands."
    ),
    responses={503: {"description": "The stored channel list is unreadable"}},
)
async def public_payment_channels() -> PaymentChannelsResponse:
    try:
        enabled, _updated = await read_payment_channels()
    except PaymentChannelsUnavailable as exc:
        logger.error("payment-channels: system_settings holds an unusable list: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The payment methods on this server are unreadable.",
        ) from exc

    if enabled is None:
        return PaymentChannelsResponse(restricted=False, channels=[])

    return PaymentChannelsResponse(
        restricted=True,
        channels=[
            PaymentChannelResponse(key=key, label=channel_registry.label(key))
            for key in enabled
            # A channel with no gateway code cannot be paid online, whatever an
            # old stored list happens to contain.
            if channel_registry.snap_code(key) is not None
        ],
    )
