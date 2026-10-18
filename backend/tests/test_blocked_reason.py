"""
The reason a block carries, and the two doors that can open one.

`blocked_reason` is not metadata; it is the datum that decides whether a payment
may reopen an account. 'admin' means an administrator closed the account, and
only the admin's own unblock endpoint may open it — a payment satisfying that
lock would be the privilege-escalation door this whole plan exists to keep shut.
'subscription_expired' means the clock ran out, and paying reopens it.

These tests sit on the conftest identity fake because the behavior is service
shape, not SQL text (the SQL guards are pinned in test_blocked_reason_schema).
"""

import uuid

from api.services import accounts

BLOCKED_REASON_ADMIN = "admin"
BLOCKED_REASON_SUSPENDED = "subscription_expired"


class TestSetBlockedRecordsWhy:
    async def test_an_admin_block_names_itself(self, fake_identity):
        created = await accounts.create_account(
            email="why@aidss.id", password_hash="h", full_name="W", phone_number="0812"
        )
        blocked = await accounts.set_blocked(created.id, True, reason=BLOCKED_REASON_ADMIN)
        assert blocked.blocked_at is not None
        assert blocked.blocked_reason == "admin"

    async def test_the_reason_travels_to_later_reads(self, fake_identity):
        """The JOIN in authenticate() is what every request reads, so the reason
        has to survive the round trip, not just the write that set it."""
        created = await accounts.create_account(
            email="after@aidss.id", password_hash="h", full_name="A", phone_number="0812"
        )
        await accounts.set_blocked(created.id, True, reason=BLOCKED_REASON_ADMIN)
        fetched = await accounts.get_account(created.id)
        assert fetched.blocked_reason == "admin"


class TestReopenAfterPayment:
    async def _suspended(self, fake_identity, email):
        created = await accounts.create_account(
            email=email, password_hash="h", full_name="S", phone_number="0812"
        )
        await accounts.set_blocked(created.id, True, reason=BLOCKED_REASON_ADMIN)
        row = fake_identity.users[email]
        row["blocked_reason"] = BLOCKED_REASON_SUSPENDED
        return created

    async def test_it_clears_a_lapsed_subscription_block(self, fake_identity):
        account = await self._suspended(fake_identity, "lapsed@aidss.id")

        opened = await accounts.reopen_after_payment(account.id)

        assert opened is True
        fetched = await accounts.get_account(account.id)
        assert fetched.blocked_at is None
        assert fetched.blocked_reason is None

    async def test_it_never_opens_an_admin_ban(self, fake_identity):
        """The one property this plan must not regress. A settled payment calls
        this on its way to granting; a banned account does not become payable."""
        created = await accounts.create_account(
            email="banned@aidss.id", password_hash="h", full_name="B", phone_number="0812"
        )
        await accounts.set_blocked(created.id, True, reason=BLOCKED_REASON_ADMIN)

        opened = await accounts.reopen_after_payment(created.id)

        assert opened is False
        fetched = await accounts.get_account(created.id)
        assert fetched.blocked_at is not None
        assert fetched.blocked_reason == "admin"

    async def test_an_open_account_is_a_false_not_an_error(self, fake_identity):
        """Idempotent by construction: a retried settle finds nothing to clear
        and reports exactly that, rather than asking the caller to special-case it."""
        created = await accounts.create_account(
            email="open@aidss.id", password_hash="h", full_name="O", phone_number="0812"
        )
        assert await accounts.reopen_after_payment(created.id) is False

    async def test_it_runs_on_the_callers_connection(self, fake_identity):
        """`conn` is how grant() keeps the reopening inside the payment's own
        transaction, so the account never half-opens while the period half-wrote."""
        account = await self._suspended(fake_identity, "conn@aidss.id")

        opened = await accounts.reopen_after_payment(account.id, conn=fake_identity)

        assert opened is True
        fetched = await accounts.get_account(account.id)
        assert fetched.blocked_at is None

    async def test_an_unknown_account_is_false_not_a_404(self, fake_identity):
        """The reopen rides along with a grant; the grant is what owns the
        not-found and the transaction state. Nothing here is worth an exception."""
        assert await accounts.reopen_after_payment(uuid.uuid4()) is False
