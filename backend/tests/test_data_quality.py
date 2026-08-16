"""
Data-quality guarantees: reconciliation, universe selection, VaR sign.

These encode decisions that are easy to reverse by accident — a tolerance
loosened to make a run pass, a sign flipped back, a liquidity floor removed.
"""

from datetime import date

import numpy as np
import pandas as pd
import pytest

from ingestor.reconcile import reconcile_closes
from ml.features.universe import select_universe_from_frame
from ml.inference.risk_engine import _historical_var_cvar


class TestReconciliation:
    def test_identical_closes_pass(self):
        rep = reconcile_closes(
            date(2026, 8, 14), {"BBCA": 6350.0, "TLKM": 2620.0},
            {"BBCA": 6350.0, "TLKM": 2620.0},
        )
        assert rep.passed
        assert rep.matched == 2
        assert rep.match_rate == 1.0

    def test_rounding_difference_is_tolerated(self):
        """Both feeds report the same print; a tick-grid rounding gap is not a fault."""
        rep = reconcile_closes(
            date(2026, 8, 14), {"BBCA": 6350.0}, {"BBCA": 6355.0}, tolerance_pct=0.5
        )
        assert rep.passed

    def test_real_disagreement_fails(self):
        """
        A 10% gap means one feed is wrong. Letting it through would put a bad
        price into support levels, stop losses and model features alike.
        """
        rep = reconcile_closes(
            date(2026, 8, 14), {"BBCA": 6350.0}, {"BBCA": 7000.0}, tolerance_pct=0.5
        )
        assert not rep.passed
        assert len(rep.discrepancies) == 1
        assert rep.discrepancies[0].diff_pct == pytest.approx(10.236, abs=0.01)

    def test_coverage_gap_is_not_a_failure(self):
        """
        Yahoo does not cover the whole IDX board. A symbol in one feed only is
        reported, not treated as corruption.
        """
        rep = reconcile_closes(
            date(2026, 8, 14), {"BBCA": 6350.0, "OBSCURE": 100.0}, {"BBCA": 6350.0}
        )
        assert rep.passed
        assert rep.only_idx == ["OBSCURE"]

    def test_zero_idx_price_is_a_discrepancy(self):
        rep = reconcile_closes(date(2026, 8, 14), {"BBCA": 0.0}, {"BBCA": 6350.0})
        assert not rep.passed

    def test_no_overlap_does_not_pass(self):
        """Comparing nothing is not the same as agreeing."""
        rep = reconcile_closes(date(2026, 8, 14), {"AAA": 1.0}, {"BBB": 1.0})
        assert rep.compared == 0
        assert not rep.passed

    def test_summary_names_the_worst_offenders(self):
        rep = reconcile_closes(
            date(2026, 8, 14),
            {"AAA": 100.0, "BBB": 100.0},
            {"AAA": 100.0, "BBB": 150.0},
        )
        assert "BBB" in rep.summary()


class TestUniverseSelection:
    def _frame(self, spec: dict[str, list[float]]) -> pd.DataFrame:
        rows = []
        for symbol, values in spec.items():
            for i, v in enumerate(values):
                rows.append({
                    "symbol": symbol,
                    "date": pd.Timestamp("2026-01-01") + pd.Timedelta(days=i),
                    "value_idr": v,
                })
        return pd.DataFrame(rows)

    def test_ranks_by_median_traded_value(self):
        frame = self._frame({
            "BIG":  [100e9] * 200,
            "MID":  [20e9] * 200,
            "SMALL": [1e9] * 200,
        })
        picked = select_universe_from_frame(frame, size=2, min_median_value=0, min_sessions=100)
        assert picked == ["BIG", "MID"]

    def test_median_resists_a_single_block_trade(self):
        """
        Mean would promote a dormant counter on one crossing. The whole point of
        the liquidity filter is to exclude names whose flat prices teach the
        model that nothing moves.
        """
        frame = self._frame({
            "STEADY":  [10e9] * 200,
            "DORMANT": [1e6] * 199 + [5000e9],  # one enormous block
        })
        assert np.mean(frame[frame.symbol == "DORMANT"]["value_idr"]) > 10e9

        picked = select_universe_from_frame(frame, size=1, min_median_value=0, min_sessions=100)
        assert picked == ["STEADY"]

    def test_liquidity_floor_excludes_thin_names(self):
        frame = self._frame({"THIN": [1e6] * 200, "LIQUID": [50e9] * 200})
        picked = select_universe_from_frame(
            frame, size=10, min_median_value=5e9, min_sessions=100
        )
        assert picked == ["LIQUID"]

    def test_recent_listing_excluded_for_short_history(self):
        """A name with 10 sessions gives the model a mostly-NaN column."""
        frame = self._frame({"OLD": [10e9] * 200, "NEW": [99e9] * 10})
        picked = select_universe_from_frame(
            frame, size=10, min_median_value=0, min_sessions=100
        )
        assert picked == ["OLD"]

    def test_empty_frame_returns_empty(self):
        assert select_universe_from_frame(pd.DataFrame(), 45, 0, 1) == []

    def test_missing_value_column_returns_empty(self):
        frame = pd.DataFrame({"symbol": ["A"], "close": [1.0]})
        assert select_universe_from_frame(frame, 45, 0, 1) == []


class TestVarSignConvention:
    """
    Losses are negative throughout the API so they compose with P&L. The UI
    renders the magnitude. Reversing this silently breaks every threshold
    comparison downstream.
    """

    def test_var_and_cvar_are_negative(self):
        returns = np.array([-0.05, -0.03, -0.01, 0.0, 0.01, 0.02, 0.03, -0.08, 0.015, -0.02])
        var, cvar = _historical_var_cvar(returns, confidence=0.95, portfolio_value=1_000_000)
        assert var < 0
        assert cvar < 0

    def test_cvar_is_at_least_as_severe_as_var(self):
        returns = np.random.default_rng(42).normal(0, 0.02, 500)
        var, cvar = _historical_var_cvar(returns, 0.95, 1_000_000)
        assert cvar <= var, "expected shortfall cannot be milder than VaR"

    def test_all_positive_returns_still_yield_negative_var(self):
        """
        On a series with no losing day the empirical quantile is positive. A
        'positive VaR' would read as a guaranteed gain.
        """
        var, cvar = _historical_var_cvar(np.array([0.01] * 100), 0.95, 1_000_000)
        assert var <= 0
        assert cvar <= 0

    def test_scales_with_portfolio_value(self):
        returns = np.array([-0.10] * 50 + [0.05] * 50)
        small, _ = _historical_var_cvar(returns, 0.95, 1_000.0)
        large, _ = _historical_var_cvar(returns, 0.95, 1_000_000.0)
        assert large == pytest.approx(small * 1000)

    def test_empty_series_is_zero_not_a_crash(self):
        assert _historical_var_cvar(np.array([]), 0.95, 1_000.0) == (0.0, 0.0)

    def test_seed_data_follows_the_convention(self):
        """The seed is served in mock mode and must not contradict the model."""
        import json
        from pathlib import Path

        seed = json.loads(
            (Path(__file__).parent.parent / "api" / "seed" / "risk.json").read_text()
        )
        assert seed["risk"]["var95"] < 0
        assert seed["risk"]["cvar95"] < 0
