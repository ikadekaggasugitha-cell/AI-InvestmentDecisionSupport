from typing import Literal
from pydantic import BaseModel, Field, PrivateAttr

# Probability tier replaces the former STRONG BUY / BUY / HOLD / SELL labels.
# Those literal values sat in the public OpenAPI schema and the database CHECK
# constraint, where an auditor reads them as trade instructions regardless of
# how the underlying number is derived (CMP-01, GAP-01). The tokens below are a
# probabilistic position relative to the model's own base rate; the human-facing
# bilingual wording ("Probabilitas Sangat Tinggi" / "Very High Probability")
# lives in the frontend i18n layer, not in the contract.
ProbabilityTier = Literal["VERY_HIGH", "HIGH", "NEUTRAL", "LOW"]

from api.models.broksum import BrokerSummarySnapshot
from api.models.technicals import GapInfo, SRLevel, TrendInfo


class ShapFactor(BaseModel):
    factor: str       # Indonesian label  e.g. "Fundamental"
    factorEn: str     # English label     e.g. "Fundamentals"
    value: float


class TradePlan(BaseModel):
    """
    Entry and stop loss derived from fractal S/R levels.

    Every field is optional and the whole object is omitted when no S/R level
    qualifies. A fabricated stop loss is worse than no stop loss, so the signal
    reports nothing rather than inventing a level.

    riskRewardRatio is derived from the signal's existing targetPrice — it is
    never a second, independently-computed target. Two target numbers on one
    card would eventually disagree.
    """
    entryPrice: float | None = None
    stopLoss: float | None = None
    stopLossPct: float | None = None       # negative, % below entry
    stopLossReason: str = ""               # Indonesian
    stopLossReasonEn: str = ""             # English
    riskRewardRatio: float | None = None


class AISignal(BaseModel):
    """
    Matches frontend AISignal type in src/app/hooks/useAISignals.ts.
    Field names use camelCase to match the TypeScript contract directly.
    """
    id: int
    symbol: str
    name: str
    probabilityTier: ProbabilityTier
    uprob: int = Field(..., ge=0, le=100, description="Probability of upside move, 0–100")
    confidence: int = Field(..., ge=0, le=100)
    targetPrice: float
    currentPrice: float
    upside: float = Field(..., description="Expected upside %, negative for SELL signals")
    horizon: str         # Indonesian  e.g. "6–12 bln"
    horizonEn: str       # English     e.g. "6–12 months"
    risk: str            # Indonesian  e.g. "Sedang"
    riskEn: str          # English     e.g. "Medium"
    thesis: str
    thesisEn: str
    catalysts: list[str]
    catalystsEn: list[str]
    modelScore: float = Field(..., ge=0, le=100)
    analystConsensus: str     # e.g. "Beli: 12 | Tahan: 3 | Jual: 0"
    analystConsensusEn: str   # e.g. "Buy: 12 | Hold: 3 | Sell: 0"
    shap: list[ShapFactor]

    # ── Phase 10 ──────────────────────────────────────────────────────────────
    # All optional with safe defaults. Seed data predates these fields and must
    # keep validating; the UI guards every render site rather than assuming
    # presence.

    # Entry / stop loss. Absent when no fractal S/R level qualifies.
    tradePlan: TradePlan | None = None

    # Generated technical commentary. This ADDS to `thesis`, it does not replace
    # it: the hand-written narrative thesis carries information a template
    # cannot, and the seed path is what most users actually see.
    technicalNote: str = ""
    technicalNoteEn: str = ""

    # Point-in-time price action + broker flow, computed at "now" for display.
    # Not model inputs — see PHASE10_DISPLAY_FEATURES in ml/features/engineer.py.
    trend: TrendInfo | None = None
    supportResistance: list[SRLevel] = []
    activePatterns: list[str] = []
    activePatternsEn: list[str] = []
    openGaps: list[GapInfo] = []
    brokerSummary: BrokerSummarySnapshot | None = None

    model_config = {"populate_by_name": True}


class SignalsResponse(BaseModel):
    """Envelope returned by GET /v1/signals"""
    signals: list[AISignal]
    generatedAt: str   # ISO timestamp
    modelVersion: str
    source: Literal["live", "mock"] = "mock"

    # Point-in-time feature vector per symbol, as scored. A PrivateAttr so it is
    # excluded from model_dump()/model_dump_json() — it must never reach the API
    # response, the frontend contract, or the Redis cache. Its sole consumer is
    # the signal worker's audit persistence (features_json), which needs it to
    # make a stored signal reconstructable (BR-18, GAP-09).
    _features_by_symbol: dict[str, dict] = PrivateAttr(default_factory=dict)
