"""The payment destinations (rekening tujuan) an operator maintains."""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from api.core.auth import AdminUser
from api.services.bank_registry import options as bank_options
from api.services.system_settings_service import (
    BankAccountInvalid,
    BankAccountsUnavailable,
    read_bank_accounts,
    write_bank_accounts,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ── Rekening tujuan ──────────────────────────────────────────────────────────

class AdminBankAccountRequest(BaseModel):
    """One destination as the operator writes it.

    The router binds the field names and types; whether a string is an amount of
    bank name worth storing is the service's call (same split as pricing).
    """

    bank: str
    accountNumber: str
    holderName: str
    # Which entry in `bank_registry` this row is. Sent and read back, because the
    # form renders it as a select and a row that cannot re-select its own bank is
    # a row that loses its bank on the next save.
    code: str = "other"
    # Whether the paying public sees this destination. Defaulted to shown so a
    # row written before the field existed keeps behaving as it did.
    enabled: bool = True


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
                code=e.code,
                enabled=e.enabled,
            )
            for e in entries
        ],
        updatedAt=updated,
    )


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
            "code": a.code,
            "enabled": a.enabled,
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
                code=e.code,
                enabled=e.enabled,
            )
            for e in stored
        ]
    )


# ── The bank list the form selects from ─────────────────────────────────────

class BankOptionResponse(BaseModel):
    """One choice in the bank dropdown.

    Served instead of hardcoded in the frontend. A list copied to the browser is
    a list that eventually disagrees with the one the server validates against,
    and the disagreement surfaces as an operator unable to save a bank the other
    half has never heard of.
    """

    code: str
    name: str


class BankOptionsResponse(BaseModel):
    options: list[BankOptionResponse]


@router.get(
    "/settings/bank-options",
    response_model=BankOptionsResponse,
    summary="The banks a destination can be set to",
    description=(
        "Read-only, administrator-gated, and the only place the list lives.\n\n"
        "These are internal keys and display names. They are not bank clearing\n"
        "codes: nothing here is usable for routing money, and none was written\n"
        "from memory of one."
    ),
    responses={403: {"description": "Administrator access required"}},
)
async def admin_bank_options(admin: AdminUser) -> BankOptionsResponse:
    return BankOptionsResponse(
        options=[BankOptionResponse(code=o.code, name=o.name) for o in bank_options()]
    )
