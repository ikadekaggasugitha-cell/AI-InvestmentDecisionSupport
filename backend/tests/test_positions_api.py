"""
GET and PUT /v1/portfolio/positions.

Positions used to have no write path at all. They lived in the browser's
localStorage, so the Portfolio page showed a book the analytics had never seen —
ADR-0005 made the analytics honest and left the screen lying, which is the same
defect one layer down.

The cost basis is stored alongside the lot count for one reason: "what did I pay"
is not derivable from any price feed, and the only alternative was keeping it in a
second store where the two answers drift the first time a position is edited
somewhere else.
"""

import json

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_BYPASS", "true")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _positions(client, fake_portfolios):
    resp = client.get("/v1/portfolio/positions")
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestReading:
    def test_a_new_account_holds_nothing(self, client, fake_portfolios):
        """Empty is the correct answer, and the reason these tests exist: it used
        to be answered with ten seeded positions."""
        body = _positions(client, fake_portfolios)
        assert body["positions"] == []
        assert body["totalCostBasis"] is None

    def test_positions_round_trip(self, client, fake_portfolios):
        client.put(
            "/v1/portfolio/positions",
            json={"positions": [
                {"symbol": "BBCA", "lots": 2000, "avgPrice": 9200},
                {"symbol": "TLKM", "lots": 5000, "avgPrice": 2780},
            ]},
        )
        body = _positions(client, fake_portfolios)
        by_symbol = {p["symbol"]: p for p in body["positions"]}
        assert by_symbol["BBCA"]["lots"] == 2000
        assert by_symbol["BBCA"]["avgPrice"] == 9200
        # 1 lot = 100 shares, stated by the API so a client cannot get it wrong.
        assert by_symbol["BBCA"]["shares"] == 200_000

    def test_symbols_are_upper_cased(self, client, fake_portfolios):
        client.put(
            "/v1/portfolio/positions",
            json={"positions": [{"symbol": "bbca", "lots": 100, "avgPrice": 9000}]},
        )
        assert _positions(client, fake_portfolios)["positions"][0]["symbol"] == "BBCA"


class TestCostBasis:
    def test_a_position_without_a_price_keeps_it_unknown(self, client, fake_portfolios):
        """Null, not zero. A zero cost basis reads as a position that cost nothing,
        which is a different claim from "we do not know what it cost"."""
        client.put(
            "/v1/portfolio/positions",
            json={"positions": [{"symbol": "BBCA", "lots": 100}]},
        )
        body = _positions(client, fake_portfolios)
        assert body["positions"][0]["avgPrice"] is None
        # A partial total would understate the basis without admitting it.
        assert body["totalCostBasis"] is None

    def test_the_total_appears_only_when_every_position_has_a_price(self, client, fake_portfolios):
        client.put(
            "/v1/portfolio/positions",
            json={"positions": [
                {"symbol": "BBCA", "lots": 100, "avgPrice": 9000},
                {"symbol": "TLKM", "lots": 200, "avgPrice": 3000},
            ]},
        )
        body = _positions(client, fake_portfolios)
        # 100 lots = 10,000 shares × 9000; 200 lots = 20,000 shares × 3000.
        assert body["totalCostBasis"] == pytest.approx(10_000 * 9000 + 20_000 * 3000)


class TestWriting:
    def test_an_empty_list_clears_the_portfolio(self, client, fake_portfolios):
        """A whole-row replace is the only shape that can express a deletion."""
        client.put(
            "/v1/portfolio/positions",
            json={"positions": [{"symbol": "BBCA", "lots": 100, "avgPrice": 9000}]},
        )
        client.put("/v1/portfolio/positions", json={"positions": []})
        assert _positions(client, fake_portfolios)["positions"] == []

    def test_a_duplicate_symbol_does_not_double_the_holding(self, client, fake_portfolios):
        """Last write wins. Summing would silently double someone's position
        because of a UI bug, which is not a recoverable surprise."""
        client.put(
            "/v1/portfolio/positions",
            json={"positions": [
                {"symbol": "BBCA", "lots": 100, "avgPrice": 9000},
                {"symbol": "BBCA", "lots": 250, "avgPrice": 9500},
            ]},
        )
        body = _positions(client, fake_portfolios)
        assert len(body["positions"]) == 1
        assert body["positions"][0]["lots"] == 250

    def test_the_write_is_analytics_visible(self, client, fake_portfolios):
        """The point of writing positions at all: what the person sees and what
        the analytics measure have to come out the same."""
        import asyncio

        from api.services.portfolio_access import load_lots

        client.put(
            "/v1/portfolio/positions",
            json={"positions": [{"symbol": "BBCA", "lots": 2000, "avgPrice": 9200}]},
        )
        portfolio_id = next(iter(fake_portfolios.rows))
        lots = asyncio.run(load_lots(portfolio_id))
        assert lots == {"BBCA": 2000}


class TestValidation:
    @pytest.mark.parametrize("bad", [
        [{"symbol": "BBCA", "lots": 0}],
        [{"symbol": "BBCA", "lots": -5}],
        [{"symbol": "BBCA", "lots": 1.5}],
        [{"symbol": "", "lots": 10}],
        [{"symbol": "BBCA", "lots": 10, "avgPrice": 0}],
        [{"symbol": "BBCA", "lots": 10, "avgPrice": -1}],
    ])
    def test_rejected_rather_than_coerced(self, client, bad):
        """A rejected write leaves the portfolio alone. Clamping a negative lot
        count would put a position on screen that was never entered."""
        resp = client.put("/v1/portfolio/positions", json={"positions": bad})
        assert resp.status_code == 422, resp.text

    def test_the_write_needs_the_positions_key(self, client):
        assert client.put("/v1/portfolio/positions", json={}).status_code == 422


class TestBothStorageShapesAreRead:
    def test_the_pre_migration_shape_still_answers(self, client, fake_portfolios):
        """An install part-way through 0008 has {symbol: lots}. Reading only the new
        shape would report every position there as malformed and quietly empty
        real holdings."""
        # Provision first, so the row exists and can be rewritten into the old shape.
        client.get("/v1/portfolio/positions")
        pid = next(iter(fake_portfolios.rows))
        owner = fake_portfolios.rows[pid][0]
        fake_portfolios.rows[pid] = (owner, True, json.dumps({"BBCA": 2000}))

        body = _positions(client, fake_portfolios)
        assert body["positions"][0]["symbol"] == "BBCA"
        assert body["positions"][0]["lots"] == 2000
        # Nothing to state when the old shape carries no price.
        assert body["positions"][0]["avgPrice"] is None


class TestCachesAreInvalidatedOnWrite:
    """Risk metrics, the equity curve and optimisation weights are pure functions
    of the positions, so none of them can survive a position change.

    The empty result is the sharper case: it was cached like any other, for an
    hour, which meant a person could add their first holding and be told by the
    risk page that they had none while the positions endpoint listed one.
    """

    def test_writing_positions_drops_every_derived_figure(self, client, mock_redis):
        """Seeding the cache first is what makes this meaningful: with no stale
        entries there would be nothing to clear, and the test would pass against
        code that invalidates nothing."""
        # Provision so there is a portfolio id, which the cache keys are built on.
        client.get("/v1/portfolio/positions")

        mock_redis["risk:portfolio:default"] = "{}"
        mock_redis["portfolio:optimise:default"] = "{}"
        mock_redis["portfolio:equity:default:252"] = "{}"
        # An unrelated key that must survive: invalidation is scoped to this
        # portfolio, not a flush.
        mock_redis["signals:latest"] = "{}"

        client.put(
            "/v1/portfolio/positions",
            json={"positions": [{"symbol": "BBCA", "lots": 100, "avgPrice": 9000}]},
        )

        assert not any(key.startswith("risk:portfolio:") for key in mock_redis)
        assert not any(key.startswith("portfolio:optimise:") for key in mock_redis)
        assert not any(key.startswith("portfolio:equity:") for key in mock_redis)
        assert mock_redis["signals:latest"] == "{}"

    def test_an_empty_risk_result_is_not_cached(
        self, client, fake_portfolios, mock_redis, live_settings
    ):
        """The regression test for the hour of "no positions" after adding one.

        `live_settings` puts USE_MOCK_RISK off, because the mock branch is the
        other thing that writes to the risk cache and it is not what this asserts.
        """
        import asyncio

        from api.services import risk_service

        async def run():
            with patch("api.services.risk_service.load_lots", AsyncMock(return_value={})):
                first = await risk_service.get_risk_metrics("default")
                second = await risk_service.get_risk_metrics("default")
            return first, second

        first, second = asyncio.run(run())

        assert first.positionsCount == 0
        assert second.positionsCount == 0
        # Nothing cached: an empty portfolio is a fact that changes the moment a
        # position is added, and the cache cannot know that.
        assert not any(key.startswith("risk:portfolio:") for key in mock_redis)
