"""The notification outbox: what the system owes people, and the drain.

Two halves, deliberately different in shape.

**Enqueue** takes the caller's connection. It has to: the row only means
something if it is written in the same database transaction as the settlement
that creates the obligation. Enqueueing after `approve_transaction` commits
leaves a window where the money is accepted, the period is written, the process
dies, and no record exists that anybody was ever told. A row that can be lost is
not an outbox, it is a suggestion.

**Drain** is the only part that talks to a mail server, and it never runs inside
a transaction. It claims rows in a short transaction, sends after that
transaction closes, then records the answer. Holding an open transaction across
`send_mail` would hold row locks across a network round trip to a third party.

Delivery is at-least-once, not exactly-once. A process that dies between a
successful send and marking the row leaves the message to be sent again. For a
payment confirmation that is the right trade: a duplicate email is an
inconvenience, a missing one leaves a payer who cannot see what they bought and
no trace that anything was owed. Exactly-once would need the send to be
transactional with the row, and an SMTP server does not take part in a Postgres
transaction.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from api.services.email_transport import (
    EmailSendFailed,
    EmailUnavailable,
    mail_config,
    send_mail,
)

logger = logging.getLogger(__name__)

# A message that has failed this many times stops being retried and waits for an
# operator. Beyond this the failure is almost certainly not transient — a
# rejected address, a server that will not accept out relay — and hammering it
# every minute is how an install gets its mail account suspended.
_MAX_ATTEMPTS = 5

# How long a claimed row is held back before it can be tried again. Longer than
# the transport's own connect timeout, so a slow send does not let a second
# worker claim the same row while the first is still talking to the server.
_CLAIM_WINDOW = timedelta(minutes=2)

PLAN_LABEL = {"weekly": "mingguan", "monthly": "bulanan", "annual": "tahunan"}

# Named statements, so `test_admin_live_sql.py` can run this exact SQL on a
# connection it controls and roll it back. The functions below take their own
# connection from the pool, and a connection cannot see another one's uncommitted
# rows — the same reason `account_service` names `_LIST_ACCOUNTS_SQL`.
_ENQUEUE_SQL = """
    INSERT INTO notification_outbox
               (user_id, event, channel, recipient, subject, body_text, source_id)
    VALUES     ($1, $2, 'email', $3, $4, $5, $6)
    ON CONFLICT (source_id, event, channel) DO NOTHING
    RETURNING id
"""

_CLAIM_SQL = """
    WITH batch AS (
        SELECT id
          FROM notification_outbox
         WHERE status = 'pending'
           AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_outbox o
       SET attempts = o.attempts + 1,
           next_attempt_at = NOW() + $2::interval
      FROM batch
     WHERE o.id = batch.id
    RETURNING o.id, o.recipient, o.subject, o.body_text, o.attempts
"""

_MARK_SENT_SQL = """
    UPDATE notification_outbox
       SET status = 'sent', sent_at = NOW(), last_error = NULL
     WHERE id = $1
"""

# A failed attempt goes back to `pending` with `next_attempt_at` pushed out; only
# the attempt that runs out the budget makes the row terminal. Written as one
# statement because the transition and the backoff have to move together — a row
# marked failed by one path and left un-scheduled by another is how a queue
# silently stops draining.
_MARK_FAILED_SQL = """
    UPDATE notification_outbox
       SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END,
           last_error = $2,
           next_attempt_at = NOW() + $4::interval
     WHERE id = $1
"""


@dataclass(frozen=True)
class OutboxRow:
    """One message about to be sent."""

    id: uuid.UUID
    recipient: str
    subject: str
    body_text: str
    attempts: int


def _rupiah(amount: int) -> str:
    """Rupiah with the separator a reader here expects, computed once.

    Written as a helper rather than `f"{amount:,}".replace(",", ".")` inline:
    adjacent string literals concatenate at compile time, so a `.replace` hung
    on one of those lines quietly applies to all of them — including the line
    carrying the invoice code.
    """
    return f"Rp {amount:,}".replace(",", ".")


def _approved_body(invoice_code: str, amount: int, plan: str, expires_at: datetime) -> str:
    """The confirmation, in the payer's language, with only facts they were given.

    Every line here is a value the server already wrote. Nothing is promised that
    the payment path does not do: no invoice attachment (there is no PDF), no
    link to a dashboard the account may not be able to reach yet, and no
    reference to a receipt image, because `proof_image_url` is deliberately never
    populated (ADR-0011).
    """
    label = PLAN_LABEL.get(plan, plan)
    return "\n".join(
        [
            "Halo,",
            "",
            "Pembayaran Anda sudah kami periksa dan diterima.",
            "",
            f"  Nomor faktur  : {invoice_code}",
            f"  Nominal       : {_rupiah(amount)}",
            f"  Paket         : {label}",
            f"  Aktif sampai  : {expires_at.strftime('%d %B %Y')}",
            "",
            "Anda bisa memeriksa masa aktif itu di halaman Langganan pada pengaturan",
            "akun. Tidak ada tindakan lain yang perlu Anda lakukan.",
            "",
            "— AIDSS",
            "",
        ]
    )


def _denied_body(invoice_code: str, amount: int, reason: str) -> str:
    """The refusal, with the operator's reason in it.

    The reason is required by the deny endpoint precisely so this message has
    something true to say. A denial without an explanation would be a lock with
    no key, and the payer could not tell what to fix.
    """
    return "\n".join(
        [
            "Halo,",
            "",
            "Transfer yang Anda nyatakan belum bisa kami terima sebagai pembayaran.",
            "",
            f"  Nomor faktur  : {invoice_code}",
            f"  Nominal       : {_rupiah(amount)}",
            "",
            f"  Alasan        : {reason}",
            "",
            "Akun Anda tidak berubah oleh keputusan ini. Kalau nominal atau rekening",
            "tujuannya yang perlu diperbaiki, nyatakan ulang transfernya setelah",
            "diperbaiki; kalau bukan, hubungi dukungan lewat alamat pada halaman harga.",
            "",
            "— AIDSS",
            "",
        ]
    )


async def enqueue_approved(
    conn,
    *,
    user_id: uuid.UUID | str,
    recipient: str,
    transaction_id: uuid.UUID | str,
    invoice_code: str,
    amount: int,
    plan: str,
    expires_at: datetime,
) -> bool:
    """Queue the confirmation, inside the caller's transaction.

    Returns whether a row was written. `False` is not a failure: it means the
    unique key already holds this message, which is what a repeated approve
    should do — answer with the period it first minted and say nothing new.
    """
    if not recipient:
        # No address to write to. The settlement is still true; the obligation
        # is not created out of nothing, and a row with an empty recipient would
        # fail every attempt and read like a broken mail server.
        logger.warning("notifications: approved transaction has no recipient to queue")
        return False

    row = await conn.fetchrow(
        _ENQUEUE_SQL,
        str(user_id),
        "payment_approved",
        recipient,
        f"Pembayaran diterima — langganan {PLAN_LABEL.get(plan, plan)} aktif",
        _approved_body(invoice_code, amount, plan, expires_at),
        str(transaction_id),
    )
    return row is not None


async def enqueue_denied(
    conn,
    *,
    user_id: uuid.UUID | str,
    recipient: str,
    transaction_id: uuid.UUID | str,
    invoice_code: str,
    amount: int,
    reason: str,
) -> bool:
    """Queue the refusal, inside the caller's transaction. Same key, same rules."""
    if not recipient:
        logger.warning("notifications: denied transaction has no recipient to queue")
        return False

    row = await conn.fetchrow(
        _ENQUEUE_SQL,
        str(user_id),
        "payment_denied",
        recipient,
        f"Transfer {invoice_code} belum bisa diterima",
        _denied_body(invoice_code, amount, reason),
        str(transaction_id),
    )
    return row is not None


async def claim_due(limit: int = 20) -> list[OutboxRow]:
    """Take the rows that are due, and hold them off for a while.

    `FOR UPDATE SKIP LOCKED` is what lets two workers run at once without both
    sending the same message: a row one of them is holding is simply not offered
    to the other. The claim transaction then pushes `next_attempt_at` forward
    before it closes, so a row whose send outlives the lock is not immediately
    re-claimed either.
    """
    from api.core.db import get_pool

    pool = await get_pool()
    rows = await pool.fetch(
        _CLAIM_SQL,
        max(1, int(limit)),
        # A timedelta, not str(timedelta). asyncpg infers an interval parameter
        # from the `$n::interval` cast and wants the object: a string raises
        # DataError on the driver, while the suite's fake pool would have taken
        # it happily and this task would fail on every beat in production.
        _CLAIM_WINDOW,
    )
    return [
        OutboxRow(
            id=r["id"] if isinstance(r["id"], uuid.UUID) else uuid.UUID(str(r["id"])),
            recipient=r["recipient"],
            subject=r["subject"],
            body_text=r["body_text"],
            attempts=r["attempts"],
        )
        for r in rows
    ]


async def mark_sent(row_id: uuid.UUID) -> None:
    from api.core.db import get_pool

    pool = await get_pool()
    await pool.execute(_MARK_SENT_SQL, str(row_id))


async def mark_failed(row_id: uuid.UUID, error: str, attempts: int) -> None:
    """Record a failure, and stop trying eventually.

    A failed attempt goes back to `pending` with `next_attempt_at` pushed out —
    only the last one becomes `failed`. Setting `failed` on the first refusal
    would make the backoff below dead code and turn one transient provider
    outage into a message that is never sent again.

    The row keeps `last_error`. That is the point: an operator asking "did the
    payer get told?" gets an answer with a reason in it, rather than a table of
    pending rows that might be waiting or might be broken.
    """
    from api.core.db import get_pool

    pool = await get_pool()
    terminal = attempts >= _MAX_ATTEMPTS
    # Exponential, capped at an hour. A provider that is down for ten minutes
    # should not be retried every beat, and one that is gone for a day should not
    # be retried every hour forever.
    backoff = min(timedelta(minutes=2 ** min(attempts, 6)), timedelta(hours=1))
    await pool.execute(
        _MARK_FAILED_SQL,
        str(row_id),
        error[:500],
        _MAX_ATTEMPTS,
        backoff,
    )
    if terminal:
        logger.error(
            "notifications: outbox row %s gave up after %d attempts", row_id, attempts
        )


async def drain_once(limit: int = 20) -> dict[str, int]:
    """Send what is due. One beat's work, counted and returned.

    The counts are the operator-facing part of this function: a beat that
    silently did nothing and a beat that silently failed are the same row in the
    log unless the numbers say otherwise.

    The email configuration is read once, at the top of the beat. That is not a
    cache in the sense the admin form has to worry about — the next beat reads it
    again, so a host an operator saves takes effect without a restart — and it is
    not per row either, because a beat that re-read the row between two sends
    could deliver one message from the old server and the next from the new one.
    """
    config = await mail_config()
    rows = await claim_due(limit)
    sent = failed = 0
    for row in rows:
        try:
            send_mail(row.recipient, row.subject, row.body_text, config=config)
        except (EmailSendFailed, EmailUnavailable) as exc:
            failed += 1
            await mark_failed(row.id, str(exc), row.attempts)
            # The recipient is left out of the log line: a failing address would
            # otherwise be repeated on every retry of every row.
            logger.warning("notifications: send failed for an outbox row: %s", exc)
            continue
        sent += 1
        await mark_sent(row.id)
    return {"claimed": len(rows), "sent": sent, "failed": failed}
