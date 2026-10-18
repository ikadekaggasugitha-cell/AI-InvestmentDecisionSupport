"""
The suspension beat: who is caught, who is left alone, and that it is idempotent.

A lapsed subscription closing the whole account is a heavier consequence than a
402 on a route, so the catch has to be exact. The two wrong catches are both
permanent-feeling from the person's side: suspend someone who never paid, and
every new registration becomes a ban; suspend someone with live access, and the
beat has decided access instead of the expiry — rule 1 says it may not.

These tests sit on the conftest identity fake, whose rows move the way the
statements move. The guard-on-'admin' property also has a schema-level pin in
test_blocked_reason_schema and a money-path pin in test_blocked_reason.
"""

import uuid
from datetime import timedelta


def _seed_subscription(pool, account_id, *, days_left):
    """One subscription row; `days_left=-3` means it ran out 3 days ago."""
    row = {
        "id": uuid.uuid4(),
        "user_id": str(account_id),
        "expires_at": pool._now.now(pool._tz.utc) + timedelta(days=days_left),
    }
    pool.subscriptions.append(row)
    return row


async def _signup(pool, email):
    created = await pool.fetchrow(
        "INSERT INTO users (email, password_hash, full_name, phone_number, role) "
        "VALUES ($1, $2, $3, $4, $5)",
        email, "h", "S", "0812", "user",
    )
    return created


class TestWhoIsCaught:
    async def test_an_account_who_never_paid_is_never_caught(self, fake_identity):
        """The dangerous catch. Empty `subscriptions` on a fresh install must
        not become a lock on every free registration."""
        account = await _signup(fake_identity, "neverpaid@aidss.id")

        suspended = await fake_identity.fetch("UPDATE users u SET blocked_at")

        assert suspended == []
        assert account["blocked_at"] is None

    async def test_an_account_with_live_access_is_not_caught(self, fake_identity):
        account = await _signup(fake_identity, "live@aidss.id")
        _seed_subscription(fake_identity, account["id"], days_left=12)

        suspended = await fake_identity.fetch("UPDATE users u SET blocked_at")

        assert suspended == []
        assert account["blocked_at"] is None

    async def test_an_account_whose_subscription_ended_is_caught(self, fake_identity):
        account = await _signup(fake_identity, "lapsed@aidss.id")
        _seed_subscription(fake_identity, account["id"], days_left=-3)

        suspended = await fake_identity.fetch("UPDATE users u SET blocked_at")

        assert [(r["email"]) for r in suspended] == ["lapsed@aidss.id"]
        assert account["blocked_at"] is not None
        assert account["blocked_reason"] == "subscription_expired"

    async def test_an_admin_block_is_never_touched(self, fake_identity):
        """`blocked_at IS NULL` is the beat's first guard: a closed row is not a
        candidate, whatever its reason. 'admin' can only be opened by the admin
        endpoint, and this is the test that the beat cannot even re-date it."""
        account = await _signup(fake_identity, "banned@aidss.id")
        _seed_subscription(fake_identity, account["id"], days_left=-3)
        blocked_when = fake_identity._now.now(fake_identity._tz.utc)
        account["blocked_at"] = blocked_when
        account["blocked_reason"] = "admin"

        suspended = await fake_identity.fetch("UPDATE users u SET blocked_at")

        assert suspended == []
        assert account["blocked_at"] is blocked_when
        assert account["blocked_reason"] == "admin"

    async def test_a_row_already_suspended_is_not_caught_again(self, fake_identity):
        """Idempotence, stated as a catch: 'subscription_expired' on a closed
        row must not be re-stamped twice — the second pass moves nothing."""
        account = await _signup(fake_identity, "done@aidss.id")
        _seed_subscription(fake_identity, account["id"], days_left=-3)

        first = await fake_identity.fetch("UPDATE users u SET blocked_at")
        stamp = account["blocked_at"]
        second = await fake_identity.fetch("UPDATE users u SET blocked_at")

        assert len(first) == 1
        assert second == []
        assert account["blocked_at"] is stamp


class TestTheReadSide:
    async def test_dry_run_sees_the_same_people_the_beat_would_close(self,
                                                                     fake_identity):
        account = await _signup(fake_identity, "seen@aidss.id")
        _seed_subscription(fake_identity, account["id"], days_left=-1)
        clean = await _signup(fake_identity, "clean@aidss.id")
        _seed_subscription(fake_identity, clean["id"], days_left=30)

        found = await fake_identity.fetch(
            "SELECT FROM users u WHERE EXISTS", 30
        )

        assert [r["email"] for r in found] == ["seen@aidss.id"]
        # Nothing moved: the read side never writes.
        assert account["blocked_at"] is None


class TestNothingElseMoves:
    async def test_subscriptions_are_untouched(self, fake_identity):
        """The beat closes access the expiry already ended; rule 1 keeps it out
        of the subscription table entirely."""
        account = await _signup(fake_identity, "readonly@aidss.id")
        row = _seed_subscription(fake_identity, account["id"], days_left=-1)
        before = dict(row)

        await fake_identity.fetch("UPDATE users u SET blocked_at")

        assert row == before

    async def test_the_service_presented_counts_what_it_caught(self, fake_identity):
        """The worker's heartbeat and the CLI's report both read this return."""
        from api.services import accounts

        target = await _signup(fake_identity, "counted@aidss.id")
        _seed_subscription(fake_identity, target["id"], days_left=-1)

        suspended = await accounts.suspend_lapsed_accounts()

        assert [(r["email"]) for r in suspended] == ["counted@aidss.id"]

    async def test_find_lapsed_returns_rows_for_the_cli(self, fake_identity):
        from api.services import accounts

        await _signup(fake_identity, "listing@aidss.id")
        target = fake_identity.users["listing@aidss.id"]
        _seed_subscription(fake_identity, target["id"], days_left=-2)

        found = await accounts.find_lapsed_accounts()

        assert [r["email"] for r in found] == ["listing@aidss.id"]


class TestTheBeatIsScheduled:
    def test_the_beat_task_is_registered_hourly(self):
        from workers.celery_app import celery_app

        entry = celery_app.conf.beat_schedule["suspend-lapsed-subscriptions"]
        assert entry["task"] == "workers.payment_worker.suspend_lapsed_subscriptions"
        cron = entry["schedule"]
        assert list(cron.minute) == [5], (
            "the suspension beat should sit at :05, out of the minute-0 "
            "stampede the market-hours jobs share"
        )
        assert sorted(cron.hour) == list(range(24)), (
            "suspension runs around the clock: a lapse does not wait for the "
            "market to open"
        )
