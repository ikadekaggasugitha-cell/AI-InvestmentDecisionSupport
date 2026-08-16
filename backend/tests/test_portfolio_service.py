"""
Tests for portfolio service — mock path and HTTP endpoint.
"""

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
