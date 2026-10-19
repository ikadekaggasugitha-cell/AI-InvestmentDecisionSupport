"""
The two ends of the price: anyone may read it, only an administrator may set it.

Both statements are load-bearing.

The read is public because a price nobody can read before signing up is not a
price. Gating it behind the entitlement gate would be circular in the same way
`GET /v1/subscription/current` is: the account refused the data is exactly the one
that needs to be told what the data costs.

The write is `require_admin`, not `require_entitlement`. These are different
questions — "may this person run the product" versus "may this person use the paid
analysis" — and CONTEXT.md rule 6 forbids one standing in for the other. An
administrator without a subscription can still set the price.

Which means the write answers **403**, not 402. A non-admin being refused here has
not run into a billing problem, and a client that reads 402 as "needs a
subscription" would tell them to go and subscribe.
"""

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings


@pytest.fixture
def pricing_client(monkeypatch, mock_redis):
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "true")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _signup_as_admin(client, fake_identity, email="admin-harga@aidss.id"):
    resp = client.post(
        "/v1/auth/signup",
        json={
            "email": email,
            "full_name": "Administrator",
            "phone_number": "081234567891",
            "password": "s3cret-pass",
        },
    )
    assert resp.status_code == 200, resp.text
    for row in fake_identity.users.values():
        if row["email"] == email:
            row["role"] = "admin"
            return row
    raise AssertionError("account was not created")


def _signup_plain(client, fake_identity, email="biasa@aidss.id"):
    resp = client.post(
        "/v1/auth/signup",
        json={
            "email": email,
            "full_name": "Pengguna Biasa",
            "phone_number": "081234567892",
            "password": "s3cret-pass",
        },
    )
    assert resp.status_code == 200, resp.text
    for row in fake_identity.users.values():
        if row["email"] == email:
            return row
    raise AssertionError("account was not created")


class TestThePublicRead:
    def test_a_signed_out_visitor_can_ask_what_it_costs(self, pricing_client):
        """Otherwise there is no price until after you have paid, which is not a
        price."""
        resp = pricing_client.get("/v1/subscriptions/pricing")
        assert resp.status_code == 200, resp.text

    def test_it_reports_the_three_prices_in_rupiah(self, pricing_client):
        body = pricing_client.get("/v1/subscriptions/pricing").json()
        assert body["weekly"] == 15000
        assert body["monthly"] == 44000
        assert body["annual"] == 252000

    def test_it_says_when_the_price_last_changed(self, pricing_client):
        """So "why is it this now?" is answerable without a database session."""
        body = pricing_client.get("/v1/subscriptions/pricing").json()
        assert "updatedAt" in body
        assert body["updatedAt"] is not None

    def test_a_missing_row_is_a_503_not_a_price_of_zero(
        self, pricing_client, fake_identity
    ):
        """Zero is a number nobody decided on, and publishing it would quote a real
        customer for free."""
        fake_identity.settings.clear()
        resp = pricing_client.get("/v1/subscriptions/pricing")
        assert resp.status_code == 503

    def test_it_never_reveals_anything_but_the_price(self, pricing_client):
        body = pricing_client.get("/v1/subscriptions/pricing").json()
        assert set(body) == {"weekly", "monthly", "annual", "updatedAt"}


class TestTheAdminWrite:
    def test_an_admin_can_set_the_price(self, pricing_client, fake_identity):
        _signup_as_admin(pricing_client, fake_identity)
        resp = pricing_client.put(
            "/v1/admin/settings/pricing",
            json={"weekly": 5000, "monthly": 20000, "annual": 200000},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["weekly"] == 5000
        assert resp.json()["monthly"] == 20000

    def test_the_public_read_reflects_it_immediately(
        self, pricing_client, fake_identity
    ):
        """One source. If these disagreed, the app would quote one price and sell
        another."""
        _signup_as_admin(pricing_client, fake_identity)
        pricing_client.put(
            "/v1/admin/settings/pricing",
            json={"weekly": 5000, "monthly": 20000, "annual": 200000},
        )
        body = pricing_client.get("/v1/subscriptions/pricing").json()
        assert body["weekly"] == 5000
        assert body["monthly"] == 20000
        assert body["annual"] == 200000

    def test_a_normal_account_cannot_set_it(self, pricing_client, fake_identity):
        _signup_plain(pricing_client, fake_identity)
        resp = pricing_client.put(
            "/v1/admin/settings/pricing",
            json={"weekly": 1, "monthly": 1, "annual": 1},
        )
        assert resp.status_code == 403
        assert pricing_client.get("/v1/subscriptions/pricing").json()["monthly"] == 44000

    def test_an_anonymous_caller_cannot_set_it(self, pricing_client):
        resp = pricing_client.put(
            "/v1/admin/settings/pricing",
            json={"weekly": 1, "monthly": 1, "annual": 1},
        )
        assert resp.status_code == 401

    def test_a_non_admin_gets_403_not_402(self, pricing_client, fake_identity):
        """402 means "pay first". This refusal is about the role, and a client that
        reads it as a billing problem would send the person off to subscribe."""
        _signup_plain(pricing_client, fake_identity)
        assert pricing_client.put(
            "/v1/admin/settings/pricing",
            json={"weekly": 5000, "monthly": 15000, "annual": 150000},
        ).status_code == 403

    def test_an_admin_without_a_subscription_can_still_set_it(
        self, pricing_client, fake_identity
    ):
        """Role answers "may this person run the product"; entitlement answers "may
        this person use the paid analysis". Collapsing them would make an
        administrator a paying subscriber by accident (CONTEXT.md rule 6)."""
        _signup_as_admin(pricing_client, fake_identity)
        assert pricing_client.put(
            "/v1/admin/settings/pricing",
            json={"weekly": 9000, "monthly": 17000, "annual": 170000},
        ).status_code == 200

    @pytest.mark.parametrize("body", [
        {"weekly": 5000, "monthly": 0, "annual": 150000},
        {"weekly": 5000, "monthly": -5000, "annual": 150000},
        {"weekly": 5000, "monthly": 15000, "annual": 0},
        {"weekly": 5000, "monthly": 10**12, "annual": 150000},
        {"weekly": 0, "monthly": 15000, "annual": 150000},
        {"weekly": 10**12, "monthly": 15000, "annual": 150000},
    ])
    def test_a_price_that_is_not_a_price_is_refused(
        self, pricing_client, fake_identity, body
    ):
        _signup_as_admin(pricing_client, fake_identity)
        resp = pricing_client.put("/v1/admin/settings/pricing", json=body)
        assert resp.status_code == 422
        assert pricing_client.get("/v1/subscriptions/pricing").json()["monthly"] == 44000

    def test_a_refused_write_leaves_the_three_prices_untouched(
        self, pricing_client, fake_identity
    ):
        _signup_as_admin(pricing_client, fake_identity)
        pricing_client.put(
            "/v1/admin/settings/pricing",
            json={"weekly": 0, "monthly": 15000, "annual": 150000},
        )
        body = pricing_client.get("/v1/subscriptions/pricing").json()
        assert body["weekly"] == 15000
        assert body["monthly"] == 44000
        assert body["annual"] == 252000

    def test_a_partial_body_does_not_half_apply(self, pricing_client, fake_identity):
        """Sending only `monthly` and having it land would leave a monthly price
        from this moment beside an annual price from the last one — a combination
        that never existed and nobody chose."""
        _signup_as_admin(pricing_client, fake_identity)
        resp = pricing_client.put(
            "/v1/admin/settings/pricing", json={"monthly": 20000}
        )
        assert resp.status_code == 422
        assert pricing_client.get("/v1/subscriptions/pricing").json()["monthly"] == 44000

class TestTheFormCanReachItsOwnData:
    """The admin form loads from `GET /v1/admin/settings/pricing`.

    It shipped reading a path where only PUT was registered. Every frontend test
    mocked `apiFetch`, so the form rendered correctly against a response the
    server never sent, and nobody noticed it had never once been able to load.
    This asserts the route exists and answers, which is the thing that was missing.
    """

    def test_the_admin_route_answers_a_get(self, pricing_client, fake_identity):
        _signup_as_admin(pricing_client, fake_identity)
        resp = pricing_client.get("/v1/admin/settings/pricing")
        assert resp.status_code == 200, resp.text
        assert resp.json()["monthly"] == 44000

    def test_both_methods_exist_on_one_path(self, monkeypatch):
        """Guards the mismatch directly: a form that GETs what only PUTs answers
        405 and renders nothing, with no failing test anywhere."""
        monkeypatch.setenv("AUTH_BYPASS", "false")
        from api.core.config import get_settings

        get_settings.cache_clear()
        try:
            from api.main import create_app

            ops = create_app().openapi()["paths"]["/v1/admin/settings/pricing"]
            assert "get" in ops, "the admin form has nothing to load from"
            assert "put" in ops, "the admin form has nothing to save to"
        finally:
            get_settings.cache_clear()

    def test_a_non_admin_is_refused_the_read_with_403(self, pricing_client, fake_identity):
        _signup_plain(pricing_client, fake_identity)
        assert pricing_client.get("/v1/admin/settings/pricing").status_code == 403


class TestTheWriteCanActuallyCross:
    """A preflight that fails is invisible until somebody uses a browser.

    `PUT` was missing from the CORS allow-list, and two existing PUT endpoints
    had been blocked the same way without it being noticed — no test drives a
    preflight, so the list is asserted directly here.
    """

    def test_put_is_allowed_cross_origin(self, monkeypatch):
        monkeypatch.setenv("AUTH_BYPASS", "false")
        monkeypatch.setenv("PAYWALL_ENABLED", "false")
        from api.core.config import get_settings

        get_settings.cache_clear()
        try:
            from fastapi.middleware.cors import CORSMiddleware

            from api.main import create_app

            app = create_app()
            cors = [m for m in app.user_middleware if m.cls is CORSMiddleware]
            assert cors, "no CORS middleware configured"
            assert "PUT" in cors[0].kwargs.get("allow_methods", []), (
                "PUT is not allowed cross-origin, so saving a price fails the "
                "preflight in any frontend served from a different origin"
            )
        finally:
            get_settings.cache_clear()
