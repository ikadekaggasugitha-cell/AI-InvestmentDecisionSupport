"""
LightGBM Signal Inference — Phase 3

Loads the latest production model from MLflow model registry,
runs inference on current market features, computes SHAP values,
and returns a list of AISignal objects ready for the API response.
"""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import shap

from api.core.config import get_settings
from api.models.broksum import BrokerSummarySnapshot
from api.models.signals import AISignal, ShapFactor, SignalsResponse
from api.models.technicals import GapInfo, SRLevel, TrendInfo
from ml.inference.trade_plan import _build_technical_note, _compute_trade_plan

logger = logging.getLogger(__name__)

def _uprob_to_tier(uprob: int, base_rate: float = 0.5) -> str:
    """
    Map a probability to a tier token, RELATIVE to the model's own base rate.

    Fixed thresholds (>=65 high, >=40 neutral) assume predictions centre on 50%.
    They do not. This model trained on a sample where only 38.65% of 5-day
    windows were up, so its probabilities centre near that — and every single
    output landed under 40, tiering all fifteen tracked symbols LOW permanently.

    A probability is informative relative to what the model considers typical.
    Sitting at the base rate is NEUTRAL; the high and low bands are scaled from
    the headroom on either side, so the tiers stay meaningful whatever the
    sample's up-rate happens to be.

    Returns a ProbabilityTier token (VERY_HIGH / HIGH / NEUTRAL / LOW). The
    former STRONG BUY / BUY / HOLD / SELL labels were replaced because their
    literal wording read as a trade instruction in the API and DB (CMP-01,
    GAP-01); the mapping thresholds are unchanged.
    """
    base = max(0.05, min(0.95, base_rate)) * 100
    p = float(uprob)

    # Headroom above and below the base rate, split into bands.
    up_room = 100 - base
    down_room = base

    if p >= base + 0.60 * up_room:
        return "VERY_HIGH"
    if p >= base + 0.25 * up_room:
        return "HIGH"
    if p >= base - 0.35 * down_room:
        return "NEUTRAL"
    return "LOW"


# SHAP factor name mapping (model feature → bilingual display name).
#
# Keys must match ml/features/point_in_time.FEATURE_COLUMNS. An unmapped
# feature falls back to its raw column name, which surfaces on the card as
# something like "xs_turnover_rank" — visible, so a drifted mapping shows up
# rather than silently dropping a factor's contribution.
SHAP_DISPLAY: dict[str, tuple[str, str]] = {
    # Momentum
    "ret_1d":                ("Momentum",     "Momentum"),
    "ret_5d":                ("Momentum",     "Momentum"),
    "ret_20d":               ("Momentum",     "Momentum"),
    "ret_60d":               ("Momentum",     "Momentum"),
    # Trend / mean reversion
    "rsi_14":                ("Teknikal",     "Technical"),
    "ema_ratio_9_21":        ("Teknikal",     "Technical"),
    "dist_from_high_60d":    ("Teknikal",     "Technical"),
    "dist_from_low_60d":     ("Teknikal",     "Technical"),
    # Volatility
    "vol_20d":               ("Volatilitas",  "Volatility"),
    "vol_ratio_5_20":        ("Volatilitas",  "Volatility"),
    # Liquidity
    "turnover_ratio_20d":    ("Likuiditas",   "Liquidity"),
    "volume_ratio_5_20":     ("Volume",       "Volume"),
    "frequency_ratio_5_20":  ("Likuiditas",   "Liquidity"),
    # Foreign participation — IDX first-party
    "foreign_net_ratio_1d":  ("Foreign Flow", "Foreign Flow"),
    "foreign_net_ratio_5d":  ("Foreign Flow", "Foreign Flow"),
    "foreign_net_ratio_20d": ("Foreign Flow", "Foreign Flow"),
    # Cross-sectional position
    "xs_ret_20d_rank":       ("Relatif Pasar", "Relative to Market"),
    "xs_turnover_rank":      ("Relatif Pasar", "Relative to Market"),
}


def _aggregate_shap(
    shap_values: np.ndarray,
    feature_names: list[str],
) -> list[ShapFactor]:
    """
    Aggregate raw per-feature SHAP values into display-level factor groups.
    Groups features by their bilingual display name, sums contributions.
    Returns top 7 factors sorted by absolute contribution.
    """
    group_sums: dict[str, tuple[float, str, str]] = {}

    for feat, val in zip(feature_names, shap_values):
        display = SHAP_DISPLAY.get(feat, (feat, feat))
        key = display[0]
        if key in group_sums:
            group_sums[key] = (
                group_sums[key][0] + val,
                display[0],
                display[1],
            )
        else:
            group_sums[key] = (val, display[0], display[1])

    factors = [
        ShapFactor(factor=v[1], factorEn=v[2], value=round(v[0] * 100, 1))
        for v in group_sums.values()
    ]
    return sorted(factors, key=lambda f: abs(f.value), reverse=True)[:7]


def _target_price(current: float, uprob: int) -> float:
    """Simple target price from uprob: assume linear relationship to 1-year upside."""
    upside_factor = (uprob - 50) / 50 * 0.30  # max ±30% target
    return round(current * (1 + upside_factor), 0)


class SignalInference:
    """
    Wraps the trained LightGBM model for inference.

    Usage:
        engine = SignalInference.load()
        signals = engine.run(feature_df, market_df)
    """

    def __init__(self, model_bundle: dict[str, Any]) -> None:
        self.model = model_bundle["model"]
        self.features = model_bundle["features"]
        self.version = model_bundle.get("version", "unknown")
        self.report = model_bundle.get("report", {})
        self._explainer = shap.TreeExplainer(self.model)

    def _predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        """
        P(up) for each row, whichever LightGBM API produced the model.

        `lgb.train()` returns a Booster whose `predict()` already yields the
        positive-class probability for a binary objective. The sklearn wrapper
        returns a two-column array from `predict_proba()`. Supporting only the
        latter is what would have broken serving: train_signals_v2 uses
        `lgb.train`, so the saved artefact is a Booster and `predict_proba`
        does not exist on it.
        """
        if hasattr(self.model, "predict_proba"):
            return np.asarray(self.model.predict_proba(X))[:, 1]

        raw = np.asarray(self.model.predict(X))
        # A multiclass Booster returns one column per class.
        return raw[:, 1] if raw.ndim == 2 and raw.shape[1] > 1 else raw.ravel()

    @classmethod
    def load(cls, model_path: str | Path | None = None) -> "SignalInference":
        """Load from path or discover latest model in models/ directory."""
        if model_path is None:
            models_dir = Path(__file__).parent.parent.parent / "models"
            pkls = sorted(models_dir.glob("lgbm_signals_*.pkl"), reverse=True)
            if not pkls:
                raise FileNotFoundError(
                    "No trained model found in models/. "
                    "Run: python -m ml.training.train_signals"
                )
            model_path = pkls[0]
        bundle = joblib.load(model_path)
        logger.info("Loaded model: %s (version=%s)", model_path, bundle.get("version"))
        return cls(bundle)

    def run(
        self,
        features_df: pd.DataFrame,
        market_prices: dict[str, float],
        technicals: dict[str, dict[str, Any]] | None = None,
        broksum: dict[str, dict[str, Any]] | None = None,
    ) -> SignalsResponse:
        """
        Run inference on a feature matrix and return SignalsResponse.

        Args:
            features_df: DataFrame with FEATURE_COLUMNS, indexed by symbol
            market_prices: dict symbol → current price (for target price calc)
            technicals: optional dict symbol → {"trend", "sr_levels", "patterns", "gaps"}
                as produced by technicals_service. Used for display and for
                deriving the trade plan; NOT a model input.
            broksum: optional dict symbol → accumulation-score dict from
                broksum_features.compute_accumulation_score. Display only.
        """
        technicals = technicals or {}
        broksum = broksum or {}
        settings = get_settings()
        # The label distribution the model was fitted on. Action bands are
        # scaled around it — see _uprob_to_tier.
        base_rate = float(self.report.get("base_rate", 0.5) or 0.5)
        max_stop_pct = settings.ta_max_stop_loss_pct
        min_stop_pct = settings.ta_min_stop_loss_pct
        # NaN is passed through, not filled.
        #
        # The model was trained with NaN present and LightGBM learns a split
        # direction for it. A missing foreign-flow reading means "IDX did not
        # report", which is a different state from zero net flow — filling it
        # with 0 at serving time while training saw NaN is train/serve skew, and
        # it silently shifts every prediction on any symbol with a gap.
        X = features_df[self.features]

        probas = self._predict_proba(X)
        shap_vals = self._explainer.shap_values(X)
        if isinstance(shap_vals, list):
            shap_vals = shap_vals[1]  # binary: take positive class

        # Feature vector per symbol, carried out-of-band for audit persistence
        # (SignalsResponse._features_by_symbol → signals.features_json). NaN is
        # mapped to None so the value is valid JSON for the JSONB column.
        features_by_symbol: dict[str, dict] = {}

        signals: list[AISignal] = []
        for i, symbol in enumerate(features_df.index):
            uprob = int(probas[i] * 100)
            tier = _uprob_to_tier(uprob, base_rate)
            current = market_prices.get(symbol, 0)
            target = _target_price(current, uprob)
            upside = round((target - current) / current * 100, 1) if current else 0

            shap_factors = _aggregate_shap(shap_vals[i], self.features)

            row = X.iloc[i]
            features_by_symbol[symbol] = {
                feat: (None if pd.isna(val) else float(val))
                for feat, val in zip(self.features, row)
            }

            # ── Phase 10 display enrichment (never model inputs) ──────────────
            ta = technicals.get(symbol, {})
            sr_levels = ta.get("sr_levels", []) or []
            trend_raw = ta.get("trend")
            patterns_raw = ta.get("patterns", []) or []
            gaps_raw = ta.get("gaps", []) or []
            bs_raw = broksum.get(symbol)

            plan = _compute_trade_plan(
                current, target, sr_levels, max_stop_pct, min_stop_pct
            )
            note_id, note_en = _build_technical_note(
                trend_raw, plan, patterns_raw, gaps_raw, bs_raw
            )

            signals.append(AISignal(
                id=i + 1,
                symbol=symbol,
                name=symbol,  # Phase 3: enrich from idx_universe table
                probabilityTier=tier,
                uprob=uprob,
                confidence=uprob,
                targetPrice=target,
                currentPrice=current,
                upside=upside,
                horizon="3–6 bln" if tier in ("VERY_HIGH", "LOW") else "6–12 bln",
                horizonEn="3–6 months" if tier in ("VERY_HIGH", "LOW") else "6–12 months",
                risk="Tinggi" if uprob < 40 or uprob > 85 else "Sedang",
                riskEn="High" if uprob < 40 or uprob > 85 else "Medium",
                thesis=f"Model score: {probas[i]:.3f}. SHAP-driven analysis.",
                thesisEn=f"Model score: {probas[i]:.3f}. SHAP-driven analysis.",
                catalysts=[],
                catalystsEn=[],
                modelScore=round(probas[i] * 100, 1),
                analystConsensus="—",
                analystConsensusEn="—",
                shap=shap_factors,
                tradePlan=plan,
                technicalNote=note_id,
                technicalNoteEn=note_en,
                trend=TrendInfo(
                    trend=trend_raw.get("trend", "sideways"),
                    trendId=trend_raw.get("trendId", "Sideways"),
                    strength=int(trend_raw.get("strength", 0)),
                    emaFast=float(trend_raw.get("ema_fast", 0.0)),
                    emaSlow=float(trend_raw.get("ema_slow", 0.0)),
                ) if trend_raw else None,
                supportResistance=[
                    SRLevel(
                        type=lvl["type"],
                        price=float(lvl["price"]),
                        strength=int(lvl.get("strength", 1)),
                        touches=int(lvl.get("touches", 0)),
                        method=lvl.get("method", "fractal"),
                    )
                    for lvl in sr_levels
                ],
                activePatterns=[p.get("patternId", p.get("pattern", "")) for p in patterns_raw],
                activePatternsEn=[
                    p.get("pattern", "").replace("_", " ").title() for p in patterns_raw
                ],
                openGaps=[
                    GapInfo(
                        type=g["type"],
                        date=g.get("date", ""),
                        gapPct=float(g.get("gap_pct", 0.0)),
                        top=float(g.get("top", 0.0)),
                        bottom=float(g.get("bottom", 0.0)),
                        isFilled=bool(g.get("is_filled", False)),
                        fillProbability=float(g.get("fill_probability", 0.75)),
                        avgFillDays=g.get("avg_fill_days"),
                    )
                    for g in gaps_raw if not g.get("is_filled")
                ],
                brokerSummary=BrokerSummarySnapshot(**bs_raw) if bs_raw else None,
            ))

        # Sort by abs(uprob - 50) desc — most decisive signals first
        signals.sort(key=lambda s: abs(s.uprob - 50), reverse=True)

        response = SignalsResponse(
            signals=signals,
            generatedAt=datetime.now(timezone.utc).isoformat(),
            modelVersion=self.version,
            source="live",
        )
        response._features_by_symbol = features_by_symbol
        return response
