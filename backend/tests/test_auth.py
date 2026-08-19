"""
Auth enforcement tests.

The security gap these lock down: get_current_user existed but was wired to no
route, so the API answered every caller regardless of AUTH_BYPASS. These build
the app with bypass OFF and assert the guard is actually applied, plus that the
login endpoint issues a usable token.
"""

import pytest
from fastapi.testclient import TestClient

from api.core.auth import create_access_token
from api.core.config import get_settings


@pytest.fixture
def secure_app(monkeypatch):
    """App built with authentication ENFORCED (AUTH_BYPASS=false)."""
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("JWT_SECRET_KEY", "unit-test-secret-not-the-default")
    monkeypatch.setenv("AUTH_USERNAME", "operator")
    monkeypatch.setenv("AUTH_PASSWORD", "s3cret-pass")
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


class TestGuardApplied:
    def test_protected_route_rejects_missing_token(self, secure_client, mock_redis):
        assert secure_client.get("/v1/signals").status_code == 401

    def test_protected_route_rejects_bad_token(self, secure_client, mock_redis):
        resp = secure_client.get(
            "/v1/signals", headers={"Authorization": "Bearer not-a-real-token"}
        )
        assert resp.status_code == 401

    def test_protected_route_accepts_valid_token(self, secure_client, mock_redis):
        token = create_access_token("operator")
        resp = secure_client.get(
            "/v1/signals", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 200

    def test_liveness_is_public(self, secure_client):
        assert secure_client.get("/livez").status_code == 200


class TestLogin:
    def test_valid_credentials_return_token(self, secure_client):
        resp = secure_client.post(
            "/v1/auth/token", json={"username": "operator", "password": "s3cret-pass"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["token_type"] == "bearer"
        assert body["access_token"]

    def test_issued_token_opens_protected_route(self, secure_client, mock_redis):
        token = secure_client.post(
            "/v1/auth/token", json={"username": "operator", "password": "s3cret-pass"}
        ).json()["access_token"]
        resp = secure_client.get(
            "/v1/signals", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 200

    def test_wrong_password_rejected(self, secure_client):
        resp = secure_client.post(
            "/v1/auth/token", json={"username": "operator", "password": "wrong"}
        )
        assert resp.status_code == 401

    def test_wrong_username_rejected(self, secure_client):
        resp = secure_client.post(
            "/v1/auth/token", json={"username": "intruder", "password": "s3cret-pass"}
        )
        assert resp.status_code == 401


class TestBypassMode:
    def test_bypass_lets_unauthenticated_calls_through(self, client, mock_redis):
        # The shared `client` fixture builds the app with AUTH_BYPASS=true.
        assert client.get("/v1/signals").status_code == 200
