"""
The declared transfer: opened by the buyer, adjudicated by the operator, aged
out by the beat.

Every SQL statement here touches `transactions` — the one writer the ADR-0011
rule demands — and approval runs inside one database transaction because
marking money received and minting the period it bought must stand or fall
together.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg

from api.core.db import get_pool
from api.services.payment_service.core import (
    _MAX_METHOD_CHARS,
    _MAX_NOTE_CHARS,
    _MAX_QUEUE_FETCH,
    _OWN_LIST_LIMIT,
    _QUEUE_LIMIT,
    PLAN_DAYS,
    PLAN_NAMES,
    Transaction,
    TransactionNotApprovable,
    TransactionNotDeniable,
    DenyRequiresReason,
    ManualPaymentInvalid,
    _MAX_DESTINATION_CHARS,
    _new_invoice_code,
    _plan_amount,
    _to_transaction,
    _TX_COLUMNS,
)
from api.services.subscription_service import (
    TransactionNotFound,
    SubscriptionPeriod,
    grant,
)
from api.services.channel_registry import is_known as is_known_channel, snap_code
from api.services.email_transport import email_configured
from api.services.notification_service import enqueue_approved, enqueue_denied
from api.services.system_settings_service import (
    BankAccountsUnavailable,
    PricingUnavailable,
    read_bank_accounts,
    read_payment_channels as read_payment_channels_state,
    read_pricing,
)

logger = logging.getLogger(__name__)


async def _recipient_email(conn, user_id) -> str:
    """The address the account is reached at, read on the caller's connection.

    Read inside the transaction rather than passed in from the queue read: the
    address that gets the confirmation should be the one the database held at the
    moment the payment was accepted, not the one a page fetched minutes earlier
    and may have since paged past.
    """
    row = await conn.fetchrow("SELECT email FROM users WHERE id = $1", str(user_id))
    return row["email"] if row is not None else ""


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


async def open_manual_transaction(
    account_id: uuid.UUID | str,
    *,
    plan: str,
    payment_method: str,
    note: str | None = None,
    destination_account: str | None = None,
) -> Transaction:
    """Record a declaration that money has been transferred.

    The plan and the destination method are validated; the amount is not
    accepted from the caller at all — it is the server's price for the plan at
    this moment, so a forged body cannot open the queue with a cheaper claim.

    The method is checked twice: it has to be a channel this code knows, and a
    gateway channel additionally has to be one this install offers. `note` and
    `destination_account` are the payer's own record of the transfer, and the
    destination is resolved against the accounts the operator displays.

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
    # Named in the registry or not stored at all. Until now any non-empty string
    # was accepted, so the queue could be handed a "method" no payment path has
    # ever offered, shown to the operator matching the transfer as if it were a
    # fact about how the money moved.
    if not is_known_channel(method):
        raise ManualPaymentInvalid(f"payment_method {method!r} is not a known channel")

    # A channel the operator switched off cannot be declared as used.
    #
    # Only for the channels that are the gateway's: `bank_transfer` has no gateway
    # code and no place in that list, so refusing it here would break the transfer
    # path on an install that has correctly enabled nothing online. And a list
    # nobody ever wrote reads as no restriction, exactly as the checkout does —
    # otherwise switching on this feature would invalidate declarations that were
    # fine yesterday.
    if snap_code(method) is not None:
        enabled = (await read_payment_channels_state())[0]
        if enabled is not None and method not in enabled:
            raise ManualPaymentInvalid(
                f"{method!r} is not offered on this install, so a transfer cannot be "
                "declared against it"
            )
    note = (note or "").strip()
    if len(note) > _MAX_NOTE_CHARS:
        raise ManualPaymentInvalid(f"note is longer than {_MAX_NOTE_CHARS} characters")

    # Which published destination the payer says they used. Validated against the
    # list the operator shows and stored as a snapshot this service composes —
    # never as the caller's own text, which would let a declaration describe an
    # account this install never published, or rewrite one after the fact.
    destination = None
    wanted = (destination_account or "").strip()
    if wanted:
        try:
            entries, _updated = await read_bank_accounts()
        except BankAccountsUnavailable as exc:
            raise ManualPaymentInvalid(
                "the destination list is unreadable, so no account can be named"
            ) from exc
        shown = {e.account_number: e for e in entries if e.enabled}
        entry = shown.get(wanted)
        if entry is None:
            raise ManualPaymentInvalid(
                f"{destination_account!r} is not a destination this server publishes"
            )
        destination = (
            f"{entry.bank} {entry.account_number} a.n. {entry.holder_name}"
            [:_MAX_DESTINATION_CHARS]
        )

    try:
        pricing = await read_pricing()
    except PricingUnavailable as exc:
        # Not a 500 and not the caller's error: the install has no price right
        # now, so no declaration can name what it owes.
        raise PricingUnavailable("the price is unreadable, so no transfer can be declared") from exc
    amount = _plan_amount(plan, pricing)

    pool = await get_pool()
    for _attempt in range(5):
        code = _new_invoice_code()
        try:
            row = await pool.fetchrow(
                """
                INSERT INTO transactions
                    (user_id, invoice_code, amount, payment_gateway,
                     payment_method, status, admin_notes, plan, destination)
                VALUES ($1, $2, $3, 'manual', $4, 'pending', $5, $6, $7)
                RETURNING"""
                + _TX_COLUMNS,
                str(account_id),
                code,
                amount,
                method,
                note or None,
                plan,
                destination,
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
    status: str = "pending",
    limit: int = _QUEUE_LIMIT,
    offset: int = 0,
) -> tuple[list[Transaction], bool]:
    """One page of the work queue, oldest first, and whether rows exist past it.

    Oldest first because the queue is order of arrival: a transfer declared
    yesterday at 22:00 sits at the top, not under the week's fresh noise. The
    email travels with the row — without it the operator cannot match the
    transfer to an account at all.

    Paged, and the second return value is why that matters. Before this the query
    simply stopped at 200 rows, so `status=all` on a growing install answered with
    a truncated history that looked complete: the oldest rows, which are the ones
    an auditor asks about, were the first to go silent. One over-fetch answers
    `hasMore` without a second COUNT, the same way the account list does it.

    `limit` is clamped to `_MAX_QUEUE_FETCH` rather than to the page size, because
    the same read serves the CSV export as the screen: the caller chooses how much
    it wants to carry, and this is the ceiling it cannot ask past.
    """
    pool = await get_pool()
    bounded = max(1, min(int(limit), _MAX_QUEUE_FETCH))
    rows = await pool.fetch(
        """
        SELECT t.id, t.user_id, t.invoice_code, t.amount, t.plan,
               t.payment_gateway, t.payment_method, t.status, t.admin_notes,
               t.subscription_id, t.created_at, t.updated_at, t.approved_at,
               t.destination, u.email
          FROM transactions t
          JOIN users u ON u.id = t.user_id
         WHERE ($1::text IS NULL OR t.status = $1)
         ORDER BY t.created_at
         LIMIT $2 OFFSET $3
        """,
        None if status is None else status,
        bounded + 1,
        max(0, int(offset)),
    )
    return [_to_transaction(r) for r in rows[:bounded]], len(rows) > bounded


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
            # The confirmation is queued beside the settlement, on the same
            # connection, so the obligation commits or rolls back with the access
            # it describes. Gated on `email_configured()` rather than always
            # written: an install that cannot send mail would otherwise fill the
            # outbox with rows that fail every attempt, and the console's claim
            # that approving here tells nobody would stop being true.
            if await email_configured(conn):
                await enqueue_approved(
                    conn,
                    user_id=row["user_id"],
                    recipient=await _recipient_email(conn, row["user_id"]),
                    transaction_id=row["id"],
                    invoice_code=row["invoice_code"],
                    amount=int(row["amount"]),
                    plan=row["plan"],
                    expires_at=period.expires_at,
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
            if await email_configured(conn):
                await enqueue_denied(
                    conn,
                    user_id=row["user_id"],
                    recipient=await _recipient_email(conn, row["user_id"]),
                    transaction_id=row["id"],
                    invoice_code=row["invoice_code"],
                    amount=int(row["amount"]),
                    reason=text,
                )
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
