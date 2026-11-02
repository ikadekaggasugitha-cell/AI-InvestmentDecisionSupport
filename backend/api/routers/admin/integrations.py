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
from api.services.midtrans_service import gateway_configured, gateway_environment

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


class IntegrationsResponse(BaseModel):
    """Derived facts about the one integration this code reads.

    `midtransEnvironment` is `sandbox` or `production`: which site the money
    would flow toward. It is shown because an install pointed at the wrong one
    looks exactly like a working payment page while booking nothing.
    """

    midtransConfigured: bool
    midtransEnvironment: str


@router.get(
    "/settings/integrations",
    response_model=IntegrationsResponse,
    summary="Which payment gateway this install is wired to",
    description=(
        "Read-only, and only about Midtrans — the single integration whose\n"
        "credentials this codebase reads.\n\n"
        "No secret crosses this boundary. The endpoint reports whether a key\n"
        "exists and which site it points at, never the key, a fragment of it, or\n"
        "how long it is.\n\n"
        "Changing a key means editing the deployment's environment and\n"
        "restarting: Settings is read once and cached, so a form that appeared to\n"
        "save would be a lie about what it did."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_integrations(admin: AdminUser) -> IntegrationsResponse:
    return IntegrationsResponse(
        midtransConfigured=gateway_configured(),
        midtransEnvironment=gateway_environment(),
    )
