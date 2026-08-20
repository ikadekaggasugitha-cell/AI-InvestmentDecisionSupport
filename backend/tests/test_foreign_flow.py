"""
Tests for foreign-flow accumulation detection.

Foreign flow is the free, legal substitute for gated per-broker "bandarmology",
so it must separate the three regimes from IDX's `foreign_net` alone:
persistent net foreign buying (accumulation), net selling (distribution), and
balance (neutral) — and degrade honestly when foreign flow is unavailable.
"""

import numpy as np
import pandas as pd

from ml.features.foreign_flow import analyse_foreign_flow, foreign_flow_history


def _frame(foreign_nets, volume=1_000_000, n=None):
    """OHLCV frame with a foreign_net column (shares). `foreign_nets` per day."""
    foreign_nets = list(foreign_nets)
    rows = []
    price = 1000.0
    for i, fn in enumerate(foreign_nets):
        price *= 1.002 if fn >= 0 else 0.998
        rows.append({
            "time": pd.Timestamp("2026-01-01") + pd.Timedelta(days=i),
            "open": price, "high": price * 1.01, "low": price * 0.99,
            "close": price, "volume": int(volume), "foreign_net": fn,
        })
    return pd.DataFrame(rows)


def _accumulation_frame():
    # Steady net foreign buying every session, ~15% of a 1M-share turnover.
    return _frame([150_000] * 40)


def _distribution_frame():
    return _frame([-150_000] * 40)


def _neutral_frame():
    # Alternating tiny flows that net to ~0 over any window.
    return _frame([20_000 if i % 2 == 0 else -20_000 for i in range(40)])


class TestPhaseDetection:
    def test_accumulation_detected(self):
        r = analyse_foreign_flow(_accumulation_frame())
        assert r["available"] is True
        assert r["phase"] == "accumulation"
        assert r["score"] > 0
        assert r["netForeign5d"] > 0
        assert r["consistencyDays"] >= 3
        assert r["signals"]

    def test_distribution_detected(self):
        r = analyse_foreign_flow(_distribution_frame())
        assert r["phase"] == "distribution"
        assert r["score"] < 0
        assert r["netForeign5d"] < 0

    def test_balanced_is_neutral(self):
        r = analyse_foreign_flow(_neutral_frame())
        assert r["phase"] == "neutral"

    def test_score_is_bounded(self):
        for frame in (_accumulation_frame(), _distribution_frame(), _neutral_frame()):
            r = analyse_foreign_flow(frame)
            assert -100.0 <= r["score"] <= 100.0
            assert 0 <= r["strength"] <= 100

    def test_net_reported_in_lots(self):
        # 150k shares/day * 5 days = 750k shares = 7_500 lots.
        r = analyse_foreign_flow(_accumulation_frame())
        assert r["netForeign5d"] == 7_500


class TestAvailability:
    def test_missing_column_is_unavailable(self):
        df = _accumulation_frame().drop(columns=["foreign_net"])
        r = analyse_foreign_flow(df)
        assert r["available"] is False
        assert r["phase"] == "neutral"

    def test_all_null_foreign_is_unavailable(self):
        df = _accumulation_frame()
        df["foreign_net"] = np.nan
        r = analyse_foreign_flow(df)
        assert r["available"] is False

    def test_short_series_available_but_neutral(self):
        r = analyse_foreign_flow(_frame([100_000] * 5))
        assert r["available"] is True
        assert r["phase"] == "neutral"
        assert r["score"] == 0.0


class TestHistory:
    def test_history_shape(self):
        hist = foreign_flow_history(_accumulation_frame(), days=15)
        assert len(hist) == 15
        row = hist[-1]
        assert set(row) >= {"date", "netForeign", "cumulativeNet", "score", "phase", "close"}
        assert row["phase"] in ("accumulation", "distribution", "neutral")

    def test_history_cumulative_grows_under_accumulation(self):
        hist = foreign_flow_history(_accumulation_frame(), days=20)
        assert hist[-1]["cumulativeNet"] > hist[0]["cumulativeNet"]

    def test_history_empty_when_unavailable(self):
        df = _accumulation_frame().drop(columns=["foreign_net"])
        assert foreign_flow_history(df, days=10) == []
