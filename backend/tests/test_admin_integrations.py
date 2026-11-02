"""
The integrations panel: what it may say, and what it must never say.

The endpoint exists so an operator can answer one question they cannot see from
outside the process — is the gateway wired, and toward which site. Everything else
about credentials is out of scope by decision: keys stay in the deployment's
environment, because a secret written to `system_settings` would be plaintext
jsonb, would ride along in every backup, and would still need a restart to take
effect (`get_settings()` is cached at import). A form that appeared to change them
would be a lie about what it did.

So the assertions that matter are the negative ones: no fragment of the key, and
nothing about an integration the code does not have.
"""

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from tests.test_admin_api import login, make_admin, signup

FAKE_KEY = "dGVzdC1zZXJ2ZXIta2V5LTEyMzQ1Njc4OTByb3RhdGUt"
_ENDPOINT = "/v1/admin/settings/integrations"


def _app(monkeypatch, server_key: str, is_production: bool = False) -> TestClient:
    """A client built with the gateway in a chosen state.

    The key is set per test rather than globally because the honest answer to
    "is this install wired for payments" has two sides, and a fixture that only
    ever produced one of them would leave the other untested.
    """
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    monkeypatch.setenv("MIDTRANS_SERVER_KEY", server_key)
    monkeypatch.setenv("MIDTRANS_IS_PRODUCTION", "true" if is_production else "false")
    get_settings.cache_clear()
    from api.main import create_app

    return TestClient(create_app())


@pytest.fixture
def client(monkeypatch, mock_redis):
    yield _app(monkeypatch, FAKE_KEY)


class TestAccess:
    def test_anonymous_is_refused(self, client):
        assert client.get(_ENDPOINT).status_code == 401

    def test_a_subscriber_is_refused_because_money_does_not_open_this(self, client, fake_identity):
        """403, not 402: this is running the product, and paying for analysis has
        nothing to do with it (CONTEXT.md rule 6)."""
        signup(client, "bayar@aidss.id")
        login(client, "bayar@aidss.id")
        assert client.get(_ENDPOINT).status_code == 403

    def test_an_administrator_reads_it(self, client, fake_identity):
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        assert client.get(_ENDPOINT).status_code == 200


class TestWhatItReports:
    def test_configured_and_which_site(self, client, fake_identity):
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        assert client.get(_ENDPOINT).json() == {
            "midtransConfigured": True,
            "midtransEnvironment": "sandbox",
        }

    def test_an_install_with_no_credentials_says_so_rather_than_looking_ready(
        self, monkeypatch, mock_redis, fake_identity
    ):
        """The point of the panel: an install that cannot take money must read as
        one that cannot take money, not as a payment page waiting for a customer."""
        bare = _app(monkeypatch, "")
        make_admin(bare, fake_identity)
        login(bare, "admin@aidss.id")

        assert bare.get(_ENDPOINT).json() == {
            "midtransConfigured": False,
            "midtransEnvironment": "sandbox",
        }

    def test_the_production_flag_moves_the_answer(self, monkeypatch, mock_redis, fake_identity):
        """Sandbox and production look identical once a page works. The panel has
        to say which site this install would actually send money toward."""
        live = _app(monkeypatch, FAKE_KEY, is_production=True)
        make_admin(live, fake_identity)
        login(live, "admin@aidss.id")

        assert live.get(_ENDPOINT).json()["midtransEnvironment"] == "production"

    def test_the_panel_and_the_checkout_agree_on_what_configured_means(
        self, monkeypatch, fake_identity
    ):
        """One predicate, two readers.

        If the panel guessed at "configured" it could advertise a working payment
        button while `create_snap_token` was about to refuse the same request.
        """
        import api.services.midtrans_service as midtrans

        wired = _app(monkeypatch, FAKE_KEY)
        make_admin(wired, fake_identity)
        login(wired, "admin@aidss.id")

        assert midtrans.gateway_configured() is True
        assert wired.get(_ENDPOINT).json()["midtransConfigured"] is True

        monkeypatch.setenv("MIDTRANS_SERVER_KEY", "")
        get_settings.cache_clear()
        assert midtrans.gateway_configured() is False

    def test_no_response_body_carries_key_material(self, client, fake_identity):
        """Not the value, not a prefix, not a length.

        A length alone would let a caller confirm a guess about the key, so the
        response is deliberately two fields and neither can hold a string.
        """
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        resp = client.get(_ENDPOINT)
        assert FAKE_KEY not in resp.text
        assert FAKE_KEY[:8] not in resp.text
        assert all(len(str(v)) < 24 for v in resp.json().values())


class TestItOnlyNamesWhatExists:
    def test_smtp_and_whatsapp_are_not_listed_as_off(self, client, fake_identity):
        """`Settings` has no field for either and no transport exists. A row
        saying "not configured" would imply the app has a place to put them,
        which is a claim about the code that the code does not support."""
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        body = client.get(_ENDPOINT).json()
        assert set(body) == {"midtransConfigured", "midtransEnvironment"}
        text = str(body).lower()
        assert "smtp" not in text
        assert "whatsapp" not in text

    def test_it_offers_no_way_to_write_a_key(self, client, fake_identity):
        """Read-only is the decision, not an unfinished edit."""
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        assert client.put(_ENDPOINT, json={"midtransServerKey": "x"}).status_code == 405
