"""
grant() — the one writer of `subscriptions`.

These run against the fake identity pool, like the service tests in
test_identity_service.py: the suite has no database, and the questions this file
asks — idempotency per transaction, days ≤ 0 refused, one period per payment —
are questions about the statements the service issues and the guards around
them. The fake raises an AssertionError on any statement it does not recognise,
so a drift between the SQL here and the fake's branches is a red test, not a
silently green one.
"""

import uuid

import pytest

from api.services import accounts
from api.services.subscriptions import (
    InvalidGrant,
    SubscriptionPeriod,
    TransactionNotFound,
    TransactionOwnershipError,
    grant,
)


async def _account(fake_identity, email="payer@aidss.id") -> accounts.Account:
    return await accounts.create_account(
        email=email,
        password_hash="not-a-real-hash",
        full_name="Pengguna Uji",
        phone_number="081234567890",
    )


class TestDirectGrant:
    async def test_grant_creates_one_period(self, fake_identity):
        """The happy path: a row appears, pointing at the account, still active."""
        from datetime import timedelta

        account = await _account(fake_identity)

        period = await grant(account.id, days=30)

        assert isinstance(period, SubscriptionPeriod)
        assert str(period.user_id) == str(account.id)
        stored = fake_identity.subscriptions
        assert len(stored) == 1
        assert str(stored[0]["user_id"]) == str(account.id)
        # The expiry the fake computed sits inside the granted window, measured
        # against the same clock the fake used to mint it.
        assert timedelta(0) < stored[0]["expires_at"] - fake_identity._now.now(
            fake_identity._tz.utc
        ) <= timedelta(days=30)

    async def test_days_of_zero_or_negative_is_refused(self, fake_identity):
        """days ≤ 0 would create `expires_at` at or before NOW(): a period that
        reads as active for an instant and is gone by the next request."""
        account = await _account(fake_identity)

        with pytest.raises(InvalidGrant):
            await grant(account.id, days=0)
        with pytest.raises(InvalidGrant):
            await grant(account.id, days=-1)
        # The refusal happened before any statement, not after a partial write.
        assert fake_identity.subscriptions == []

    async def test_a_second_grant_adds_a_row_and_never_moves_the_first(self, fake_identity):
        """Overlapping periods are legitimate: renewal is a new row, and the
        first period keeps the expiry it was granted with."""
        account = await _account(fake_identity)
        first = await grant(account.id, days=30)
        first_stored = fake_identity.subscriptions[0]["expires_at"]

        second = await grant(account.id, days=15)

        assert len(fake_identity.subscriptions) == 2
        assert fake_identity.subscriptions[0]["expires_at"] == first_stored
        # MAX(expires_at) — entitlements reads the longest period, which is the
        # 30-day one, not the most recent grant.
        longest = max(fake_identity.subscriptions, key=lambda r: r["expires_at"])
        assert str(longest["user_id"]) == str(first.user_id) == str(second.user_id)


class TestGrantPerTransaction:
    async def test_the_same_transaction_grants_once(self, fake_identity):
        """The idempotency guarantee: one payment row, one period, however many
        times the same transaction is granted."""
        account = await _account(fake_identity)
        transaction = fake_identity.add_transaction(account.id)

        first = await grant(account.id, days=30, transaction_id=transaction["id"])
        second = await grant(account.id, days=30, transaction_id=transaction["id"])

        assert first.id == second.id
        assert len(fake_identity.subscriptions) == 1
        assert str(fake_identity.transactions[str(transaction["id"])]["subscription_id"]) == str(
            first.id
        )

    async def test_two_transactions_grant_two_periods(self, fake_identity):
        """Distinct transactions are distinct payments, so each mints its own
        period — and the longest expiry is the one that reads as active."""
        account = await _account(fake_identity)
        first_tx = fake_identity.add_transaction(account.id)
        second_tx = fake_identity.add_transaction(account.id)

        first = await grant(account.id, days=30, transaction_id=first_tx["id"])
        second = await grant(account.id, days=15, transaction_id=second_tx["id"])

        assert first.id != second.id
        assert len(fake_identity.subscriptions) == 2
        longest = max(fake_identity.subscriptions, key=lambda r: r["expires_at"])
        assert str(longest.get("id")) == str(first.id)

    async def test_a_unknown_transaction_grants_nothing(self, fake_identity):
        """Granting against a payment row that does not exist would write access
        no money ever settled for."""
        account = await _account(fake_identity)

        with pytest.raises(TransactionNotFound):
            await grant(account.id, days=5, transaction_id=str(uuid.uuid4()))
        assert fake_identity.subscriptions == []

    async def test_someone_elses_transaction_is_refused(self, fake_identity):
        """The ownership guard: one account's payment cannot mint another
        account's subscription."""
        payer = await _account(fake_identity, "pembayar@aidss.id")
        other = await _account(fake_identity, "lain@aidss.id")
        transaction = fake_identity.add_transaction(payer.id)

        with pytest.raises(TransactionOwnershipError):
            await grant(other.id, days=5, transaction_id=transaction["id"])
        # Nobody granted anything to anyone.
        assert fake_identity.subscriptions == []
