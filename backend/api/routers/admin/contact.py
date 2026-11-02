"""The support address an operator publishes to the public footer."""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from api.core.auth import AdminUser
from api.services.system_settings_service import (
    ContactInvalid,
    ContactUnavailable,
    read_contact_support,
    write_contact_support,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ── Kontak bantuan ───────────────────────────────────────────────────────────

class AdminContactRequest(BaseModel):
    """The address as the operator writes it.

    An empty string is accepted and means "take it off the footer". It is not a
    validation failure: the field being blank is how clearing is expressed, and
    the form names that action instead of letting a blank box look untouched.
    """

    email: str


class AdminContactResponse(BaseModel):
    """The address as the server now holds it, read back after a write.

    `email` is null when nothing is published, which is the same answer the
    public endpoint gives, so the form and the footer cannot disagree about
    whether there is an address.
    """

    email: str | None = None
    updatedAt: str | None = None


@router.get(
    "/settings/contact",
    response_model=AdminContactResponse,
    summary="Read the published support address",
    description=(
        "What the form is looking at before changing it, from the source the\n"
        "footer reads. Separated from `GET /v1/subscriptions/contact` for the\n"
        "same reason the price is: a non-administrator gets 403 here rather than\n"
        "a sessionless version of the same answer."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_get_contact(admin: AdminUser) -> AdminContactResponse:
    try:
        email, updated = await read_contact_support()
    except ContactUnavailable as exc:
        logger.error("admin contact: stored address is unreadable — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The stored support address is unreadable.",
        ) from exc
    return AdminContactResponse(email=email or None, updatedAt=updated)


@router.put(
    "/settings/contact",
    response_model=AdminContactResponse,
    summary="Publish or clear the support address",
    description=(
        "Writes one address, then reads it back, so the form ends up showing what\n"
        "the footer will publish rather than what was typed.\n\n"
        "`require_admin`, not `require_entitlement` (CONTEXT.md rule 6): naming\n"
        "the channel people write to is running the product, and a non-admin is\n"
        "refused with 403, not 402.\n\n"
        "An address that could not be delivered to is refused with 422. This is\n"
        "not a style question: the footer turns the value into a `mailto:` link,\n"
        "so a string that is not an address ships as a control that sends mail\n"
        "nowhere."
    ),
    responses={
        403: {"description": "Administrator access required"},
        422: {"description": "The value is not a single deliverable address"},
        503: {"description": "The write did not happen"},
    },
)
async def admin_set_contact(admin: AdminUser, body: AdminContactRequest) -> AdminContactResponse:
    try:
        stored = await write_contact_support(body.email)
    except ContactInvalid as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        # The operator is watching a form that reports what was saved; a 503
        # keeps their screen from answering with the address they typed.
        logger.error("admin: cannot write contact_support — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot save the support address right now.",
        ) from exc

    # Re-read rather than echoing the write: what the form shows after saving is
    # what the public endpoint will publish, including the server's timestamp.
    try:
        email, updated = await read_contact_support()
    except ContactUnavailable as exc:
        logger.error("admin contact: read-back failed after a write — %s", exc)
        return AdminContactResponse(email=stored or None, updatedAt=None)
    return AdminContactResponse(email=email or None, updatedAt=updated)
