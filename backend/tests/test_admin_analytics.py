"""
The console's overview endpoint.

Two families of assertion, and they cover different failure modes:

  * The service answers zeros for an install with nothing in it, and 503 for a
    database that would not answer. Those are different states and the screen has
    to be able to tell them apart, because a flat line read as "quiet business"
    when it is really "we could not ask" is how an operator stops looking.
  * Every figure moves for the thing it is supposed to measure. A pending
    declaration is not revenue. An expired row is not the same count as a waiting
    one. A period that has ended is churn, and a period still running is not.

The SQL itself — that it is valid Postgres and that `FILTER`, `AT TIME ZONE` and
the churn subquery mean what they claim — is checked against a real database in
tests/test_admin_live_sql.py, because the fake below reimplements the predicates
in Python and cannot catch a syntax error in the statement it stands in for.
"""

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from api.services.admin_analytics_service import (
    OverviewUnavailable,
    read_overview,
)
from tests.test_admin_api import login, make_admin, signup

_OVERVIEW = "/v1/admin/analytics/overview"


@pytest.fixture
def client(monkeypatch, mock_redis):
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _declare(client, plan="monthly"):
    return client.post(
        "/v1/payments/manual", json={"plan": plan, "payment_method": "bank_transfer"}
    )


class TestTheService:
    async def test_an_install_with_nothing_in_it_answers_zeros(self, fake_identity):
        """Not an error, and not a lie: there genuinely has been no money."""
        figures = await read_overview()

        assert figures.revenue_today == 0
        assert figures.revenue_total == 0
        assert figures.mrr_run_rate == 0
        assert figures.pending_queue == 0
        assert figures.active_subscribers == 0
        assert figures.churned_subscribers == 0

    async def test_a_database_that_will_not_answer_is_not_reported_as_zeros(
        self, fake_identity
    ):
        """"Everything is zero" and "I could not ask" must not look alike.

        The first is a fact about the business; the second is a fact about the
        install. Showing an operator the first when the truth is the second is
        how a broken database gets ignored for a week.
        """
        fake_identity.fail = True

        with pytest.raises(OverviewUnavailable):
            await read_overview()


class TestOverHTTP:
    def test_anonymous_is_refused(self, client):
        assert client.get(_OVERVIEW).status_code == 401

    def test_a_normal_account_is_refused_because_this_is_not_a_billing_question(
        self, client, fake_identity
    ):
        """403, not 402. Money cannot buy this route; the role is what it checks,
        and conflating them would tell a subscriber they simply had not paid."""
        signup(client, "biasa@aidss.id")
        login(client, "biasa@aidss.id")
        assert client.get(_OVERVIEW).status_code == 403

    def test_an_admin_reads_the_nine_figures(self, client, fake_identity):
        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        resp = client.get(_OVERVIEW)
        assert resp.status_code == 200, resp.text
        assert set(resp.json()) == {
            "revenueToday",
            "revenueLast30Days",
            "revenueTotal",
            "mrrRunRate",
            "settledLast30Days",
            "pendingQueue",
            "expiredQueue",
            "activeSubscribers",
            "churnedSubscribers",
        }

    def test_a_waiting_declaration_shows_up_as_work_not_as_income(self, client, fake_identity):
        signup(client, "antre@aidss.id")
        login(client, "antre@aidss.id")
        _declare(client)

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        body = client.get(_OVERVIEW).json()

        assert body["pendingQueue"] == 1
        assert body["revenueTotal"] == 0
        assert body["expiredQueue"] == 0

    def test_an_approved_payment_moves_the_money_figures(self, client, fake_identity):
        signup(client, "bayar@aidss.id")
        login(client, "bayar@aidss.id")
        declared = _declare(client).json()

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        assert client.post(f"/v1/admin/transactions/{declared['id']}/approve").status_code == 200

        body = client.get(_OVERVIEW).json()
        assert body["revenueTotal"] == 44000
        assert body["revenueToday"] == 44000
        assert body["revenueLast30Days"] == 44000
        assert body["settledLast30Days"] == 1
        # A monthly payment normalises to itself over a thirty-day window.
        assert body["mrrRunRate"] == 44000
        assert body["activeSubscribers"] == 1
        assert body["churnedSubscribers"] == 0

    def test_a_weekly_payment_normalises_upward_in_the_run_rate(self, client, fake_identity):
        """Seven days of access priced at 15.000 carries roughly four times that
        over a thirty-day month. The run-rate is the figure that says so; the
        revenue totals stay the actual rupiah received."""
        signup(client, "mingguan@aidss.id")
        login(client, "mingguan@aidss.id")
        declared = _declare(client, plan="weekly").json()

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        client.post(f"/v1/admin/transactions/{declared['id']}/approve")

        body = client.get(_OVERVIEW).json()
        assert body["revenueTotal"] == 15000
        assert body["mrrRunRate"] == round(15000 * 30.0 / 7)

    def test_an_expired_row_is_counted_apart_from_the_waiting_one(
        self, client, fake_identity
    ):
        """The queue's own endpoint insists an expired row is still money and
        stays approvable. Folding it into `pendingQueue` would hide work that has
        merely gone stale; folding it into revenue would invent income."""
        signup(client, "telat@aidss.id")
        login(client, "telat@aidss.id")
        declared = _declare(client).json()

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")

        # The row is moved into the state the beat's own task produces. That
        # transition is tested in its own file; what matters here is that the
        # overview counts the two working sets apart.
        fake_identity.transactions[declared["id"]]["status"] = "expire"

        body = client.get(_OVERVIEW).json()
        assert body["pendingQueue"] == 0
        assert body["expiredQueue"] == 1
        assert body["revenueTotal"] == 0

    def test_a_broken_read_answers_503_and_not_a_flat_line(self, client, fake_identity, monkeypatch):
        """The failure is aimed at the overview read alone.

        `fake_identity.fail` would take the session lookup down with it, and the
        route would then 503 for a reason that has nothing to do with the
        aggregates — testing the auth layer's message instead of this one.
        """
        from api.routers.admin import analytics as analytics_router

        async def broken():
            raise OverviewUnavailable("the overview query failed: simulated")

        make_admin(client, fake_identity)
        login(client, "admin@aidss.id")
        monkeypatch.setattr(analytics_router, "read_overview", broken)

        resp = client.get(_OVERVIEW)
        assert resp.status_code == 503
        assert "could not be read" in resp.json()["detail"]
