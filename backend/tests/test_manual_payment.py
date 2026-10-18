"""
POST /v1/payments/manual — an account declaring a transfer happened.

What this endpoint must never get wrong:

  * The row starts `pending`. Nothing has been received, and nothing about the
    declaration may read otherwise.
  * The amount is the server's price for the plan at that moment. The body has
    no amount field and no invoice field — both are server facts, and a body
    proposing either is writing its own receipt.
  * No Subscription is written. A period handed out on a declaration could not
    be honestly taken back when the money turned out not to exist.

`GET /v1/payments/me` is here too: the account's own history, denials included,
because a rejected transfer that vanished would read the same as an accepted
one's successor.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from tests.test_admin_api import login, signup


@pytest.fixture
def client(monkeypatch, mock_redis):
    # Paywall ON but never consulted by this router: money state does not gate
    # money state, and the account asking about its payment is exactly the one
    # the paywall refuses.
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "true")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _declare(client, plan="monthly", method="bank_transfer", note=None, extra=None):
    body = {"plan": plan, "payment_method": method}
    if note is not None:
        body["note"] = note
    if extra:
        body.update(extra)
    return client.post("/v1/payments/manual", json=body)


class TestDeclareManualPayment:
    def test_the_declaration_is_pending_and_carries_the_server_price(
        self, client, fake_identity
    ):
        acct = signup(client, "pembeli@aidss.id")
        login(client, "pembeli@aidss.id")

        resp = _declare(client, note="BCA a/n Suga 1234567890")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "pending"
        assert body["paymentGateway"] == "manual"
        assert body["plan"] == "monthly"
        assert body["invoiceCode"]
        # 15000 is the seeded monthly price — what the server says the plan
        # costs, not anything a body proposed.
        assert body["amount"] == 15000
        assert body["expiresAt"]  # the queue deadline, shown to the payer
        assert body["createdAt"]

        row = fake_identity.transactions[body["id"]]
        assert row["status"] == "pending"
        assert row["amount"] == 15000
        assert row["payment_gateway"] == "manual"
        assert row["admin_notes"] == "BCA a/n Suga 1234567890"
        assert str(row["user_id"]) == acct

    def test_the_annual_plan_declares_the_annual_price(self, client, fake_identity):
        signup(client, "tahunan@aidss.id")
        login(client, "tahunan@aidss.id")

        resp = _declare(client, plan="annual")

        assert resp.status_code == 200, resp.text
        assert resp.json()["amount"] == 150000
        stored = next(iter(fake_identity.transactions.values()))
        assert stored["plan"] == "annual"
        assert stored["amount"] == 150000

    def test_a_body_cannot_propose_the_amount_or_the_invoice(
        self, client, fake_identity
    ):
        """`amount: 1` and a chosen invoice_code are not ignored — they are
        refused. An ignored field reads as accepted to whoever sent it."""
        signup(client, "mengarang@aidss.id")
        login(client, "mengarang@aidss.id")

        resp = _declare(client, extra={"amount": 1, "invoice_code": "INV-HACKED-01"})

        assert resp.status_code == 422, resp.text
        # Nothing was written: there is no row carrying the caller's amount,
        # and there is no row at all.
        assert fake_identity.transactions == {}
        assert fake_identity.invoice_codes == {}

    def test_two_declarations_are_two_rows_not_an_error(self, client, fake_identity):
        """An unpaid first attempt is money in flight, not a conflict."""
        signup(client, "duakali@aidss.id")
        login(client, "duakali@aidss.id")

        first = _declare(client)
        second = _declare(client, plan="annual")

        assert first.status_code == 200 and second.status_code == 200
        assert len(fake_identity.transactions) == 2
        a, b = first.json()["invoiceCode"], second.json()["invoiceCode"]
        assert a and b and a != b, "invoice codes are unique per row"

    def test_the_declaration_writes_no_subscription(self, client, fake_identity):
        signup(client, "menunggu@aidss.id")
        login(client, "menunggu@aidss.id")

        assert _declare(client).status_code == 200

        assert fake_identity.subscriptions == []
        state = client.get("/v1/subscription/current")
        assert state.status_code == 200
        assert state.json()["active"] is False

    def test_an_empty_method_is_the_caller_error_not_a_503(self, client):
        signup(client, "kosong@aidss.id")
        login(client, "kosong@aidss.id")

        resp = _declare(client, method="   ")

        assert resp.status_code == 422, resp.text

    def test_an_unknown_plan_is_refused(self, client):
        signup(client, "mingguan@aidss.id")
        login(client, "mingguan@aidss.id")

        resp = _declare(client, plan="weekly")

        assert resp.status_code == 422, resp.text

    def test_without_a_readable_price_nothing_is_declared(self, client, fake_identity):
        """503, not a row: an install with no price cannot tell the buyer what
        they owe, and inventing a number would be worse than the outage."""
        signup(client, "tanpaharga@aidss.id")
        login(client, "tanpaharga@aidss.id")
        fake_identity.settings.pop("pricing")

        resp = _declare(client)

        assert resp.status_code == 503, resp.text
        assert fake_identity.transactions == {}

    def test_no_session_no_declaration(self, client, fake_identity):
        resp = _declare(client)

        assert resp.status_code == 401
        assert fake_identity.transactions == {}


class TestOwnHistory:
    def test_me_lists_own_rows_newest_first_with_denials(self, client, fake_identity):
        account = signup(client, "riwayat@aidss.id")
        login(client, "riwayat@aidss.id")
        first_id = _declare(client).json()["id"]
        second_id = _declare(client, plan="annual").json()["id"]
        # One of them denied by an admin — the UI keeps it visible.
        fake_identity.transactions[first_id]["status"] = "deny"

        resp = client.get("/v1/payments/me")

        assert resp.status_code == 200, resp.text
        rows = resp.json()
        assert [r["id"] for r in rows] == [second_id, first_id], "newest first"
        assert rows[0]["plan"] == "annual"
        assert rows[1]["status"] == "deny"
        assert rows[1]["expiresAt"] is None, "a closed row has no queue deadline"
        # Someone else's money is not in the list.
        assert all(
            str(fake_identity.transactions[r["id"]]["user_id"]) == account for r in rows
        )

    def test_me_is_not_readable_without_a_session(self, client):
        assert client.get("/v1/payments/me").status_code == 401


class TestQueueDeadline:
    def test_the_deadline_is_created_at_plus_the_window(self, client, fake_identity):
        signup(client, "tenggat@aidss.id")
        login(client, "tenggat@aidss.id")

        body = _declare(client).json()

        created = fake_identity.transactions[body["id"]]["created_at"]
        expected = created + timedelta(seconds=get_settings().manual_transaction_ttl_seconds)
        from datetime import datetime

        observed = datetime.fromisoformat(body["expiresAt"])
        assert observed == expected, "the deadline travels with the row, not with now"
