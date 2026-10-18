"""
Administrative actions on accounts.

Registration is open and every account it creates has role 'user'. Nothing in the
request path can produce an 'admin', and nothing in the request path could block
one either: `blocked_at` had a column, a reader and no writer, so the capability
existed on paper only. These endpoints are the writer.

Why a script and an endpoint both exist: `db/promote_admin.py` creates the first
administrator because a brand-new install has nobody to promote. Once one exists,
promoting and demoting is a routine action and belongs behind the API rather than
in a shell on someone's laptop — an operator should not need database access to
close an account that is being abused.

Two rules worth stating, because both are easy to get wrong:

  * **No email in the path.** The path parameter is a UUID. Emails change, and
    `lower(email)` uniqueness means case variants resolve to one account but a
    typo resolves to none; an id cannot be misremembered into someone else's
    account.

  * **Role and block are separate.** `require_entitlement` reads a Subscription,
    `AdminUser` reads a role. CONTEXT.md rule 6 forbids one standing in for the
    other, so an administrator is still gated on the paid data, and blocking an
    administrator is a normal account operation rather than a role change.

Blocking does not delete sessions. `authenticate()` re-reads `blocked_at` on every
request, so a block takes effect immediately without touching them — which is
CONTEXT.md rule 8, not an oversight.
"""

import logging
import uuid

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from api.core.auth import AdminUser
from api.core.config import get_settings
from api.services.accounts import Account, get_account, list_accounts, set_blocked
from api.services.payments import (
    manual_deadline,
)
from api.services.settings import (
    BankAccountInvalid,
    BankAccountsUnavailable,
    PriceOutOfRange,
    PricingUnavailable,
    read_bank_accounts,
    read_pricing,
    write_bank_accounts,
    write_pricing,
)
from api.services.subscriptions import InvalidGrant, grant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/admin", tags=["admin"])


class AdminAccountResponse(BaseModel):
    id: str
    email: str
    full_name: str
    phone_number: str
    role: str
    blocked: bool
    # When the block happened, not just that it is in effect. "This account is
    # closed" and "this account has been closed since Tuesday" answer different
    # questions when someone is trying to work out whether a block was applied.
    blocked_at: str | None = None
    # Which kind of closure: 'admin' or 'subscription_expired'. The kind decides
    # what may open the account again — payment reopens the second, only this
    # endpoint's unblock reopens the first — so an administrator reading the list
    # sees the same fact the access check will act on, not a paraphrase of it.
    blocked_reason: str | None = None


class AccountListResponse(BaseModel):
    accounts: list[AdminAccountResponse]
    # Whether more rows exist past this page. Without it the caller cannot tell
    # "that is everyone" from "that is the first hundred".
    hasMore: bool


class BlockRequest(BaseModel):
    """An optional free-text reason, sung in the audit log rather than stored.

    The database does carry `blocked_reason`, but only as a fixed vocabulary —
    'admin' or 'subscription_expired' — because that value is what access code
    branches on. What the operator types here is prose for humans reading the
    log; folding prose into the column would make every reader parse sentences
    to find out whether a payment may open the account.
    """

    reason: str | None = Field(None, max_length=280)


def _to_response(account: Account) -> AdminAccountResponse:
    return AdminAccountResponse(
        id=str(account.id),
        email=account.email,
        full_name=account.full_name,
        phone_number=account.phone_number,
        role=account.role,
        blocked=account.blocked_at is not None,
        blocked_at=account.blocked_at.isoformat() if account.blocked_at else None,
        blocked_reason=account.blocked_reason,
    )


@router.get(
    "/accounts",
    response_model=AccountListResponse,
    summary="List accounts",
    description=(
        "Newest first. Paged, because an unpaged list of every account is a slow "
        "query exactly when the table is most worth looking at."
    ),
)
async def admin_list_accounts(
    admin: AdminUser,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> AccountListResponse:
    accounts = await list_accounts(limit=limit + 1, offset=offset)
    # One over-fetch is how hasMore is answered without a second COUNT query.
    has_more = len(accounts) > limit
    return AccountListResponse(
        accounts=[_to_response(a) for a in accounts[:limit]],
        hasMore=has_more,
    )


@router.post(
    "/accounts/{account_id}/block",
    response_model=AdminAccountResponse,
    summary="Block an account",
    description=(
        "Takes effect on the account's next request. The session rows are left in "
        "place and the block is re-checked on every request, so access stops "
        "immediately without a second mechanism."
    ),
    responses={404: {"description": "No such account"}},
)
async def admin_block_account(
    account_id: uuid.UUID,
    admin: AdminUser,
    body: BlockRequest | None = None,
) -> AdminAccountResponse:
    """Block `account_id`.

    Self-blocking is refused. An administrator who closes their own account locks
    every other administrator out of the way to undo it, because the promotion
    script needs a shell and the endpoint needs a session. The refusal is
    deliberate rather than an oversight to fix later.
    """
    if str(account_id) == str(admin.user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An administrator cannot block their own account.",
        )

    updated = await set_blocked(account_id, True, reason="admin")
    if body and body.reason:
        logger.info("admin: block reason for %s: %s", account_id, body.reason)
    return _to_response(updated)


@router.delete(
    "/accounts/{account_id}/block",
    response_model=AdminAccountResponse,
    summary="Unblock an account",
    description=(
        "Clears `blocked_at`. A second block records a new timestamp, so the "
        "history of when access was on and off is not blurred by a stale value."
    ),
    responses={404: {"description": "No such account"}},
)
async def admin_unblock_account(
    account_id: uuid.UUID, admin: AdminUser
) -> AdminAccountResponse:
    return _to_response(await set_blocked(account_id, False, reason="admin"))


# ── Manual subscription grants ───────────────────────────────────────────────

class SubscriptionGrantRequest(BaseModel):
    """The period to grant, in whole days.

    `days` is validated in the service, not here, for the same reason the price
    range is: a bound written in two places is a bound that disagrees with
    itself. What counts as a period of access is a billing decision.
    """

    days: int = Field(description="Panjang periode yang diberikan, dalam hari")
    reason: str | None = Field(None, max_length=280)


class SubscriptionGrantResponse(BaseModel):
    """The period created by the grant, read back from the service.

    `expiresAt` comes from the row, not from the body — the caller asked for a
    number of days and does not decide when the period ends.
    """

    accountId: str
    subscriptionId: str
    expiresAt: str


@router.post(
    "/accounts/{account_id}/subscription",
    response_model=SubscriptionGrantResponse,
    summary="Grant a subscription period manually",
    description=(
        "Adds an unexpired period for the account, `days` counted from now. In an\n"
        "install without payments this is the only way an account can come to\n"
        "hold one, including the operator's own.\n\n"
        "`require_admin` rather than `require_entitlement` (CONTEXT.md rule 6):\n"
        "granting is running the product, not using the paid analysis, and an\n"
        "administrator often has no subscription of their own. A non-admin is\n"
        "refused with 403 — not a billing refusal, so not 402.\n\n"
        "A blocked account can still be granted: the block decides access, not\n"
        "what the account is entitled to (CONTEXT.md rule 8)."
    ),
    responses={
        403: {"description": "Administrator access required"},
        404: {"description": "No such account"},
        422: {"description": "The period as asked cannot exist"},
    },
)
async def admin_grant_subscription(
    account_id: uuid.UUID,
    admin: AdminUser,
    body: SubscriptionGrantRequest,
) -> SubscriptionGrantResponse:
    """Grant `body.days` of access to `account_id`, operator-requested.

    No payment row exists on this path, so every call is a new period and there
    is no idempotency key — repeating the action grants again, which is what an
    operator extending someone's access would expect.
    """
    account = await get_account(account_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found.",
        )

    try:
        period = await grant(account_id, days=body.days)
    except InvalidGrant as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        # 503, not 404 and not 403: the account exists, the role checked out,
        # and the write failed for a reason neither the caller nor the operator
        # chose. Reporting success here would claim access was granted when it
        # was not.
        logger.error(
            "admin: cannot grant %s days to %s — %s", body.days, account_id, exc
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot grant the subscription right now.",
        ) from exc

    if body.reason:
        logger.info(
            "admin: subscription grant reason for %s: %s", account_id, body.reason
        )
    return SubscriptionGrantResponse(
        accountId=str(period.user_id),
        subscriptionId=str(period.id),
        expiresAt=period.expires_at.isoformat(),
    )


# ── Pricing ──────────────────────────────────────────────────────────────────

class PricingResponse(BaseModel):
    """The current price, as the operator sees it.

    Same three fields as the public endpoint. It is a second read of one fact, and
    that is deliberate: the public one answers for a prospective buyer and never
    fails with 403, while this one answers for somebody who is already an operator
    and says so plainly when they are not. Without it the admin form would either
    render its prices without knowing it is allowed to, or ask a public endpoint
    and lose the refusal entirely.
    """

    monthly: int
    annual: int
    updatedAt: str | None = None


@router.get(
    "/settings/pricing",
    response_model=PricingResponse,
    summary="Read the current subscription price",
    description=(
        "What the operator is looking at before changing it. Same source as the\n"
        "public `GET /v1/subscriptions/pricing`; separated so that a non-administrator\n"
        "gets 403 here rather than being quietly handed the answer anyway."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_get_pricing(admin: AdminUser) -> PricingResponse:
    try:
        pricing = await read_pricing()
    except PricingUnavailable as exc:
        logger.error("admin pricing: system_settings has no usable price — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No pricing is configured on this server.",
        ) from exc
    return PricingResponse(
        monthly=pricing.monthly, annual=pricing.annual, updatedAt=pricing.updated_at
    )


class PricingUpdateRequest(BaseModel):
    """Both prices, or neither.

    Required rather than optional on purpose. A partial body would apply one
    price from this moment beside the other from the last, and that combination
    was never chosen by anyone.
    """

    monthly: int = Field(description="Harga bulanan dalam rupiah penuh")
    annual: int = Field(description="Harga tahunan dalam rupiah penuh")


@router.put(
    "/settings/pricing",
    response_model=PricingResponse,
    summary="Set the subscription price",
    description=(
        "Replaces both prices. Written as one statement, so a reader can never see a\n"
        "new monthly price beside an old annual one.\n\n"
        "`require_admin`, not `require_entitlement`: setting the price is running the\n"
        "product, which is a different question from using the paid analysis\n"
        "(CONTEXT.md rule 6). A non-admin is refused with 403, not 402 — they have\n"
        "not run into a billing problem."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_set_pricing(
    admin: AdminUser,
    body: PricingUpdateRequest,
) -> PricingResponse:
    """Set `body.monthly` and `body.annual`.

    The range check lives in the service, not here. This router rejects a body
    that is the wrong shape; deciding what counts as an amount of money is the
    service's job, and putting the bound in both places guarantees the two
    disagree eventually.
    """
    try:
        pricing = await write_pricing(body.monthly, body.annual)
    except PriceOutOfRange as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return PricingResponse(
        monthly=pricing.monthly,
        annual=pricing.annual,
        updatedAt=pricing.updated_at,
    )


# ── Rekening tujuan ──────────────────────────────────────────────────────────

class AdminBankAccountRequest(BaseModel):
    """One destination as the operator writes it.

    The router binds the field names and types; whether a string is an amount of
    bank name worth storing is the service's call (same split as pricing).
    """

    bank: str
    accountNumber: str
    holderName: str


class AdminBankAccountsRequest(BaseModel):
    """The whole list, or nothing.

    Required rather than a patch, because the stored value IS the list: a partial
    body cannot know which destinations the operator intends to keep.
    """

    accounts: list[AdminBankAccountRequest]


class AdminBankAccountsResponse(BaseModel):
    """The list as it now stands, read back from the service.

    `updatedAt` is filled only by the read that comes with it: it is when the
    operator last changed the list, which is the one timestamp worth showing on
    the form and not part of what a PUT decides.
    """

    accounts: list[AdminBankAccountRequest]
    updatedAt: str | None = None


@router.get(
    "/settings/bank-accounts",
    response_model=AdminBankAccountsResponse,
    summary="Read the transfer destinations as installed",
    description=(
        "What the form is looking at before changing the list, from the source the\n"
        "public endpoint reads. Separated from `GET /v1/subscriptions/bank-accounts`\n"
        "for the same reason the price is: a non-administrator gets 403 here rather\n"
        "than a sessionless version of the same answer."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_get_bank_accounts(admin: AdminUser) -> AdminBankAccountsResponse:
    try:
        entries, updated = await read_bank_accounts()
    except BankAccountsUnavailable as exc:
        logger.error("admin bank-accounts: stored list is unreadable — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The stored destination list is unreadable.",
        ) from exc
    return AdminBankAccountsResponse(
        accounts=[
            AdminBankAccountRequest(
                bank=e.bank,
                accountNumber=e.account_number,
                holderName=e.holder_name,
            )
            for e in entries
        ],
        updatedAt=updated,
    )


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
    from api.services import payments as payments_service

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
    from api.services import payments as payments_service

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
    from api.services import payments as payments_service

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


@router.put(
    "/settings/bank-accounts",
    response_model=AdminBankAccountsResponse,
    summary="Replace the transfer destinations",
    description=(
        "Writes the whole list as one statement, so a public reader can never see\n"
        "half a change. `require_admin`, not `require_entitlement` (CONTEXT.md\n"
        "rule 6): setting destinations is running the product, and a non-admin is\n"
        "refused with 403, not 402.\n\n"
        "An empty list is refused by the service — saving nothing and deleting\n"
        "every destination are the same write, and that is not an accident to\n"
        "ship from a form whose last row was removed silently."
    ),
    responses={
        403: {"description": "Administrator access required"},
        422: {"description": "The list, or an entry in it, cannot be stored"},
        503: {"description": "The write did not happen"},
    },
)
async def admin_set_bank_accounts(
    admin: AdminUser,
    body: AdminBankAccountsRequest,
) -> AdminBankAccountsResponse:
    """Replace the destination list with `body.accounts`.

    The stored shape is the blueprint's `bank` / `account_number` /
    `holder_name`; the camelCase names on the wire stay in the HTTP layer, and
    converting is this router's job rather than a schema translated twice.
    """
    payload = [
        {
            "bank": a.bank,
            "account_number": a.accountNumber,
            "holder_name": a.holderName,
        }
        for a in body.accounts
    ]
    try:
        stored = await write_bank_accounts(payload)
    except BankAccountInvalid as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        # The operator is watching a form that reports what was saved; a 503
        # keeps their screen from answering with the number they typed.
        logger.error("admin: cannot write bank_accounts — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot save the destinations right now.",
        ) from exc

    return AdminBankAccountsResponse(
        accounts=[
            AdminBankAccountRequest(
                bank=e.bank,
                accountNumber=e.account_number,
                holderName=e.holder_name,
            )
            for e in stored
        ]
    )
