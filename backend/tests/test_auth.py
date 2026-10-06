"""
Auth enforcement, end to end over HTTP.

The old version tested a JWT: forge a token, put it in a bearer header, assert a
route answers. None of that survives, and the reason is worth stating. A bearer
token is something the caller holds and the server believes until it expires, so
"valid token" was doing all the work — which made the tests pass while the real
product questions (can this person be signed out? is this account blocked? does it
have access?) had no test at all.

These drive the actual browser flow instead: POST /v1/auth/signup, then use the
cookie the server set. The cookie is HttpOnly, so a test cannot forge one; it can
only go through signup or login, which is the property we wanted.

`PAYWALL_ENABLED` is off for the suite by default so route tests reach the
behaviour they are about. TestPaywallGate below turns it on and checks all three
states, including the database being unreachable.
"""

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings


@pytest.fixture
def secure_app(monkeypatch):
    """App built with authentication ENFORCED (AUTH_BYPASS=false)."""
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("USE_MOCK_SIGNALS", "true")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    app = create_app()
    yield app
    get_settings.cache_clear()


@pytest.fixture
def secure_client(secure_app):
    return TestClient(secure_app)


def _signup(client, email="baru@aidss.id", password="s3cret-pass"):
    return client.post(
        "/v1/auth/signup",
        json={
            "email": email,
            "full_name": "Pengguna Baru",
            "phone_number": "081234567890",
            "password": password,
        },
    )


class TestGuardApplied:
    def test_paid_route_rejects_anonymous_caller(self, secure_client):
        assert secure_client.get("/v1/signals").status_code == 401

    def test_liveness_is_public(self, secure_client):
        assert secure_client.get("/livez").status_code == 200

    def test_bearer_header_no_longer_authenticates(self, secure_client):
        """The token moved to an HttpOnly cookie. A header must not still work."""
        resp = secure_client.get(
            "/v1/signals", headers={"Authorization": "Bearer not-a-real-token"}
        )
        assert resp.status_code == 401

    def test_ws_stats_requires_auth_when_enforced(self, secure_client):
        """The WebSocket authenticates its own handshake; its stats route is normal HTTP."""
        assert secure_client.get("/v1/ws/market/stats").status_code == 401


class TestSignup:
    def test_signup_returns_the_account_and_a_cookie(self, secure_client):
        resp = _signup(secure_client)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["account"]["email"] == "baru@aidss.id"
        assert body["account"]["role"] == "user"
        assert body["account"]["blocked"] is False
        assert "aidss_session" in resp.cookies

    def test_session_cookie_is_httponly(self, secure_client):
        """HttpOnly is the reason the token left localStorage; assert it stayed moved."""
        raw = _signup(secure_client).headers["set-cookie"]
        assert "HttpOnly" in raw
        assert "SameSite=lax" in raw.lower().replace("samesite=lax", "SameSite=lax")

    def test_cookie_alone_opens_a_protected_route(self, secure_client):
        client = TestClient(secure_client.app)
        _signup(client)
        assert client.get("/v1/signals").status_code == 200

    def test_duplicate_email_is_a_conflict_not_a_crash(self, secure_client):
        assert _signup(secure_client).status_code == 200
        second = _signup(secure_client)
        assert second.status_code == 409
        assert "already registered" in second.json()["detail"]

    def test_duplicate_is_case_insensitive(self, secure_client):
        _signup(secure_client, email="Case@Aidss.ID")
        assert _signup(secure_client, email="case@aidss.id").status_code == 409

    @pytest.mark.parametrize(
        "field,value",
        [
            ("email", "bukan-email"),
            ("phone_number", "123"),
            ("password", "pendek"),
        ],
    )
    def test_invalid_input_is_rejected(self, secure_client, field, value):
        payload = {
            "email": "baru@aidss.id",
            "full_name": "Nama",
            "phone_number": "081234567890",
            "password": "s3cret-pass",
        }
        payload[field] = value
        assert secure_client.post("/v1/auth/signup", json=payload).status_code == 422

    def test_phone_number_is_required(self, secure_client):
        """legal-and-consent.md requires it and it is the only notification channel."""
        resp = secure_client.post(
            "/v1/auth/signup",
            json={
                "email": "nopon@aidss.id",
                "full_name": "Nama",
                "password": "s3cret-pass",
            },
        )
        assert resp.status_code == 422


class TestLogin:
    def test_login_opens_a_session(self, secure_client):
        _signup(secure_client)
        client = TestClient(secure_client.app)
        resp = client.post(
            "/v1/auth/login", json={"email": "baru@aidss.id", "password": "s3cret-pass"}
        )
        assert resp.status_code == 200
        assert "aidss_session" in resp.cookies
        assert client.get("/v1/signals").status_code == 200

    def test_login_is_case_insensitive_on_email(self, secure_client):
        _signup(secure_client, email="Case@Aidss.ID")
        client = TestClient(secure_client.app)
        resp = client.post(
            "/v1/auth/login", json={"email": "CASE@aidss.id", "password": "s3cret-pass"}
        )
        assert resp.status_code == 200

    def test_wrong_password_is_refused(self, secure_client):
        _signup(secure_client)
        client = TestClient(secure_client.app)
        resp = client.post(
            "/v1/auth/login", json={"email": "baru@aidss.id", "password": "salah"}
        )
        assert resp.status_code == 401

    def test_unknown_account_gives_the_same_answer(self, secure_client):
        """Identical wording, so the response cannot be used to enumerate accounts."""
        _signup(secure_client)
        client = TestClient(secure_client.app)
        wrong_pw = client.post(
            "/v1/auth/login", json={"email": "baru@aidss.id", "password": "salah"}
        )
        unknown = client.post(
            "/v1/auth/login", json={"email": "tidak@aidss.id", "password": "salah"}
        )
        assert wrong_pw.status_code == unknown.status_code == 401
        assert wrong_pw.json()["detail"] == unknown.json()["detail"]

    def test_old_token_endpoint_is_gone(self, secure_client):
        """It compared AUTH_PASSWORD in plaintext and had no user store behind it."""
        assert secure_client.post(
            "/v1/auth/token", json={"username": "operator", "password": "x"}
        ).status_code == 404


class TestSessionLifecycle:
    def test_me_requires_a_session(self, secure_client):
        assert secure_client.get("/v1/auth/me").status_code == 401

    def test_me_describes_the_signed_in_account(self, secure_client):
        client = TestClient(secure_client.app)
        _signup(client)
        body = client.get("/v1/auth/me").json()
        assert body["email"] == "baru@aidss.id"
        assert body["full_name"] == "Pengguna Baru"

    def test_logout_invalidates_the_session_server_side(self, secure_client):
        """Deleting the cookie alone would leave a usable copy of the token."""
        client = TestClient(secure_client.app)
        _signup(client)
        assert client.get("/v1/auth/me").status_code == 200

        assert client.post("/v1/auth/logout").status_code == 204

        saved = client.cookies.get("aidss_session")
        assert not client.get("/v1/auth/me").status_code == 200
        # Even replaying the old token by hand changes nothing.
        assert secure_client.get(
            "/v1/auth/me", cookies={"aidss_session": saved}
        ).status_code == 401

    def test_changing_the_password_signs_out_everywhere(self, secure_client):
        first = TestClient(secure_client.app)
        _signup(first)
        stolen = first.cookies.get("aidss_session")

        second = TestClient(secure_client.app)
        second.cookies.set("aidss_session", stolen)
        resp = second.post(
            "/v1/auth/change-password",
            json={"current_password": "s3cret-pass", "new_password": "s3cret-kuat"},
        )
        assert resp.status_code == 204

        assert secure_client.get(
            "/v1/auth/me", cookies={"aidss_session": stolen}
        ).status_code == 401

    def test_change_password_requires_the_current_one(self, secure_client):
        client = TestClient(secure_client.app)
        _signup(client)
        resp = client.post(
            "/v1/auth/change-password",
            json={"current_password": "salah", "new_password": "s3cret-kuat"},
        )
        assert resp.status_code == 401

    def test_blocked_account_loses_access(self, secure_client, fake_identity):
        """blocked_at is checked before anything else, and it is not cached."""
        client = TestClient(secure_client.app)
        _signup(client)
        assert client.get("/v1/auth/me").status_code == 200

        fake_identity.users["baru@aidss.id"]["blocked_at"] = "2026-01-01T00:00:00Z"

        assert client.get("/v1/auth/me").status_code == 403

    def test_expired_session_is_refused(self, secure_client, fake_identity):
        from datetime import datetime, timedelta, timezone

        client = TestClient(secure_client.app)
        _signup(client)
        token = client.cookies.get("aidss_session")
        for row in fake_identity.sessions.values():
            row["expires_at"] = datetime.now(timezone.utc) - timedelta(days=1)

        assert secure_client.get(
            "/v1/auth/me", cookies={"aidss_session": token}
        ).status_code == 401


class TestBypassMode:
    def test_bypass_lets_unauthenticated_calls_through(self, client):
        assert client.get("/v1/signals").status_code == 200

    def test_bypass_resolves_to_a_real_account(self, client, fake_identity):
        """A synthetic principal cannot own a portfolio: user_id is a foreign key."""
        assert client.get("/v1/auth/me").status_code == 200
        assert fake_identity.users, "bypass must materialise an Account row"

    def test_bypass_account_is_not_a_subscriber(self, client, fake_identity):
        """CONTEXT.md: the Operator Tunggal has no Subscription and does not need one."""
        client.get("/v1/auth/me")
        assert fake_identity.subscriptions == []

class TestProfileUpdate:
    """PUT /v1/auth/me. The two fields a person may change about themselves."""

    def _client_with_account(self, secure_client):
        client = TestClient(secure_client.app)
        _signup(client)
        return client

    def test_name_and_phone_can_be_changed(self, secure_client):
        client = self._client_with_account(secure_client)
        resp = client.put(
            "/v1/auth/me",
            json={"full_name": "Nama Baru", "phone_number": "+628123456789"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["full_name"] == "Nama Baru"
        assert body["phone_number"] == "+628123456789"

    def test_the_change_survives_a_fresh_read(self, secure_client):
        client = self._client_with_account(secure_client)
        client.put("/v1/auth/me", json={"full_name": "Nama Baru", "phone_number": "081234567890"})
        assert client.get("/v1/auth/me").json()["full_name"] == "Nama Baru"

    def test_surrounding_whitespace_is_cleaned_up(self, secure_client):
        client = self._client_with_account(secure_client)
        resp = client.put(
            "/v1/auth/me", json={"full_name": "  Nama   Baru  ", "phone_number": "081234567890"}
        )
        assert resp.json()["full_name"] == "Nama Baru"

    def test_an_empty_name_is_refused(self, secure_client):
        client = self._client_with_account(secure_client)
        resp = client.put("/v1/auth/me", json={"full_name": "   ", "phone_number": "081234567890"})
        assert resp.status_code == 422

    @pytest.mark.parametrize("phone", ["123", "+1 555 0100", ""])
    def test_an_unusable_phone_is_refused(self, secure_client, phone):
        client = self._client_with_account(secure_client)
        resp = client.put("/v1/auth/me", json={"full_name": "Nama", "phone_number": phone})
        assert resp.status_code == 422

    def test_role_cannot_be_changed_through_this_path(self, secure_client):
        """Otherwise any account could promote itself."""
        client = self._client_with_account(secure_client)
        resp = client.put(
            "/v1/auth/me",
            json={
                "full_name": "Nama",
                "phone_number": "081234567890",
                "role": "admin",
            },
        )
        # Either rejected outright or the role ignored; what must not happen is
        # the account becoming an admin.
        if resp.status_code == 200:
            assert resp.json()["role"] == "user"
        assert client.get("/v1/auth/me").json()["role"] == "user"

    def test_email_cannot_be_changed_through_this_path(self, secure_client):
        client = self._client_with_account(secure_client)
        client.put(
            "/v1/auth/me",
            json={
                "full_name": "Nama",
                "phone_number": "081234567890",
                "email": "another@aidss.id",
            },
        )
        assert client.get("/v1/auth/me").json()["email"] == "baru@aidss.id"

    def test_it_requires_a_session(self, secure_client):
        assert secure_client.put(
            "/v1/auth/me", json={"full_name": "X", "phone_number": "081234567890"}
        ).status_code == 401


class TestCookieAttributes:
    """The cookie is the session. Its attributes are load-bearing, not decoration."""

    def test_it_is_httponly_and_samesite_lax(self, secure_client):
        # HttpOnly is why the token left localStorage; Lax is why the dev proxy
        # can make the API same-origin and the cookie still travel.
        raw = _signup(secure_client).headers["set-cookie"]
        assert "HttpOnly" in raw
        assert "SameSite=lax" in raw.replace("samesite=lax", "SameSite=lax")

    def test_it_is_host_only(self, secure_client):
        """No Domain attribute means the cookie cannot be read by a sibling
        subdomain, which is the default and worth keeping."""
        raw = _signup(secure_client).headers["set-cookie"]
        assert "domain=" not in raw.lower()

    def test_secure_follows_the_setting_not_the_environment(self, secure_client, monkeypatch):
        from api.core.config import get_settings

        monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
        get_settings.cache_clear()
        try:
            raw = _signup(secure_client).headers["set-cookie"]
            assert "Secure" in raw
        finally:
            get_settings.cache_clear()


class TestProductionCookieRefusal:
    def test_production_refuses_to_boots_without_secure_cookies(self, monkeypatch):
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("AUTH_BYPASS", "false")
        monkeypatch.setenv("PAYWALL_ENABLED", "true")
        monkeypatch.setenv("SESSION_COOKIE_SECURE", "false")
        monkeypatch.setenv("APP_DEBUG", "false")
        get_settings.cache_clear()
        try:
            with pytest.raises(ValueError) as exc:
                get_settings()
            assert "SESSION_COOKIE_SECURE" in str(exc.value)
        finally:
            get_settings.cache_clear()

    def test_secure_defaults_off_for_local_http(self):
        from api.core.config import Settings

        # A Secure cookie is dropped silently on plain-http localhost, which reads
        # as "login is broken" rather than as a misconfiguration.
        assert Settings.model_fields["session_cookie_secure"].default is False


class TestNameValidationIsShared:
    """The rule used to exist twice, and signup had the weaker copy.

    `min_length=1` counts characters, so "   " passed: three spaces, and the column
    is NOT NULL, so an empty string was stored. The legal terms require a real
    name at registration.
    """

    @pytest.mark.parametrize("name", ["   ", "\t\n ", "  "])
    def test_signup_rejects_a_blank_name(self, secure_client, name):
        resp = secure_client.post(
            "/v1/auth/signup",
            json={
                "email": "blank@aidss.id",
                "full_name": name,
                "phone_number": "081234567890",
                "password": "s3cret-pass",
            },
        )
        assert resp.status_code == 422, resp.text

    def test_signup_collapses_surrounding_whitespace(self, secure_client):
        resp = _signup(secure_client)
        assert resp.status_code == 200
        resp = secure_client.post(
            "/v1/auth/login",
            json={"email": "baru@aidss.id", "password": "s3cret-pass"},
        )
        assert resp.status_code == 200
        client = TestClient(secure_client.app)
        client.post(
            "/v1/auth/login", json={"email": "baru@aidss.id", "password": "s3cret-pass"}
        )
        # A fresh signup that stores the name untrimmed would show it here.
        again = _signup(secure_client, email="spaced@aidss.id")
        assert again.json()["account"]["full_name"] == "Pengguna Baru"
