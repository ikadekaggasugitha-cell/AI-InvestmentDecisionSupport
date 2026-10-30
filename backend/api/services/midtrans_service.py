"""
The Midtrans HTTP surface, kept thin and mockable.

Two verbs live here: mint a Snap checkout page, and verify the signature
Midtrans computes when it calls back. Everything else about the gateway —
where the row lives, when access is written — belongs to payments.py, so the
transactions table keeps its one writer.

Nothing here decides access or records money. The token mint is a door being
opened, not money arriving; the signature check says only that a callback
plausibly came from Midtrans, and the webhook's handler still has to find the
order before believing it.
"""

import base64
import hashlib
import hmac
import logging
from dataclasses import dataclass

import httpx

from api.core.config import get_settings

logger = logging.getLogger(__name__)


class GatewayUnavailable(RuntimeError):
    """Midtrans could not be reached, or would not open the page."""


@dataclass(frozen=True)
class SnapSession:
    """What a successful token mint yields: the page and its token."""

    token: str
    redirect_url: str


def snap_base_url() -> str:
    """Which Midtrans site money flows toward — configuration, not a constant."""
    return (
        "https://app.midtrans.com"
        if get_settings().midtrans_is_production
        else "https://app.sandbox.midtrans.com"
    )


async def create_snap_token(
    *,
    order_id: str,
    gross_amount: int,
    email: str | None = None,
    expiry_minutes: int,
) -> SnapSession:
    """Open one Snap checkout page for `order_id` at the given total.

    The server key riding in the Authorization header is the same key the
    webhook signature is checked against: minting and proving share one secret
    by design, so a page this install opened is a page its webhook can vouch
    for. `credit_card.secure` is on — two-factor card payments are the
    gateway's own recommendation, and the flag is harmless to the other
    methods (QRIS, virtual accounts, e-wallets).

    `expiry_minutes` carries the same window the queue gives a manual
    declaration: a page that outlives the ledger's pending row would applaud a
    payment the settlement hook might later refuse context for.
    """
    settings = get_settings()
    if not settings.midtrans_server_key:
        raise GatewayUnavailable("no server key is configured on this install")
    payload = {
        "transaction_details": {
            "order_id": order_id,
            "gross_amount": int(gross_amount),
        },
        "expiry": {"unit": "minutes", "duration": int(expiry_minutes)},
        "credit_card": {"secure": True},
    }
    if email:
        payload["customer_details"] = {"email": email}
    basic = base64.b64encode(f"{settings.midtrans_server_key}:".encode()).decode()
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{snap_base_url()}/snap/v1/transactions",
                json=payload,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Authorization": f"Basic {basic}",
                },
            )
    except httpx.HTTPError as exc:
        logger.error(
            "midtrans: token mint for %s could not reach the gateway — %s",
            order_id,
            exc,
        )
        raise GatewayUnavailable("the gateway could not be reached") from exc
    if not response.is_success:
        # Midtrans' own error words go to the log, trimmed; the caller gets a
        # sentence, not the gateway's dump.
        logger.error(
            "midtrans: token mint for %s refused with HTTP %s — %s",
            order_id,
            response.status_code,
            response.text[:300],
        )
        raise GatewayUnavailable("the gateway refused to open the payment page")
    try:
        data = response.json()
    except ValueError as exc:
        logger.error("midtrans: token mint for %s answered unreadable body", order_id)
        raise GatewayUnavailable("the gateway answered something unreadable") from exc
    token = data.get("token")
    redirect_url = data.get("redirect_url")
    if not token or not redirect_url:
        logger.error(
            "midtrans: token mint for %s returned no page — %s",
            order_id,
            str(data)[:300],
        )
        raise GatewayUnavailable("the gateway answered without a payment page")
    logger.info("midtrans: checkout page opened for %s", order_id)
    return SnapSession(token=token, redirect_url=redirect_url)


def verify_webhook_signature(
    *, order_id: str, status_code: str, gross_amount: str, signature_key: str
) -> bool:
    """Whether this callback plausibly came from Midtrans.

    Midtrans signs SHA-512(order_id + status_code + gross_amount + server_key)
    and sends the hex back. The digest is taken over the callback's exact
    strings, because that is what Midtrans signed — normalising the total
    first would change what can authenticate itself. An install with no server
    key can prove nothing: nothing holding its credentials could have minted a
    page, and nothing arriving should be believed either.
    """
    server_key = get_settings().midtrans_server_key
    if not server_key:
        return False
    expected = hashlib.sha512(
        f"{order_id}{status_code}{gross_amount}{server_key}".encode()
    ).hexdigest()
    return hmac.compare_digest(expected, str(signature_key or ""))
