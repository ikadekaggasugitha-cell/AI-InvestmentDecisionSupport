"""
Tests for signal service — mock path (seed JSON) and HTTP endpoint.
"""

import pytest
from unittest.mock import patch, AsyncMock


class TestSignalEndpoint:
    def test_get_signals_returns_200(self, client, mock_redis):
        resp = client.get("/v1/signals")
        assert resp.status_code == 200

    def test_get_signals_returns_list(self, client, mock_redis):
        resp = client.get("/v1/signals")
        data = resp.json()
        assert "signals" in data
        assert len(data["signals"]) > 0

    def test_signal_has_required_fields(self, client, mock_redis):
        resp = client.get("/v1/signals")
        signal = resp.json()["signals"][0]
        required = {"symbol", "action", "uprob", "confidence", "targetPrice"}
        assert required.issubset(set(signal.keys()))

    def test_signal_uprob_in_range(self, client, mock_redis):
        resp = client.get("/v1/signals")
        for sig in resp.json()["signals"]:
            assert 0 <= sig["uprob"] <= 100, f"uprob out of range for {sig['symbol']}"

    def test_source_is_mock(self, client, mock_redis):
        resp = client.get("/v1/signals")
        assert resp.json()["source"] == "mock"


class TestSignalService:
    @pytest.mark.asyncio
    async def test_seed_load(self, mock_redis):
        from api.services.signal_service import get_signals
        result = await get_signals()
        assert len(result.signals) >= 5

    @pytest.mark.asyncio
    async def test_cache_hit_skips_seed(self):
        import json
        from pathlib import Path
        seed = Path("api/seed/signals.json")
        if not seed.exists():
            pytest.skip("Seed file not available")

        # Field names must match SignalsResponse: generatedAt / modelVersion.
        # "computedAt" belongs to the risk model and fails validation here.
        cached_payload = json.dumps({
            "signals": [],
            "generatedAt": "2026-01-01T00:00:00Z",
            "modelVersion": "test-cache",
            "source": "mock",
        })
        mock_r = AsyncMock()
        mock_r.get.return_value = cached_payload
        # redis_get_json does `async with get_redis() as r`, so the object the
        # body actually talks to is __aenter__'s return value. Without this the
        # configured `.get` is never reached and json.loads receives a mock.
        mock_r.__aenter__.return_value = mock_r

        with patch("api.core.redis_client.get_redis", return_value=mock_r):
            from api.services.signal_service import get_signals
            result = await get_signals()
            assert result.signals == []
