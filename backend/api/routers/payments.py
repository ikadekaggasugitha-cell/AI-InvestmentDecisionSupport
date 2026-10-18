"""
A buyer declaring money moved, and their own record of it.

`POST /v1/payments/manual` is the statement, not a receipt: the account says a
transfer went out, and the row that appears is `pending` until a human matches
the money. Nothing about this endpoint grants access — no Subscription is
written, and none could be taken back if it were — which is why the amount is
taken from the server's price rather than from the body: a declaration whose
amount is the buyer's to type is a price the buyer sets.

`GET /v1/payments/me` is the account's own attempt history, including denials.
A rejected transfer that vanishes would look identical to an accepted one's
replacement, and this record is how "where is my payment" has an answer.

Both endpoints are authenticated and neither is entitlement-gated: the account
asking where its payment stands is the one the paywall refuses, and payment
state never decides access (CONTEXT.md rule 3).
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from api.core.auth import CurrentUser
from api.core.config import get_settings
from api.services.payments import (
    ManualPaymentInvalid,
    Transaction,
    list_transactions_for_user,
    manual_deadline,
    open_manual_transaction,
)
from api.services.settings import PricingUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/payments", tags=["payments"])


class ManualPaymentRequest(BaseModel):
    """The declaration: which length the money is for, and where it went.

    `extra="forbid"` is not decoration — `invoice_code` and `amount` are both
    server-minted facts, and a body proposing either is proposing to write the
    receipt itself. Refusing the field beats ignoring it, because an ignored
    field reads as accepted to whoever sent it.
    """

    model_config = ConfigDict(extra="forbid")

    plan: str = Field(description="'monthly' or 'annual'")
    payment_method: str = Field(
        description="Yang dipakai mentransfer: qris, va_bca, va_mandiri, atau bank_transfer"
    )
    note: str | None = Field(
        None,
        max_length=500,
        description="Catatan untuk admin yang mencocokkan transfer — nomor dan nama pengirim",
    )


class PaymentResponse(BaseModel):
    """One attempt to pay, as its owner and the queue both see it.

    `expiresAt` is when the queue stops offering a pending declaration. It is
    never the end of anything: expired money stays approvable, and the words
    beside the date say so.
    """

    id: str
    invoiceCode: str
    amount: int
    plan: str
    paymentGateway: str
    paymentMethod: str
    status: str
    notes: str | None = None
    createdAt: str
    expiresAt: str | None = None


def _to_response(tx: Transaction, ttl_seconds: int) -> PaymentResponse:
    pending = tx.status in ("pending", "expire")
    return PaymentResponse(
        id=str(tx.id),
        invoiceCode=tx.invoice_code,
        amount=tx.amount,
        plan=tx.plan,
        paymentGateway=tx.payment_gateway,
        paymentMethod=tx.payment_method,
        status=tx.status,
        notes=tx.admin_notes,
        createdAt=tx.created_at.isoformat(),
        # The deadline belongs on pending and expired rows alike: for a pending
        # one it is the moment the queue will stop offering it, for an expired
        # one it is when that happened. It is not the end of the money.
        expiresAt=manual_deadline(tx.created_at, ttl_seconds).isoformat()
        if pending
        else None,
    )


@router.post(
    "/manual",
    response_model=PaymentResponse,
    summary="Declare a manual transfer",
    description=(
        "Writes one `pending` transaction. `amount` is this server's price for\n"
        "the plan at this moment — the body has no amount field, and none will\n"
        "be added: a claim the buyer can price is a checkout the buyer controls.\n\n"
        "No Subscription is written, and none should be: nothing has been\n"
        "received, and a written period cannot be honestly taken back.\n\n"
        "Several pending declarations may exist at once — an unpaid first\n"
        "attempt is not an error, it is money in flight."
    ),
)
async def declare_manual_payment(
    body: ManualPaymentRequest, user: CurrentUser
) -> PaymentResponse:
    try:
        tx = await open_manual_transaction(
            user.user_id,
            plan=body.plan,
            payment_method=body.payment_method,
            note=body.note,
        )
    except ManualPaymentInvalid as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except PricingUnavailable as exc:
        logger.error("payments: cannot declare without a readable price: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Harga belum bisa dibaca di server ini, jadi transfer belum "
            "bisa dinyatakan.",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("payments: manual declaration failed — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Tidak dapat mencatat transfer sekarang.",
        ) from exc

    return _to_response(tx, get_settings().manual_transaction_ttl_seconds)


@router.get(
    "/me",
    response_model=list[PaymentResponse],
    summary="This account's own attempts to pay",
    description=(
        "Newest first, denials included: a rejected transfer that disappeared\n"
        "would read the same as an accepted one. Status here is information for\n"
        "the account, not a gate — a pending row never blocks anything."
    ),
)
async def my_payments(user: CurrentUser) -> list[PaymentResponse]:
    ttl_seconds = get_settings().manual_transaction_ttl_seconds
    try:
        rows = await list_transactions_for_user(user.user_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("payments: cannot read own history — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Riwayat pembayaran tidak dapat dimuat.",
        ) from exc
    return [_to_response(tx, ttl_seconds) for tx in rows]
