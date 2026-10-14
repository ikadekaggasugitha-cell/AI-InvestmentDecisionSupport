"""
The paywall gate.

PAYWALL_ENABLED is off for the rest of the suite so route tests reach the
behaviour they are about. This module turns it on and drives the three states
that matter, which is the whole reason the flag exists separately from
AUTH_BYPASS: a misconfigured bypass must not be able to take the gate down with
it, and the only way to know that is to test the gate directly.

The third state is the one that would have shipped broken. `redis_client` is
written to degrade open — correct for a market cache, and inherited automatically
by anything built on top of it. A gate that treated "cache unavailable" as "no
restriction" would open the paid data to anyone who could trigger a connection
error, so an unreachable database has to mean *denied*.
"""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect as ClientDisconnect

from api.core.config import get_settings


@pytest.fixture
def gated_client(monkeypatch, mock_redis):
    """App with authentication AND the paywall both enforced."""
    # mock_redis is what keeps `signals:latest` — cached by the mock-signal path
    # this fixture switches on — out of the real cache. Without it the guard in
    # conftest catches the write and fails this file.
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "true")
    monkeypatch.setenv("USE_MOCK_SIGNALS", "true")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _refuse(client, path="/v1/ws/market"):
    """Connect and record the refusal, returning (code, reason).

    A WebSocketException raised before the handshake is accepted reaches the
    TestClient as an exception out of `websocket_connect`, not as a socket with a
    close code, so the refusal has to be caught rather than read off the object.
    """
    with pytest.raises(ClientDisconnect) as caught:
        with client.websocket_connect(path) as ws:
            ws.receive_json()
    exc = caught.value
    return getattr(exc, "code", None), (getattr(exc, "reason", None) or "")


def _signup(client, email="bayar@aidss.id"):
    resp = client.post(
        "/v1/auth/signup",
        json={
            "email": email,
            "full_name": "Pengguna Bayar",
            "phone_number": "081234567890",
            "password": "s3cret-pass",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp


class TestGateStates:
    def test_signed_in_without_a_subscription_is_refused(self, gated_client, fake_identity):
        """Signing in is not the same as paying. Until Phase 2 there is no way to pay."""
        _signup(gated_client)
        assert gated_client.get("/v1/signals").status_code == 402

    def test_an_unexpired_subscription_opens_the_data(self, gated_client, fake_identity):
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=30)
        assert gated_client.get("/v1/signals").status_code == 200

    def test_an_expired_subscription_does_not(self, gated_client, fake_identity):
        """The gate reads expires_at; there is no status column that could disagree."""
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=-1)
        assert gated_client.get("/v1/signals").status_code == 402

    def test_early_renewal_uses_the_longer_period(self, gated_client, fake_identity):
        """MAX(expires_at), so an overlapping renewal is not a reason to deny."""
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=5)
        fake_identity.add_subscription(account_id, days=60)
        assert gated_client.get("/v1/signals").status_code == 200

    def test_unreachable_entitlement_query_denies(self, gated_client, fake_identity):
        """Fail closed. The alternative is paid data for anyone with a connection error."""
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=30)
        assert gated_client.get("/v1/signals").status_code == 200

        fake_identity.fail_subscriptions = True
        assert gated_client.get("/v1/signals").status_code == 402

    def test_unreachable_database_is_a_503_not_a_refusal(self, gated_client, fake_identity):
        """A total outage is a different failure from knowing and refusing.

        "We cannot tell who you are" must not be reported as "you have no
        subscription" — that would read as a billing problem to the person and as
        a logged-out user to the support desk. Same fail-closed effect, honest
        status, and the caller can retry.
        """
        _signup(gated_client)
        fake_identity.fail = True
        assert gated_client.get("/v1/signals").status_code == 503

    def test_anonymous_is_refused_before_the_gate(self, gated_client):
        assert gated_client.get("/v1/signals").status_code == 401


class TestGateScope:
    """Reference data stays open to any signed-in account.

    Gating the instrument list would mean a signed-out visitor could not render the
    pricing page, which is the opposite of what the gate is for. This asserts the
    boundary so it cannot be widened by accident.
    """

    def test_reference_routes_need_a_session_but_not_a_subscription(
        self, gated_client, fake_identity
    ):
        _signup(gated_client)
        assert gated_client.get("/v1/news").status_code == 200

    def test_reference_routes_are_still_protected(self, gated_client):
        assert gated_client.get("/v1/news").status_code == 401

    def test_analysis_routes_are_gated(self, gated_client, fake_identity):
        _signup(gated_client)
        for path in ("/v1/signals", "/v1/portfolio/optimise", "/v1/alerts"):
            assert gated_client.get(path).status_code == 402, path


class TestRefusalsAreDistinguishable:
    """Three refusals, three statuses, so the client can tell them apart.

    They used to share one. A blocked account and a non-admin both answered 403,
    which is the same status an unsubscribed account got — so a frontend reading
    403 as "needs a subscription" would tell a banned person to check their
    billing, and tell an ordinary user their billing was the reason an admin page
    would not open.
    """

    def test_an_entitlement_refusal_is_402_not_403(self, gated_client, fake_identity):
        _signup(gated_client)
        assert gated_client.get("/v1/signals").status_code == 402

    def test_a_blocked_account_is_refused_with_403_not_402(self, gated_client, fake_identity):
        _signup(gated_client)
        account = next(iter(fake_identity.users.values()))
        account["blocked_at"] = "2026-01-01T00:00:00+00:00"
        assert gated_client.get("/v1/signals").status_code == 403

    def test_a_non_admin_on_an_admin_route_gets_403_not_402(self, gated_client):
        _signup(gated_client)
        assert gated_client.get("/v1/admin/accounts").status_code == 403

    def test_an_admin_without_a_subscription_gets_402_on_paid_routes(
        self, gated_client, fake_identity
    ):
        """Role is not entitlement, in both directions: 403 to open, 402 to read."""
        _signup(gated_client, email="admin-402@aidss.id")
        account = next(iter(fake_identity.users.values()))
        account["role"] = "admin"

        assert gated_client.get("/v1/signals").status_code == 402
        assert gated_client.get("/v1/admin/accounts").status_code == 200


class TestRoleIsNotEntitlement:
    """CONTEXT.md rule 6: the two are computed separately and neither sacrifices
    the other. An administrator is not automatically a paying subscriber, which is
    what makes the gate an entitlement rather than a role check."""

    def test_an_admin_without_a_subscription_is_still_gated(
        self, gated_client, fake_identity
    ):
        _signup(gated_client, email="admin@aidss.id")
        account = next(iter(fake_identity.users.values()))
        account["role"] = "admin"

        assert gated_client.get("/v1/signals").status_code == 402
        # The role itself still works: /v1/auth/me answers for an admin.
        assert gated_client.get("/v1/auth/me").status_code == 200


class TestDevelopmentCannotSeeTheGate:
    """Why the bugs this suite guards against survived as long as they did.

    `AUTH_BYPASS=true` is the development default and makes `get_current_user`
    return a dev principal, so the entitlement check never fires locally. Every
    paid route answers 200, the refusal paths are unreachable, and a frontend bug
    in the 402 handling is invisible to the person writing it — which is exactly
    how "a refusal signs you out" and "a refusal is reported as a dead backend"
    both shipped.

    This does not fail the boot. It says out loud that the app on screen is not
    the one that will be deployed.
    """

    def _settings(self, monkeypatch, **env):
        for k, v in {"AUTH_BYPASS": "true", "PAYWALL_ENABLED": "true",
                     "APP_ENV": "development"}.items():
            monkeypatch.setenv(k, env.get(k, v))
        get_settings.cache_clear()

    def test_the_bypass_and_gate_combination_is_announced(
        self, monkeypatch, caplog
    ):
        self._settings(monkeypatch)
        try:
            with caplog.at_level("WARNING", logger="api.core.config"):
                get_settings()
            announced = " ".join(r.getMessage() for r in caplog.records)
            assert "PAYWALL_ENABLED" in announced
            assert "AUTH_BYPASS" in announced
        finally:
            get_settings.cache_clear()

    def test_it_changes_no_behaviour(self, monkeypatch):
        """The warning is a logger call and nothing else.

        If this ever started refusing to boot, local development would stop — and
        the refusal would be one more reason the gate never gets exercised.
        """
        self._settings(monkeypatch)
        try:
            settings = get_settings()
            assert settings.auth_bypass is True
            assert settings.paywall_enabled is True
        finally:
            get_settings.cache_clear()

    def test_it_is_silent_when_the_gate_can_actually_be_reached(
        self, monkeypatch, caplog
    ):
        monkeypatch.setenv("AUTH_BYPASS", "false")
        monkeypatch.setenv("PAYWALL_ENABLED", "true")
        monkeypatch.setenv("APP_ENV", "development")
        get_settings.cache_clear()
        try:
            with caplog.at_level("WARNING", logger="api.core.config"):
                get_settings()
            announced = " ".join(r.getMessage() for r in caplog.records)
            assert "AUTH_BYPASS" not in announced
        finally:
            get_settings.cache_clear()


class TestProductionRefusesAnOpenGate:
    def test_production_boots_with_the_gate_off_fails_fast(self, monkeypatch):
        """A missing env var must not silently open the paid data."""
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("AUTH_BYPASS", "false")
        monkeypatch.setenv("PAYWALL_ENABLED", "false")
        monkeypatch.setenv("APP_DEBUG", "false")
        get_settings.cache_clear()
        try:
            with pytest.raises(ValueError) as exc:
                get_settings()
            assert "PAYWALL_ENABLED" in str(exc.value)
        finally:
            get_settings.cache_clear()

    def test_default_is_the_secure_one(self):
        """The field default, not the resolved value.

        conftest sets PAYWALL_ENABLED=false in the environment so the rest of the
        suite is ungated; asserting on Settings() here would read that back and
        prove nothing.
        """
        from api.core.config import Settings

        assert Settings.model_fields["paywall_enabled"].default is True, (
            "secure by default: a deployment that never sets the flag must be gated"
        )

class TestWebSocketGate:
    """The live feed is the same paid data every HTTP route serves.

    It shipped without any entitlement check at all, so it was a socket that
    served the paid snapshot to any signed-in account regardless of subscription
    — the one route where the HTTP gate could simply be stepped around.
    """

    def test_signed_in_without_a_subscription_is_refused(self, gated_client):
        _signup(gated_client)
        code, reason = _refuse(gated_client)
        assert code == 4403
        # The reason has to name the subscription, so a frontend can tell the
        # person why the feed did not open rather than looking like a bug.
        assert "subscription" in reason.lower()

    def test_a_refusal_names_its_cause_in_the_close_code_alone(
        self, gated_client, fake_identity
    ):
        """Two refusals, two codes, so a client never has to parse `reason`.

        `reason` is the only thing that used to tell "your session ended" from "you
        have no subscription", and it is the wrong thing to branch on: the browser
        truncates CloseEvent.reason to 123 bytes, and a human-readable string can be
        reworded by a copy edit without anything failing. The frontend read every
        1008 as an expired session, so an account with a perfectly valid session and
        no subscription was signed out by the paywall.
        """
        anonymous_code, _ = _refuse(gated_client)

        gated_client.cookies.clear()
        _signup(gated_client, email="cause@aidss.id")
        paywall_code, _ = _refuse(gated_client)

        assert paywall_code != anonymous_code, (
            "a subscription refusal must be distinguishable from an identity "
            "refusal by code, not by the wording of reason"
        )

    def test_the_subscription_code_cannot_collide_with_a_protocol_code(
        self, gated_client
    ):
        """4400-4999 is the range reserved for applications.

        A refusal that reused a reserved protocol code would be indistinguishable
        from a transport failure to any client that switches on the number alone,
        which is exactly the assumption this change introduces.
        """
        _signup(gated_client)
        code, _ = _refuse(gated_client)
        assert 4000 <= code <= 4999

    def test_an_unexpired_subscription_opens_the_stream(
        self, gated_client, fake_identity
    ):
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=30)
        with gated_client.websocket_connect("/v1/ws/market") as ws:
            assert ws.receive_json()["type"] == "snapshot"

    def test_an_expired_subscription_does_not(self, gated_client, fake_identity):
        """The socket reads expires_at like every other gate; no separate rule."""
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=-1)
        code, _ = _refuse(gated_client)
        assert code == 4403

    def test_an_admin_without_a_subscription_is_refused(
        self, gated_client, fake_identity
    ):
        """Same rule as the HTTP gate: a role is not an entitlement."""
        _signup(gated_client, email="admin-ws@aidss.id")
        account = next(iter(fake_identity.users.values()))
        account["role"] = "admin"
        code, _ = _refuse(gated_client)
        assert code == 4403

    def test_a_blocked_account_is_refused(self, gated_client, fake_identity):
        """Blocking is immediate access loss, so it applies to the socket too."""
        _signup(gated_client, email="blocked-ws@aidss.id")
        account = next(iter(fake_identity.users.values()))
        account["blocked_at"] = "2026-01-01T00:00:00+00:00"
        fake_identity.add_subscription(account["id"], days=30)
        code, _ = _refuse(gated_client)
        assert code == 1008

    def test_anonymous_is_refused(self, gated_client):
        code, _ = _refuse(gated_client)
        assert code == 1008

    def test_a_ticket_carries_the_account_so_the_gate_still_applies(
        self, gated_client, fake_identity
    ):
        """The ticket exists so a cross-site browser can reach the socket at all.

        It used to store a bare "1", which proved who someone was without saying
        who — so the only way to gate on a ticket was to let it through. Now it
        names the account and is held to the same gate as the cookie.
        """
        _signup(gated_client, email="ticket@aidss.id")
        account_id = next(iter(fake_identity.users.values()))["id"]

        ticket = gated_client.post("/v1/auth/ws-ticket").json()["ticket"]
        code, reason = _refuse(gated_client, f"/v1/ws/market?ticket={ticket}")
        assert code == 4403
        assert "subscription" in reason.lower()

        # And the entitled case opens on the ticket as well as the cookie.
        fake_identity.add_subscription(account_id, days=30)
        ticket = gated_client.post("/v1/auth/ws-ticket").json()["ticket"]
        with gated_client.websocket_connect(
            f"/v1/ws/market?ticket={ticket}"
        ) as ws:
            assert ws.receive_json()["type"] == "snapshot"

    def test_a_ticket_is_single_use(self, gated_client, fake_identity):
        """Consumed whether or not it connects, so a leaked URL is not a key.

        The cookie is dropped first, otherwise the replayed ticket is masked: the
        handshake would fall through to the cookie and open anyway, and this test
        would pass whether or not the ticket was actually single-use.
        """
        _signup(gated_client, email="once@aidss.id")
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=30)

        ticket = gated_client.post("/v1/auth/ws-ticket").json()["ticket"]
        gated_client.cookies.clear()
        with gated_client.websocket_connect(f"/v1/ws/market?ticket={ticket}") as ws:
            assert ws.receive_json()["type"] == "snapshot"
        code, _ = _refuse(gated_client, f"/v1/ws/market?ticket={ticket}")
        assert code == 1008

    def test_a_ticket_alone_does_not_open_the_stream_without_a_subscription(
        self, gated_client
    ):
        """The ticket is an identity claim, not an entitlement claim."""
        _signup(gated_client, email="ticket-nopay@aidss.id")
        ticket = gated_client.post("/v1/auth/ws-ticket").json()["ticket"]
        gated_client.cookies.clear()
        code, reason = _refuse(gated_client, f"/v1/ws/market?ticket={ticket}")
        assert code == 4403
        assert "subscription" in reason.lower()


@pytest.fixture
def priced_market():
    """A market state with real quotes for the two symbols under test.

    The suite never polls the feed, so `_current_stocks` is empty and every
    position would value at zero — which is a true statement about the
    calculation and a useless one about the isolation.
    """
    from api.services import market_service

    market_service._init_default_state()
    yield market_service
    market_service._current_stocks.clear()


class TestWebSocketCarriesTheCallersOwnPortfolio:
    """The feed's rupiah figures have to belong to the account receiving them.

    generate_snapshot() with no positions used to answer with a hardcoded 13.1
    billion rupiah for everyone, so two accounts on one screen saw identical money.
    """

    def test_two_accounts_see_different_portfolio_values(
        self, gated_client, fake_portfolios, fake_identity, priced_market
    ):
        _signup(gated_client, email="a@aidss.id")
        first = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(first, days=30)
        alice = gated_client.post("/v1/auth/ws-ticket").json()["ticket"]

        gated_client.cookies.clear()
        _signup(gated_client, email="b@aidss.id")
        second = next(
            row["id"] for row in fake_identity.users.values() if row["id"] != first
        )
        fake_identity.add_subscription(second, days=30)
        bob = gated_client.post("/v1/auth/ws-ticket").json()["ticket"]
        gated_client.cookies.clear()

        # Give each a book, then make the fake portfolio table answer for it.
        fake_portfolios.rows.clear()
        # str(), because resolve_portfolio_id passes the account id as text.
        fake_portfolios.rows["pf_alice"] = (str(first), True, '{"BBCA": 2000}')
        fake_portfolios.rows["pf_bob"] = (str(second), True, '{"TLKM": 5000}')

        with gated_client.websocket_connect(f"/v1/ws/market?ticket={alice}") as ws:
            alice_value = ws.receive_json()["data"]["portfolioValue"]
        with gated_client.websocket_connect(f"/v1/ws/market?ticket={bob}") as ws:
            bob_value = ws.receive_json()["data"]["portfolioValue"]

        assert alice_value > 0 and bob_value > 0
        assert alice_value != bob_value

    def test_an_empty_portfolio_reports_zero_not_a_baseline(
        self, gated_client, fake_portfolios, fake_identity, priced_market
    ):
        """Zero is what a portfolio holding nothing is worth.

        The removed baseline was the operator's book, presented to an account that
        had never bought a share — and it looked like a real number on the same
        screen as real prices.
        """
        _signup(gated_client, email="empty@aidss.id")
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=30)

        fake_portfolios.rows.clear()
        fake_portfolios.rows["pf_empty"] = (str(account_id), True, "{}")

        ticket = gated_client.post("/v1/auth/ws-ticket").json()["ticket"]
        gated_client.cookies.clear()
        with gated_client.websocket_connect(f"/v1/ws/market?ticket={ticket}") as ws:
            data = ws.receive_json()["data"]

        assert data["portfolioValue"] == 0
        assert data["dailyPnL"] == 0


class TestSubscriptionCurrent:
    """`GET /v1/subscription/current` — the read path Tab 2 has been missing.

    Authenticated but not entitlement-gated, because the question cannot be asked
    by someone the gate has already refused. The tests below assert that, since it
    is the decision most likely to be "tidied up" into a gated route later.
    """

    def test_a_signed_out_caller_is_refused(self, gated_client):
        assert gated_client.get("/v1/subscription/current").status_code == 401

    def test_no_subscription_answers_null_not_zero(self, gated_client, fake_identity):
        """`active: false` with no date, rather than an expired period with
        `daysRemaining: 0`.

        The second shape reads as "you have one" — it has a date and a number on
        screen — and it would be a status column on a Subscription, which
        CONTEXT.md rule 1 rules out.
        """
        _signup(gated_client)
        body = gated_client.get("/v1/subscription/current").json()
        assert body == {
            "active": False,
            "expiresAt": None,
            "daysRemaining": None,
            "startDate": None,
        }

    def test_an_unexpired_period_is_reported_with_days_left(
        self, gated_client, fake_identity
    ):
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=30)

        body = gated_client.get("/v1/subscription/current").json()
        assert body["active"] is True
        assert body["expiresAt"] is not None
        # 30 days minus a sliver of elapsed time, so an exact 30 would be flaky.
        assert 28 <= body["daysRemaining"] <= 30

    def test_an_expired_period_reads_as_no_subscription(self, gated_client, fake_identity):
        """The row is still there. Reporting it as "your subscription, 0 days left"
        would say the person has one."""
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=-5)

        body = gated_client.get("/v1/subscription/current").json()
        assert body["active"] is False
        assert body["expiresAt"] is None
        assert body["daysRemaining"] is None

    def test_the_longest_unexpired_period_wins(self, gated_client, fake_identity):
        """An overlapping renewal must not be reported as the shorter one."""
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=5)
        fake_identity.add_subscription(account_id, days=60)

        body = gated_client.get("/v1/subscription/current").json()
        assert body["daysRemaining"] >= 59

    def test_a_non_subscriber_can_still_ask(self, gated_client, fake_identity):
        """The circularity that would appear if this were moved behind
        `require_entitlement`: the account refused the very answer that explains why
        it is seeing no data."""
        _signup(gated_client)
        # No subscription, paywall on.
        assert gated_client.get("/v1/signals").status_code == 402
        assert gated_client.get("/v1/subscription/current").status_code == 200

    def test_an_unreadable_database_is_503_not_no_subscription(
        self, gated_client, fake_identity
    ):
        """Answering "you have none" to a connection error would leave someone with
        an active subscription being told, in the Settings page, that they do not
        have one."""
        _signup(gated_client)
        account_id = next(iter(fake_identity.users.values()))["id"]
        fake_identity.add_subscription(account_id, days=30)

        fake_identity.fail = True
        assert gated_client.get("/v1/subscription/current").status_code == 503
