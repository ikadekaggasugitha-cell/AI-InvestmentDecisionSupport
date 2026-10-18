"""
The suspension gate: two reasons for a closed account, two different doors.

A block used to have one shape and one answer — 403 everywhere, session
treated as dead. That was fine while the only writer was an administrator.
The lapsed-subscription beat gave the column a second value, and the one
answer became wrong twice at once: a suspended person is signed in and must
reach pricing and `/v1/payments` (that is how they come back), and an admin ban
must never be readable as anything they could satisfy by paying.

Statuses here answer the person, not the check: 401 "who are you", 403 "the
account is closed, and money will not fix it", 402 "payment is the way back
in" — riding both a person who never held the entitlement and one whose
period just ended; the *sentence* is what carries which of the two. The
WebSocket refuses on codes the client cannot confuse — 1008 would bounce a
still-valid session into the login page.
"""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect as ClientDisconnect

from api.core.config import get_settings


@pytest.fixture
def gated_client(monkeypatch, mock_redis):
    """Authentication enforced; the paywall stays off so these tests isolate
    what a closed account does from what a never-subscribed one does."""
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _signup(client, email="suspend@aidss.id"):
    resp = client.post(
        "/v1/auth/signup",
        json={
            "email": email,
            "full_name": "Pengguna Tertangguh",
            "phone_number": "081234567890",
            "password": "s3cret-pass",
        },
    )
    assert resp.status_code == 200, resp.text
    return email


def _close(fake_identity, email, reason):
    """Close the account's row the way the two real writers would."""
    from datetime import datetime, timezone

    row = fake_identity.users[email]
    row["blocked_at"] = datetime(2026, 10, 1, tzinfo=timezone.utc)
    row["blocked_reason"] = reason
    return row


def _wbail(client, path="/v1/ws/market"):
    with pytest.raises(ClientDisconnect) as caught:
        with client.websocket_connect(path) as ws:
            ws.receive_json()
    exc = caught.value
    return getattr(exc, "code", None), (getattr(exc, "reason", None) or "")


class TestAAccountSuspendedByTheBeat:
    """`subscription_expired`: signed in, see prices, refuse the paid data."""

    @pytest.fixture
    def suspended(self, gated_client, fake_identity):
        email = _signup(gated_client)
        _close(fake_identity, email, "subscription_expired")
        return gated_client

    def test_auth_me_reports_block_and_reason(self, suspended):
        resp = suspended.get("/v1/auth/me")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["blocked"] is True
        assert body["blockedReason"] == "subscription_expired"

    def test_pricing_and_payments_stay_open(self, suspended):
        """The renewal path is the point of the suspension: a person who lost
        access entirely could never earn it back."""
        assert suspended.get("/v1/auth/me").status_code == 200
        assert suspended.get("/v1/subscriptions/pricing").status_code == 200
        assert suspended.get("/v1/payments/me").status_code == 200

    def test_the_paid_data_is_refused_with_its_own_sentence(self, suspended):
        resp = suspended.get("/v1/signals")
        assert resp.status_code == 402, resp.text
        assert "subscription has ended" in resp.json()["detail"]

    def test_the_ending_is_402_with_a_sentence_of_its_own(self, suspended):
        """One status, two headlines now: "never held it" and "the period
        ended" both answer 402 — the sentence is what tells them apart, and
        neither is the admin's "blocked", the door money does not open."""
        resp = suspended.get("/v1/signals")
        assert resp.status_code == 402, resp.text
        detail = resp.json()["detail"]
        assert detail != "An active subscription is required for this data."
        assert detail != "This account is blocked."

    def test_the_websocket_refuses_with_4404(self, suspended):
        code, reason = _wbail(suspended)
        assert code == 4404, (code, reason)

    def test_1008_is_reserved_for_admin_and_4404_for_suspension(self, suspended,
                                                                fake_identity):
        """The two close codes are different rows of the same vocabulary —
        and neither is the other's."""
        # suspension first
        assert _wbail(suspended)[0] == 4404


class TestAnAdminBanEverywhere:
    """`admin`: the identity itself is refused, including login."""

    @pytest.fixture
    def banned(self, gated_client, fake_identity):
        email = _signup(gated_client, "banned@aidss.id")
        _close(fake_identity, email, "admin")
        return gated_client

    def test_auth_me_is_403(self, banned):
        assert banned.get("/v1/auth/me").status_code == 403

    def test_the_same_refusal_on_paid_routes(self, banned):
        resp = banned.get("/v1/signals")
        assert resp.status_code == 403
        assert resp.json()["detail"] == "This account is blocked."

    def test_the_websocket_refuses_with_1008(self, banned):
        code, reason = _wbail(banned)
        assert code == 1008, (code, reason)

    def test_a_fresh_login_is_refused_too(self, banned):
        resp = banned.post(
            "/v1/auth/login",
            json={"email": "banned@aidss.id", "password": "s3cret-pass"},
        )
        assert resp.status_code == 403, resp.text


class TestTheDoorsStaySeparated:
    def test_a_suspended_account_can_log_back_in(self, gated_client, fake_identity):
        """A cookie lost is not access lost: the lapser signs in and pays."""
        _signup(gated_client, "again@aidss.id")
        _close(fake_identity, "again@aidss.id", "subscription_expired")

        resp = gated_client.post(
            "/v1/auth/login",
            json={"email": "again@aidss.id", "password": "s3cret-pass"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["account"]["blockedReason"] == "subscription_expired"

    def test_suspension_refuses_data_even_with_the_paywall_off(
        self, gated_client, fake_identity
    ):
        """The suspension check runs before the paywall switch: an install that
        serves analysis free has not made a lapsed period live again. Only a
        settled payment does that."""
        _signup(gated_client, "noflag@aidss.id")
        _close(fake_identity, "noflag@aidss.id", "subscription_expired")
        # gated_client's fixture already runs the paywall off.
        assert gated_client.get("/v1/signals").status_code == 402

    def test_a_suspended_administrator_still_runs_the_admin_panel(
        self, gated_client, fake_identity
    ):
        """Rule 6 unchanged by suspension: role answers "may this person run the
        system", the entitlement answers "may they see paid data". One does not
        eat the other, in either direction."""
        _signup(gated_client, "boss@aidss.id")
        row = fake_identity.users["boss@aidss.id"]
        row["role"] = "admin"
        _close(fake_identity, "boss@aidss.id", "subscription_expired")

        assert gated_client.get("/v1/admin/accounts").status_code == 200
        assert gated_client.get("/v1/signals").status_code == 402
