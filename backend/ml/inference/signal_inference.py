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

# Action mapping: uprob → action label
def _uprob_to_action(uprob: int) -> str:
    if uprob >= 80:
        return "STRONG BUY"
    if uprob >= 65:
        return "BUY"
    if uprob >= 40:
        return "HOLD"
    return "SELL"


# SHAP factor name mapping (model feature → bilingual display name)
SHAP_DISPLAY: dict[str, tuple[str, str]] = {
    "rsi_14":            ("Teknikal",       "Technical"),
    "macd_delta":        ("Teknikal",       "Technical"),
    "bb_position":       ("Teknikal",       "Technical"),
    "bb_width":          ("Volatilitas",    "Volatility"),
    "ret_5d":            ("Momentum",       "Momentum"),
    "ret_20d":           ("Momentum",       "Momentum"),
    "ret_60d":           ("Fundamental",    "Fundamentals"),
    "vol_ratio_5_20":    ("Volume",         "Volume"),
    "foreign_net_5d":    ("Foreign Flow",   "Foreign Flow"),
    "foreign_net_20d":   ("Foreign Flow",   "Foreign Flow"),
    "foreign_flow_signal":("Foreign Flow",  "Foreign Flow"),
    "pe_sector_pct":     ("Fundamental",    "Fundamentals"),
    "bi_rate_change":    ("Makro",          "Macro"),
    "usdidr_vol_30d":    ("Makro",          "Macro"),
    "sentiment_5d":      ("Sentimen",       "Sentiment"),  # Phase 5 feature
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
        self._explainer = shap.TreeExplainer(self.model)

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
        max_stop_pct = settings.ta_max_stop_loss_pct
        min_stop_pct = settings.ta_min_stop_loss_pct
        X = features_df[self.features].fillna(0)
        probas = self.model.predict_proba(X)[:, 1]  # P(up)
        shap_vals = self._explainer.shap_values(X)
        if isinstance(shap_vals, list):
            shap_vals = shap_vals[1]  # binary: take positive class

        signals: list[AISignal] = []
        for i, symbol in enumerate(features_df.index):
            uprob = int(probas[i] * 100)
            action = _uprob_to_action(uprob)
            current = market_prices.get(symbol, 0)
            target = _target_price(current, uprob)
            upside = round((target - current) / current * 100, 1) if current else 0

            shap_factors = _aggregate_shap(shap_vals[i], self.features)

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
                action=action,
                uprob=uprob,
                confidence=uprob,
                targetPrice=target,
                currentPrice=current,
                upside=upside,
                horizon="3–6 bln" if action in ("STRONG BUY", "SELL") else "6–12 bln",
                horizonEn="3–6 months" if action in ("STRONG BUY", "SELL") else "6–12 months",
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

        return SignalsResponse(
            signals=signals,
            generatedAt=datetime.now(timezone.utc).isoformat(),
            modelVersion=self.version,
            source="live",
        )
