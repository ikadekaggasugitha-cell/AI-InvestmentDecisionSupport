"""
GET /v1/admin/accounts and the block/unblock pair.

`blocked_at` existed as a column with a reader and no writer, so the capability to
close an account was theoretical. These tests exist so it cannot go back to being
theoretical, and so the two things this router is easy to get wrong stay right:

  * Role and entitlement are separate questions. An administrator is not
    automatically a paying subscriber, and a paying subscriber is not an
    administrator (CONTEXT.md rule 6).
  * A non-administrator gets 403, never a partially different status.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings


@pytest.fixture
def client(monkeypatch, mock_redis):
    # mock_redis: these routes read through the cache, which writes on the way.
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def signup(client, email):
    resp = client.post(
        "/v1/auth/signup",
        json={
            "email": email,
            "full_name": "Nama Uji",
            "phone_number": "081234567890",
            "password": "s3cret-pass",
        },
    )
    assert resp.status_code == 200, resp.text
    # Signup answers with a session envelope, not a bare account.
    return resp.json()["account"]["id"]


class TestAuthorisation:
    def test_anonymous_cannot_list_accounts(self, client):
        assert client.get("/v1/admin/accounts").status_code == 401

    def test_a_normal_account_cannot_list_accounts(self, client, fake_identity):
        """The whole router hinges on this one. Without it, every registered
        person could enumerate every other account's email and phone number."""
        signup(client, "biasa@aidss.id")
        assert client.get("/v1/admin/accounts").status_code == 403

    def test_a_normal_account_cannot_block_anyone(self, client, fake_identity):
        signup(client, "biasa@aidss.id")
        target = signup(client, "target@aidss.id")
        assert client.post(f"/v1/admin/accounts/{target}/block").status_code == 403

    def test_an_admin_can_list_accounts(self, client, fake_identity):
        signup(client, "admin@aidss.id")
        # Promote through the same fake the subscription tests use.
        _promote(fake_identity, "admin@aidss.id")
        assert client.get("/v1/admin/accounts").status_code == 200

    def test_role_is_not_entitlement(self, client, fake_identity, monkeypatch):
        """An administrator is still gated on the paid data.

        The inverse matters too: this router is role-gated, not entitlement-gated,
        so an admin without a Subscription can still do its job.
        """
        make_admin(client, fake_identity)

        monkeypatch.setenv("PAYWALL_ENABLED", "true")
        get_settings.cache_clear()
        try:
            # Admin still administers...
            assert client.get("/v1/admin/accounts").status_code == 200
            # ...but does not get the paid analysis for free.
            assert client.get("/v1/signals").status_code == 403
        finally:
            get_settings.cache_clear()


def login(client, email, password="s3cret-pass"):
    """Sign in again as `email`.

    Necessary because the TestClient keeps exactly one session cookie: creating a
    second account replaces the first one's, so an administrator has to sign in
    again before calling the admin endpoints. Getting this wrong produces a
    confusing 403 that looks like an authorisation bug rather than a test bug.
    """
    resp = client.post(
        "/v1/auth/login", json={"email": email, "password": password}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["account"]["id"]


def session_cookie(client):
    """The current session cookie, saved so it can be replayed later.

    A TestClient holds exactly one session, so "use the session that was open when
    the account got blocked" has to mean "put the cookie back". Logging in again
    instead would not test anything: a blocked account cannot log in, so the only
    thing it would prove is that login is refused.
    """
    return client.cookies.get("aidss_session")


def restore_cookie(client, value):
    client.cookies.clear()
    if value is not None:
        client.cookies.set("aidss_session", value)


def make_admin(client, fake_identity, email="admin@aidss.id"):
    """Create an administrator and sign in as them, ready to call the API."""
    account_id = signup(client, email)
    _promote(fake_identity, email)
    login(client, email)
    return account_id


def _promote(fake_identity, email):
    """Mark an account as admin inside the fake identity table.

    Promotion stays a script per ADR-0002 — nothing in the request path can grant a
    role. The tests reach past the API on purpose, the same way
    `db/promote_admin.py` does, rather than inventing an endpoint to make testing
    convenient.
    """
    for row in fake_identity.users.values():
        if row["email"] == email:
            row["role"] = "admin"
            return
    raise AssertionError(f"no such account: {email}")


class TestBlockingOverHttp:
    def test_blocking_takes_effect_and_is_visible(self, client, fake_identity):
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "admin@aidss.id")

        blocked = client.post(f"/v1/admin/accounts/{target}/block")
        assert blocked.status_code == 200, blocked.text
        body = blocked.json()
        assert body["blocked"] is True
        # The timestamp is what tells "closed" apart from "closed since Tuesday".
        assert body["blocked_at"] is not None

    def test_unblocking_clears_the_state(self, client, fake_identity):
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "admin@aidss.id")

        client.post(f"/v1/admin/accounts/{target}/block")
        restored = client.delete(f"/v1/admin/accounts/{target}/block")
        assert restored.status_code == 200
        assert restored.json()["blocked"] is False
        assert restored.json()["blocked_at"] is None

    def test_blocking_twice_refreshes_the_timestamp(self, client, fake_identity):
        """A kept timestamp would make two separate blocks indistinguishable, and
        the second would look like it predates the unblock between them."""
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "admin@aidss.id")

        first = client.post(f"/v1/admin/accounts/{target}/block").json()["blocked_at"]
        client.delete(f"/v1/admin/accounts/{target}/block")
        second = client.post(f"/v1/admin/accounts/{target}/block").json()["blocked_at"]
        assert second is not None
        assert second >= first

    def test_an_unknown_account_is_404(self, client, fake_identity):
        make_admin(client, fake_identity)
        resp = client.post(f"/v1/admin/accounts/{uuid.uuid4()}/block")
        assert resp.status_code == 404

    def test_a_non_uuid_path_is_rejected_before_the_query(self, client, fake_identity):
        """Email is not accepted as a path parameter: emails change, and lower()
        uniqueness means a case variant resolves while a typo resolves to nobody."""
        make_admin(client, fake_identity)
        assert client.post("/v1/admin/accounts/target@aidss.id/block").status_code == 422

    def test_an_admin_cannot_block_themselves(self, client, fake_identity):
        """Self-blocking locks everyone out of the way to undo it: the endpoint
        needs a session and promotion needs a shell."""
        me = make_admin(client, fake_identity)

        resp = client.post(f"/v1/admin/accounts/{me}/block")
        assert resp.status_code == 400
        assert resp.json()["detail"] == "An administrator cannot block their own account."


class TestListingShape:
    def test_the_list_reports_whether_more_exist(self, client, fake_identity):
        """Without hasMore the caller cannot tell "that is everyone" from "that is
        the first fifty"."""
        make_admin(client, fake_identity)
        signup(client, "lain@aidss.id")
        login(client, "admin@aidss.id")

        page = client.get("/v1/admin/accounts?limit=1")
        assert page.status_code == 200
        body = page.json()
        assert len(body["accounts"]) == 1
        assert body["hasMore"] is True

        everything = client.get("/v1/admin/accounts?limit=200").json()
        assert everything["hasMore"] is False
        assert len(everything["accounts"]) == len(everything["accounts"])

    def test_the_list_shows_block_state(self, client, fake_identity):
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "admin@aidss.id")
        client.post(f"/v1/admin/accounts/{target}/block")

        accounts = client.get("/v1/admin/accounts").json()["accounts"]
        states = {a["id"]: a["blocked"] for a in accounts}
        assert states[target] is True

    def test_page_size_is_bounded(self, client, fake_identity):
        """An unbounded limit would let one request ask for the whole table."""
        make_admin(client, fake_identity)
        assert client.get("/v1/admin/accounts?limit=5000").status_code == 422

class TestBlockingTakesEffectImmediately:
    """CONTEXT.md rule 8: disabling access is the Account's business, and it takes
    effect immediately.

    "Immediately" is the whole claim, and it is easy to state while quietly being
    false: if the block were enforced by anything that expires, an account would
    keep working until that thing did. So every test here replays the cookie that
    was open *before* the block, rather than signing in again — signing in again
    would only prove that login is refused, which is a different and easier thing.
    """

    def test_a_session_opened_before_the_block_stops_working(
        self, client, fake_identity
    ):
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "target@aidss.id")

        # The session works now, and the cookie is saved for the replay below.
        assert client.get("/v1/auth/me").status_code == 200
        live_cookie = session_cookie(client)

        login(client, "admin@aidss.id")
        assert client.post(f"/v1/admin/accounts/{target}/block").status_code == 200

        # The same, unexpired cookie is now refused.
        restore_cookie(client, live_cookie)
        assert client.get("/v1/auth/me").status_code == 403

    def test_signing_in_again_is_refused_while_blocked(self, client, fake_identity):
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "admin@aidss.id")
        client.post(f"/v1/admin/accounts/{target}/block")

        client.cookies.clear()
        resp = client.post(
            "/v1/auth/login",
            json={"email": "target@aidss.id", "password": "s3cret-pass"},
        )
        # 403 rather than the 401 a wrong password would give: the credentials are
        # right, and saying otherwise would send someone looking for a typo.
        assert resp.status_code == 403
        assert resp.json()["detail"] == "This account is blocked."

    def test_the_paid_data_is_refused_too(self, client, fake_identity, monkeypatch):
        """Blocking is not only about the profile page."""
        monkeypatch.setenv("PAYWALL_ENABLED", "true")
        get_settings.cache_clear()
        try:
            make_admin(client, fake_identity)
            target = signup(client, "target@aidss.id")
            account_id = next(
                r["id"] for r in fake_identity.users.values()
                if r["email"] == "target@aidss.id"
            )
            # Entitled first, so the only thing that changes later is the block.
            fake_identity.add_subscription(account_id, days=30)

            login(client, "target@aidss.id")
            assert client.get("/v1/signals").status_code == 200
            live_cookie = session_cookie(client)

            login(client, "admin@aidss.id")
            client.post(f"/v1/admin/accounts/{target}/block")

            restore_cookie(client, live_cookie)
            assert client.get("/v1/signals").status_code == 403
        finally:
            get_settings.cache_clear()

    def test_a_websocket_upgrade_is_refused_while_blocked(
        self, client, fake_identity, monkeypatch
    ):
        """The WebSocket authenticates its own handshake, so it carries its own copy
        of the blocked check and can drift from the HTTP one.

        The ticket is taken *before* the block and replayed after, which is the
        socket's version of "a session that was already open". A blocked account
        cannot ask for a fresh ticket, so this is the only way to reach the upgrade
        at all — and it is the interesting case, because the ticket was legitimately
        issued and had not expired.

        The socket is opened successfully first, so the later refusal cannot be
        mistaken for a broken setup.
        """
        monkeypatch.setenv("PAYWALL_ENABLED", "false")
        get_settings.cache_clear()
        try:
            make_admin(client, fake_identity)
            signup(client, "target@aidss.id")
            login(client, "target@aidss.id")

            # Two tickets, because a ticket is single use: one to prove the socket
            # works at all, one to replay after the block.
            opener = client.post("/v1/auth/ws-ticket").json()["ticket"]
            replay = client.post("/v1/auth/ws-ticket").json()["ticket"]

            with client.websocket_connect(f"/v1/ws/market?ticket={opener}") as ws:
                assert ws.receive_json()["type"] == "snapshot"

            # Block. The administrator's cookie replaces the target's, so the
            # cookies are cleared afterwards — otherwise the upgrade would fall
            # back to the admin's cookie and the test would pass for the wrong
            # reason.
            login(client, "admin@aidss.id")
            target = next(
                r["id"] for r in fake_identity.users.values()
                if r["email"] == "target@aidss.id"
            )
            assert client.post(f"/v1/admin/accounts/{target}/block").status_code == 200
            client.cookies.clear()

            from starlette.websockets import WebSocketDisconnect

            with pytest.raises(WebSocketDisconnect) as caught:
                with client.websocket_connect(f"/v1/ws/market?ticket={replay}") as ws:
                    ws.receive_json()
            # The reason has to say why, or a frontend can only show "connection
            # failed" for something that is a decision.
            assert "blocked" in (caught.value.reason or "").lower()
        finally:
            get_settings.cache_clear()

    def test_unblocking_restores_access(self, client, fake_identity):
        """The other direction, so a mistaken block is not a permanent one."""
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "target@aidss.id")
        live_cookie = session_cookie(client)

        login(client, "admin@aidss.id")
        client.post(f"/v1/admin/accounts/{target}/block")

        restore_cookie(client, live_cookie)
        assert client.get("/v1/auth/me").status_code == 403

        login(client, "admin@aidss.id")
        assert client.delete(f"/v1/admin/accounts/{target}/block").status_code == 200

        # The session that was live throughout comes back to life — the block never
        # touched it, which is why it is still usable.
        restore_cookie(client, live_cookie)
        assert client.get("/v1/auth/me").status_code == 200
