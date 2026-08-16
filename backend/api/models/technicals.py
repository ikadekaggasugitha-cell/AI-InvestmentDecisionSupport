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


class TechnicalAnalysisResponse(BaseModel):
    """Response for GET /v1/technicals/{symbol}"""
    symbol: str
    trend: TrendInfo
    supportResistance: list[SRLevel] = []
    patterns: list[CandlestickPattern] = []
    gaps: list[GapInfo] = []
    source: str = "mock"


class OHLCVResponse(BaseModel):
    """Response for GET /v1/technicals/{symbol}/ohlcv"""
    symbol: str
    candles: list[OHLCVCandle] = []
    days: int = 120
