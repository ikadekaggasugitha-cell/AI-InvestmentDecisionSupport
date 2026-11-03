"""
What this install is wired to, read straight from its own process.

Blueprint §5.1 lists "Pengaturan Kunci API (Midtrans, Gateway WhatsApp, SMTP
Email)" as an admin module. Two of those three do not exist as anything in this
codebase: there is no WhatsApp gateway and no SMTP transport, and `Settings` has
no field for either. Listing them as "not configured" would imply the app has a
place to put them, which is a claim about the code that the code does not support
— so this endpoint names only Midtrans, the one integration the checkout path
actually reads.

Nothing here is editable, and that is the decision rather than an omission. A
secret written into `system_settings` would be stored as plaintext jsonb, would
land in every database backup, would need masking on every read path, and would
still not take effect without a restart because `get_settings()` is `lru_cache`d
and the values are read at import. A form that appeared to change them and did
not is worse than no form. So the keys stay in the deployment's environment, and
this endpoint answers one question an operator genuinely cannot see from outside:
is the gateway wired, and toward which site.

The response never carries key material — not the value, not a prefix, not a
length. A length alone would let a caller confirm a guess about the key.
"""

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from api.core.auth import AdminUser
from api.services.email_transport import email_status
from api.services.midtrans_service import gateway_configured, gateway_environment

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


class IntegrationsResponse(BaseModel):
    """Derived facts about the two integrations this code reads.

    `midtransEnvironment` is `sandbox` or `production`: which site the money
    would flow toward. It is shown because an install pointed at the wrong one
    looks exactly like a working payment page while booking nothing.

    `emailMissing` names the *settings* that stand between this install and a
    sent confirmation — `SMTP_HOST`, `SMTP_MAIL_FROM`, `NOTIFICATIONS_ENABLED` —
    so an operator reading "not configured" has something to act on instead of
    three files to guess at. It is a list of setting names, never of values: the
    password is not returned, not masked, not truncated, not as a length, and the
    host is not either, because which provider an install uses is itself
    information about it.
    """

    midtransConfigured: bool
    midtransEnvironment: str
    emailConfigured: bool
    emailMissing: list[str] = []


@router.get(
    "/settings/integrations",
    response_model=IntegrationsResponse,
    summary="Which integrations this install is wired to",
    description=(
        "Read-only, and only about what this codebase actually reads: the\n"
        "Midtrans gateway and the SMTP settings behind the notification outbox.\n\n"
        "No secret crosses this boundary. The endpoint reports whether each\n"
        "integration is configured and, for email, which setting names are\n"
        "missing — never a value, a fragment, a length, or the host itself.\n\n"
        "Changing either means editing the deployment's environment and\n"
        "restarting: Settings is read once and cached, so a form that appeared to\n"
        "save would be a lie about what it did."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_integrations(admin: AdminUser) -> IntegrationsResponse:
    mail = email_status()
    return IntegrationsResponse(
        midtransConfigured=gateway_configured(),
        midtransEnvironment=gateway_environment(),
        emailConfigured=mail.configured,
        emailMissing=list(mail.missing),
    )
