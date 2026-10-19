"""
POST /v1/payments/checkout and Midtrans' webhook — the gateway's two doors.

The checkout opens a page and writes nothing more: the body carries a plan,
the total is this server's price, and the row enters the ledger only when the
gateway has answered that a page exists. Against that door the tests replay
the body with an amount in it, a gateway that refuses to open anything, and
an install wired to no key at all — the button must go silent with a sentence,
never with a page.

The webhook has no session and needs none. The tests below ask exactly the
questions it exists to answer: a callback signed by someone else, a settlement
total that does not match the row, Midtrans' re-delivery of a callback it did
not see answered, a signature that verifies but names an order nobody wrote,
and a refund — the one event this handler explicitly refuses to act on.

Money state never decides access (CONTEXT.md rule 3): settlement calls
`grant()` and nothing else, and neither door reads `PAYWALL_ENABLED`.
"""

import hashlib

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from api.services.midtrans import GatewayUnavailable, SnapSession
from tests.test_admin_api import login, signup

SERVER_KEY = "SB-Mid-server-testkey"


@pytest.fixture
def client(monkeypatch, mock_redis):
    """
    The app with a real paywall and no session shortcuts — the doors under
    test are signed-in, and the accounts arrive through signup and login.
    """
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "true")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


@pytest.fixture
def snap(monkeypatch):
    """
    The gateway edge, faked: recorded calls and the page the server minted.
    No test here reaches the real Midtrans site — the network boundary is the
    thing being mocked, not the money logic under it.
    """
    calls: list[dict] = []

    async def _mint(*, order_id, gross_amount, email=None, expiry_minutes):
        calls.append(
            {
                "order_id": order_id,
                "gross_amount": gross_amount,
                "email": email,
                "expiry_minutes": expiry_minutes,
            }
        )
        return SnapSession(
            token=f"tok-{order_id}",
            redirect_url=f"https://app.sandbox.midtrans.com/snap/v2/vt/{order_id}",
        )

    monkeypatch.setattr("api.services.payments.create_snap_token", _mint)
    return calls


def _with_key(monkeypatch, key=SERVER_KEY):
    monkeypatch.setenv("MIDTRANS_SERVER_KEY", key)
    get_settings.cache_clear()


def _checkout(client, plan="monthly", extra=None):
    body = {"plan": plan}
    if extra:
        body.update(extra)
    return client.post("/v1/payments/checkout", json=body)


def _signature(order_id, status_code, gross_amount, key=SERVER_KEY):
    text = f"{order_id}{status_code}{gross_amount}{key}"
    return hashlib.sha512(text.encode()).hexdigest()


def _webhook(
    client,
    order_id,
    transaction_status,
    *,
    gross_amount="15000.00",
    status_code="200",
    transaction_id="mtr-777",
    payment_type=None,
    fraud_status=None,
    key=SERVER_KEY,
    signature=None,
):
    payload = {
        "order_id": order_id,
        "status_code": status_code,
        "gross_amount": gross_amount,
        "signature_key": signature
        if signature is not None
        else _signature(order_id, status_code, gross_amount, key),
        "transaction_status": transaction_status,
        "transaction_id": transaction_id,
    }
    if payment_type:
        payload["payment_type"] = payment_type
    if fraud_status:
        payload["fraud_status"] = fraud_status
    return client.post("/v1/payments/midtrans/webhook", json=payload)


class TestCheckout:
    def test_the_checkout_opens_a_page_at_this_server_price(
        self, client, fake_identity, snap, monkeypatch
    ):
        _with_key(monkeypatch)
        account = signup(client, "gerbang@aidss.id")
        login(client, "gerbang@aidss.id")

        resp = _checkout(client)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "pending"
        assert body["paymentGateway"] == "midtrans"
        assert body["paymentMethod"] == "midtrans"
        assert body["amount"] == 15000
        assert body["expiresAt"]
        # The handover is the page itself: the URL Midtrans minted for this
        # order, and nothing else to embed.
        assert body["redirectUrl"] == (
            f"https://app.sandbox.midtrans.com/snap/v2/vt/{body['invoiceCode']}"
        )

        [call] = snap
        assert call["gross_amount"] == 15000
        assert call["order_id"] == body["invoiceCode"]
        assert call["email"] == "gerbang@aidss.id"
        assert call["expiry_minutes"] == 1440  # the queue's 24 hours, in minutes

        row = fake_identity.transactions[body["id"]]
        assert row["status"] == "pending"
        assert row["payment_gateway"] == "midtrans"
        assert row["admin_notes"] is None
        assert str(row["user_id"]) == account
        # Opening a page is not money: no Subscription exists, none should.
        assert fake_identity.subscriptions == []
        state = client.get("/v1/subscription/current")
        assert state.json()["active"] is False

    def test_the_body_prices_nothing_and_the_order_is_not_its_claim(
        self, client, monkeypatch, snap, fake_identity
    ):
        _with_key(monkeypatch)
        signup(client, "mengarang@aidss.id")
        login(client, "mengarang@aidss.id")

        resp = _checkout(
            client, extra={"amount": 1, "gross_amount": 999999, "invoice_code": "INV-X"}
        )

        assert resp.status_code == 422, resp.text
        assert snap == []  # no page was minted for a body that priced itself
        assert fake_identity.transactions == {}

    def test_a_gateway_that_refuses_to_open_a_page_records_nothing(
        self, client, monkeypatch, fake_identity
    ):
        _with_key(monkeypatch)
        signup(client, "ditolak@aidss.id")
        login(client, "ditolak@aidss.id")

        async def _unreachable(*, order_id, gross_amount, email=None, expiry_minutes):
            raise GatewayUnavailable("the gateway could not be reached")

        monkeypatch.setattr("api.services.payments.create_snap_token", _unreachable)

        resp = _checkout(client)

        assert resp.status_code == 503, resp.text
        assert "tidak dapat dihubungi" in resp.json()["detail"]
        # A checkout the gateway refused to open never moved money: the
        # ledger keeps no placebo row that a webhook could retry against.
        assert fake_identity.transactions == {}

    def test_an_install_with_no_server_key_refuses_the_button_aloud(
        self, client, monkeypatch, fake_identity, snap
    ):
        monkeypatch.setenv("MIDTRANS_SERVER_KEY", "")
        get_settings.cache_clear()
        signup(client, "tanpakunci@aidss.id")
        login(client, "tanpakunci@aidss.id")

        resp = _checkout(client)

        assert resp.status_code == 503, resp.text
        assert "belum diaktifkan" in resp.json()["detail"]
        assert snap == []
        assert fake_identity.transactions == {}

    def test_a_plan_that_is_not_one_of_the_two_refuses_before_calling_the_gateway(
        self, client, monkeypatch, snap
    ):
        _with_key(monkeypatch)
        signup(client, "mingguan@aidss.id")
        login(client, "mingguan@aidss.id")

        resp = _checkout(client, plan="weekly")

        assert resp.status_code == 422, resp.text
        assert snap == []


class TestWebhook:
    def _open_checkout(self, client, monkeypatch, plan="monthly"):
        """The payment a callback will speak about: checkout first."""
        _with_key(monkeypatch)
        signup(client, "settlement@aidss.id")
        login(client, "settlement@aidss.id")
        resp = _checkout(client, plan=plan)
        assert resp.status_code == 200, resp.text
        return resp.json()

    def test_settlement_turns_money_received_into_access(
        self, client, monkeypatch, fake_identity, snap
    ):
        body = self._open_checkout(client, monkeypatch)

        resp = _webhook(client, body["invoiceCode"], "settlement")

        assert resp.status_code == 200, resp.text
        answer = resp.json()
        assert answer["paymentStatus"] == "settlement"
        assert answer["accessGranted"] is True

        row = fake_identity.transactions[body["id"]]
        assert row["status"] == "settlement"
        # The evidence slot: the gateway's own transaction id rides in the
        # column reserved for it, and a NULL approver reads as the truth it is.
        assert row["midtrans_transaction_id"] == "mtr-777"
        assert row["approved_by"] is None

        # Access exists exactly once, minted by the settlement alone.
        assert len(fake_identity.subscriptions) == 1

    def test_a_redelivered_settlement_finds_the_access_its_first_claim_wrote(
        self, client, monkeypatch, fake_identity, snap
    ):
        """Midtrans re-delivers what it did not see answered. The second
        callback must answer the first one's period, not mint a second."""
        body = self._open_checkout(client, monkeypatch)
        first = _webhook(client, body["invoiceCode"], "settlement")
        assert first.status_code == 200, first.text

        second = _webhook(client, body["invoiceCode"], "settlement")

        assert second.status_code == 200, second.text
        assert second.json() == first.json()
        assert len(fake_identity.subscriptions) == 1

    def test_a_settlement_total_that_prices_itself_is_refused(
        self, client, monkeypatch, fake_identity, snap
    ):
        body = self._open_checkout(client, monkeypatch)

        resp = _webhook(
            client,
            body["invoiceCode"],
            "settlement",
            gross_amount="1.00",
        )

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"paymentStatus": "refused", "action": "amount-mismatch"}
        row = fake_identity.transactions[body["id"]]
        assert row["status"] == "pending"
        assert fake_identity.subscriptions == []

    def test_a_callback_signed_by_someone_else_is_refused_before_any_lookup(
        self, client, monkeypatch, fake_identity, snap
    ):
        body = self._open_checkout(client, monkeypatch)

        resp = _webhook(
            client,
            body["invoiceCode"],
            "settlement",
            signature="f" * 128,
        )

        assert resp.status_code == 403, resp.text
        row = fake_identity.transactions[body["id"]]
        assert row["status"] == "pending"
        assert fake_identity.subscriptions == []

    def test_a_signed_callback_for_an_order_nobody_wrote_waits(
        self, client, monkeypatch
    ):
        _with_key(monkeypatch)
        signup(client, "asang@aidss.id")
        login(client, "asang@aidss.id")

        resp = _webhook(client, "INV-20260101000000-UNKNOWN", "settlement")

        assert resp.status_code == 404, resp.text
        assert resp.json()["detail"] == "Order tidak dikenal."

    def test_the_gateway_refusing_its_money_denies_the_row_in_its_words(
        self, client, monkeypatch, fake_identity, snap
    ):
        body = self._open_checkout(client, monkeypatch)

        resp = _webhook(
            client,
            body["invoiceCode"],
            "deny",
            payment_type="va_bca",
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["paymentStatus"] == "deny"
        row = fake_identity.transactions[body["id"]]
        assert row["status"] == "deny"
        # The refusal sentence names who said it and what they said.
        assert row["admin_notes"] == "Ditolak gateway Midtrans: status=deny, metode=va_bca"
        assert row["midtrans_transaction_id"] == "mtr-777"
        assert fake_identity.subscriptions == []

    def test_an_expired_page_is_queue_hygiene_and_a_late_payment_still_pays(
        self, client, monkeypatch, fake_identity, snap
    ):
        body = self._open_checkout(client, monkeypatch)

        expired = _webhook(client, body["invoiceCode"], "expire")
        assert expired.status_code == 200, expired.text
        assert expired.json()["paymentStatus"] == "expire"
        assert len(fake_identity.subscriptions) == 0

        # Expiry never became a verdict: money arriving late still settles —
        # the same rule the approve path has always obeyed, kept by the
        # gateway's settle through the same WHERE clause.
        settled = _webhook(client, body["invoiceCode"], "settlement")
        assert settled.status_code == 200, settled.text
        assert settled.json() == {
            "paymentStatus": "settlement",
            "accessGranted": True,
        }
        assert len(fake_identity.subscriptions) == 1

    def test_a_refund_callback_closes_nothing_it_did_not_open(
        self, client, monkeypatch, fake_identity, snap
    ):
        body = self._open_checkout(client, monkeypatch)
        settled = _webhook(client, body["invoiceCode"], "settlement")
        assert settled.status_code == 200, settled.text
        assert len(fake_identity.subscriptions) == 1

        refund = _webhook(
            client, body["invoiceCode"], "refund", transaction_id="mtr-888"
        )

        assert refund.status_code == 200, refund.text
        assert refund.json()["action"] == "refund-noted"
        # The period the settlement wrote is untouched: reverting money is an
        # administrator's decision, and this handler is not the holder of it.
        assert fake_identity.transactions[body["id"]]["status"] == "settlement"
        assert fake_identity.transactions[body["id"]]["midtrans_transaction_id"] == "mtr-777"
        assert len(fake_identity.subscriptions) == 1

    def test_a_capture_under_challenge_asks_the_bank_not_the_ledger(
        self, client, monkeypatch, fake_identity, snap
    ):
        body = self._open_checkout(client, monkeypatch)

        resp = _webhook(
            client,
            body["invoiceCode"],
            "capture",
            fraud_status="challenge",
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["action"] == "held-for-challenge"
        row = fake_identity.transactions[body["id"]]
        assert row["status"] == "pending"
        assert fake_identity.subscriptions == []
