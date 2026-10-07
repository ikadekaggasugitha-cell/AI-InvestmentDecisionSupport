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
from api.services.accounts import Account, list_accounts, set_blocked

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


class AccountListResponse(BaseModel):
    accounts: list[AdminAccountResponse]
    # Whether more rows exist past this page. Without it the caller cannot tell
    # "that is everyone" from "that is the first hundred".
    hasMore: bool


class BlockRequest(BaseModel):
    """An optional reason, recorded in the log rather than in the database.

    `blocked_at` is deliberately not being given a sibling column for this: it is
    an operational note, not a fact about access. If blocking later needs a reason
    the user can see, that is a column and an ADR, not a comment.
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

    updated = await set_blocked(account_id, True)
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
    return _to_response(await set_blocked(account_id, False))