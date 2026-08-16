from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class StockTick(BaseModel):
    """
    Matches frontend StockTick interface in src/app/hooks/useLiveMarket.ts.
    Broadcast over WebSocket /v1/ws/market.
    """
    symbol: str
    name: str
    price: float
    prevClose: float
    open: float
    high: float
    low: float
    change: float
    changePct: float
    volume: int
    mktCap: str          # e.g. "Rp 892T"
    pe: float | None
    sector: str          # Indonesian sector name
    sectorEn: str        # English sector name
    tier: Literal[1, 2, 3]
    foreignNet: float    # Net foreign buy/sell IDR billions
    history: list[float] # Last 60 ticks for sparkline


class IntradayPoint(BaseModel):
    time: str            # "09:00", "09:01" …
    value: float         # Portfolio IDR value
    ihsg: float          # IHSG index value


class IhsgSnapshot(BaseModel):
    value: float
    prevClose: float
    change: float
    changePct: float


class FxRate(BaseModel):
    """
    USD/IDR from the market feed.

    Previously the frontend hardcoded 15,847 and animated it with synthetic
    volatility. The real rate is around 17,820 — an 11% error, moving on
    invented ticks, on a figure used to convert portfolio values.
    """
    pair: str = "USD/IDR"
    rate: float
    prevClose: float
    change: float
    changePct: float


class MarketSnapshot(BaseModel):
    """
    Broadcast message shape for WebSocket /v1/ws/market.
    Matches LiveMarketData in src/app/hooks/useLiveMarket.ts.
    """
    stocks: dict[str, StockTick]
    intradayChart: list[IntradayPoint]
    portfolioValue: float
    portfolioPrevClose: float
    dailyPnL: float
    dailyPnLPct: float
    ihsg: IhsgSnapshot
    fx: FxRate | None = None   # USD/IDR from the feed; None until first fetch
    isMarketOpen: bool
    lastUpdated: datetime

    # ── Data provenance ───────────────────────────────────────────────────────
    # The free IDX feed is delayed, and a price shown without its age invites
    # the reader to trade on a stale number. These travel with every snapshot so
    # the UI can state what it is actually showing.
    #
    # `lastUpdated` is when WE fetched. `dataAsOf` is the exchange timestamp of
    # the quote itself — the two differ by the vendor delay, and only the second
    # one answers "how old is this price".
    dataSource: str = "mock"          # provider id, or "mock"
    dataAsOf: datetime | None = None  # exchange timestamp of the oldest quote
    dataAgeSeconds: float | None = None
    delaySeconds: int = 0             # vendor-declared feed delay
    isDelayed: bool = False
    sourceLabel: str = ""             # vendor's own wording, e.g. "Delayed Quote"


class MarketTickMessage(BaseModel):
    """Slim delta message for tick-by-tick updates (Phase 2+)"""
    type: Literal["tick", "snapshot"] = "snapshot"
    data: MarketSnapshot
