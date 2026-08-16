"""
Point-in-time guarantees for the training matrix.

These tests exist because the first attempt at these features leaked: one
scalar per symbol, computed from the entire history, broadcast onto every row.
Training scores looked excellent and meant nothing.

The property that matters is simple to state and easy to break by accident:
**a feature value on date D must not change when data after D changes.** The
tests below check exactly that, rather than checking that particular numbers
come out — a formula can be right and still be leaky.
"""

from datetime import timedelta

import numpy as np
import pandas as pd
import pytest

from ml.features.point_in_time import (
    FEATURE_COLUMNS,
    LABEL_COLUMN,
    LABEL_HORIZON,
    build_point_in_time_features,
    walk_forward_splits,
)


def _bars(symbols: list[str], n: int = 160, seed: int = 7) -> pd.DataFrame:
    """Synthetic daily bars with every column the builder can use."""
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2025-01-01")
    rows = []
    for s_i, sym in enumerate(symbols):
        price = 1000.0 * (s_i + 1)
        for i in range(n):
            price *= 1 + rng.normal(0.0004, 0.018)
            vol = int(rng.uniform(1e6, 8e6))
            rows.append({
                "symbol": sym,
                "date": start + timedelta(days=i),
                "open": price * 0.997,
                "high": price * 1.012,
                "low": price * 0.988,
                "close": price,
                "volume": vol,
                "foreign_net": int(rng.normal(0, 3e5)),
                "value_idr": price * vol,
                "listed_shares": int(1e10 * (s_i + 1)),
                "frequency": int(rng.uniform(500, 9000)),
            })
    return pd.DataFrame(rows)


class TestNoLookAhead:
    def test_features_do_not_change_when_the_future_changes(self):
        """
        The core property. Build features on the full series, then rebuild on a
        truncated one, and compare the overlapping rows. Any difference means a
        value on an early date depended on a later date.
        """
        full = _bars(["AAA", "BBB"], n=160)
        cutoff = full["date"].sort_values().unique()[100]
        truncated = full[full["date"] <= cutoff]

        feats_full = build_point_in_time_features(full)
        feats_trunc = build_point_in_time_features(truncated)

        # Compare only rows the truncated build could legitimately produce:
        # its final LABEL_HORIZON rows have no label and are dropped.
        common = feats_trunc["date"].max()
        a = feats_full[feats_full["date"] <= common].sort_values(["symbol", "date"])
        b = feats_trunc[feats_trunc["date"] <= common].sort_values(["symbol", "date"])

        assert len(a) == len(b), "row counts diverge on the overlapping window"

        for col in FEATURE_COLUMNS:
            left = a[col].to_numpy(dtype=float)
            right = b[col].to_numpy(dtype=float)
            same = np.allclose(left, right, equal_nan=True, rtol=1e-9, atol=1e-12)
            assert same, f"{col} changed when future data was added — look-ahead leak"

    def test_features_vary_within_a_symbol(self):
        """
        The original bug produced one constant per symbol. A constant column
        carries no timing information and lets the tree memorise symbol
        identity, so this asserts the shape of that failure cannot return.
        """
        feats = build_point_in_time_features(_bars(["AAA", "BBB"], n=160))

        for sym, g in feats.groupby("symbol"):
            varying = [c for c in FEATURE_COLUMNS if g[c].nunique(dropna=True) > 1]
            assert len(varying) >= len(FEATURE_COLUMNS) - 2, (
                f"{sym}: only {len(varying)}/{len(FEATURE_COLUMNS)} features vary — "
                "constant-per-symbol is the broadcast bug"
            )

    def test_label_looks_forward_by_exactly_the_horizon(self):
        bars = _bars(["AAA"], n=60)
        feats = build_point_in_time_features(bars)

        closes = bars.set_index("date")["close"]
        row = feats.iloc[10]
        future_date = row["date"] + timedelta(days=LABEL_HORIZON)
        expected = int(closes.loc[future_date] > closes.loc[row["date"]])
        assert row[LABEL_COLUMN] == expected

    def test_unscoreable_tail_is_dropped(self):
        """The last LABEL_HORIZON sessions have no future to score against."""
        bars = _bars(["AAA"], n=60)
        feats = build_point_in_time_features(bars)
        assert feats["date"].max() <= bars["date"].max() - timedelta(days=LABEL_HORIZON)

    def test_label_is_not_a_feature(self):
        assert LABEL_COLUMN not in FEATURE_COLUMNS


class TestCrossSectional:
    def test_ranks_are_computed_within_a_date(self):
        """
        Ranking the pooled column would compare today's move against next
        year's. Within a date, ranks must span roughly 0..1 across symbols.
        """
        feats = build_point_in_time_features(_bars([f"S{i}" for i in range(12)], n=120))
        sample = feats[feats["date"] == feats["date"].max()]
        ranks = sample["xs_ret_20d_rank"].dropna()

        assert len(ranks) >= 10
        assert ranks.min() >= 0.0 and ranks.max() <= 1.0
        assert ranks.max() - ranks.min() > 0.5, "ranks do not span the cross-section"

    def test_rank_is_relative_not_absolute(self):
        """A rank should reflect ordering, so it is scale-free across symbols."""
        feats = build_point_in_time_features(_bars(["AAA", "BBB", "CCC"], n=120))
        per_date = feats.groupby("date")["xs_ret_20d_rank"].nunique()
        assert (per_date > 1).any(), "every symbol got the same rank on some date"


class TestForeignFlow:
    def test_missing_foreign_flow_stays_nan(self):
        """
        NaN means "IDX did not report"; 0.0 means "no net foreign trading".
        Collapsing them hides a real distinction from the model.
        """
        bars = _bars(["AAA"], n=80).drop(columns=["foreign_net"])
        feats = build_point_in_time_features(bars)
        assert feats["foreign_net_ratio_5d"].isna().all()

    def test_foreign_flow_is_scaled_by_volume(self):
        """Absolute flow would mostly encode company size."""
        feats = build_point_in_time_features(_bars(["AAA"], n=120))
        ratios = feats["foreign_net_ratio_1d"].dropna()
        assert (ratios.abs() < 5).all(), "ratio should be a share of volume, not raw shares"


class TestWalkForward:
    def test_train_always_precedes_test(self):
        feats = build_point_in_time_features(_bars(["AAA", "BBB"], n=200))
        splits = walk_forward_splits(feats, n_splits=3)

        assert len(splits) >= 2
        for train, test in splits:
            assert train["date"].max() < test["date"].min(), "train overlaps test in time"

    def test_embargo_gap_covers_the_label_horizon(self):
        """
        Without the gap, the last training rows carry labels that reach into the
        test window — the model is scored on outcomes it was partly trained on.
        """
        feats = build_point_in_time_features(_bars(["AAA", "BBB"], n=200))
        for train, test in walk_forward_splits(feats, n_splits=3, embargo_days=LABEL_HORIZON):
            gap_days = (test["date"].min() - train["date"].max()).days
            assert gap_days > LABEL_HORIZON, f"embargo only {gap_days}d"

    def test_training_window_expands(self):
        feats = build_point_in_time_features(_bars(["AAA"], n=240))
        splits = walk_forward_splits(feats, n_splits=3)
        sizes = [len(tr) for tr, _ in splits]
        assert sizes == sorted(sizes), "expanding window should not shrink"

    def test_empty_input_is_safe(self):
        assert walk_forward_splits(pd.DataFrame()) == []


class TestSchema:
    def test_output_columns_are_exactly_as_declared(self):
        feats = build_point_in_time_features(_bars(["AAA"], n=100))
        assert list(feats.columns) == ["symbol", "date", *FEATURE_COLUMNS, LABEL_COLUMN]

    def test_empty_input_returns_the_declared_shape(self):
        out = build_point_in_time_features(pd.DataFrame())
        assert list(out.columns) == ["symbol", "date", *FEATURE_COLUMNS, LABEL_COLUMN]
        assert out.empty

    def test_label_is_binary(self):
        feats = build_point_in_time_features(_bars(["AAA", "BBB"], n=120))
        assert set(feats[LABEL_COLUMN].unique()) <= {0, 1}
