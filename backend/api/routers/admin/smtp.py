"""The email this install writes from, edited by the operator.

A separate door from the Integrations panel, and the separation is the point.
`tests/test_admin_integrations.py` enforces that the panel returns no text at all
except a one-word site name, because it is a status read that must never carry a
host, a username, or a credential. An editor by definition returns the host and
the username it is showing, so putting these fields behind that endpoint would
break the guard that exists to keep secrets out of a status screen. Two endpoints,
two jobs: the panel reports whether mail goes out, this one says what it goes out
with.

What this endpoint never does is return the password. `hasPassword` is a boolean,
and it is the only shape the credential takes here — not masked, not truncated,
not a length. The value is stored as plaintext in `system_settings`, which is the
owner's decision and is recorded in `docs/adr/00NN-smtp-di-database.md`; how far
it travels from that row is still this file's to control.
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from api.core.auth import AdminUser
from api.services.email_transport import mail_config
from api.services.system_settings_service import (
    SmtpInvalid,
    SmtpUnavailable,
    read_smtp,
    read_smtp_updated_at,
    write_smtp,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


class SmtpForm(BaseModel):
    """The email configuration in force, with the password replaced by a boolean.

    Every field is the *effective* value — what the row says when the row says
    something, and what the environment says when it does not. A form showing
    blanks where the install actually sends from would be a screen that lies
    about a working configuration, and the operator would fix what was not
    broken.
    """

    host: str
    port: int
    username: str
    fromAddress: str = Field(description="Alamat pengirim yang terbaca di header From")
    useTls: bool
    enabled: bool
    hasPassword: bool
    # Whether the row holds anything at all, as opposed to the environment
    # answering every field. The form's headline reads this.
    stored: bool
    updatedAt: str | None = None


class SmtpEdit(BaseModel):
    """The fields the operator typed. Absent or empty means "leave it to the
    environment", except `password`, where empty means "keep the stored one".

    That asymmetry is deliberate and is the one sentence in this file a reader
    has to get right: an admin correcting a hostname sends no password, and a
    write that treated "no password" as "no password" would silently delete the
    credential until the next failed send.
    """

    host: str | None = None
    port: int | None = None
    username: str | None = None
    fromAddress: str | None = None
    useTls: bool | None = None
    enabled: bool | None = None
    password: str | None = None


async def _form() -> SmtpForm:
    """The form, resolved from the same reader the transport uses.

    Not a second read of the row through a different path: the panel, the send
    and this screen must all answer from `mail_config()` or they can disagree
    about what the install is configured to do.
    """
    config = await mail_config()
    stored = await read_smtp()
    return SmtpForm(
        host=config.host,
        port=config.port,
        username=config.username,
        fromAddress=config.mail_from,
        useTls=config.use_tls,
        enabled=config.enabled,
        hasPassword=bool(config.password),
        stored=stored is not None,
        updatedAt=await read_smtp_updated_at(),
    )


@router.get(
    "/settings/smtp",
    response_model=SmtpForm,
    summary="Read the email configuration in force",
    description=(
        "The values this install would send with right now: the stored row where\n"
        "it speaks, the deployment's environment where it does not.\n\n"
        "No password, in any form. `hasPassword` is a boolean and that is the\n"
        "whole of it, because a length or a prefix of a credential is enough to\n"
        "rule out candidates for a short one, and this screen has no use for more\n"
        "than whether the field is filled.\n\n"
        "Requires an administrator session. This is the only place outside the\n"
        "transport that reads the row, and it reads it through the transport."
    ),
    responses={
        403: {"description": "Administrator access required"},
        503: {"description": "The stored configuration is unreadable"},
    },
)
async def admin_get_smtp(admin: AdminUser) -> SmtpForm:
    try:
        return await _form()
    except SmtpUnavailable as exc:
        logger.error("admin smtp: stored row is unreadable — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The stored email configuration is unreadable.",
        ) from exc


@router.put(
    "/settings/smtp",
    response_model=SmtpForm,
    summary="Write the email configuration",
    description=(
        "Replaces the stored configuration with what is sent here. A field left\n"
        "empty falls back to the environment again; an empty `password` keeps the\n"
        "stored one.\n\n"
        "The effect is immediate and needs no restart: the transport reads this\n"
        "row at send time, which is the reason this endpoint exists at all. A\n"
        "form writing to the database while the transport read the cached\n"
        "`Settings` would appear to save and change nothing.\n\n"
        "The password is stored as plaintext jsonb. It is in every backup of this\n"
        "database and readable by any account with read access to Postgres. The\n"
        "write is logged with the field names that changed and never their values."
    ),
    responses={
        403: {"description": "Administrator access required"},
        422: {"description": "A field is not something a mail server could use"},
        503: {"description": "The write did not happen"},
    },
)
async def admin_put_smtp(admin: AdminUser, body: SmtpEdit) -> SmtpForm:
    try:
        await write_smtp(body.model_dump())
    except SmtpInvalid as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except SmtpUnavailable as exc:
        logger.error("admin smtp: stored row is unreadable — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The stored email configuration is unreadable.",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("admin: cannot write smtp — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot save the email configuration right now.",
        ) from exc

    logger.info("admin: email configuration saved by account %s", admin.user_id)
    return await _form()
