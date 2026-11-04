"""
The gateway join: Midtrans' checkout, and the phone call it makes back.

The blueprint's webhook phase writes its row through the same INSERT and the
same settlement stroke the manual queue uses, so this table keeps ONE writer —
this package — and `transactions.subscription_id` stays a fact anyone can
trust. The Midtrans transport itself lives in midtrans_service.py.
"""

import logging
import uuid

import asyncpg

from api.core.config import get_settings
from api.core.db import get_pool
from api.services.midtrans_service import (
    GatewayUnavailable,
    create_snap_token,
    gateway_configured,
)
from api.services.channel_registry import is_known as is_known_channel, snap_code, snap_codes
from api.services.system_settings_service import read_payment_channels
from api.services.payment_service.core import (
    PLAN_DAYS,
    PLAN_NAMES,
    Transaction,
    TransactionNotApprovable,
    ManualPaymentInvalid,
    _new_invoice_code,
    _plan_amount,
    _to_transaction,
    _TX_COLUMNS,
)
from api.services.payment_service.manual import _period_by_id
from api.services.subscription_service import (
    TransactionNotFound,
    SubscriptionPeriod,
    grant,
)
from api.services.system_settings_service import read_pricing

logger = logging.getLogger(__name__)
class GatewayCheckoutUnavailable(RuntimeError):
    """Midtrans could not open a checkout page, or is not wired here.

    Carries the sentence the buyer reads. Two causes read differently on
    purpose: an install without a server key must not be told "try again
    later" (there is nothing to try), and a reachable-but-refusing gateway
    must not be told "permanently off" — the words go with the cause.
    """

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


async def open_gateway_transaction(
    account_id: uuid.UUID | str,
    *,
    plan: str,
    email: str | None = None,
    channel: str | None = None,
) -> tuple[Transaction, str]:
    """Open a Midtrans checkout: one pending row, and the page that serves it.

    The order inside one call is deliberate. The plan is validated, the price
    is read from the server, Midtrans gets the invoice code as its `order_id`,
    and the row is written only when the gateway has answered with a page — a
    checkout Midtrans refused to open was never an attempt to move money, and
    the ledger does not record placebo attempts. The webhook cannot outrun the
    INSERT except by delivering before the redirect_url below exists, which no
    buyer can trigger: that URL is what the buyer pays on. Should a delivery
    still race ahead, it is answered 404, and Midtrans' retries wait for the
    row.

    The plan check comes first so a bad body costs no gateway call at all, and
    the channel check comes before it for the same reason: a body naming a
    method this install does not offer should not reach the gateway either.

    `channel` is our key (`qris`, `va_bca`, ...) and it is what the ledger
    records, so the queue can show which method was actually chosen instead of
    the word 'midtrans' on every gateway row. Rows written before it was sent
    keep 'midtrans', and the queue renders both.
    """
    enabled, _channels_updated = await read_payment_channels()

    resolved = (channel or "").strip() or None
    if resolved is not None:
        if not is_known_channel(resolved):
            raise ManualPaymentInvalid(f"unknown payment channel {channel!r}")
        code = snap_code(resolved)
        if code is None:
            # `bank_transfer` is a real declaration value and has no place in a
            # Snap request. Refusing beats sending a code that would mean
            # something else to the gateway.
            raise ManualPaymentInvalid(
                f"{resolved!r} is not a channel that can be paid through the gateway"
            )
        if enabled is not None and resolved not in enabled:
            raise ManualPaymentInvalid(
                f"{resolved!r} is not enabled on this install"
            )

    if plan not in PLAN_NAMES:
        raise ManualPaymentInvalid(f"plan must be one of {PLAN_NAMES}, got {plan!r}")

    settings = get_settings()
    if not gateway_configured():
        raise GatewayCheckoutUnavailable(
            "Gateway pembayaran belum diaktifkan di server ini."
        )

    # What the page will offer. Three distinct states, and collapsing them is
    # how an install loses a payment method without anyone choosing to:
    #
    #   enabled is None  -> the operator never chose. Send nothing, and the
    #                       gateway's own dashboard decides, as it always did.
    #   enabled is []    -> the operator turned online payment off on purpose.
    #                       Refuse, rather than opening an unrestricted page.
    #   enabled has keys -> restrict to those, unless a single channel was
    #                       picked, in which case that one.
    if enabled is not None and not enabled:
        raise GatewayCheckoutUnavailable(
            "Pembayaran online sedang dimatikan di instalasi ini."
        )
    if resolved is not None:
        enabled_payments: list[str] | None = [snap_code(resolved)]
    elif enabled is None:
        enabled_payments = None
    else:
        enabled_payments = snap_codes(enabled)

    pricing = await read_pricing()
    amount = _plan_amount(plan, pricing)

    pool = await get_pool()
    ttl_minutes = max(1, int(settings.manual_transaction_ttl_seconds // 60))
    for _attempt in range(5):
        code = _new_invoice_code()
        try:
            session = await create_snap_token(
                order_id=code,
                gross_amount=amount,
                email=email,
                expiry_minutes=ttl_minutes,
                enabled_payments=enabled_payments,
            )
        except GatewayUnavailable as exc:
            raise GatewayCheckoutUnavailable(
                "Gerbang pembayaran tidak dapat dihubungi sekarang. Coba lagi beberapa saat."
            ) from exc
        try:
            row = await pool.fetchrow(
                """
                INSERT INTO transactions
                    (user_id, invoice_code, amount, payment_gateway,
                     payment_method, status, admin_notes, plan)
                VALUES ($1, $2, $3, 'midtrans', $5, 'pending', NULL, $4)
                RETURNING"""
                + _TX_COLUMNS,
                str(account_id),
                code,
                amount,
                plan,
                # The chosen channel, or the word the ledger has always used when
                # the gateway picked the method itself.
                resolved or "midtrans",
            )
        except asyncpg.UniqueViolationError:
            continue
        logger.info(
            "payments: gateway checkout opened %s (%s %s IDR, status pending)",
            code,
            plan,
            amount,
        )
        return _to_transaction(row), session.redirect_url
    raise RuntimeError("could not mint a unique invoice_code after five attempts")


async def transaction_by_invoice_code(invoice_code: str) -> Transaction | None:
    """The row a webhook's `order_id` belongs to, or None.

    The webhook speaks order_id; this table speaks invoice_code. Minted from
    the same string by the same server, they are one identifier, so the lookup
    is plain equality — and a signed callback naming a code nobody wrote here
    has no row to move, which the router answers 404 rather than 200 so
    Midtrans waits and retries.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT"
        + _TX_COLUMNS
        + "\n           FROM transactions\n"
        "          WHERE invoice_code = $1",
        invoice_code,
    )
    return None if row is None else _to_transaction(row)


async def settle_gateway_transaction(
    transaction_id: uuid.UUID | str, midtrans_transaction_id: str | None
) -> tuple[Transaction, SubscriptionPeriod | None]:
    """Turn one settled callback into money received and access minted.

    Mirrors `approve_transaction` stroke for stroke — settlement and grant run
    inside one database transaction, so a crash takes both back and a retry
    takes both forward — with two differences marking whose hand did it.
    Nobody approved this, the money did: `approved_by` stays NULL, and
    Midtrans' own transaction id lands in the column the schema reserved for
    it, where `uq_transactions_midtrans_transaction_id` keeps one gateway
    payment from ever aliasing another.

    A settled callback on a row already settled answers the Subscription its
    first claim made — Midtrans re-delivers what it did not see answered, and
    the second delivery must find the period the first one wrote.

    Returns the transaction plus its period. A callback that names a row money
    cannot reopen — `deny` most plausibly, an administrator's answer that the
    gateway's claim contradicts — returns the row with no period; a missing
    row raises `TransactionNotFound`; a settled row that claims an absent
    subscription raises `TransactionNotApprovable` rather than minting a
    second one quietly.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE transactions
                   SET status = 'settlement',
                       approved_by = NULL,
                       approved_at = NOW(),
                       midtrans_transaction_id = $2,
                       updated_at = NOW()
                 WHERE id = $1
                   AND status IN ('pending', 'expire')
                RETURNING"""
                + _TX_COLUMNS,
                str(transaction_id),
                midtrans_transaction_id,
            )
            if row is None:
                current = await conn.fetchrow(
                    "SELECT"
                    + _TX_COLUMNS
                    + "\n           FROM transactions WHERE id = $1",
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
                return tx, None

            days = PLAN_DAYS[row["plan"]]
            # grant() runs on this connection inside this same database
            # transaction: the money and the period it bought stand or fall
            # together, too.
            period = await grant(
                row["user_id"],
                days=days,
                transaction_id=row["id"],
                conn=conn,
            )
            settled = _to_transaction(
                await conn.fetchrow(
                    "SELECT"
                    + _TX_COLUMNS
                    + "\n           FROM transactions WHERE id = $1",
                    str(transaction_id),
                )
            )
        return settled, period


async def deny_gateway_transaction(
    transaction_id: uuid.UUID | str,
    midtrans_transaction_id: str | None,
    reason: str,
) -> Transaction | None:
    """Record the gateway's own refusal, with no approver to name.

    This deny differs from the queue's in who spoke: Midtrans said the money
    did not move, and the sentence says so. Like the admin denial it is
    terminal — a gateway that first refuses can later claim settlement, and
    that later callback will find a row money cannot reopen. The row's WHERE
    clause makes that true: only `pending` and `expire` are reachable.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE transactions
           SET status = 'deny',
               approved_by = NULL,
               approved_at = NOW(),
               midtrans_transaction_id = $2,
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
        midtrans_transaction_id,
        f"Ditolak gateway Midtrans: {reason}".strip(),
    )
    return None if row is None else _to_transaction(row)


async def expire_gateway_transaction(
    transaction_id: uuid.UUID | str, midtrans_transaction_id: str | None
) -> Transaction | None:
    """Age one row out because Midtrans closed its page.

    `expire` opens nothing and takes nothing: the beat already expires rows on
    the same hours, and an expired gateway row stays approvable by a later
    settlement exactly the way an expired declaration does — expiry is queue
    hygiene, not a verdict on the money.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE transactions
           SET status = 'expire',
               midtrans_transaction_id = $2,
               updated_at = NOW()
         WHERE id = $1
           AND status = 'pending'
        RETURNING"""
        + _TX_COLUMNS,
        str(transaction_id),
        midtrans_transaction_id,
    )
    return None if row is None else _to_transaction(row)
