"""
Endpoint tests for the Phase 10 routers.

Redis is patched out so the service layer is genuinely exercised on every call
rather than short-circuiting on a cache hit.
"""

import pytest
from unittest.mock import patch


@pytest.fixture
def no_redis():
    """Force every cache lookup to miss and every write to no-op."""
    async def _get(_key):
        return None

    async def _set(_key, _value, ttl=None):
        return None

    targets = [
        "api.services.technicals_service.redis_get_json",
        "api.services.technicals_service.redis_set_json",
        "api.services.broksum_service.redis_get_json",
        "api.services.broksum_service.redis_set_json",
    ]
    patches = [
        patch(t, _get if "get" in t else _set) for t in targets
    ]
    for p in patches:
        p.start()
    yield
    for p in patches:
        p.stop()


class TestTechnicalsEndpoint:
    def test_returns_full_analysis(self, client, no_redis):
        r = client.get("/v1/technicals/BBCA")
        assert r.status_code == 200
        body = r.json()
        assert body["symbol"] == "BBCA"
        assert body["trend"]["trend"] in {"uptrend", "downtrend", "sideways"}
        assert 0 <= body["trend"]["strength"] <= 100
        for level in body["supportResistance"]:
            assert level["type"] in {"support", "resistance"}
            assert level["price"] > 0
            assert 1 <= level["strength"] <= 5

    def test_symbol_is_case_insensitive(self, client, no_redis):
        lower = client.get("/v1/technicals/bbca").json()
        upper = client.get("/v1/technicals/BBCA").json()
        assert lower["symbol"] == upper["symbol"] == "BBCA"
        assert lower["trend"] == upper["trend"]

    def test_gap_probabilities_are_valid(self, client, no_redis):
        body = client.get("/v1/technicals/BREN").json()
        for gap in body["gaps"]:
            assert 0.0 <= gap["fillProbability"] <= 1.0
            assert gap["type"] in {"gap_up", "gap_down"}
            assert gap["top"] >= gap["bottom"]

    def test_includes_volume_accumulation_and_entry(self, client, no_redis):
        body = client.get("/v1/technicals/BBCA").json()
        # Volume intensity
        assert body["volume"]["level"] in {"high", "normal", "low"}
        assert body["volume"]["trend"] in {"rising", "falling", "flat"}
        # Volume-flow accumulation
        assert body["accumulation"]["phase"] in {"accumulation", "distribution", "neutral"}
        assert -100 <= body["accumulation"]["score"] <= 100
        # Entry signal with a reason
        assert body["entrySignal"]["signal"] in {"buy_watch", "wait", "avoid"}
        assert isinstance(body["entrySignal"]["reason"], str)
        # Trade plan shape (fields may be null when no support qualifies)
        assert "stopLoss" in body["tradePlan"]


class TestAccumulationBatchEndpoint:
    def test_returns_one_entry_per_symbol(self, client, no_redis):
        r = client.get("/v1/technicals/accumulation?symbols=BBCA,BBRI,TLKM")
        assert r.status_code == 200
        body = r.json()
        assert body["source"] == "volume"
        symbols = {it["symbol"] for it in body["items"]}
        assert symbols == {"BBCA", "BBRI", "TLKM"}
        for it in body["items"]:
            assert it["phase"] in {"accumulation", "distribution", "neutral"}
            assert -100 <= it["score"] <= 100
            assert 0 <= it["strength"] <= 100

    def test_route_is_not_captured_as_a_symbol(self, client, no_redis):
        # /accumulation must resolve to the batch route, not technicals/{symbol}.
        body = client.get("/v1/technicals/accumulation?symbols=BBCA").json()
        assert "items" in body and "trend" not in body

    def test_defaults_to_tracked_universe(self, client, no_redis):
        body = client.get("/v1/technicals/accumulation").json()
        assert len(body["items"]) > 0


class TestOHLCVEndpoint:
    def test_returns_requested_window(self, client, no_redis):
        r = client.get("/v1/technicals/BBCA/ohlcv?days=60")
        assert r.status_code == 200
        candles = r.json()["candles"]
        assert len(candles) == 60

    def test_candles_are_ordered_and_coherent(self, client, no_redis):
        candles = client.get("/v1/technicals/BBCA/ohlcv?days=40").json()["candles"]
        dates = [c["time"] for c in candles]
        assert dates == sorted(dates), "candles must be oldest-first for the chart"
        for c in candles:
            assert c["low"] <= c["open"] <= c["high"]
            assert c["low"] <= c["close"] <= c["high"]
            assert c["volume"] > 0

    def test_shorter_window_is_a_suffix_of_the_longer_one(self, client, no_redis):
        """
        The chart and the S/R levels beside it are computed from different
        window lengths. If those windows disagree the lines would not line up
        with the candles.
        """
        long = client.get("/v1/technicals/BBCA/ohlcv?days=120").json()["candles"]
        short = client.get("/v1/technicals/BBCA/ohlcv?days=40").json()["candles"]
        assert long[-40:] == short

    @pytest.mark.parametrize("days", [5, 500])
    def test_out_of_range_window_rejected(self, client, no_redis, days):
        assert client.get(f"/v1/technicals/BBCA/ohlcv?days={days}").status_code == 422


class TestBroksumEndpoint:
    def test_returns_snapshot_and_brokers(self, client, no_redis):
        r = client.get("/v1/broksum/BBCA")
        assert r.status_code == 200
        body = r.json()
        assert body["symbol"] == "BBCA"
        assert body["source"] == "mock"
        snap = body["snapshot"]
        assert snap["phase"] in {"accumulation", "distribution", "neutral"}
        assert -100 <= snap["score"] <= 100
        assert 0.0 <= snap["concentration"] <= 1.0

    def test_mock_source_is_labelled(self, client, no_redis):
        """
        Simulated broker activity must be identifiable as such. The codes name
        real securities firms, and presenting invented flow as observed would
        misrepresent their trading.
        """
        assert client.get("/v1/broksum/BBCA").json()["source"] == "mock"

    def test_top_buyers_outrank_top_sellers(self, client, no_redis):
        snap = client.get("/v1/broksum/BBCA").json()["snapshot"]
        if snap["topBuyers"] and snap["topSellers"]:
            assert snap["topBuyers"][0]["netLot5d"] >= snap["topSellers"][0]["netLot5d"]

    def test_history_is_chronological(self, client, no_redis):
        r = client.get("/v1/broksum/BBCA/history?days=15")
        assert r.status_code == 200
        history = r.json()["history"]
        dates = [d["date"] for d in history]
        assert dates == sorted(dates)

    @pytest.mark.parametrize("days", [0, 400])
    def test_out_of_range_history_rejected(self, client, no_redis, days):
        assert client.get(f"/v1/broksum/BBCA/history?days={days}").status_code == 422


class TestSignalsContractUnchanged:
    def test_existing_signals_endpoint_still_validates(self, client, mock_redis):
        """
        Every Phase 10 field on AISignal is optional. Seed data predates them
        and must keep deserialising untouched.
        """
        r = client.get("/v1/signals")
        assert r.status_code == 200
        signals = r.json()["signals"]
        assert signals
        for s in signals:
            assert s["tradePlan"] is None
            assert s["technicalNote"] == ""
            assert s["supportResistance"] == []
            assert s["openGaps"] == []
