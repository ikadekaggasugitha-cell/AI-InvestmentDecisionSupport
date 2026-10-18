"""
The money flow: money declared, approved, denied, and left to age.

Every SQL statement that touches `transactions` lives here, for the same reason
`accounts.py` owns `users`: one writer per table is what makes
`transactions.subscription_id` a fact anyone can trust. The admin queue, the
declared transfer, and the expiry beat all come through these functions, and the
gateway phase later joins them rather than adding a second file of UPDATEs.

The table records money flow only. Nothing here decides access: a settlement
does not open data, and a denial does not close it — `subscriptions.expires_at`
stays the only access decision (CONTEXT.md rule 1), and the Subscription itself
is written by `grant()` and nothing else.

Approval runs inside one database transaction, because the two things it does —
marking money received and minting the period it bought — must stand or fall
together. A crash in between would leave a settled payment whose access never
appeared: the exact state "kegagalan di tengah tidak meninggalkan `settlement`
tanpa Subscription" exists to forbid.
"""

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import asyncpg

from api.core.db import get_pool
from api.services.settings import PricingUnavailable, read_pricing
from api.services.subscriptions import (
    TransactionNotFound,
    TransactionOwnershipError,
    SubscriptionPeriod,
    grant,
)

logger = logging.getLogger(__name__)

# The blueprint's durations: a monthly purchase is 30 days of access, an annual
# one is 365. Fixed here because they are the two periods the product sells —
# not values an operator tunes per approval.
PLAN_DAYS = {"monthly": 30, "annual": 365}
PLAN_NAMES = tuple(PLAN_DAYS)

# A buyer says where the money went in one word; the queue shows it to the
# operator matching the transfer. Rewritten to the blueprint's vocabulary:
# qris, va_bca, va_mandiri, bank_transfer.
PAYMENT_METHODS = ("qris", "va_bca", "va_mandiri", "bank_transfer")

_MAX_NOTE_CHARS = 500
_MAX_METHOD_CHARS = 50
_QUEUE_LIMIT = 200
_OWN_LIST_LIMIT = 50


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
    email: str | None = None  # the admin queue's row carries the payer


_TX_COLUMNS = """
        id, user_id, invoice_code, amount, plan, payment_gateway, payment_method,
        status, admin_notes, subscription_id, created_at, updated_at
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
        email=row.get("email"),
    )


def manual_deadline(created_at: datetime, ttl_seconds: int) -> datetime:
    """When the queue stops offering a pending declaration.

    Computed from the row's own creation time, so a deadline survives a read
    that happens much later: the queue shows the moment it was offered plus the
    configured window, not "now minus something".
    """
    created = (
        created_at
        if created_at.tzinfo is not None
        else created_at.replace(tzinfo=timezone.utc)
    )
    return created + timedelta(seconds=ttl_seconds)


def _new_invoice_code() -> str:
    """Server-minted and unique; the body never gets to propose one.

    UTC stamp plus random tail. A repeat matters only at the UNIQUE index, and
    the insert retries with a fresh tail until it wins.
    """
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"INV-{stamp}-{secrets.token_hex(3).upper()}"


async def open_manual_transaction(
    account_id: uuid.UUID | str,
    *,
    plan: str,
    payment_method: str,
    note: str | None = None,
) -> Transaction:
    """Record a declaration that money has been transferred.

    The plan and the destination method are validated; the amount is not
    accepted from the caller at all — it is the server's price for the plan at
    this moment, so a forged body cannot open the queue with a cheaper claim.

    No Subscription is written here, and none should be: nothing has been
    received, and a written period cannot be honestly taken back.
    """
    if plan not in PLAN_NAMES:
        raise ManualPaymentInvalid(f"plan must be one of {PLAN_NAMES}, got {plan!r}")
    method = (payment_method or "").strip()
    if not method:
        raise ManualPaymentInvalid("payment_method cannot be empty")
    if len(method) > _MAX_METHOD_CHARS:
        raise ManualPaymentInvalid(
            f"payment_method is longer than {_MAX_METHOD_CHARS} characters"
        )
    note = (note or "").strip()
    if len(note) > _MAX_NOTE_CHARS:
        raise ManualPaymentInvalid(f"note is longer than {_MAX_NOTE_CHARS} characters")

    try:
        pricing = await read_pricing()
    except PricingUnavailable as exc:
        # Not a 500 and not the caller's error: the install has no price right
        # now, so no declaration can name what it owes.
        raise PricingUnavailable("the price is unreadable, so no transfer can be declared") from exc
    amount = pricing.monthly if plan == "monthly" else pricing.annual

    pool = await get_pool()
    for _attempt in range(5):
        code = _new_invoice_code()
        try:
            row = await pool.fetchrow(
                """
                INSERT INTO transactions
                    (user_id, invoice_code, amount, payment_gateway,
                     payment_method, status, admin_notes, plan)
                VALUES ($1, $2, $3, 'manual', $4, 'pending', $5, $6)
                RETURNING"""
                + _TX_COLUMNS,
                str(account_id),
                code,
                amount,
                method,
                note or None,
                plan,
            )
        except asyncpg.UniqueViolationError:
            continue
        logger.info(
            "payments: manual transfer declared %s (%s %s IDR, status pending)",
            code,
            plan,
            amount,
        )
        return _to_transaction(row)
    raise RuntimeError("could not mint a unique invoice_code after five attempts")


async def list_transactions_for_user(
    account_id: uuid.UUID | str, limit: int = _OWN_LIST_LIMIT
) -> list[Transaction]:
    """The caller's own attempts to pay, newest first.

    Denials are included on purpose: a rejected transfer disappearing would look
    exactly like an accepted one's successor, and either way the account is
    entitled to its own history.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT"""
        + _TX_COLUMNS
        + """
          FROM transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2
        """,
        str(account_id),
        max(1, min(int(limit), _QUEUE_LIMIT)),
    )
    return [_to_transaction(r) for r in rows]


async def list_transactions_for_admin(
    status: str = "pending", limit: int = _QUEUE_LIMIT
) -> list[Transaction]:
    """The work queue, oldest first, with the payer attached.

    Oldest first because the queue is order of arrival: a transfer declared
    yesterday at 22:00 sits at the top, not under the week's fresh noise. The
    email travels with the row — without it the operator cannot match the
    transfer to an account at all.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT t.id, t.user_id, t.invoice_code, t.amount, t.plan,
               t.payment_gateway, t.payment_method, t.status, t.admin_notes,
               t.subscription_id, t.created_at, t.updated_at, u.email
          FROM transactions t
          JOIN users u ON u.id = t.user_id
         WHERE ($1::text IS NULL OR t.status = $1)
         ORDER BY t.created_at
         LIMIT $2
        """,
        None if status is None else status,
        max(1, min(int(limit), _QUEUE_LIMIT)),
    )
    return [_to_transaction(r) for r in rows]


async def approve_transaction(
    transaction_id: uuid.UUID | str, admin_account_id: uuid.UUID | str
) -> tuple[Transaction, SubscriptionPeriod]:
    """Mark the money received and write the period it bought — in one stroke.

    Both happen inside one database transaction: if the grant fails, the
    settlement is rolled back with it, so a crash can never leave `settlement`
    without the access it was supposed to buy. A repeat call finds the row
    settled and answers with the Subscription its first claim made, rather than
    minting a second one.

    An `expire`d transaction is still approvable — expiry is queue hygiene, not
    a verdict on the money. A `deny` is final for this row.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE transactions
                   SET status = 'settlement',
                       approved_by = $2,
                       approved_at = NOW(),
                       updated_at = NOW()
                 WHERE id = $1
                   AND status IN ('pending', 'expire')
                RETURNING"""
                + _TX_COLUMNS,
                str(transaction_id),
                str(admin_account_id),
            )
            if row is None:
                current = await conn.fetchrow(
                    """
                    SELECT id, user_id, invoice_code, amount, plan,
                           payment_gateway, payment_method, status, admin_notes,
                           subscription_id, created_at, updated_at
                      FROM transactions
                     WHERE id = $1
                    """,
                    str(transaction_id),
                )
                if current is None:
                    raise TransactionNotFound(
                        f"transaction {transaction_id} does not exist"
                    )
                tx = _to_transaction(current)
                if tx.status == "settlement":
                    if tx.subscription_id is None:
                        logger.error(
                            "payments: settled transaction %s holds no subscription id",
                            tx.id,
                        )
                        raise TransactionNotApprovable("settlement")
                    period = await _period_by_id(tx.subscription_id, conn)
                    if period is None:
                        logger.error(
                            "payments: transaction %s claims subscription %s, which is gone",
                            tx.id,
                            tx.subscription_id,
                        )
                        raise TransactionNotApprovable("settlement")
                    return tx, period
                raise TransactionNotApprovable(tx.status)

            days = PLAN_DAYS[row["plan"]]
            # grant() runs on this same connection: the claim it guards is part
            # of this database transaction, so both writes commit together.
            period = await grant(
                row["user_id"],
                days=days,
                transaction_id=row["id"],
                conn=conn,
            )
            settled = _to_transaction(
                await conn.fetchrow(
                    "SELECT"""
                    + _TX_COLUMNS
                    + "\n           FROM transactions WHERE id = $1",
                    str(transaction_id),
                )
            )
        return settled, period


async def deny_transaction(
    transaction_id: uuid.UUID | str,
    admin_account_id: uuid.UUID | str,
    reason: str,
) -> Transaction:
    """Refuse the evidence, writing who refused and why.

    The reasoning is mandatory: a queue entry that flips to `deny` with nothing
    recorded gives the account nothing to argue with and the operator nothing to
    audit. The existing note — the payer's declaration — is kept and the reason
    joins it, so the row still explains what was claimed as well as why it
    failed.

    No Subscription is touched. Denying evidence cannot retroactively change
    access anyone already holds; whatever was granted stays granted.
    """
    text = (reason or "").strip()
    if not text:
        raise DenyRequiresReason("a denial needs a recorded reason")
    text = text[:1000]

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE transactions
                   SET status = 'deny',
                       approved_by = $2,
                       approved_at = NOW(),
                       admin_notes = CASE
                           WHEN admin_notes IS NULL OR admin_notes = ''
                               THEN $3
                           ELSE admin_notes || ' — ' || $3
                       END,
                       updated_at = NOW()
                 WHERE id = $1
                   AND status IN ('pending', 'expire')
                RETURNING"""
                + _TX_COLUMNS,
                str(transaction_id),
                str(admin_account_id),
                f"Ditolak: {text}",
            )
            if row is None:
                current = await conn.fetchrow(
                    """
                    SELECT id, user_id, invoice_code, amount, plan,
                           payment_gateway, payment_method, status, admin_notes,
                           subscription_id, created_at, updated_at
                      FROM transactions
                     WHERE id = $1
                    """,
                    str(transaction_id),
                )
                if current is None:
                    raise TransactionNotFound(
                        f"transaction {transaction_id} does not exist"
                    )
                tx = _to_transaction(current)
                if tx.status == "deny":
                    # A second press after a successful denial answers with the
                    # row as it stands — the denial did not change.
                    return tx
                raise TransactionNotDeniable(tx.status)
            return _to_transaction(row)


async def expire_pending(ttl_seconds: int) -> int:
    """Age pending declarations past their window into `expire`.

    Beat-safe: only rows still `pending` move, so a second run over the same
    schedule changes nothing, and `settlement` is unreachable from here — a
    settled payment stays a settled payment whichever way the clock looks at
    it. No Subscription is created or removed: expiry is the queue's business,
    and access is decided by `subscriptions.expires_at` alone.
    """
    if ttl_seconds <= 0:
        raise ValueError(
            f"ttl_seconds must be positive, got {ttl_seconds} — it is a window, not a deadline offset"
        )
    pool = await get_pool()
    result = await pool.execute(
        """
        UPDATE transactions
           SET status = 'expire', updated_at = NOW()
         WHERE status = 'pending'
           AND created_at < NOW() - ($1::int * interval '1 second')
        """,
        int(ttl_seconds),
    )
    try:
        count = int(str(result).rsplit(" ", 1)[-1])
    except (ValueError, IndexError):
        count = 0
    if count:
        logger.info("payments: %d manual declarations expired", count)
    return count


async def _period_by_id(
    subscription_id: uuid.UUID | str, conn: asyncpg.Connection
) -> SubscriptionPeriod | None:
    """Read one period, on the approve transaction's connection."""
    row = await conn.fetchrow(
        """
        SELECT id, user_id, expires_at
          FROM subscriptions
         WHERE id = $1
        """,
        str(subscription_id),
    )
    if row is None:
        return None
    return SubscriptionPeriod(
        id=row["id"] if isinstance(row["id"], uuid.UUID) else uuid.UUID(str(row["id"])),
        user_id=(
            row["user_id"]
            if isinstance(row["user_id"], uuid.UUID)
            else uuid.UUID(str(row["user_id"]))
        ),
        expires_at=row["expires_at"],
    )


# Imported late so callers can reach every payment-facing exception from this
# module without the subscriptions module importing payments in return.
__all__ = [
    "DenyRequiresReason",
    "PLAN_DAYS",
    "PLAN_NAMES",
    "PAYMENT_METHODS",
    "SubscriptionPeriod",
    "Transaction",
    "TransactionNotFound",
    "TransactionNotApprovable",
    "TransactionNotDeniable",
    "TransactionOwnershipError",
    "deny_transaction",
    "expire_pending",
    "list_transactions_for_admin",
    "list_transactions_for_user",
    "manual_deadline",
    "open_manual_transaction",
    "approve_transaction",
]
