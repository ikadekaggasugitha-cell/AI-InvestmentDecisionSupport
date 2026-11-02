"""
Who a visitor can write to, and how long that has been true.

The address lives in `system_settings.contact_support`, the same table the price
and the transfer destinations live in, and this is where the public reads it.

Public for the same reason those two are: the footer that carries it sits on the
signed-out screens, and a person who has not decided to subscribe yet is exactly
the person who may need to ask something first. An address that could only be
read after signing up is not reachable by the people who would need it.

It exposes one string and a timestamp. There is no phone number, no WhatsApp, no
name and no office address here, because none has ever been given to anyone —
`docs/adr/0013` forbids publishing one, and the footer renders nothing when this
answers empty rather than building a `mailto:` that goes nowhere.
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from api.services.system_settings_service import (
    ContactUnavailable,
    read_contact_support,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/subscriptions", tags=["contact"])


class ContactResponse(BaseModel):
    """The published support address, or null when the operator set none.

    `null` rather than `""` on the wire: the footer's rule is "no value means no
    row", and an empty string is a value that has to be tested for before it can
    be told apart from nothing. The service keeps the empty string as its stored
    "cleared" state; this is where that becomes an absence.
    """

    email: str | None = Field(default=None, description="Alamat bantuan, atau null bila belum ada")
    updatedAt: str | None = Field(
        default=None, description="Kapan alamat terakhir diubah (ISO 8601)"
    )


@router.get(
    "/contact",
    response_model=ContactResponse,
    summary="Who to write to, before an account exists",
    description=(
        "Public with the price and the destinations: the footer that shows this\n"
        "address stands on signed-out screens.\n\n"
        "Answers `\"email\": null` when nothing was ever written, or was cleared.\n"
        "That is the reader's cue to render no contact row at all — not a `mailto:`\n"
        "with nothing after it. A row holding something unusable answers 503,\n"
        "because installed state that reads as noise was written by something\n"
        "else, and repeating it here would publish it as a way to reach the team."
    ),
    responses={503: {"description": "The stored address is unreadable"}},
)
async def public_contact() -> ContactResponse:
    try:
        email, updated = await read_contact_support()
    except ContactUnavailable as exc:
        logger.error("contact: system_settings holds an unusable address — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The support address on this server is unreadable.",
        ) from exc

    return ContactResponse(email=email or None, updatedAt=updated)
