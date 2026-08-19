"""
Feature-drift monitoring tests.

drift_detector.py was dead code — defined but never called — so its behaviour
was never asserted. It is now wired into workers.monitoring_worker.check_drift
(weekly beat). These tests pin the detector maths and the worker's degrade
paths so the wiring cannot rot back into a no-op.
"""

import numpy as np
import pandas as pd

from ml.monitoring.drift_detector import (
    PSI_THRESHOLD_RETRAIN,
    check_feature_drift,
    compute_psi,
)


class TestComputePSI:
    def test_identical_distributions_score_near_zero(self):
        rng = np.random.default_rng(0)
        x = rng.normal(size=5000)
        assert compute_psi(x, x.copy()) < 0.01

    def test_shifted_distribution_crosses_retrain_threshold(self):
        rng = np.random.default_rng(1)
        ref = rng.normal(0, 1, size=5000)
        shifted = rng.normal(2, 1, size=5000)  # mean shifted by 2σ
        assert compute_psi(ref, shifted) > PSI_THRESHOLD_RETRAIN

    def test_psi_is_non_negative(self):
        rng = np.random.default_rng(2)
        ref = rng.normal(size=2000)
        cur = rng.normal(0.3, 1.2, size=2000)
        assert compute_psi(ref, cur) >= 0.0


class TestCheckFeatureDrift:
    def _frames(self, shift: float):
        rng = np.random.default_rng(3)
        cols = ["ret_5d", "vol_20d", "rsi_14"]
        ref = pd.DataFrame({c: rng.normal(size=1000) for c in cols})
        cur = pd.DataFrame({c: rng.normal(shift, 1, size=200) for c in cols})
        return ref, cur, cols

    def test_stable_when_distributions_match(self):
        ref, cur, cols = self._frames(shift=0.0)
        result = check_feature_drift(ref, cur, cols)
        assert result["needs_retraining"] is False
        assert set(result) >= {"psi", "drifted_features", "needs_retraining", "max_psi"}

    def test_flags_retraining_on_large_shift(self):
        ref, cur, cols = self._frames(shift=3.0)
        result = check_feature_drift(ref, cur, cols)
        assert result["needs_retraining"] is True
        assert result["max_psi"] > PSI_THRESHOLD_RETRAIN

    def test_ignores_features_absent_from_a_frame(self):
        ref, cur, cols = self._frames(shift=0.0)
        result = check_feature_drift(ref, cur, [*cols, "not_a_column"])
        assert "not_a_column" not in result["psi"]

    def test_skips_features_with_too_few_samples(self):
        ref = pd.DataFrame({"x": np.arange(1000.0)})
        cur = pd.DataFrame({"x": np.arange(5.0)})  # < 10 current rows
        result = check_feature_drift(ref, cur, ["x"])
        assert "x" not in result["psi"]


class TestFeatureBaseline:
    def test_baseline_is_capped_and_keyed_by_feature(self):
        from ml.training.train_signals_v2 import (
            BASELINE_SAMPLE_PER_FEATURE,
            FEATURE_COLUMNS,
            _build_feature_baseline,
        )

        n = BASELINE_SAMPLE_PER_FEATURE + 500
        rng = np.random.default_rng(4)
        df = pd.DataFrame({c: rng.normal(size=n) for c in FEATURE_COLUMNS})
        baseline = _build_feature_baseline(df)

        assert set(baseline) == set(FEATURE_COLUMNS)
        for values in baseline.values():
            assert len(values) == BASELINE_SAMPLE_PER_FEATURE

    def test_baseline_drops_nan_and_survives_short_columns(self):
        from ml.training.train_signals_v2 import _build_feature_baseline

        df = pd.DataFrame({"ret_5d": [1.0, np.nan, 2.0, np.nan, 3.0]})
        baseline = _build_feature_baseline(df)
        assert baseline["ret_5d"] == [1.0, 2.0, 3.0]


class TestCheckDriftTask:
    def test_skips_in_mock_mode(self):
        # conftest exports USE_MOCK_SIGNALS=true, so the task must short-circuit
        # before touching a model or the database.
        from workers.monitoring_worker import check_drift

        result = check_drift.apply().get()
        assert result["status"] == "skipped"
        assert result["reason"] == "use_mock_signals=true"
