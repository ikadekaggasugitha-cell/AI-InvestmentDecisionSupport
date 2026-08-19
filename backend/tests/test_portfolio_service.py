"""
Tests for portfolio service — mock path and HTTP endpoint.
"""

import json

import pytest


class TestPortfolioEndpoint:
    def test_get_optimise_returns_200(self, client, mock_redis):
        resp = client.get("/v1/portfolio/optimise")
        assert resp.status_code == 200

    def test_response_has_weights_and_metrics(self, client, mock_redis):
        data = client.get("/v1/portfolio/optimise").json()
        assert "weights" in data
        assert "metrics" in data
        assert "blView" in data
        assert "disclaimer" in data

    def test_weights_sum_to_one(self, client, mock_redis):
        data = client.get("/v1/portfolio/optimise").json()
        total = sum(w["weight"] for w in data["weights"])
        assert abs(total - 1.0) < 0.01, f"Portfolio weights should sum to 1, got {total}"

    def test_all_weights_in_range(self, client, mock_redis):
        data = client.get("/v1/portfolio/optimise").json()
        for w in data["weights"]:
            assert 0 <= w["weight"] <= 1.0, f"Weight out of range for {w['symbol']}"

    def test_source_is_mock(self, client, mock_redis):
        data = client.get("/v1/portfolio/optimise").json()
        assert data["source"] == "mock"

    def test_disclaimer_present(self, client, mock_redis):
        data = client.get("/v1/portfolio/optimise").json()
        assert len(data["disclaimer"]) > 20


class TestPortfolioService:
    @pytest.mark.asyncio
    async def test_mock_returns_seed(self, mock_redis):
        from api.services.portfolio_service import get_portfolio_optimisation
        result = await get_portfolio_optimisation()
        assert len(result.weights) > 0
        assert result.source == "mock"


class TestPortfolioLivePathFallback:
    """
    With USE_MOCK_PORTFOLIO=false the real optimiser runs — but on a box with no
    TimescaleDB (CI, a fresh deploy) the price matrix comes back empty. The
    service must degrade to seed weights and still answer 200, never 500.
    """

    @pytest.mark.asyncio
    async def test_no_history_degrades_to_seed(self, monkeypatch, mock_redis):
        from api.core.config import get_settings
        from api.services import portfolio_service

        monkeypatch.setenv("USE_MOCK_PORTFOLIO", "false")
        get_settings.cache_clear()

        # Simulate an empty/unreachable `ohlcv` table.
        async def _empty_matrix(symbols, days):
            import pandas as pd
            return pd.DataFrame()

        monkeypatch.setattr(portfolio_service, "_load_price_matrix", _empty_matrix)

        result = await portfolio_service.get_portfolio_optimisation()
        assert len(result.weights) > 0            # answered, not crashed
        assert result.source == "mock"            # seed fallback, honestly labelled
        get_settings.cache_clear()

    @pytest.mark.asyncio
    async def test_does_not_read_risk_cache_key(self, monkeypatch, mock_redis):
        """
        Regression: portfolio reused REDIS_KEYS['risk_portfolio'], so once the
        risk endpoint cached a RiskMetricsResult under risk:portfolio:default the
        optimiser read it back and 500'd on validation. The two keys must differ,
        and a risk-shaped payload under the risk key must not reach the portfolio.
        """
        from api.core.redis_client import REDIS_KEYS
        from api.core.config import get_settings
        from api.services import portfolio_service

        assert REDIS_KEYS["portfolio_optimise"] != REDIS_KEYS["risk_portfolio"]

        monkeypatch.setenv("USE_MOCK_PORTFOLIO", "false")
        get_settings.cache_clear()

        # Poison the risk key with data that would fail PortfolioOptimisationResponse.
        mock_redis[REDIS_KEYS["risk_portfolio"].format(uid="default")] = json.dumps(
            {"risk": {"var95": -1.0}, "stressTests": []}
        )

        async def _empty_matrix(symbols, days):
            import pandas as pd
            return pd.DataFrame()

        monkeypatch.setattr(portfolio_service, "_load_price_matrix", _empty_matrix)

        result = await portfolio_service.get_portfolio_optimisation()
        assert len(result.weights) > 0  # valid response, not a 500 from the risk blob
        get_settings.cache_clear()

    @pytest.mark.asyncio
    async def test_signal_scores_parse_from_redis_payload(self, monkeypatch):
        """The 0..1 uprob is rescaled to the 0..100 the BL view builder expects."""
        from api.services import portfolio_service

        async def _fake_get_json(key):
            return {"signals": [
                {"symbol": "BBCA", "uprob": 0.72},
                {"symbol": "TLKM", "uprob": 0.40},
                {"symbol": "NOPE"},  # missing uprob — skipped
            ]}

        monkeypatch.setattr(portfolio_service, "redis_get_json", _fake_get_json)
        scores = await portfolio_service._load_signal_scores()
        assert scores == {"BBCA": 72.0, "TLKM": 40.0}
