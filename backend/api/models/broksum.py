"""
Broker Summary API Models — Phase 10

Pydantic models for the /v1/broksum/* endpoints.
"""

from pydantic import BaseModel, Field


class BrokerActivity(BaseModel):
    """Single broker's buy/sell activity."""
    broker: str
    netLot5d: int = 0
    netLot20d: int = 0


class BrokerSummarySnapshot(BaseModel):
    """Accumulation/distribution snapshot for a symbol."""
    phase: str              # "accumulation" | "distribution" | "neutral"
    phaseId: str            # Indonesian: "Akumulasi" | "Distribusi" | "Netral"
    score: float = Field(..., ge=-100, le=100)
    topBuyers: list[BrokerActivity] = []
    topSellers: list[BrokerActivity] = []
    netLot5d: int = 0
    netLot20d: int = 0
    consistencyDays: int = 0
    concentration: float = Field(0.0, ge=0, le=1)

    # ── Volume-flow analysis (populated when the snapshot is derived from
    # OHLCV+volume rather than per-broker flow, i.e. method="volume"). The
    # broker-flow path leaves these at their defaults. All optional so existing
    # consumers keep working. ────────────────────────────────────────────────
    method: str = "broker"          # "broker" (licensed feed) | "volume" (OHLCV)
    strength: int = 0               # |score| rounded, 0..100
    obvTrend: float = 0.0           # On-Balance-Volume slope, % of mean
    cmf: float = 0.0                # Chaikin Money Flow (20)
    mfi: float = 50.0               # Money Flow Index (14)
    volumeRatio: float = 1.0        # 5d vs 20d average volume
    volumeLevel: str = "normal"     # "high" | "normal" | "low"
    signals: list[str] = []         # bilingual reasons — Indonesian
    signalsEn: list[str] = []       # English


class BrokerRow(BaseModel):
    """Single row of broker summary data."""
    brokerCode: str
    buyLot: int = 0
    sellLot: int = 0
    buyVal: float = 0.0
    sellVal: float = 0.0
    netLot: int = 0
    netVal: float = 0.0
    avgBuyPrice: float = 0.0
    avgSellPrice: float = 0.0


class BrokerSummaryResponse(BaseModel):
    """Response for GET /v1/broksum/{symbol}"""
    symbol: str
    date: str               # ISO date
    snapshot: BrokerSummarySnapshot
    brokers: list[BrokerRow] = []
    source: str = "mock"    # "live" | "mock"


class BrokerSummaryDay(BaseModel):
    """Single day of broker summary history."""
    date: str
    netLot: int = 0
    netVal: float = 0.0
    topBuyer: str = ""
    topSeller: str = ""
    # Volume-flow history (method="volume"): per-day accumulation score and the
    # session volume, so the UI can plot how buying pressure built up.
    score: float = 0.0
    phase: str = "neutral"
    volume: int = 0
    close: float = 0.0


class BrokerSummaryHistoryResponse(BaseModel):
    """Response for GET /v1/broksum/{symbol}/history"""
    symbol: str
    days: int
    history: list[BrokerSummaryDay] = []
    source: str = "mock"
