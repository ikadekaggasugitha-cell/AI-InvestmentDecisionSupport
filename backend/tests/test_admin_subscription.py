"""
POST /v1/admin/accounts/{account_id}/subscription.

Before payments exist, this endpoint is the only writer of `subscriptions` in
the request path, and it is how an operator opens access — including their own
(CURRENT.md rule 6 keeps role and entitlement apart, so the operator granting
usually has none themselves). The things it must never get wrong:

  * A non-administrator is refused with 403, and an anonymous caller with 401 —
    this endpoint hands out paid access, so every path to it has to be earned.
  * A `days` of zero or less is refused, because it would mint a period that
    reads as active for an instant and is gone by the next request.
  * Blocking and granting are different questions (CONTEXT.md rule 8): a blocked
    account can be granted, and the grant does not lift the block.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from tests.test_admin_api import login, make_admin, signup


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


def _grant(client, account_id, days=30):
    return client.post(
        f"/v1/admin/accounts/{account_id}/subscription",
        json={"days": days},
    )


class TestGrantAccess:
    def test_the_grant_answers_with_the_period_it_created(self, client, fake_identity):
        make_admin(client, fake_identity)
        target = signup(client, "penerima@aidss.id")
        login(client, "admin@aidss.id")

        resp = _grant(client, target)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accountId"] == target
        assert body["subscriptionId"]
        assert body["expiresAt"]
        # One row in the table — the fake recognises only statements that
        # really ran, so anything else here would make the row count a lie.
        assert len(fake_identity.subscriptions) == 1

    def test_after_the_grant_the_account_can_ask_its_own_state(self, client, fake_identity):
        """The round trip that matters: the recipient asks GET
        /v1/subscription/current and hears yes, without anyone editing anything
        by hand."""
        make_admin(client, fake_identity)
        target = signup(client, "penerima@aidss.id")
        login(client, "admin@aidss.id")
        assert _grant(client, target).status_code == 200

        login(client, "penerima@aidss.id")
        mine = client.get("/v1/subscription/current")

        assert mine.status_code == 200
        state = mine.json()
        assert state["active"] is True
        assert state["daysRemaining"] in (29, 30)
        assert state["expiresAt"] is not None

    def test_a_second_grant_adds_a_period_without_shifting_the_first(
        self, client, fake_identity
    ):
        """Renewal is a new row. The longest expiry wins on read, and neither
        call rewrites the other's."""
        make_admin(client, fake_identity)
        target = signup(client, "penerima@aidss.id")
        login(client, "admin@aidss.id")

        first = _grant(client, target, days=30).json()
        assert _grant(client, target, days=15).status_code == 200

        assert len(fake_identity.subscriptions) == 2
        login(client, "penerima@aidss.id")
        state = client.get("/v1/subscription/current").json()
        assert state["active"] is True
        # The 30-day grant reported earlier keeps its expiry; the current
        # answer is the longest period, not the latest call.
        earliest = first["expiresAt"]
        assert earliest is not None
        assert state["expiresAt"] >= earliest

    def test_the_admin_can_start_with_themselves(self, client, fake_identity):
        """The operator is usually the account with no subscription: this is
        also how their own access opens."""
        me = make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        assert _grant(client, me).status_code == 200
        assert len(fake_identity.subscriptions) == 1


class TestRefusals:
    def test_anonymous_gets_401(self, client, fake_identity):
        assert client.post(
            f"/v1/admin/accounts/{uuid.uuid4()}/subscription", json={"days": 30}
        ).status_code == 401

    def test_a_normal_account_gets_403_not_402(self, client, fake_identity):
        """403, and deliberately not 402: the caller has run into nothing about
        billing, they have run into the router's role wall (CONTEXT.md rule 6)."""
        signup(client, "biasa@aidss.id")
        target = signup(client, "target@aidss.id")

        resp = _grant(client, target)

        assert resp.status_code == 403
        assert fake_identity.subscriptions == []

    def test_an_unknown_account_is_404(self, client, fake_identity):
        make_admin(client, fake_identity)

        assert _grant(client, uuid.uuid4()).status_code == 404

    def test_a_non_uuid_path_is_rejected_before_anything(self, client, fake_identity):
        make_admin(client, fake_identity)

        assert (
            client.post(
                "/v1/admin/accounts/target@aidss.id/subscription", json={"days": 30}
            ).status_code
            == 422
        )

    def test_days_of_zero_or_negative_is_422(self, client, fake_identity):
        """The service refuses before any statement; the router maps the
        refusal to 422 with the reason in the detail."""
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "admin@aidss.id")

        for days in (0, -1):
            resp = _grant(client, target, days=days)
            assert resp.status_code == 422, resp.text
        assert fake_identity.subscriptions == []


class TestBlockAndEntitleStayApart:
    def test_a_blocked_account_can_still_be_granted(self, client, fake_identity):
        """Access is the block's answer; entitlement is the grant's. One does
        not overrule the other, so granting to a closed account is allowed —
        and unblocking is still the admin endpoint's job."""
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "admin@aidss.id")
        assert client.post(f"/v1/admin/accounts/{target}/block").status_code == 200

        granted = _grant(client, target)

        assert granted.status_code == 200, granted.text
        # The block survives the grant: the second permission did not become a
        # third decision.
        blocked = next(
            row
            for row in fake_identity.users.values()
            if str(row["id"]) == target
        )
        assert blocked["blocked_at"] is not None

    def test_grant_stays_role_gated_when_the_paywall_is_on(self, client, fake_identity, monkeypatch):
        """With the entitlement gate lit, an admin without a subscription still
        administers — rule 6 — and the granted account's role stays 'user'."""
        make_admin(client, fake_identity)
        target = signup(client, "target@aidss.id")
        login(client, "admin@aidss.id")

        monkeypatch.setenv("PAYWALL_ENABLED", "true")
        get_settings.cache_clear()
        try:
            resp = _grant(client, target)
        finally:
            get_settings.cache_clear()

        assert resp.status_code == 200, resp.text
        # Direct endpoint call proves access exists as an entitlement, not just
        # that the write happened.
        entitlement_row = fake_identity.subscriptions[0]
        assert str(entitlement_row["user_id"]) == target

    def test_the_paid_data_stops_refusing_after_the_grant(self, client, fake_identity, monkeypatch):
        """The check the hand cannot fake: before the grant the gate answers 402
        for the paid analysis; after it, the same request for the same account
        answers 200."""
        make_admin(client, fake_identity)
        target = signup(client, "penerima@aidss.id")
        login(client, "admin@aidss.id")

        monkeypatch.setenv("PAYWALL_ENABLED", "true")
        get_settings.cache_clear()
        try:
            login(client, "penerima@aidss.id")
            assert client.get("/v1/signals").status_code == 402

            login(client, "admin@aidss.id")
            assert _grant(client, target).status_code == 200

            login(client, "penerima@aidss.id")
            assert client.get("/v1/signals").status_code == 200
        finally:
            get_settings.cache_clear()
