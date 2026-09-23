"""
Symbol-universe API models — the /v1/symbols endpoints.

These describe the listed board the frontend browses and searches: one entry per
IDX security with its reference metadata and last daily close. Prices are the
end-of-day close from `ohlcv_daily`; live intraday ticks arrive separately over
the market WebSocket.
"""

from pydantic import BaseModel, Field


class SymbolInfo(BaseModel):
    """One instrument: reference metadata + last daily close."""

    symbol: str
    name: str | None = None
    sector: str | None = None          # IDX-IC top level, Indonesian (e.g. "Keuangan")
    sectorEn: str | None = None        # English label for the same sector
    subSector: str | None = None
    industry: str | None = None
    board: str | None = None           # PapanPencatatan (Utama, Pengembangan, …)
    listingDate: str | None = None
    listedShares: int | None = None
    isActive: bool = True

    # Last end-of-day values from ohlcv_daily. Null until the board is backfilled.
    lastClose: float | None = None
    prevClose: float | None = None
    change: float | None = None
    changePct: float | None = None
    volume: int | None = None
    marketCap: float | None = None
    lastDate: str | None = None


class SymbolListResponse(BaseModel):
    """A page of the universe."""

    symbols: list[SymbolInfo]
    total: int = Field(0, description="Total matching the filter, before paging.")
    source: str = "db"                 # "db" | "empty" — empty when the DB is unreachable


class SectorCount(BaseModel):
    sector: str
    sectorEn: str | None = None
    count: int


class SectorListResponse(BaseModel):
    sectors: list[SectorCount]
    source: str = "db"
