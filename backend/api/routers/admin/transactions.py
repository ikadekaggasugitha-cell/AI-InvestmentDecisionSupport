"""Payment queue: manual transfers and gateway rows, listed and adjudicated."""

import logging
import uuid

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from api.core.auth import AdminUser
from api.core.config import get_settings
from api.services.payment_service import manual_deadline

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ── Payment queue (manual transfers, gateway rows later) ─────────────────────

_ALLOWED_STATUSES = ("pending", "settlement", "expire", "deny", "cancel", "all")


class AdminTransactionResponse(BaseModel):
    """One payment as the queue shows it.

    Nominal, plan, invoice number, the payer, the record the account left, and
    when the queue stops offering it. That is what the operator needs to match
    a transfer to an account — a list without the amount would be a list of the
    action without its evidence.
    """

    id: str
    invoiceCode: str
    amount: int
    plan: str
    paymentGateway: str
    paymentMethod: str
    status: str
    notes: str | None = None
    payerEmail: str | None = None
    createdAt: str
    updatedAt: str | None = None
    # Set only when the money became a Subscription: the queue's answer to
    # "what did this buy" after approve, and the id a repeat approve must reuse.
    subscriptionId: str | None = None
    # When the queue stops offering a pending row. A deadline the queue enforces
    # is hygiene; the money stays real either way.
    expiresAt: str | None = None


class ApprovePaymentResponse(BaseModel):
    """What approve did, read back.

    `subscriptionId` and `subscriptionExpiresAt` name the period the money
    bought — the visible state the plan calls for, rather than a toast. A
    repeat approve returns the same period it first minted, not a new one.
    """

    transactionId: str
    invoiceCode: str
    plan: str
    amount: int
    status: str
    subscriptionId: str
    subscriptionExpiresAt: str


class DenyPaymentRequest(BaseModel):
    """The refusal, with the reason that made it true.

    Required rather than optional because a denial without a reason gives the
    account nothing to argue with and the operator nothing to audit.
    """

    reason: str = Field(min_length=1, max_length=1000)


def _tx_to_response(tx, ttl_seconds: int) -> AdminTransactionResponse:
    pending = tx.status in ("pending", "expire")
    return AdminTransactionResponse(
        id=str(tx.id),
        invoiceCode=tx.invoice_code,
        amount=tx.amount,
        plan=tx.plan,
        paymentGateway=tx.payment_gateway,
        paymentMethod=tx.payment_method,
        status=tx.status,
        notes=tx.admin_notes,
        payerEmail=tx.email,
        createdAt=tx.created_at.isoformat(),
        updatedAt=tx.updated_at.isoformat() if tx.updated_at else None,
        subscriptionId=str(tx.subscription_id) if tx.subscription_id else None,
        expiresAt=manual_deadline(tx.created_at, ttl_seconds).isoformat()
        if pending
        else None,
    )


@router.get(
    "/transactions",
    response_model=list[AdminTransactionResponse],
    summary="The payment queue",
    description=(
        "Attempts to pay, oldest first, with the payer attached. `status`\n"
        "selects the working set — `pending` is the work, `expire` is the\n"
        "backlog that is still money, and the rest is history. Approval is a\n"
        "state change an operator reviews, so each row carries its evidence:\n"
        "amount, invoice number, account, and the declaration it left."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_list_transactions(
    admin: AdminUser,
    status_filter: str = Query(default="pending", alias="status"),
) -> list[AdminTransactionResponse]:
    from api.services import payment_service as payments_service

    if status_filter not in _ALLOWED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"status must be one of {_ALLOWED_STATUSES}, got {status_filter!r}",
        )
    ttl_seconds = get_settings().manual_transaction_ttl_seconds
    try:
        rows = await payments_service.list_transactions_for_admin(
            None if status_filter == "all" else status_filter
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("admin: cannot read the payment queue — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The payment queue cannot be read right now.",
        ) from exc
    return [_tx_to_response(tx, ttl_seconds) for tx in rows]


@router.post(
    "/transactions/{transaction_id}/approve",
    response_model=ApprovePaymentResponse,
    summary="Accept a payment and write the period it bought",
    description=(
        "Marks the money received and writes the Subscription in **one**\n"
        "database transaction: neither can succeed while the other fails, so a\n"
        "crash cannot leave a settled payment without the access it paid for.\n\n"
        "Expiry is queue hygiene, not a verdict: an `expire`d row is still\n"
        "money someone sent, so approving it still works. A row already\n"
        "settled answers with the Subscription it first minted rather than a\n"
        "second one. The granted period follows the plan on the row — 30 days\n"
        "monthly, 365 days annual — not a length the body proposes."
    ),
    responses={
        403: {"description": "Administrator access required"},
        404: {"description": "No such transaction"},
        409: {"description": "The transaction is in a state approve cannot proceed from"},
    },
)
async def admin_approve_transaction(
    transaction_id: uuid.UUID, admin: AdminUser
) -> ApprovePaymentResponse:
    from api.services import payment_service as payments_service

    try:
        tx, period = await payments_service.approve_transaction(
            transaction_id, admin.user_id
        )
    except payments_service.TransactionNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found.",
        )
    except payments_service.TransactionNotApprovable as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )
    except payments_service.TransactionOwnershipError as exc:
        logger.error("payments: ownership guard raised during approve — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The transaction belongs to another account.",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("payments: approve failed, nothing was changed — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Approve did not complete. The transaction is unchanged.",
        ) from exc

    if tx.status != "settlement" or tx.subscription_id is None:
        # Unreachable through every path above; reaching it means the service
        # answered something its own contract rules out.
        logger.error("payments: approve returned %s without a subscription", tx.status)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Approve did not complete. The transaction is unchanged.",
        )
    logger.info(
        "payments: %s settled by %s — %s (%s, %d days), subscription %s",
        tx.invoice_code,
        admin.email,
        tx.amount,
        tx.plan,
        payments_service.PLAN_DAYS[tx.plan],
        period.id,
    )
    return ApprovePaymentResponse(
        transactionId=str(tx.id),
        invoiceCode=tx.invoice_code,
        plan=tx.plan,
        amount=tx.amount,
        status=tx.status,
        subscriptionId=str(period.id),
        subscriptionExpiresAt=period.expires_at.isoformat(),
    )


@router.post(
    "/transactions/{transaction_id}/deny",
    response_model=AdminTransactionResponse,
    summary="Refuse a payment's evidence",
    description=(
        "Writes `deny`, who wrote it, and the reason — joined onto the record\n"
        "the account left, so the row still explains what was claimed. A\n"
        "denial touches **nothing** the account holds: refusing evidence\n"
        "cannot retroactively change access the Subscription already granted."
    ),
    responses={
        403: {"description": "Administrator access required"},
        404: {"description": "No such transaction"},
        409: {"description": "The transaction is settled, and denial would revoke access"},
        422: {"description": "The reason is missing"},
    },
)
async def admin_deny_transaction(
    transaction_id: uuid.UUID,
    admin: AdminUser,
    body: DenyPaymentRequest,
) -> AdminTransactionResponse:
    from api.services import payment_service as payments_service

    ttl_seconds = get_settings().manual_transaction_ttl_seconds
    try:
        tx = await payments_service.deny_transaction(
            transaction_id, admin.user_id, body.reason
        )
    except payments_service.DenyRequiresReason as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except payments_service.TransactionNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found.",
        )
    except payments_service.TransactionNotDeniable as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("payments: deny failed, nothing was changed — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Deny did not complete. The transaction is unchanged.",
        ) from exc

    if tx.status != "deny":
        logger.error("payments: deny returned status %s", tx.status)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Deny did not complete. The transaction is unchanged.",
        )
    logger.info("payments: %s denied by %s", tx.invoice_code, admin.email)
    return _tx_to_response(tx, ttl_seconds)
