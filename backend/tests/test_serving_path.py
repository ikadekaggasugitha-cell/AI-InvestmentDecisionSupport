"""
Serving-path guarantees.

Each test here pins a bug found while wiring the trained model into the API.
All three were silent: none raised, and two of them would have shipped
plausible-looking numbers that were wrong.
"""

import numpy as np
import pandas as pd
import pytest

from ml.inference.signal_inference import SHAP_DISPLAY, _uprob_to_tier

# Tier order from least to most bullish, used to assert monotonicity.
_TIER_ORDER = {"LOW": 0, "NEUTRAL": 1, "HIGH": 2, "VERY_HIGH": 3}
_ALL_TIERS = set(_TIER_ORDER)


class TestProbabilityTierBands:
    """
    Fixed thresholds assumed predictions centre on 50%. The trained model's
    base rate is 38.65%, its outputs clustered near 20%, and every one of the
    fifteen tracked symbols came out LOW — permanently.
    """

    def test_base_rate_maps_to_neutral(self):
        for base in (0.30, 0.3865, 0.50, 0.65):
            assert _uprob_to_tier(int(base * 100), base) == "NEUTRAL", base

    def test_a_low_base_rate_model_can_still_reach_high(self):
        """The regression: with base 0.3865 nothing reached the old 65 cutoff."""
        assert _uprob_to_tier(60, 0.3865) == "HIGH"
        assert _uprob_to_tier(80, 0.3865) == "VERY_HIGH"

    def test_bands_are_ordered(self):
        base = 0.3865
        seen = [_uprob_to_tier(p, base) for p in range(0, 101)]
        ranks = [_TIER_ORDER[a] for a in seen]
        assert ranks == sorted(ranks), "tier must not become less bullish as uprob rises"

    def test_all_four_tiers_are_reachable(self):
        for base in (0.30, 0.3865, 0.50, 0.60):
            tiers = {_uprob_to_tier(p, base) for p in range(0, 101)}
            assert tiers == _ALL_TIERS, base

    def test_band_boundaries_move_with_the_base_rate(self):
        """
        The property that matters, tested on the boundaries rather than a probe
        point — a single probe can sit inside the same band for every base rate
        and pass while proving nothing.

        Where LOW ends and where HIGH begins must both rise as the market's
        up-rate rises: a 45% reading is encouraging in a market that rises 35%
        of the time and disappointing in one that rises 65% of the time.
        """
        def first_uprob_reaching(tier: str, base: float) -> int:
            for p in range(101):
                if _TIER_ORDER[_uprob_to_tier(p, base)] >= _TIER_ORDER[tier]:
                    return p
            return 101

        for tier in ("NEUTRAL", "HIGH", "VERY_HIGH"):
            low = first_uprob_reaching(tier, 0.35)
            mid = first_uprob_reaching(tier, 0.50)
            high = first_uprob_reaching(tier, 0.65)
            assert low < mid < high, (
                f"{tier} boundary did not rise with the base rate: "
                f"{low} / {mid} / {high}"
            )

    def test_degenerate_base_rates_are_clamped(self):
        for base in (0.0, 1.0, -1.0, 2.0):
            assert _uprob_to_tier(50, base) in _ALL_TIERS


class TestBoosterCompatibility:
    """
    `lgb.train()` returns a Booster with no `predict_proba`. Inference called
    exactly that, so the first live request would have raised AttributeError.
    """

    def _engine(self, model):
        from ml.inference.signal_inference import SignalInference

        obj = SignalInference.__new__(SignalInference)
        obj.model = model
        obj.features = ["a", "b"]
        obj.version = "test"
        obj.report = {}
        return obj

    def test_booster_style_predict_is_supported(self):
        class Booster:
            def predict(self, X):
                return np.full(len(X), 0.7)

        out = self._engine(Booster())._predict_proba(pd.DataFrame({"a": [1, 2], "b": [3, 4]}))
        assert out.shape == (2,)
        assert np.allclose(out, 0.7)

    def test_sklearn_style_predict_proba_is_supported(self):
        class Classifier:
            def predict_proba(self, X):
                return np.column_stack([np.full(len(X), 0.3), np.full(len(X), 0.7)])

        out = self._engine(Classifier())._predict_proba(pd.DataFrame({"a": [1], "b": [2]}))
        assert np.allclose(out, 0.7)

    def test_probabilities_stay_in_range(self):
        class Booster:
            def predict(self, X):
                return np.linspace(0, 1, len(X))

        out = self._engine(Booster())._predict_proba(pd.DataFrame({"a": range(5), "b": range(5)}))
        assert out.min() >= 0 and out.max() <= 1


class TestShapMapping:
    def test_every_model_feature_has_a_display_name(self):
        """
        An unmapped feature falls back to its raw column name and shows up on
        the card as `xs_turnover_rank`. Visible, but not something to ship.
        """
        from ml.features.point_in_time import FEATURE_COLUMNS

        unmapped = [f for f in FEATURE_COLUMNS if f not in SHAP_DISPLAY]
        assert not unmapped, f"no display name for: {unmapped}"

    def test_display_names_are_bilingual(self):
        for feat, (name_id, name_en) in SHAP_DISPLAY.items():
            assert name_id and name_en, feat

    def test_mapping_has_no_stale_keys(self):
        """Keys for features the model no longer has are dead weight."""
        from ml.features.point_in_time import FEATURE_COLUMNS

        stale = [k for k in SHAP_DISPLAY if k not in FEATURE_COLUMNS]
        assert not stale, f"mapping references removed features: {stale}"


class TestNanHandling:
    def test_features_are_not_zero_filled_before_prediction(self):
        """
        The model trained with NaN present and LightGBM learns a split for it.
        A missing foreign-flow reading means "IDX did not report", which is not
        zero net flow — filling it at serving time is train/serve skew.
        """
        import inspect

        from ml.inference.signal_inference import SignalInference

        source = inspect.getsource(SignalInference.run)
        assert "fillna(0)" not in source, "NaN must reach the model, not be filled"


class TestCrossSectionRequirement:
    def test_service_documents_why_the_full_board_is_needed(self):
        """
        Scoring the 15 displayed symbols alone recomputes xs_*_rank over a
        different universe than training used, which silently rescales two
        features. The guard against reintroducing that is the code path itself.
        """
        import inspect

        from api.services import signal_service

        source = inspect.getsource(signal_service._compute_live_signals)
        assert "_load_cross_section" in source, (
            "live scoring must build features over the full cross-section"
        )

    @pytest.mark.asyncio
    async def test_empty_database_refuses_rather_than_guessing(self, monkeypatch):
        from api.services import signal_service

        async def _empty(_days):
            return pd.DataFrame()

        monkeypatch.setattr(signal_service, "_load_cross_section", _empty)

        class _Engine:
            version = "test"

            @classmethod
            def load(cls):
                return cls()

        monkeypatch.setattr(
            "ml.inference.signal_inference.SignalInference.load",
            classmethod(lambda cls: _Engine()),
        )

        with pytest.raises(signal_service.ModelUnavailable, match="cross-sectional"):
            await signal_service._compute_live_signals()
