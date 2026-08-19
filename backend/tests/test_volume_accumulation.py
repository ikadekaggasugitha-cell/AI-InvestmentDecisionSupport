"""
Tests for volume-based accumulation detection.

This is the real substitute for gated broker-summary flow, so it needs to
correctly separate the three regimes from OHLCV alone: buying pressure
(accumulation), selling pressure (distribution), and balance (neutral).
"""

import numpy as np
import pandas as pd

from ml.features.volume_accumulation import (
    analyse_accumulation,
    accumulation_history,
)


def _series(closes, volume_bias="flat", n_pad=40):
    """Build an OHLCV frame; volume_bias skews volume toward up or down days."""
    closes = list(closes)
    rows = []
    prev = closes[0]
    for i, c in enumerate(closes):
        up = c >= prev
        base_vol = 1_000_000
        if volume_bias == "up":
            vol = base_vol * (2.2 if up else 0.5)
        elif volume_bias == "down":
            vol = base_vol * (0.5 if up else 2.2)
        else:
            vol = base_vol
        high = max(c, prev) * 1.01
        low = min(c, prev) * 0.99
        # Close near the high on accumulation days, near the low on distribution.
        rows.append({
            "time": pd.Timestamp("2026-01-01") + pd.Timedelta(days=i),
            "open": prev, "high": high, "low": low, "close": c, "volume": int(vol),
        })
        prev = c
    return pd.DataFrame(rows)


def _accumulation_frame():
    # Steady climb with heavier volume on up days → accumulation footprint.
    closes = list(np.linspace(1000, 1300, 60))
    return _series(closes, volume_bias="up")


def _distribution_frame():
    closes = list(np.linspace(1300, 1000, 60))
    return _series(closes, volume_bias="down")


def _flat_frame():
    # Symmetric oscillation with flat volume: up days and down days cancel, so
    # money flow nets to ~0 and the read should be neutral.
    closes = [1000.0 if i % 2 == 0 else 1010.0 for i in range(60)]
    return _series(closes, volume_bias="flat")


class TestPhaseDetection:
    def test_accumulation_detected(self):
        r = analyse_accumulation(_accumulation_frame())
        assert r["phase"] == "accumulation"
        assert r["score"] > 0
        assert r["cmf"] > 0
        assert r["signals"]  # has human-readable reasons

    def test_distribution_detected(self):
        r = analyse_accumulation(_distribution_frame())
        assert r["phase"] == "distribution"
        assert r["score"] < 0
        assert r["cmf"] < 0

    def test_flat_is_neutral(self):
        r = analyse_accumulation(_flat_frame())
        assert r["phase"] == "neutral"

    def test_short_series_is_neutral_empty(self):
        r = analyse_accumulation(_series(list(range(1000, 1010))))
        assert r["phase"] == "neutral"
        assert r["score"] == 0.0
        assert r["signals"] == []

    def test_score_is_bounded(self):
        for frame in (_accumulation_frame(), _distribution_frame(), _flat_frame()):
            r = analyse_accumulation(frame)
            assert -100.0 <= r["score"] <= 100.0
            assert 0 <= r["strength"] <= 100


class TestHistory:
    def test_history_length_and_shape(self):
        hist = accumulation_history(_accumulation_frame(), days=15)
        assert len(hist) == 15
        row = hist[-1]
        assert set(row) >= {"date", "score", "phase", "volume", "close"}
        assert row["phase"] in ("accumulation", "distribution", "neutral")

    def test_history_reflects_accumulation(self):
        hist = accumulation_history(_accumulation_frame(), days=20)
        acc_days = sum(1 for h in hist if h["phase"] == "accumulation")
        assert acc_days >= len(hist) // 2  # the up-volume regime dominates

    def test_history_empty_on_short_series(self):
        assert accumulation_history(_series(list(range(1000, 1005))), days=10) == []
