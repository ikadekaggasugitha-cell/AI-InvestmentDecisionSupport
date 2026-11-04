"""Which payment methods this install offers online, chosen by the operator.

Read-only about the *list*, writable about the *choice*. There is no key here and
no gateway code in the response: the operator picks from names the payer will
also see, and the mapping to what the gateway understands lives in
`channel_registry`, one place away from anything that touches the wire.

Why an admin can constrain this at all: the gateway's own dashboard has always
decided which methods appear on its page, and until now that decision was
invisible from inside the product. An operator running an install that should
take QRIS only had no way to say so here, and the payer would discover the
mismatch by trying to pay.
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from api.core.auth import AdminUser
from api.services import channel_registry
from api.services.system_settings_service import (
    PaymentChannelsInvalid,
    PaymentChannelsUnavailable,
    read_payment_channels,
    write_payment_channels,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


class ChannelOption(BaseModel):
    """One choice the operator can switch on.

    `snap` is included here and nowhere else on the public side. An operator
    deciding whether a method is offered benefits from seeing the word that will
    be sent outward; a payer choosing how to pay does not.
    """

    key: str
    label: str
    snap: str | None


class AdminPaymentChannelsResponse(BaseModel):
    """The current choice, and the whole list to choose from.

    `restricted` is false when nobody has ever written the setting. It is
    reported rather than inferred from an empty list because the two mean
    different things on screen: "the gateway decides" and "nothing is enabled"
    must not read the same way.
    """

    restricted: bool
    enabled: list[str]
    options: list[ChannelOption]
    updatedAt: str | None = None


class AdminPaymentChannelsRequest(BaseModel):
    """The whole enabled set, or nothing.

    A patch would need to know which channels the operator intends to keep, and
    the stored value is one list.
    """

    channels: list[str]


def _option_rows() -> list[ChannelOption]:
    """The registry, every time, never a cached copy.

    A list held at import would be a second place deciding what can be chosen,
    and the whole point of the registry is that there is one.
    """
    return [
        ChannelOption(key=c.key, label=c.label, snap=c.snap)
        for c in channel_registry.options()
    ]


async def _current_state() -> AdminPaymentChannelsResponse:
    """What the screen reads, straight from the stored row.

    Used after a write as well as before one, so the response the operator gets
    back is the server's answer rather than an echo of the request — the same
    rule the destination form keeps, and the reason a saved list on screen means
    the payment page will publish it.
    """
    try:
        enabled, updated_at = await read_payment_channels()
    except PaymentChannelsUnavailable as exc:
        logger.error("admin payment-channels: stored list is unreadable — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The stored channel list is unreadable.",
        ) from exc

    return AdminPaymentChannelsResponse(
        restricted=enabled is not None,
        enabled=enabled or [],
        options=_option_rows(),
        updatedAt=updated_at,
    )


@router.get(
    "/settings/payment-channels",
    response_model=AdminPaymentChannelsResponse,
    summary="Read the online payment methods as configured",
    description=(
        "What the payment screen will offer, plus every channel the registry\n"
        "knows so the form can show the choices that are not currently on.\n\n"
        "An install that has never set this reports `restricted: false`, which\n"
        "means the gateway's own dashboard is deciding. That is the state every\n"
        "existing install is in on the day this ships, and saying it plainly is\n"
        "what keeps the form from showing an empty list as if someone had\n"
        "switched everything off."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_get_payment_channels(admin: AdminUser) -> AdminPaymentChannelsResponse:
    return await _current_state()


@router.put(
    "/settings/payment-channels",
    response_model=AdminPaymentChannelsResponse,
    summary="Choose the online payment methods",
    description=(
        "Writes the whole enabled set in one statement.\n\n"
        "An empty list is accepted here and means no online payment at all — a\n"
        "deliberate act, and the one case where the checkout endpoint refuses\n"
        "rather than opening an unrestricted page. Unknown keys are refused with\n"
        "422: a code the gateway does not recognise does not error, it simply\n"
        "never shows the method, so a typo would cost a payer a way to pay\n"
        "without anyone being told."
    ),
    responses={
        403: {"description": "Administrator access required"},
        422: {"description": "The list names a channel this code does not know"},
        503: {"description": "The write did not happen"},
    },
)
async def admin_set_payment_channels(
    admin: AdminUser,
    body: AdminPaymentChannelsRequest,
) -> AdminPaymentChannelsResponse:
    try:
        await write_payment_channels(body.channels)
    except PaymentChannelsInvalid as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("admin: cannot write payment_channels — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot save the payment methods right now.",
        ) from exc

    return await _current_state()
