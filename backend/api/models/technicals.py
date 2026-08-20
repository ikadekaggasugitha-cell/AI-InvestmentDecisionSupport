"""
Technical Analysis API Models — Phase 10

Pydantic models for the /v1/technicals/* endpoints.
"""

from pydantic import BaseModel, Field


class TrendInfo(BaseModel):
    """Trend direction and strength."""
    trend: str = "sideways"        # "uptrend" | "downtrend" | "sideways"
    trendId: str = "Sideways"      # Indonesian label
    strength: int = Field(0, ge=0, le=100)
    emaFast: float = 0.0
    emaSlow: float = 0.0


class SRLevel(BaseModel):
    """Support or Resistance level."""
    type: str                      # "support" | "resistance"
    price: float
    strength: int = Field(1, ge=1, le=5)
    touches: int = 0
    method: str = "fractal"


class CandlestickPattern(BaseModel):
    """Detected candlestick pattern."""
    pattern: str                   # e.g. "bullish_engulfing"
    patternId: str                 # Indonesian label
    date: str
    significance: str = "medium"   # "high" | "medium" | "low"
    signal: int = 0                # -3 to +3


class GapInfo(BaseModel):
    """Price gap information."""
    type: str                      # "gap_up" | "gap_down"
    date: str
    gapPct: float
    top: float
    bottom: float
    isFilled: bool = False
    fillProbability: float = 0.75
    avgFillDays: int | None = None


class OHLCVCandle(BaseModel):
    """Single OHLCV candlestick for Lightweight Charts."""
    time: str                      # ISO date or epoch seconds
    open: float
    high: float
    low: float
    close: float
    volume: int = 0


class VolumeInfo(BaseModel):
    """How heavy trading is versus the stock's own baseline."""
    level: str = "normal"          # "high" | "normal" | "low"
    ratio: float = 1.0             # 5-day avg / 20-day avg volume
    latest: int = 0                # most recent session volume
    average20d: int = 0            # 20-day average volume
    trend: str = "flat"            # "rising" | "falling" | "flat"
    spike: bool = False            # latest volume >= 2x the 20-day average
    note: str = ""                 # Indonesian one-liner
    noteEn: str = ""


class AccumulationInfo(BaseModel):
    """
    Combined "smart money" accumulation read.

    Blends two free, real signals: volume-flow (OBV/ADL/CMF/MFI) for *how much*
    buying pressure, and IDX foreign flow for *who* — persistent net foreign
    buying is the honest, free substitute for gated per-broker bandarmology.
    `method` reports which dimensions actually contributed ("volume+foreign" vs
    "volume" when foreign flow is unavailable for the symbol/session).
    """
    phase: str = "neutral"         # "accumulation" | "distribution" | "neutral"
    phaseId: str = "Netral"
    score: float = 0.0             # -100..+100 (combined)
    strength: int = 0
    obvTrend: float = 0.0
    cmf: float = 0.0
    mfi: float = 50.0
    consistencyDays: int = 0       # volume-flow OBV persistence
    signals: list[str] = []
    signalsEn: list[str] = []
    method: str = "volume"         # "volume+foreign" | "volume"
    # ── Foreign-flow dimension (null-ish when method == "volume") ──────────────
    foreignAvailable: bool = False
    foreignPhase: str = "neutral"
    foreignScore: float = 0.0
    netForeign5d: int = 0          # net foreign flow, lots (5 sessions)
    netForeign20d: int = 0
    foreignConsistencyDays: int = 0


class EntrySignal(BaseModel):
    """When to enter and why — derived from trend, accumulation and structure."""
    signal: str = "wait"           # "buy_watch" | "wait" | "avoid"
    signalId: str = "Tunggu"       # Indonesian label
    reason: str = ""               # Indonesian
    reasonEn: str = ""


class TradePlanInfo(BaseModel):
    """Entry / stop-loss derived from fractal S/R. Null fields when none qualify."""
    entryPrice: float | None = None
    stopLoss: float | None = None
    stopLossPct: float | None = None
    stopLossReason: str = ""
    stopLossReasonEn: str = ""
    riskRewardRatio: float | None = None


class AccumulationBadge(BaseModel):
    """Compact accumulation read for one symbol — for list/table badges."""
    symbol: str
    phase: str = "neutral"          # "accumulation" | "distribution" | "neutral"
    phaseId: str = "Netral"
    score: float = 0.0              # -100..+100 (combined volume + foreign)
    strength: int = 0
    consistencyDays: int = 0
    # Which dimensions contributed, so the table badge matches the detail panel.
    method: str = "volume"          # "volume+foreign" | "volume"
    foreignPhase: str = "neutral"   # foreign-flow phase when method includes foreign


class AccumulationBatchResponse(BaseModel):
    """Response for GET /v1/technicals/accumulation — one entry per symbol."""
    items: list[AccumulationBadge] = []
    source: str = "volume"


class AccumulationHistoryPoint(BaseModel):
    """One session in the foreign-flow accumulation history."""
    date: str
    netForeign: int = 0            # net foreign flow that session, lots
    cumulativeNet: int = 0         # running cumulative net, lots
    score: float = 0.0             # -100..+100 rolling foreign-flow score
    phase: str = "neutral"
    close: float = 0.0


class AccumulationHistoryResponse(BaseModel):
    """Response for GET /v1/technicals/{symbol}/accumulation-history."""
    symbol: str
    points: list[AccumulationHistoryPoint] = []
    available: bool = False        # False when the symbol carries no foreign flow
    source: str = "foreign"


class TechnicalAnalysisResponse(BaseModel):
    """Response for GET /v1/technicals/{symbol}"""
    symbol: str
    trend: TrendInfo
    supportResistance: list[SRLevel] = []
    patterns: list[CandlestickPattern] = []
    gaps: list[GapInfo] = []
    volume: VolumeInfo = VolumeInfo()
    accumulation: AccumulationInfo = AccumulationInfo()
    entrySignal: EntrySignal = EntrySignal()
    tradePlan: TradePlanInfo = TradePlanInfo()
    technicalNote: str = ""
    technicalNoteEn: str = ""
    source: str = "mock"


class OHLCVResponse(BaseModel):
    """Response for GET /v1/technicals/{symbol}/ohlcv"""
    symbol: str
    candles: list[OHLCVCandle] = []
    days: int = 120
