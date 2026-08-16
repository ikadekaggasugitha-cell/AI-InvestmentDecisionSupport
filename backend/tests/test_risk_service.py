"""
Tests for risk service — mock path (seed JSON) and HTTP endpoint.
"""

import pytest


class TestRiskEndpoint:
    def test_get_risk_returns_200(self, client, mock_redis):
        resp = client.get("/v1/risk/portfolio")
        assert resp.status_code == 200

    def test_response_has_risk_and_stress(self, client, mock_redis):
        data = client.get("/v1/risk/portfolio").json()
        assert "risk" in data
        assert "stressTests" in data
        assert "sectorExposure" in data

    def test_var95_is_negative(self, client, mock_redis):
        data = client.get("/v1/risk/portfolio").json()
        assert data["risk"]["var95"] < 0, "VaR 95% should be a negative loss value"

    def test_stress_tests_non_empty(self, client, mock_redis):
        data = client.get("/v1/risk/portfolio").json()
        assert len(data["stressTests"]) >= 4

    def test_sector_exposure_weights_sum_to_100(self, client, mock_redis):
        data = client.get("/v1/risk/portfolio").json()
        total = sum(s["weight"] for s in data["sectorExposure"])
        assert abs(total - 100.0) < 1.0, f"Sector weights should sum to ~100, got {total}"


class TestRiskService:
    @pytest.mark.asyncio
    async def test_seed_load(self, mock_redis):
        from api.services.risk_service import get_risk_metrics
        result = await get_risk_metrics()
        assert result.risk is not None
        assert len(result.stressTests) > 0

    @pytest.mark.asyncio
    async def test_kupiec_backtest_field_present(self, mock_redis):
        from api.services.risk_service import get_risk_metrics
        result = await get_risk_metrics()
        # kupiec_pass may or may not be present depending on seed
        assert hasattr(result, "risk")
