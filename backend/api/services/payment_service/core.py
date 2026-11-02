"""
Payment vocabulary: the plan slots, the limits, the row shape, the errors.

Shared by the two writers of `transactions` — the manual queue and the gateway
join — so neither keeps its own copy of what a Transaction row means.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from api.services.system_settings_service import Pricing

# The blueprint's durations, one access length per slot the product sells: a
# weekly purchase is 7 days of access, a monthly one is 30, an annual one is
# 365. Fixed here because they are the three periods the product sells — not
# values an operator tunes per approval.
PLAN_DAYS = {"weekly": 7, "monthly": 30, "annual": 365}
PLAN_NAMES = tuple(PLAN_DAYS)


def _plan_amount(plan: str, pricing: Pricing) -> int:
    """The rupiah amount to charge for `plan`, straight off `pricing`.

    The plan names and the Pricing field names are one vocabulary — every field
    matches a PLAN_DAYS key — so `getattr` answers with the row that belongs to
    that gate and fails loudly if the two ever drift apart.
    """
    return getattr(pricing, plan)


def _new_invoice_code() -> str:
    """Server-minted and unique; the body never gets to propose one.

    UTC stamp plus random tail. A repeat matters only at the UNIQUE index, and
    the insert retries with a fresh tail until it wins.
    """
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"INV-{stamp}-{secrets.token_hex(3).upper()}"


# A buyer says where the money went in one word; the queue shows it to the
# operator matching the transfer. Rewritten to the blueprint's vocabulary:
# qris, va_bca, va_mandiri, bank_transfer.
PAYMENT_METHODS = ("qris", "va_bca", "va_mandiri", "bank_transfer")

_MAX_NOTE_CHARS = 500
_MAX_METHOD_CHARS = 50
_QUEUE_LIMIT = 200
_OWN_LIST_LIMIT = 50

# The most any one admin read may pull, whatever the caller asked for. The queue
# page is far smaller; this is the ceiling behind the CSV export, where an
# operator legitimately wants a season of history in one file. Kept as one
# number in one place so a request cannot ask for the whole table and make the
# database build a response nobody reads.
_MAX_QUEUE_FETCH = 5000


class ManualPaymentInvalid(ValueError):
    """A declaration that cannot go into the queue as asked."""


class TransactionNotApprovable(RuntimeError):
    """The transaction is in a state that settle cannot proceed from.

    Carries the current status: a settled payment is already served by its
    claim (the caller re-reads rather than granting again), and `deny`/`cancel`
    are final answers the admin must reverse another way.
    """

    def __init__(self, status: str):
        super().__init__(
            f"transaction is {status!r}; only 'pending' and 'expire' "
            "can be settled"
        )
        self.status = status


class TransactionNotDeniable(RuntimeError):
    """The transaction cannot be denied from its current state.

    `settlement` is money already turned into access; denying it would revoke
    what the buyer holds, and that is the admin endpoint's separate decision.
    """

    def __init__(self, status: str):
        super().__init__(f"transaction is {status!r} and cannot be denied")
        self.status = status


class DenyRequiresReason(ValueError):
    """A denial with no reason gives nobody anything to check against."""


@dataclass(frozen=True)
class Transaction:
    """One attempt to pay, as the money flow sees it after the statement ran."""

    id: uuid.UUID
    user_id: uuid.UUID
    invoice_code: str
    amount: int
    plan: str
    payment_gateway: str
    payment_method: str
    status: str
    admin_notes: str | None
    subscription_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime | None
    # When the money was accepted. Written by both the manual approve and the
    # gateway settlement, so it is the one timestamp that means the same thing on
    # every settled row — unlike `updated_at`, which also moves when a row is
    # denied.
    approved_at: datetime | None = None
    email: str | None = None  # the admin queue's row carries the payer


_TX_COLUMNS = """
        id, user_id, invoice_code, amount, plan, payment_gateway, payment_method,
        status, admin_notes, subscription_id, created_at, updated_at, approved_at
"""


def _to_transaction(row) -> Transaction:
    notes = row["admin_notes"]
    amount = row["amount"]
    return Transaction(
        id=row["id"] if isinstance(row["id"], uuid.UUID) else uuid.UUID(str(row["id"])),
        user_id=(
            row["user_id"]
            if isinstance(row["user_id"], uuid.UUID)
            else uuid.UUID(str(row["user_id"]))
        ),
        invoice_code=row["invoice_code"],
        # NUMERIC arrives as Decimal; rupiah amounts are whole numbers, and a
        # Decimal leaking into JSON serialisation would 500 the response.
        amount=int(amount),
        plan=row["plan"],
        payment_gateway=row["payment_gateway"],
        payment_method=row["payment_method"],
        status=row["status"],
        admin_notes=notes if notes is None else str(notes),
        subscription_id=(
            row["subscription_id"]
            if row["subscription_id"] is None
            else (
                row["subscription_id"]
                if isinstance(row["subscription_id"], uuid.UUID)
                else uuid.UUID(str(row["subscription_id"]))
            )
        ),
        created_at=row["created_at"],
        updated_at=row.get("updated_at"),
        approved_at=row.get("approved_at"),
        email=row.get("email"),
    )
