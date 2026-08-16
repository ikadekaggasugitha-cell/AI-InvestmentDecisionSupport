"""
Price action engine tests — Phase 10.

Focused on the defects fixed in this phase rather than on broad coverage:
  * gap fill probability must not be biased by a truncated observation window
  * sr_distance features must never be negative
  * S/R clustering must not merge levels that span more than the tolerance
"""

import pandas as pd
import pytest

from ml.features.price_action import PriceActionAnalyzer, _cluster_levels


def _series(closes: list[float], gaps: dict[int, float] | None = None) -> pd.DataFrame:
    """
    Build a daily OHLCV frame from a list of closes.

    `gaps` maps a bar index to an overnight gap fraction applied to that bar's
    open, so a test can plant a gap at a known position.
    """
    gaps = gaps or {}
    rows = []
    prev = closes[0]
    for i, close in enumerate(closes):
        open_ = prev * (1 + gaps.get(i, 0.0))
        rows.append({
            "time": pd.Timestamp("2025-01-01") + pd.Timedelta(days=i),
            "open": open_,
            "high": max(open_, close) * 1.002,
            "low": min(open_, close) * 0.998,
            "close": close,
            "volume": 1_000_000,
        })
        prev = close
    return pd.DataFrame(rows)


def _bars(rows: list[tuple[float, float, float, float]]) -> pd.DataFrame:
    """Build a frame from explicit (open, high, low, close) tuples."""
    return pd.DataFrame([
        {
            "time": pd.Timestamp("2025-01-01") + pd.Timedelta(days=i),
            "open": o, "high": h, "low": l, "close": c, "volume": 1_000_000,
        }
        for i, (o, h, l, c) in enumerate(rows)
    ])


def _series_with_slow_fills(
    n: int,
    old_gap_bars: list[int],
    recent_gap_bars: list[int],
    fill_delay: int = 12,
) -> pd.DataFrame:
    """
    Build a series where a gap up takes `fill_delay` bars to fill.

    Gaps at `old_gap_bars` are followed by enough bars to pull back and fill.
    Gaps at `recent_gap_bars` sit too close to the end to resolve — price keeps
    climbing away from them. This is the shape that separates a censored
    estimator from one that scores unresolved samples as failures.
    """
    base = 100.0
    rows: list[tuple[float, float, float, float]] = []
    prev_close = base
    pending: list[tuple[int, float]] = []  # (fill_due_bar, target_price)

    for i in range(n):
        gap_up = i in old_gap_bars or i in recent_gap_bars
        if gap_up:
            prev_high = prev_close * 1.001
            open_ = prev_close * 1.03          # clears the 1% threshold
            close = open_ * 1.002               # holds the gap open
            if i in old_gap_bars:
                pending.append((i + fill_delay, prev_high))
        elif pending and i >= pending[0][0]:
            # Pull back through the oldest open gap to fill it.
            _, target = pending.pop(0)
            open_ = prev_close
            close = target * 0.995
        else:
            open_ = prev_close
            close = prev_close * 1.001          # gentle drift, never fills a gap

        high = max(open_, close) * 1.001
        low = min(open_, close) * 0.999
        rows.append((open_, high, low, close))
        prev_close = close

    return _bars(rows)


class TestGapFillProbability:
    def test_recent_unresolved_gaps_do_not_drag_probability_down(self):
        """
        A gap that opened shortly before the reference gap has had almost no
        time to fill. Counting it as "never filled" biases the estimate toward
        zero, and the bias is worst for the samples nearest the reference —
        precisely where they cluster. Censoring those samples is the fix.

        Here four old gaps all fill and three recent ones cannot. A censored
        estimator reports 4/4; one that scores unresolved samples as failures
        reports 4/7.
        """
        analyzer = PriceActionAnalyzer()
        df = _series_with_slow_fills(
            n=120,
            old_gap_bars=[20, 40, 60, 80],
            recent_gap_bars=[112, 115, 118],
        )

        prob = analyzer._compute_fill_probability(
            df, gap_idx=119, gap_pct=3.0, gap_type="gap_up"
        )

        # 4-of-4 with Laplace smoothing → 5/6 ≈ 0.833. Without censoring the
        # three unresolved gaps enter the denominator: 5/9 ≈ 0.556.
        assert prob > 0.75, (
            f"censoring failed — probability dragged to {prob:.3f} by gaps that "
            "had no window in which to fill"
        )

    def test_certainty_is_never_reported_from_a_thin_sample(self):
        """
        A raw ratio turns 3-of-3 into "100% historical fill probability", which
        is rendered to users as a factual claim. Smoothing keeps a thin sample
        from reading as certainty.
        """
        analyzer = PriceActionAnalyzer()
        df = _series_with_slow_fills(
            n=120, old_gap_bars=[20, 40, 60, 80], recent_gap_bars=[]
        )
        prob = analyzer._compute_fill_probability(
            df, gap_idx=119, gap_pct=3.0, gap_type="gap_up"
        )
        assert prob < 1.0, "a handful of observations must not report certainty"

    def test_insufficient_sample_returns_neutral_default(self):
        analyzer = PriceActionAnalyzer()
        df = _series([100.0] * 40)
        prob = analyzer._compute_fill_probability(df, gap_idx=39, gap_pct=2.0, gap_type="gap_up")
        assert prob == 0.75

    def test_probability_is_a_valid_probability(self):
        analyzer = PriceActionAnalyzer()
        closes = [100 + (i % 7) for i in range(200)]
        df = _series(closes, {i: 0.015 for i in range(20, 180, 15)})
        prob = analyzer._compute_fill_probability(df, gap_idx=199, gap_pct=1.5, gap_type="gap_up")
        assert 0.0 <= prob <= 1.0


class TestSupportResistanceDistances:
    def test_distances_are_never_negative(self):
        """
        A negative "distance to support" silently means support is ABOVE price
        — the opposite of what the feature name claims, and indistinguishable
        from a genuine reading to the consumer.
        """
        analyzer = PriceActionAnalyzer()
        # Strong uptrend: every fractal low sits below the final price, and
        # there is no resistance above it.
        closes = [100 + i * 0.8 for i in range(150)]
        feats = analyzer.compute_features(_series(closes))

        assert feats["sr_distance_support"] >= 0.0
        assert feats["sr_distance_resistance"] >= 0.0

    def test_absent_level_reports_zero_not_wrong_side(self):
        analyzer = PriceActionAnalyzer()
        closes = [100 - i * 0.7 for i in range(150)]  # downtrend: no support below
        feats = analyzer.compute_features(_series(closes))

        assert feats["sr_distance_support"] >= 0.0
        assert feats["sr_distance_resistance"] >= 0.0

    def test_feature_keys_are_stable(self):
        analyzer = PriceActionAnalyzer()
        feats = analyzer.compute_features(_series([100 + (i % 5) for i in range(80)]))
        assert set(feats) == {
            "trend_direction", "trend_strength",
            "sr_distance_support", "sr_distance_resistance",
            "candlestick_signal", "gap_unfilled_pct",
        }


class TestClusterLevels:
    def test_cluster_span_is_bounded_by_tolerance(self):
        """
        Measuring against a running mean lets a chain of individually-close
        prices drift arbitrarily far, merging distinct levels into one.
        """
        # Each price is within 1% of the previous, but the chain spans ~10%.
        prices = [100.0, 100.9, 101.8, 102.7, 103.6, 104.5, 105.5, 106.5, 107.6, 108.7]
        clusters = _cluster_levels(prices, tolerance_pct=1.0)

        assert len(clusters) > 1, "drifting chain collapsed into a single cluster"

    def test_genuinely_close_prices_cluster_together(self):
        clusters = _cluster_levels([100.0, 100.2, 100.4, 200.0, 200.3], tolerance_pct=1.0)
        counts = sorted(c[1] for c in clusters)
        assert counts == [2, 3]

    def test_empty_input(self):
        assert _cluster_levels([]) == []


class TestTrendDetection:
    @pytest.mark.parametrize(
        "closes,expected",
        [
            ([100 + i * 1.2 for i in range(80)], "uptrend"),
            ([200 - i * 1.2 for i in range(80)], "downtrend"),
        ],
    )
    def test_directional_series(self, closes, expected):
        analyzer = PriceActionAnalyzer()
        assert analyzer.detect_trend(_series(closes))["trend"] == expected

    def test_short_series_is_sideways(self):
        analyzer = PriceActionAnalyzer()
        result = analyzer.detect_trend(_series([100.0] * 10))
        assert result["trend"] == "sideways"
        assert result["strength"] == 0
