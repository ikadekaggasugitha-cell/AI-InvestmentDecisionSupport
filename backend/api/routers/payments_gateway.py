"""
Where Midtrans joins the money flow, and what it is allowed to say.

`POST /v1/payments/checkout` is the account's request for a payment page. The
body carries a plan and nothing else: the total is read inside the service
call, the invoice code becomes Midtrans' order_id, and what comes back is the
URL the account opens in another tab. On an install with no server key the
answer is 503 with a sentence saying the gateway is not wired — refusing to
pretend is cheaper than a button that goes nowhere quietly.

`POST /v1/payments/midtrans/webhook` cannot hold this app's session, so it
asks for none: its authentication is the signature Midtrans computes over the
callback's own numbers and the same server key that minted the page —
SHA-512 over order_id, status_code, gross_amount and that key, compared
constant-time. A callback whose signature verifies is read; one that verifies
but names an order this ledger never wrote answers 404 so Midtrans waits; one
whose signature fails answers 403 before anything is looked up at all.

Neither endpoint is entitlement-gated: payment state never decides access
(CONTEXT.md rule 3) — the account opening a checkout is exactly the one the
paywall refuses, and a callback can settle a row without ever consulting the
gate. The period, once earned, is written by `grant()` and nothing else.
"""

import logging
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.core.auth import CurrentUser
from api.core.config import get_settings
from api.routers.payments import PaymentResponse, manual_deadline
from api.services import payments as money
from api.services.settings import PricingUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/payments", tags=["payments"])


class CheckoutRequest(BaseModel):
    """The ask: which length the money is for, and nothing else.

    `extra="forbid"` for the same reason the manual declaration carries it —
    the total is a server fact, and a body proposing `amount` is proposing to
    price its own checkout. A refused field says refused; an ignored one reads
    as accepted.
    """

    model_config = ConfigDict(extra="forbid")

    plan: str = Field(description="'monthly' atau 'annual'")


class GatewayCheckoutResponse(PaymentResponse):
    """The checkout row, plus the page Midtrans will serve for it.

    `redirectUrl` is the whole handover: the frontend opens it rather than
    embedding the gateway, so no Midtrans client key travels to the browser
    and the page the account pays on is the page the server minted.
    """

    redirectUrl: str


def _checkout_response(tx, redirect_url: str) -> GatewayCheckoutResponse:
    pending = tx.status in ("pending", "expire")
    base = PaymentResponse(
        id=str(tx.id),
        invoiceCode=tx.invoice_code,
        amount=tx.amount,
        plan=tx.plan,
        paymentGateway=tx.payment_gateway,
        paymentMethod=tx.payment_method,
        status=tx.status,
        notes=None,
        createdAt=tx.created_at.isoformat(),
        expiresAt=(
            manual_deadline(
                tx.created_at, get_settings().manual_transaction_ttl_seconds
            ).isoformat()
            if pending
            else None
        ),
    )
    return GatewayCheckoutResponse(**base.model_dump(), redirectUrl=redirect_url)


class MidtransWebhook(BaseModel):
    """Midtrans' notification card, as its docs hand it over.

    The signature is defined over the callback's exact strings (`status_code`
    as "200", `gross_amount` as "15000.00"), so both are kept strings and the
    digest is taken over what the callback itself carries — normalising a
    number first would change the arithmetic a total can prove itself with.
    `extra="allow"` because Midtrans grows its payloads over time, and a
    callback carrying one field this model does not know should still be
    verified, not bounced.
    """

    model_config = ConfigDict(extra="allow")

    order_id: str
    status_code: str = ""
    gross_amount: str = ""
    signature_key: str = ""
    transaction_status: str = ""
    transaction_id: str | None = None
    payment_type: str | None = None
    fraud_status: str | None = None

    @field_validator(
        "order_id",
        "status_code",
        "gross_amount",
        "signature_key",
        "transaction_status",
        "transaction_id",
        "payment_type",
        "fraud_status",
        mode="before",
    )
    @classmethod
    def _as_text(cls, value):
        return None if value is None else str(value)


_SETTLED = ("capture", "settlement")
_REFUSED = ("deny", "cancel", "failure")


@router.post(
    "/checkout",
    response_model=GatewayCheckoutResponse,
    summary="Open a Midtrans checkout",
    description=(
        "One pending transaction, minted with the page Midtrans agrees to\n"
        "serve. The total is this server's price for the plan — the body\n"
        "prices nothing. An install without a server key answers 503, because\n"
        "a payment a server cannot settle is a page it should not mint."
    ),
)
async def checkout(body: CheckoutRequest, user: CurrentUser) -> GatewayCheckoutResponse:
    try:
        tx, redirect_url = await money.open_gateway_transaction(
            user.user_id,
            plan=body.plan,
            email=user.email,
        )
    except money.ManualPaymentInvalid as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except PricingUnavailable as exc:
        logger.error("payments: cannot open a checkout without a readable price — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Harga belum bisa dibaca di server ini, jadi pembayaran online "
            "belum bisa dibuka.",
        ) from exc
    except money.GatewayCheckoutUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.detail,
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("payments: gateway checkout failed — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Tidak dapat membuka pembayaran sekarang.",
        ) from exc
    return _checkout_response(tx, redirect_url)


@router.post(
    "/midtrans/webhook",
    summary="Midtrans' callback: the gateway has news about one order",
    description=(
        "Unauthenticated by session and authenticated by signature instead —\n"
        "the same server key that minted the page is the secret the callback\n"
        "proves itself with. Unknown signature: 403. Known signature for an\n"
        "order this ledger never wrote: 404, which Midtrans waits on and\n"
        "retries, so race rather than rejection is what answers this door."
    ),
)
async def midtrans_webhook(payload: MidtransWebhook) -> dict:
    from api.services.midtrans import verify_webhook_signature

    if not verify_webhook_signature(
        order_id=payload.order_id,
        status_code=payload.status_code,
        gross_amount=payload.gross_amount,
        signature_key=payload.signature_key,
    ):
        logger.warning(
            "payments: Midtrans webhook signature refused for order %s",
            payload.order_id,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Signature webhook tidak valid.",
        )

    tx = await money.transaction_by_invoice_code(payload.order_id)
    if tx is None:
        # Signed, but an order this ledger has never written. 404 rather than
        # 204: Midtrans retries non-2xx, so a row that is a breath behind its
        # page's first payment gets found on the retry — and a callback
        # genuinely naming nothing becomes part of the record instead of
        # vanishing into silence.
        logger.warning(
            "payments: signed Midtrans webhook for unknown order %s",
            payload.order_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order tidak dikenal.",
        )

    event = payload.transaction_status
    if event in _SETTLED:
        if payload.fraud_status == "challenge":
            # A capture is not a capture while the gateway is still asking the
            # bank whether the buyer is the buyer. The row stays pending, and
            # the callback does not touch it.
            return {"paymentStatus": tx.status, "action": "held-for-challenge"}
        try:
            received = Decimal(payload.gross_amount)
        except InvalidOperation:
            received = None
        if received is None or received != Decimal(tx.amount):
            logger.error(
                "payments: settlement total %s does not match the row's %s for %s — nothing moved",
                payload.gross_amount,
                tx.amount,
                tx.invoice_code,
            )
            return {"paymentStatus": "refused", "action": "amount-mismatch"}
        try:
            settled, period_ = await money.settle_gateway_transaction(
                tx.id, payload.transaction_id
            )
        except money.TransactionNotApprovable as exc:
            # Money that claims an answer the ledger has already given
            # otherwise — most plausibly an administrator denied it while the
            # gateway still liked the payment. The row's state stands; the
            # contradiction is logged, not obeyed.
            logger.error(
                "payments: settlement for %s refused, row is %s — %s",
                tx.invoice_code,
                exc.status,
                exc,
            )
            return {"paymentStatus": exc.status, "action": "settlement-refused"}
        except money.TransactionNotFound as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Order tidak dikenal.",
            ) from exc
        return {
            "paymentStatus": settled.status,
            "accessGranted": period_ is not None,
        }

    if event == "pending":
        # The row is already pending; telling it twice makes the ledger no
        # different. Answered so Midtrans stops repeating this card.
        return {"paymentStatus": tx.status, "action": "none"}

    if event == "expire":
        expired = await money.expire_gateway_transaction(tx.id, payload.transaction_id)
        return {"paymentStatus": "expire" if expired else tx.status, "action": "expired"}
        # A settled or denied row ignores the gateway's expiry: terminal
        # states do not age backward, which the UPDATE's WHERE alone makes
        # true.

    if event in _REFUSED:
        reason = f"status={event}"
        if payload.payment_type:
            reason += f", metode={payload.payment_type}"
        denied = await money.deny_gateway_transaction(
            tx.id, payload.transaction_id, reason
        )
        return {
            "paymentStatus": "deny" if denied else tx.status,
            "action": "denied" if denied else "ignored",
        }

    if event in ("refund", "partial_refund"):
        # Money going back is an administrator's decision to reverse, not an
        # automation's: settlement wrote the period and only the admin side
        # can close what access now exists (ADR-0008 — subscriptions' one
        # writer). Acknowledged so Midtrans does not retry a verdict this
        # handler is not the holder of.
        logger.warning(
            "payments: refund event for %s noted; access untouched — admin decides",
            payload.order_id,
        )
        return {"paymentStatus": tx.status, "action": "refund-noted"}

    logger.warning(
        "payments: unhandled Midtrans webhook status %r for %s",
        event,
        payload.order_id,
    )
    return {"paymentStatus": tx.status, "action": "ignored"}
