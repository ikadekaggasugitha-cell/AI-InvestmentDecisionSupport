"""
The rate limiter actually limiting.

This file exists because of a specific failure. slowapi 0.1.9 and 0.1.10 both locate
the route handler by walking `app.routes` looking for a flat route object with an
`.endpoint` attribute. FastAPI 0.141 stopped flattening: `include_router()` wraps each
router in `_IncludedRouter`, so nothing matches, `handler` comes back as `None`, and
`_should_exempt(None)` returns `True` — every route, without exception, treated as
exempt.

The limiter was enabled, mounted, and had a default limit of 5/minute, and twelve
requests to `/v1/news` all returned 200. Nothing caught it because `conftest.py`
turned rate limiting off for the whole suite with a comment saying dedicated tests
existed. They did not.

So: every assertion here is written to fail against a limiter that is not running.
A test that passes whether or not the limiter works would repeat the original problem.
"""

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings


@pytest.fixture
def limited_client(monkeypatch):
    """An app with a deliberately tiny budget, so the test needs few requests.

    The budget is set here rather than by the global setting because the suite runs
    hundreds of requests from one address; a production-sized budget would never be
    reached and the test would pass without exercising anything.
    """
    monkeypatch.setenv("AUTH_BYPASS", "true")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("RATE_LIMIT_DEFAULT", "5/minute")
    monkeypatch.setenv("RATE_LIMIT_ADVISOR", "3/minute")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    # Empty, not the suite's raised ceiling: this test needs a budget small enough
    # to exhaust in a dozen requests. conftest raises it so the rest of the suite
    # can fire hundreds of requests from one address without being throttled.
    monkeypatch.setenv("RATE_LIMIT_TEST_BUDGET", "")
    get_settings.cache_clear()

    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _statuses(client, path, count):
    return [client.get(path).status_code for _ in range(count)]


class TestTheDefaultLimitIsEnforced:
    def test_requests_past_the_budget_are_refused(self, limited_client):
        """The assertion that fails today.

        Before the fix this returned twelve 200s against a 5/minute budget. The
        count is deliberately well past the budget: a single extra request would pass
        by accident on window boundaries.
        """
        statuses = _statuses(limited_client, "/v1/news", 12)

        assert 429 in statuses, (
            f"no request was refused; the limiter let all {len(statuses)} through "
            f"against a 5/minute budget: {statuses}"
        )

    def test_the_refusal_names_the_limit(self, limited_client):
        """A 429 without the budget attached leaves the caller unable to back off.

        Either Retry-After or an X-RateLimit-Limit header is enough; what is not
        enough is a bare 429.
        """
        responses = [limited_client.get("/v1/news") for _ in range(12)]
        refused = next((r for r in responses if r.status_code == 429), None)

        assert refused is not None, "nothing was refused, so there is nothing to describe"
        headers = {k.lower() for k in refused.headers}
        assert headers & {"retry-after", "x-ratelimit-limit", "ratelimit-limit"}, (
            f"429 carried no budget information; headers were {sorted(refused.headers)}"
        )

    def test_a_refusal_is_not_a_server_error(self, limited_client):
        """429 means "you sent too much", which is a different thing from "I broke".

        A 500 would make an overloaded client look like an outage and send people to
        the wrong runbook.
        """
        statuses = _statuses(limited_client, "/v1/news", 12)
        assert all(s in (200, 429) for s in statuses), (
            f"expected only 200 and 429, got {sorted(set(statuses))}"
        )

    def test_the_limit_applies_to_a_route_with_no_decorator_of_its_own(self, limited_client):
        """/v1/news carries no @limiter.limit. Only the advisor does.

        That is the shape of the bug: a per-route decorator on one endpoint said
        nothing about whether the global default was applied anywhere at all.
        """
        statuses = _statuses(limited_client, "/v1/news", 12)
        assert 429 in statuses


class TestExemptRoutes:
    def test_health_is_never_throttled(self, limited_client):
        """An orchestrator that gets 429 on /health concludes the instance is unhealthy
        and replaces it — so a busy application would be scaled down exactly when it
        needs to scale up."""
        statuses = [limited_client.get("/health").status_code for _ in range(30)]
        assert 429 not in statuses, f"health checks were throttled: {statuses}"
        assert all(s == 200 for s in statuses), f"health returned {sorted(set(statuses))}"

    def test_health_stays_available_after_the_budget_is_spent(self, limited_client):
        """The order matters: exhausting the budget first, then probing.

        Checking health on a fresh client would pass even with a limiter that only
        throttles the first N requests per connection.
        """
        _statuses(limited_client, "/v1/news", 12)
        assert limited_client.get("/health").status_code == 200


class TestPerRouteLimitsAreTighter:
    def test_the_advisor_limit_is_tighter_than_the_default(self, limited_client, fake_identity):
        """Each call fans out to Claude, so it gets 3/minute against a 5/minute default.

        Asserted as a ratio rather than a literal so that raising the default does not
        silently make this test meaningless.
        """
        from api.core.rate_limit import limit_for_path

        advisor = limit_for_path("/v1/advisor/chat")
        default = limit_for_path("/v1/news")

        assert advisor is not None, "the advisor route has no limit"
        assert default is not None, "the default limit is not resolvable"
        assert advisor.count < default.count, (
            f"advisor allows {advisor.count} against a default of {default.count}"
        )


class TestTheLimiterCanBeTurnedOff:
    def test_disabling_it_removes_the_refusal(self, monkeypatch):
        """`RATE_LIMIT_ENABLED=false` is what a deployment fronting its own limiter uses.

        If the flag stopped working, that deployment would have both limiters.
        """
        monkeypatch.setenv("AUTH_BYPASS", "true")
        monkeypatch.setenv("PAYWALL_ENABLED", "false")
        monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
        monkeypatch.setenv("RATE_LIMIT_DEFAULT", "5/minute")
        monkeypatch.setenv("METRICS_ENABLED", "false")
        get_settings.cache_clear()

        from api.main import create_app

        client = TestClient(create_app())
        statuses = _statuses(client, "/v1/news", 12)

        assert 429 not in statuses, f"the limiter ran despite being disabled: {statuses}"
        get_settings.cache_clear()