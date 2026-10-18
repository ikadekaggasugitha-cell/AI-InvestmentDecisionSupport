"""
The admin payment queue and its decisions.

Three endpoints, one rule family:

  * GET /v1/admin/transactions shows the work with its evidence — nominal,
    invoice, plan, payer, and the record the account left. An approval is an
    access decision, so the queue page is the working surface, not a list.
  * POST .../approve marks the money received AND writes the Subscription in
    one database transaction. The crash test below is the one that matters:
    a settlement must never exist without the access it paid for.
  * POST .../deny refuses the evidence with a recorded reason, and touches
    nothing the account already holds.

Expiry is hygiene between those two: an `expire` row is still money, so it
stays approvable; a `deny` is final for its row.
"""

import asyncio
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from tests.test_admin_api import login, make_admin, signup


@pytest.fixture
def client(monkeypatch, mock_redis):
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _declare(client, plan="monthly", note=None):
    body = {"plan": plan, "payment_method": "bank_transfer"}
    if note is not None:
        body["note"] = note
    return client.post("/v1/payments/manual", json=body)


def _queue(client, status="pending"):
    return client.get(f"/v1/admin/transactions?status={status}")


class TestTheQueue:
    def test_the_queue_shows_the_evidence_not_just_the_action(
        self, client, fake_identity
    ):
        signup(client, "antre@aidss.id")
        login(client, "antre@aidss.id")
        declared = _declare(client, note="BCA 999000111").json()
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        rows = _queue(client).json()

        assert rows, "a declared payment is the work"
        row = rows[0]
        assert row["id"] == declared["id"]
        assert row["invoiceCode"] == declared["invoiceCode"]
        assert row["amount"] == 15000
        assert row["plan"] == "monthly"
        assert row["status"] == "pending"
        assert row["payerEmail"] == "antre@aidss.id"
        assert row["notes"] == "BCA 999000111"
        assert row["expiresAt"]
        assert row["paymentMethod"] == "bank_transfer"

    def test_the_queue_oldest_first(self, client, fake_identity):
        signup(client, "pertama@aidss.id")
        login(client, "pertama@aidss.id")
        first_id = _declare(client).json()["id"]
        signup(client, "kedua@aidss.id")
        login(client, "kedua@aidss.id")
        second_id = _declare(client).json()["id"]

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        rows = _queue(client).json()

        assert [r["id"] for r in rows] == [first_id, second_id]

    def test_a_non_admin_reads_nothing_and_decides_nothing(self, client, fake_identity):
        signup(client, "bukanadmin@aidss.id")
        login(client, "bukanadmin@aidss.id")

        declared = client.post(
            "/v1/payments/manual", json={"plan": "monthly", "payment_method": "qris"}
        ).json()
        transaction_id = declared["id"]

        assert _queue(client).status_code == 403
        resp = client.post(f"/v1/admin/transactions/{transaction_id}/approve")
        assert resp.status_code == 403
        resp = client.post(
            f"/v1/admin/transactions/{transaction_id}/deny",
            json={"reason": "test"},
        )
        assert resp.status_code == 403
        # Nothing moved.
        assert fake_identity.transactions[transaction_id]["status"] == "pending"
        assert fake_identity.transactions[transaction_id]["admin_notes"] is None

    def test_an_anonymous_caller_is_refused(self, client):
        assert _queue(client).status_code == 401

    def test_an_unknown_status_filter_is_the_callers_error(self, client, fake_identity):
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        assert _queue(client, status="cancelled").status_code == 422


class TestApprove:
    def test_approve_settles_the_money_and_writes_the_period(
        self, client, fake_identity
    ):
        payer = signup(client, "disetujui@aidss.id")
        login(client, "disetujui@aidss.id")
        transaction_id = _declare(client, plan="monthly").json()["id"]

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        resp = client.post(f"/v1/admin/transactions/{transaction_id}/approve")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "settlement"
        assert body["transactionId"] == transaction_id
        assert body["subscriptionId"]
        assert body["subscriptionExpiresAt"]

        # Exactly one Subscription exists, belongs to the payer, and covers the
        # blueprint's monthly length: the period runs from the moment the
        # settlement was pressed, so it sits inside [now+30d] for the instants
        # bracketing the approve, not inside [declaration+30d].
        assert len(fake_identity.subscriptions) == 1
        period = fake_identity.subscriptions[0]
        assert str(period["user_id"]) == payer
        now_after = fake_identity._now.now(fake_identity._tz.utc)
        grant_window = period["expires_at"] - now_after
        assert timedelta(days=30, seconds=-1) < grant_window <= timedelta(days=30)

        row = fake_identity.transactions[transaction_id]
        assert row["status"] == "settlement"
        assert str(row["subscription_id"]) == body["subscriptionId"]
        assert str(row["approved_by"]) == str(
            next(u["id"] for u in fake_identity.users.values()
                 if u["email"] == "admin@aidss.id")
        )

    def test_the_annual_plan_buys_three_hundred_sixty_five_days(
        self, client, fake_identity
    ):
        signup(client, "tahunpenuh@aidss.id")
        login(client, "tahunpenuh@aidss.id")
        transaction_id = _declare(client, plan="annual").json()["id"]

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        assert client.post(f"/v1/admin/transactions/{transaction_id}/approve").json()[
            "status"
        ] == "settlement"

        period = fake_identity.subscriptions[0]
        now_after = fake_identity._now.now(fake_identity._tz.utc)
        grant_window = period["expires_at"] - now_after
        assert timedelta(days=365, seconds=-1) < grant_window <= timedelta(days=365)

    def test_a_second_approve_answers_with_the_same_period(
        self, client, fake_identity
    ):
        """A repeat call re-reads the row it settled: no second Subscription is
        minted, and both presses see the decision that stands."""
        signup(client, "duatekan@aidss.id")
        login(client, "duatekan@aidss.id")
        transaction_id = _declare(client).json()["id"]
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        first = client.post(f"/v1/admin/transactions/{transaction_id}/approve")
        second = client.post(f"/v1/admin/transactions/{transaction_id}/approve")

        assert first.status_code == 200 and second.status_code == 200
        assert first.json()["subscriptionId"] == second.json()["subscriptionId"]
        assert len(fake_identity.subscriptions) == 1

    def test_approve_serves_a_blocked_account_without_lifting_the_block(
        self, client, fake_identity
    ):
        """CONTEXT.md rule 8, from the money side: blocking and granting ask
        different questions. The account is blocked after declaring; the
        approval still writes the Subscription it paid for, and the block
        stays."""
        payer = signup(client, "terbloki@aidss.id")
        login(client, "terbloki@aidss.id")
        transaction_id = _declare(client).json()["id"]

        make_admin(client, fake_identity)
        assert (
            client.post(f"/v1/admin/accounts/{payer}/block").status_code == 200
        )
        login(client, "admin@aidss.id")
        resp = client.post(f"/v1/admin/transactions/{transaction_id}/approve")

        assert resp.status_code == 200, resp.text
        assert len(fake_identity.subscriptions) == 1
        assert str(fake_identity.subscriptions[0]["user_id"]) == payer
        # The block was never lifted by the payment.
        for row in fake_identity.users.values():
            if str(row["id"]) == payer:
                assert row["blocked_at"] is not None

    def test_after_approval_the_payer_s_own_state_says_active(
        self, client, fake_identity
    ):
        """The round trip this endpoint exists for: approve, then the payer
        asks GET /v1/subscription/current and hears yes from the fresh table —
        without signals flipping, because 402 came from the paywall reading the
        same rows."""
        signup(client, "roundtrip@aidss.id")
        login(client, "roundtrip@aidss.id")
        transaction_id = _declare(client).json()["id"]
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        assert (
            client.post(f"/v1/admin/transactions/{transaction_id}/approve").status_code
            == 200
        )

        login(client, "roundtrip@aidss.id")
        state = client.get("/v1/subscription/current")

        assert state.status_code == 200
        assert state.json()["active"] is True
        assert state.json()["daysRemaining"] in (29, 30)

    def test_two_different_transactions_grant_two_periods(
        self, client, fake_identity
    ):
        """Idempotency is per transaction, not per account: the second paid
        transaction is its own money, and it does not reuse the first
        Subscription."""
        payer = signup(client, "dwatransaksi@aidss.id")
        login(client, "dwatransaksi@aidss.id")
        first = _declare(client, plan="monthly").json()["id"]
        second = _declare(client, plan="annual").json()["id"]

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        assert (
            client.post(f"/v1/admin/transactions/{first}/approve").status_code == 200
        )
        assert (
            client.post(f"/v1/admin/transactions/{second}/approve").status_code == 200
        )

        assert len(fake_identity.subscriptions) == 2
        owners = {str(s["user_id"]) for s in fake_identity.subscriptions}
        assert owners == {payer}
        # The two periods differ by the plan each row recorded.
        expiries = sorted(s["expires_at"] for s in fake_identity.subscriptions)
        assert expiries[1] - expiries[0] > timedelta(days=300)

    def test_an_unknown_transaction_is_a_404(self, client, fake_identity):
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        resp = client.post(f"/v1/admin/transactions/{uuid.uuid4()}/approve")
        assert resp.status_code == 404

    def test_a_denied_transaction_is_not_approvable(self, client, fake_identity):
        signup(client, "tertolak@aidss.id")
        login(client, "tertolak@aidss.id")
        transaction_id = _declare(client).json()["id"]
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        assert client.post(
            f"/v1/admin/transactions/{transaction_id}/deny",
            json={"reason": "bukti tidak sesuai"},
        ).status_code == 200

        resp = client.post(f"/v1/admin/transactions/{transaction_id}/approve")

        assert resp.status_code == 409
        assert fake_identity.subscriptions == []

    def test_an_expired_transaction_is_still_approvable(self, client, fake_identity):
        """Expiry is the queue's hygiene, not a verdict on the money: the row
        aged out through the real expiry pass, and the money still settles."""
        signup(client, "terlambat@aidss.id")
        login(client, "terlambat@aidss.id")
        transaction_id = _declare(client).json()["id"]

        row = fake_identity.transactions[transaction_id]
        row["created_at"] = row["created_at"] - timedelta(hours=2)
        from api.services.payments import expire_pending

        assert asyncio.run(expire_pending(3600)) == 1
        assert row["status"] == "expire"

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        resp = client.post(f"/v1/admin/transactions/{transaction_id}/approve")

        assert resp.status_code == 200, resp.text
        assert fake_identity.subscriptions, "the period exists"


class TestDeny:
    def test_a_denial_records_the_reason_and_touches_nothing_held(
        self, client, fake_identity
    ):
        payer = signup(client, "ditolak@aidss.id")
        # The payer already holds a period granted another way — CONTEXT.md
        # rule 8 in reverse: refusing evidence cannot lift what was granted.
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        assert (
            client.post(
                f"/v1/admin/accounts/{payer}/subscription", json={"days": 30}
            ).status_code
            == 200
        )
        login(client, "ditolak@aidss.id")
        transaction_id = _declare(client, note="BCA 555222333").json()["id"]
        login(client, "admin@aidss.id")

        resp = client.post(
            f"/v1/admin/transactions/{transaction_id}/deny",
            json={"reason": "nominal tidak cocok"},
        )

        assert resp.status_code == 200, resp.text
        row = fake_identity.transactions[transaction_id]
        assert row["status"] == "deny"
        # Both the declaration and the refusal read on one line.
        assert row["admin_notes"].startswith("BCA 555222333")
        assert "Ditolak: nominal tidak cocok" in row["admin_notes"]
        assert str(row["approved_by"]) == str(
            next(u["id"] for u in fake_identity.users.values()
                 if u["email"] == "admin@aidss.id")
        )
        # Nothing the payer holds was revoked.
        assert len(fake_identity.subscriptions) == 1
        assert str(fake_identity.subscriptions[0]["user_id"]) == payer

    def test_a_denial_needs_a_reason(self, client, fake_identity):
        signup(client, "tanpaalasan@aidss.id")
        login(client, "tanpaalasan@aidss.id")
        transaction_id = _declare(client).json()["id"]
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        nothing = client.post(
            f"/v1/admin/transactions/{transaction_id}/deny", json={}
        )
        blank = client.post(
            f"/v1/admin/transactions/{transaction_id}/deny", json={"reason": "   "}
        )

        assert nothing.status_code == 422
        assert blank.status_code == 422
        assert fake_identity.transactions[transaction_id]["status"] == "pending"

    def test_settled_money_is_not_denied(self, client, fake_identity):
        """Deny cannot do what revoke would: the money has already been turned
        into access, so refusing it would silently close the account."""
        signup(client, "sudahsettle@aidss.id")
        login(client, "sudahsettle@aidss.id")
        transaction_id = _declare(client).json()["id"]
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        assert (
            client.post(f"/v1/admin/transactions/{transaction_id}/approve").status_code
            == 200
        )

        resp = client.post(
            f"/v1/admin/transactions/{transaction_id}/deny", json={"reason": "terlambat"}
        )

        assert resp.status_code == 409
        assert fake_identity.transactions[transaction_id]["status"] == "settlement"
        assert len(fake_identity.subscriptions) == 1

    def test_a_second_denial_repeats_the_first_not_its_reason(
        self, client, fake_identity
    ):
        signup(client, "duatolak@aidss.id")
        login(client, "duatolak@aidss.id")
        transaction_id = _declare(client).json()["id"]
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        first = client.post(
            f"/v1/admin/transactions/{transaction_id}/deny",
            json={"reason": "alasan pertama"},
        )
        second = client.post(
            f"/v1/admin/transactions/{transaction_id}/deny",
            json={"reason": "alasan kedua"},
        )

        assert first.status_code == 200 and second.status_code == 200
        notes = fake_identity.transactions[transaction_id]["admin_notes"]
        assert notes.count("alasan pertama") == 1
        assert "alasan kedua" not in notes

    def test_an_unknown_transaction_is_a_404_here_too(self, client, fake_identity):
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        resp = client.post(
            f"/v1/admin/transactions/{uuid.uuid4()}/deny", json={"reason": "x"}
        )
        assert resp.status_code == 404


class TestAtomicSettlement:
    def test_a_crash_between_settlement_and_grant_leaves_pending(
        self, client, fake_identity
    ):
        """The state approve must never produce: `settlement` without a
        Subscription. The Subscription write fails, the settlement rolls back
        with it, and the row is still workable money."""
        signup(client, "crash@aidss.id")
        login(client, "crash@aidss.id")
        transaction_id = _declare(client).json()["id"]
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        fake_identity.fail_subscription_writes = True

        resp = client.post(f"/v1/admin/transactions/{transaction_id}/approve")

        assert resp.status_code == 503, resp.text
        row = fake_identity.transactions[transaction_id]
        assert row["status"] == "pending", "the settlement rolled back with the grant"
        assert row["subscription_id"] is None
        assert row.get("approved_by") is None
        assert fake_identity.subscriptions == []

        # The same request can be pressed again, and then it works for real.
        fake_identity.fail_subscription_writes = False
        retry = client.post(f"/v1/admin/transactions/{transaction_id}/approve")
        assert retry.status_code == 200, retry.text
        assert len(fake_identity.subscriptions) == 1
