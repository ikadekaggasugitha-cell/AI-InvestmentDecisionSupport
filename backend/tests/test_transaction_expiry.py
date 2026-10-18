"""
The queue's clock — waiting past the window, and what it never does.

`expire_pending(ttl_seconds)` moves ONLY rows that are still `pending` and
older than the window:

  * a pending declaration past its window becomes `expire`,
  * a young pending row stays exactly as it is,
  * a settlement is unreachable — money already received is not re-decided by
    a clock,
  * no Subscription row is created or removed: expiry is queue hygiene, and
    access is `subscriptions.expires_at`'s business (CONTEXT.md rule 1).

Everything here runs twice on purpose: expiry is a beat task, and a schedule
means the second run must be a no-op, not a second opinion.
"""

from datetime import timedelta

import pytest

from api.services.payments import (
    DenyRequiresReason,
    deny_transaction,
    expire_pending,
    open_manual_transaction,
    approve_transaction,
    TransactionNotApprovable,
)
from api.services.subscriptions import TransactionNotFound


async def _account(fake_identity, email):
    from api.services import accounts

    return await accounts.create_account(
        email=email,
        password_hash="not-a-real-hash",
        full_name="Pengguna Uji",
        phone_number="081234567890",
    )


async def _declaration(fake_identity, email="pembayar@aidss.id", plan="monthly"):
    account = await _account(fake_identity, email)
    tx = await open_manual_transaction(
        account.id, plan=plan, payment_method="bank_transfer", note=None
    )
    return account, tx


async def _age_back(fake_identity, tx, **kwargs):
    """Put a declaration's creation behind the clock, as time would."""
    row = fake_identity.transactions[str(tx.id)]
    row["created_at"] = row["created_at"] - timedelta(**kwargs)


class TestExpiryWindow:
    async def test_a_pending_past_the_window_becomes_expire(self, fake_identity):
        account, tx = await _declaration(fake_identity)
        await _age_back(fake_identity, tx, hours=2)

        assert await expire_pending(3600) == 1
        assert fake_identity.transactions[str(tx.id)]["status"] == "expire"

    async def test_a_young_pending_is_not_touched(self, fake_identity):
        account, tx = await _declaration(fake_identity)

        assert await expire_pending(3600) == 0
        assert fake_identity.transactions[str(tx.id)]["status"] == "pending"

    async def test_a_second_pass_over_the_same_window_moves_nothing(
        self, fake_identity
    ):
        account, tx = await _declaration(fake_identity)
        await _age_back(fake_identity, tx, hours=2)

        assert await expire_pending(3600) == 1
        assert await expire_pending(3600) == 0
        assert fake_identity.transactions[str(tx.id)]["status"] == "expire"

    async def test_a_settlement_of_any_age_is_not_reopened(self, fake_identity):
        account, tx = await _declaration(fake_identity)
        admin = await _account(fake_identity, "admin@aidss.id")
        await approve_transaction(tx.id, admin.id)
        await _age_back(fake_identity, tx, hours=30)  # arbitrary, old in any unit

        assert await expire_pending(3600) == 0
        assert fake_identity.transactions[str(tx.id)]["status"] == "settlement"

    async def test_a_zero_window_is_a_mistake_not_a_sweep(self, fake_identity):
        """ttl_seconds ≤ 0 would flip every pending row of the install into
        `expire` in one pass. That is not hygiene, that is emptying the queue —
        so it is refused before a statement runs."""
        await _declaration(fake_identity)

        with pytest.raises(ValueError):
            await expire_pending(0)
        assert fake_identity.transactions, "rows exist, untouched"
        assert all(
            r["status"] == "pending" for r in fake_identity.transactions.values()
        )

    async def test_expiry_never_touches_a_subscription(self, fake_identity):
        account, tx = await _declaration(fake_identity)
        admin = await _account(fake_identity, "admin@aidss.id")
        await approve_transaction(tx.id, admin.id)

        before = [dict(r) for r in fake_identity.subscriptions]

        await _age_back(fake_identity, tx, hours=5)
        assert await expire_pending(3600) == 0

        # The same one row, with the expiry nobody's clock took from it.
        assert len(fake_identity.subscriptions) == 1
        assert fake_identity.subscriptions[0]["expires_at"] == before[0]["expires_at"]


class TestMoneySurvivesTheClock:
    async def test_approve_after_expire_still_grants(self, fake_identity):
        """The whole reason expiry is not a verdict: the row aged out, the
        admin matched the transfer anyway, and the period exists."""
        account, tx = await _declaration(fake_identity)
        admin = await _account(fake_identity, "admin@aidss.id")
        await _age_back(fake_identity, tx, hours=2)
        assert await expire_pending(3600) == 1

        settled, period = await approve_transaction(tx.id, admin.id)

        assert settled.status == "settlement"
        assert str(period.user_id) == str(account.id)

    async def test_deny_after_expire_still_refuses(self, fake_identity):
        account, tx = await _declaration(fake_identity)
        admin = await _account(fake_identity, "admin@aidss.id")
        await _age_back(fake_identity, tx, hours=2)
        await expire_pending(3600)

        denied = await deny_transaction(tx.id, admin.id, "bukti tidak ditemukan")

        assert denied.status == "deny"

    async def test_an_empty_window_fails_closed_on_the_deadline_math(
        self, fake_identity
    ):
        """Nothing against the deadline helper itself — this is the guard that
        keeps the beat from sweeping the queue when its setting is unset or
        mistyped to zero."""
        with pytest.raises(ValueError):
            await expire_pending(-1)


class TestTheBeat:
    def test_the_beat_ages_the_queue_and_the_task_is_registered(self):
        """The hygiene beat exists, points at the real task, and runs around
        the clock: transfers arrive whenever a buyer decides to pay, not when
        the IDX trades."""
        import workers.payment_worker  # noqa: F401 — registers, as include= does at boot
        from workers.celery_app import celery_app

        entry = celery_app.conf.beat_schedule["expire-pending-manual-transactions"]
        assert entry["task"] == "workers.payment_worker.expire_pending_transactions"
        assert entry["task"] in celery_app.tasks, "the worker is included in the app"
        assert set(entry["schedule"].minute) == {0, 10, 20, 30, 40, 50}


class TestApprovalGuards:
    async def test_an_unknown_transaction_is_not_found(self, fake_identity):
        import uuid

        with pytest.raises(TransactionNotFound):
            await approve_transaction(uuid.uuid4(), uuid.uuid4())

    async def test_a_denied_row_is_not_approvable_with_its_status_named(
        self, fake_identity
    ):
        account, tx = await _declaration(fake_identity)
        admin = await _account(fake_identity, "admin@aidss.id")
        await deny_transaction(tx.id, admin.id, "final untuk baris ini")

        with pytest.raises(TransactionNotApprovable) as caught:
            await approve_transaction(tx.id, admin.id)
        assert caught.value.status == "deny"

    async def test_a_denial_without_a_reason_is_refused_before_the_statement(
        self, fake_identity
    ):
        account, tx = await _declaration(fake_identity)
        admin = await _account(fake_identity, "admin@aidss.id")

        with pytest.raises(DenyRequiresReason):
            await deny_transaction(tx.id, admin.id, "   ")
        # Nothing moved and nothing was recorded.
        assert fake_identity.transactions[str(tx.id)]["status"] == "pending"
        assert fake_identity.transactions[str(tx.id)]["admin_notes"] is None
