"""
grant() — the one place SQL writes `subscriptions`.

Three code paths meet here: an operator's manual grant, a manual transfer the
admin approves, and a gateway webhook that settles. Every one of them calls
this function, so the question "can anything else write this table?" is the
question ADR-0011 exists to answer, and the answer is meant to stay no. A second
writer would not add capability; it would add a place where "expires_at moved
without the money moving" can happen.

One row per period, never mutated: two overlapping periods are both legitimate
(so access is read as MAX(expires_at), see `entitlements`), and each row carries
the expiry it was granted with. Extending access means a new row — which is why
nothing in this file can UPDATE or DELETE a period another caller created.

When the grant happens for a payment, the transaction row is claimed in a
guarded link (`subscription_id IS NULL`), because the claim is the idempotency
key: a replayed webhook keeps collapsing onto one transaction, and so onto one
period. A claim that loses the race to a concurrent grant discards the row it
just inserted — a row only the grant that created it can link, so no other
referencer exists to lose.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from api.core.db import get_pool
from api.services.accounts import reopen_after_payment

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SubscriptionPeriod:
    """One purchased period, as the writer sees it after the statement ran."""

    id: uuid.UUID
    user_id: uuid.UUID
    expires_at: datetime


class InvalidGrant(ValueError):
    """The grant as asked cannot exist: a period of zero or negative days.

    Raising rather than clamping, because days ≤ 0 would produce `expires_at`
    at or before NOW(): a subscription that reads as active for an instant and
    is gone by the next request. Refusing makes the caller's mistake loud.
    """


class TransactionNotFound(LookupError):
    """`transaction_id` names no transaction, so there is nothing to grant against."""


class TransactionOwnershipError(LookupError):
    """The transaction and the account do not name the same payer.

    Without this check a malformed approve request could write one account's
    subscription from another account's payment — granting access the money
    never paid for.
    """


async def grant(
    account_id: uuid.UUID | str,
    *,
    days: int,
    transaction_id: uuid.UUID | str | None = None,
    conn: "asyncpg.Connection | None" = None,
) -> SubscriptionPeriod:
    """Create one unexpired period, or return the one its transaction already has.

    `transaction_id` ties the period to a payment row and makes this idempotent:
    the first call creates and claims, every later call for the same transaction
    returns the claimed period instead of granting again. Without it — an
    operator's manual grant — every call is a new period, because there is no
    idempotency key and repeating the action grants again.

    `conn` runs every statement on the caller's connection instead of its own
    checkout. The admin's approve action flips a transaction to `settlement` and
    must write the Subscription in the same database transaction — a crash in
    between would leave a settled payment without a Subscription, which is the
    one state this flow must never produce.

    Raises:
        InvalidGrant — `days` is zero or negative.
        TransactionNotFound — no transaction carries that id.
        TransactionOwnershipError — the transaction pays for someone else.
    """
    if days <= 0:
        raise InvalidGrant(
            f"days must be positive, got {days} — a period that already ended "
            "is not a grant"
        )

    if transaction_id is None:
        return await _create_period(account_id, days, conn)

    transaction = await _read_transaction(transaction_id, conn)
    if transaction is None:
        raise TransactionNotFound(f"transaction {transaction_id} does not exist")
    if str(transaction["user_id"]) != str(account_id):
        raise TransactionOwnershipError(
            f"transaction {transaction_id} belongs to a different account"
        )

    claimed = transaction["subscription_id"]
    if claimed:
        period = await _read_period(claimed, conn)
        if period is not None:
            return period

    period = await _create_period(account_id, days, conn)
    claimed_now = await _claim_transaction(transaction_id, period.id, conn)
    if not claimed_now:
        # The claim was lost to a concurrent grant of the same transaction. That
        # call's period is canonical; ours is unlinked, so nothing references it
        # and it can be dropped without touching anyone else's row.
        await _discard_unlinked_period(period.id, conn)
        winner_id = None
        winner_tx = await _read_transaction(transaction_id, conn)
        if winner_tx is not None:
            winner_id = winner_tx["subscription_id"]
        winner = await _read_period(winner_id, conn) if winner_id else None
        if winner is not None:
            return winner
    return period


async def _db(conn):
    """The connection to run on: the caller's, or one from the pool."""
    if conn is not None:
        return conn
    return await get_pool()


async def _create_period(
    account_id: uuid.UUID | str, days: int, conn: "asyncpg.Connection | None" = None
) -> SubscriptionPeriod:
    """Insert one period, with the expiry computed from the database's NOW().

    The database's clock, not the application's: the entitlement check compares
    against NOW() on the same server, so a grant that counted a day from the
    wrong clock would expire reasonlessly.

    This is the single success door of every grant — operator's manual grant,
    settled payment, future gateway webhook — so the suspension rider lives
    here rather than at each caller: a settlement that writes the period must
    also clear the suspension the period is ending, on the same connection, or
    a paying person stays locked out while their money is in. `reopen_after_
    payment` clears only `blocked_reason = 'subscription_expired'` and only
    rows matched by its own WHERE clause, so a settlement on a sanctioned
    account leaves the ban exactly as an administrator left it.
    """
    db = await _db(conn)
    row = await db.fetchrow(
        """
        INSERT INTO subscriptions (user_id, expires_at)
        VALUES ($1, NOW() + ($2::int * interval '1 day'))
        RETURNING id, user_id, expires_at
        """,
        str(account_id),
        days,
    )
    await reopen_after_payment(account_id, conn=conn)
    return _to_period(row)


async def _claim_transaction(
    transaction_id: uuid.UUID | str,
    subscription_id: uuid.UUID | str,
    conn: "asyncpg.Connection | None" = None,
) -> bool:
    """Link the transaction to the period it just paid for. True when the claim won.

    The `subscription_id IS NULL` guard is what makes the link idempotent: two
    calls racing to the same payment row leave exactly one winner, and the
    loser's period is discarded rather than left orphaned in the table.
    """
    db = await _db(conn)
    result = await db.execute(
        """
        UPDATE transactions
           SET subscription_id = $2
         WHERE id = $1
           AND subscription_id IS NULL
        """,
        str(transaction_id),
        str(subscription_id),
    )
    return _affected(result)


async def _discard_unlinked_period(
    subscription_id: uuid.UUID | str, conn: "asyncpg.Connection | None" = None
) -> None:
    """Remove the period this grant just created, when its claim was lost.

    Safe by construction: the row became visible only to its own caller, and the
    only referencing table (`transactions`) never pointed at it.
    """
    db = await _db(conn)
    await db.execute(
        "DELETE FROM subscriptions WHERE id = $1",
        str(subscription_id),
    )


async def _read_transaction(
    transaction_id: uuid.UUID | str, conn: "asyncpg.Connection | None" = None
) -> dict | None:
    db = await _db(conn)
    row = await db.fetchrow(
        """
        SELECT id, user_id, subscription_id
          FROM transactions
         WHERE id = $1
        """,
        str(transaction_id),
    )
    return dict(row) if row else None


async def _read_period(
    subscription_id: uuid.UUID | str, conn: "asyncpg.Connection | None" = None
) -> SubscriptionPeriod | None:
    db = await _db(conn)
    row = await db.fetchrow(
        """
        SELECT id, user_id, expires_at
          FROM subscriptions
         WHERE id = $1
        """,
        str(subscription_id),
    )
    return _to_period(row) if row else None


def _to_period(row) -> SubscriptionPeriod:
    return SubscriptionPeriod(
        id=row["id"] if isinstance(row["id"], uuid.UUID) else uuid.UUID(str(row["id"])),
        user_id=(
            row["user_id"]
            if isinstance(row["user_id"], uuid.UUID)
            else uuid.UUID(str(row["user_id"]))
        ),
        expires_at=row["expires_at"],
    )


def _affected(status: str) -> int:
    """asyncpg returns 'UPDATE n' / 'DELETE n'; anything else means zero.

    Same shape as `accounts._affected`, kept here rather than exported between
    services so each module's SQL stays legible in its own file.
    """
    try:
        return int(str(status).rsplit(" ", 1)[-1])
    except (ValueError, IndexError):
        return 0
