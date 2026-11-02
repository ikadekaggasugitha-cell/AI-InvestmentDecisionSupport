"""Payment queue: manual transfers and gateway rows, listed and adjudicated."""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from api.core.auth import AdminUser
from api.core.config import get_settings
from api.services.payment_service import manual_deadline
from api.services.payment_service.core import _MAX_QUEUE_FETCH, _QUEUE_LIMIT

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
    # When the money was accepted, for the rows where it was. The export carries
    # this column, so the screen reads it too: a file that leaves the console may
    # not hold a fact the console never showed.
    approvedAt: str | None = None
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


# ── CSV export ──────────────────────────────────────────────────────────

# Exactly the columns the queue shows on screen. No phone number, no password
# hash, no block timestamp: a file that leaves the console travels, and the
# smallest thing that answers the operator's question is the one to send.
# `approved_at` is the moment the money was accepted — the date an auditor asks
# for, and the reason `updated_at` is not in this file: that column also moves
# when a row is denied, so in a list of settled rows it would answer a different
# question than its name.
_CSV_HEADER = (
    "invoice_code",
    "created_at",
    "status",
    "plan",
    "amount",
    "payment_gateway",
    "payment_method",
    "payer_email",
    "admin_notes",
    "approved_at",
    "subscription_id",
)

# A cell starting with one of these is a formula to a spreadsheet. `admin_notes`
# is free text a payer wrote, so this is not a theoretical prefix list.
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_cell(value: object) -> str:
    """One cell, quoted, and neutered if it looks like a formula.

    Every field is quoted rather than only the awkward ones: a note containing a
    comma would otherwise split into two columns, and one containing a newline
    would become two rows of a file someone is going to trust.
    """
    text = "" if value is None else str(value)
    if text.startswith(_CSV_FORMULA_PREFIXES):
        text = "'" + text
    escaped = text.replace('"', '""')
    return f'"{escaped}"'


def transactions_csv(rows: list["AdminTransactionResponse"]) -> str:
    """The queue as CSV, with the header first.

    RFC 4180 line endings (CRLF), because the file is going to a spreadsheet on
    someone's laptop rather than to another program.
    """
    lines = [",".join(_csv_cell(name) for name in _CSV_HEADER)]
    for row in rows:
        lines.append(
            ",".join(
                _csv_cell(value)
                for value in (
                    row.invoiceCode,
                    row.createdAt,
                    row.status,
                    row.plan,
                    row.amount,
                    row.paymentGateway,
                    row.paymentMethod,
                    row.payerEmail,
                    row.notes,
                    row.approvedAt,
                    row.subscriptionId,
                )
            )
        )
    return "\r\n".join(lines) + "\r\n"


class AdminTransactionListResponse(BaseModel):
    """One page of the queue, and whether the page is the whole answer.

    `hasMore` is the field that keeps a bounded read from being mistaken for a
    complete one. Without it a truncated history and an empty one look the same,
    which is the difference between "these are all the payments" and "here are
    the first 200".
    """

    transactions: list[AdminTransactionResponse]
    hasMore: bool


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
        approvedAt=tx.approved_at.isoformat() if tx.approved_at else None,
        subscriptionId=str(tx.subscription_id) if tx.subscription_id else None,
        expiresAt=manual_deadline(tx.created_at, ttl_seconds).isoformat()
        if pending
        else None,
    )


@router.get(
    "/transactions",
    response_model=AdminTransactionListResponse,
    summary="The payment queue",
    description=(
        "Attempts to pay, oldest first, with the payer attached. `status`\n"
        "selects the working set — `pending` is the work, `expire` is the\n"
        "backlog that is still money, and the rest is history. Approval is a\n"
        "state change an operator reviews, so each row carries its evidence:\n"
        "amount, invoice number, account, and the declaration it left.\n\n"
        "Paged. `hasMore` says whether rows exist past this page, because a\n"
        "bounded read that does not say so reads as a complete history."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_list_transactions(
    admin: AdminUser,
    status_filter: str = Query(default="pending", alias="status"),
    limit: int = Query(default=50, ge=1, le=_QUEUE_LIMIT),
    offset: int = Query(default=0, ge=0),
) -> AdminTransactionListResponse:
    from api.services import payment_service as payments_service

    if status_filter not in _ALLOWED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"status must be one of {_ALLOWED_STATUSES}, got {status_filter!r}",
        )
    ttl_seconds = get_settings().manual_transaction_ttl_seconds
    try:
        rows, has_more = await payments_service.list_transactions_for_admin(
            None if status_filter == "all" else status_filter,
            limit=limit,
            offset=offset,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("admin: cannot read the payment queue — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The payment queue cannot be read right now.",
        ) from exc
    return AdminTransactionListResponse(
        transactions=[_tx_to_response(tx, ttl_seconds) for tx in rows],
        hasMore=has_more,
    )


@router.get(
    "/transactions/export",
    response_class=Response,
    summary="Export one page of the queue as CSV",
    description=(
        "The same rows the queue shows, in the same columns, as a file.\n\n"
        "Bounded, and it says so: a CSV that looks complete but stops at a cap\n"
        "is worse than no CSV, because the reader will reconcile against it and\n"
        "conclude the money is missing. When the window is cut short the last\n"
        "line of the file states the cap and the row count.\n\n"
        "This is a bulk read of customer emails, so it is logged with the\n"
        "operator who asked, the filter, and the size."
    ),
    responses={
        403: {"description": "Administrator access required"},
        422: {"description": "Unknown status filter"},
        503: {"description": "The queue cannot be read"},
    },
)
async def admin_export_transactions(
    admin: AdminUser,
    status_filter: str = Query(default="pending", alias="status"),
    limit: int = Query(default=_MAX_QUEUE_FETCH, ge=1, le=_MAX_QUEUE_FETCH),
    offset: int = Query(default=0, ge=0),
) -> Response:
    from api.services import payment_service as payments_service

    if status_filter not in _ALLOWED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"status must be one of {_ALLOWED_STATUSES}, got {status_filter!r}",
        )
    ttl_seconds = get_settings().manual_transaction_ttl_seconds
    try:
        rows, has_more = await payments_service.list_transactions_for_admin(
            None if status_filter == "all" else status_filter,
            limit=limit,
            offset=offset,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("admin: cannot read the queue for export — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The payment queue cannot be read right now.",
        ) from exc

    payload = [_tx_to_response(tx, ttl_seconds) for tx in rows]
    csv = transactions_csv(payload)
    if has_more:
        # The file admits its own bound rather than leaving the reader to
        # discover it by counting against the console.
        csv += (
            f'# truncated at {len(payload)} rows; more exist. '
            f"Re-ask with offset={offset + len(payload)} for the next page.\r\n"
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    logger.info(
        "payments: queue exported by %s — status=%s rows=%d offset=%d",
        admin.email,
        status_filter,
        len(payload),
        offset,
    )
    return Response(
        content=csv,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="aidss-antrean-{status_filter}-{stamp}.csv"'
        },
    )


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
