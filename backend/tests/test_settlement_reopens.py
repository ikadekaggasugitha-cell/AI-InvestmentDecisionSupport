"""
Settlement reopens a lapsed account — and only a lapsed account.

The suspension's whole premise: losing access is the consequence, paying is the
way back. When the queue approves a payment, the account opened by the beat is
cleared on the same connection that writes the Subscription — a crash takes
both back, and retrying takes both forward.

The negative side is the reason `blocked_reason` exists at all: a settlement on
an administrator's ban is refused by the WHERE clause of `reopen_after_payment`,
not by a check in the caller's Python. The two reasons cannot be swapped, so
the tests below run both across two accounts and compare the states after.
"""

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


def _declare(client):
    return client.post(
        "/v1/payments/manual", json={"plan": "monthly", "payment_method": "bank_transfer"}
    )


def _close(fake_identity, payer_id, reason):
    """Close the payer's row the way the beat or the admin endpoint would."""
    for row in fake_identity.users.values():
        if str(row["id"]) == payer_id:
            row["blocked_at"] = fake_identity._now.now(fake_identity._tz.utc)
            row["blocked_reason"] = reason
            return row
    raise AssertionError("payer row vanished")


def _payer_row(fake_identity, payer_id):
    return next(r for r in fake_identity.users.values() if str(r["id"]) == payer_id)


def _declared_and_approved(client, fake_identity, payer_id, transaction_id):
    make_admin(client, fake_identity)
    login(client, "admin@aidss.id")
    return client.post(f"/v1/admin/transactions/{transaction_id}/approve")


class TestSettlementReopensTheLapsed:
    def test_a_settled_payment_clears_the_suspension(self, client, fake_identity):
        payer = signup(client, "lapsed@aidss.id")
        login(client, "lapsed@aidss.id")
        transaction_id = _declare(client).json()["id"]
        _close(fake_identity, payer, "subscription_expired")

        resp = _declared_and_approved(client, fake_identity, payer, transaction_id)

        assert resp.status_code == 200, resp.text
        row = _payer_row(fake_identity, payer)
        assert row["blocked_at"] is None
        assert row["blocked_reason"] is None
        # And the money became access, as always.
        assert any(str(s["user_id"]) == payer for s in fake_identity.subscriptions)

    def test_the_period_and_the_reopening_were_one_transaction(
        self, client, fake_identity
    ):
        """The crash the whole flow is armoured against: if the subscription
        write dies mid-approvals, the reopen rolls back with it. Half-opened —
        payment recorded, account still locked — is the state this must not
        produce; the retry owns both halves together."""
        payer = signup(client, "crash@aidss.id")
        login(client, "crash@aidss.id")
        transaction_id = _declare(client).json()["id"]
        _close(fake_identity, payer, "subscription_expired")

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        fake_identity.fail_subscription_writes = True
        client.post(f"/v1/admin/transactions/{transaction_id}/approve")

        fake_identity.fail_subscription_writes = False
        row = _payer_row(fake_identity, payer)
        # The snapshot rolled the users row back with the payment.
        assert row["blocked_at"] is not None
        assert row["blocked_reason"] == "subscription_expired"
        assert fake_identity.transactions[transaction_id]["status"] == "pending"

        # The retry takes both halves all the way.
        resp = client.post(f"/v1/admin/transactions/{transaction_id}/approve")
        assert resp.status_code == 200, resp.text
        row = _payer_row(fake_identity, payer)
        assert row["blocked_at"] is None


class TestSettlementNeverOpensAnAdminBan:
    def test_a_settled_payment_on_a_banned_account_changes_nothing(
        self, client, fake_identity
    ):
        """The most important test in this plan. 'admin' is the administrator's
        closure; the money path does not have the key to it, and the reason
        column must still say 'admin' after the approve — not nudged closer to
        something payable."""
        payer = signup(client, "banned-pay@aidss.id")
        login(client, "banned-pay@aidss.id")
        transaction_id = _declare(client).json()["id"]
        _close(fake_identity, payer, "admin")

        resp = _declared_and_approved(client, fake_identity, payer, transaction_id)

        # The payment is served as always (rule 8: blocking and granting are
        # different questions).
        assert resp.status_code == 200, resp.text
        assert any(str(s["user_id"]) == payer for s in fake_identity.subscriptions)
        row = _payer_row(fake_identity, payer)
        assert row["blocked_at"] is not None
        assert row["blocked_reason"] == "admin"

    def test_an_open_account_is_not_touched(self, client, fake_identity):
        """A settlement on someone never suspended must not introduce reason
        state where there was none."""
        payer = signup(client, "plain@aidss.id")
        login(client, "plain@aidss.id")
        transaction_id = _declare(client).json()["id"]

        _declared_and_approved(client, fake_identity, payer, transaction_id)

        row = _payer_row(fake_identity, payer)
        assert row["blocked_at"] is None
        assert row["blocked_reason"] is None


class TestTheReasonsCannotBeSwapped:
    def test_two_accounts_two_answers(self, client, fake_identity):
        """Side by side, so a refactor that graced one reason with the other's
        outcome cannot pass quietly."""
        lapsed = signup(client, "swap-lapsed@aidss.id")
        login(client, "swap-lapsed@aidss.id")
        lapsed_tx = _declare(client).json()["id"]

        banned = signup(client, "swap-banned@aidss.id")
        login(client, "swap-banned@aidss.id")
        banned_tx = _declare(client).json()["id"]

        _close(fake_identity, lapsed, "subscription_expired")
        _close(fake_identity, banned, "admin")

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        assert client.post(f"/v1/admin/transactions/{lapsed_tx}/approve").status_code == 200
        assert client.post(f"/v1/admin/transactions/{banned_tx}/approve").status_code == 200

        assert _payer_row(fake_identity, lapsed)["blocked_at"] is None
        assert _payer_row(fake_identity, banned)["blocked_at"] is not None
        assert _payer_row(fake_identity, banned)["blocked_reason"] == "admin"

    def test_replaying_the_settle_does_not_re_suspend_or_double_open(
        self, client, fake_identity
    ):
        """Idempotence across the reopen: a second approve answers the same
        period and leaves the account open exactly once."""
        payer = signup(client, "replay-reopen@aidss.id")
        login(client, "replay-reopen@aidss.id")
        transaction_id = _declare(client).json()["id"]
        _close(fake_identity, payer, "subscription_expired")

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        client.post(f"/v1/admin/transactions/{transaction_id}/approve")
        row = _payer_row(fake_identity, payer)
        assert row["blocked_at"] is None

        again = client.post(f"/v1/admin/transactions/{transaction_id}/approve")
        assert again.status_code == 200
        assert _payer_row(fake_identity, payer)["blocked_at"] is None
        assert fake_identity.transactions[transaction_id]["subscription_id"]


class TestTheOperatorGrantAlsoReopens:
    def test_a_manual_grant_clears_a_suspension(self, client, fake_identity):
        """The operator granting days to a suspended account means exactly what
        a settle means: the period is back, so the suspension ends — through the
        same single door inside `grant`, not a second clearing mechanism."""
        target = signup(client, "grant-me@aidss.id")
        _close(fake_identity, target, "subscription_expired")
        make_admin(client, fake_identity)

        resp = client.post(
            f"/v1/admin/accounts/{target}/subscription", json={"days": 30}
        )
        assert resp.status_code == 200, resp.text
        row = _payer_row(fake_identity, target)
        assert row["blocked_at"] is None
        assert row["blocked_reason"] is None

    def test_a_manual_grant_change_no_admin_ban(self, client, fake_identity):
        target = signup(client, "grant-banned@aidss.id")
        _close(fake_identity, target, "admin")
        make_admin(client, fake_identity)

        resp = client.post(
            f"/v1/admin/accounts/{target}/subscription", json={"days": 30}
        )
        assert resp.status_code == 200, resp.text
        row = _payer_row(fake_identity, target)
        assert row["blocked_at"] is not None
        assert row["blocked_reason"] == "admin"
