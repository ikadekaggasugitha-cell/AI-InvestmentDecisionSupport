"""
Symbol-universe service — reads the `instruments` dimension table (joined with
the last daily close from `ohlcv_daily`) for the /v1/symbols endpoints.

Every read degrades to an empty result rather than a 500 when the database is
unreachable: the universe is browse/reference data, so an outage should leave the
list empty (and the frontend can fall back to its bundled seed) rather than break
the page.
"""

from __future__ import annotations

import logging
from typing import Any

from api.models.symbols import (
    SectorCount,
    SectorListResponse,
    SymbolInfo,
    SymbolListResponse,
)

logger = logging.getLogger(__name__)

# IDX-IC top-level sectors → English labels, so the UI can show either language
# without a second lookup. Keyed on the exact `Sektor` strings IDX publishes.
SECTOR_EN: dict[str, str] = {
    "Energi": "Energy",
    "Barang Baku": "Basic Materials",
    "Perindustrian": "Industrials",
    "Barang Konsumen Primer": "Consumer Non-Cyclicals",
    "Barang Konsumen Non-Primer": "Consumer Cyclicals",
    "Kesehatan": "Healthcare",
    "Keuangan": "Financials",
    "Properti & Real Estat": "Properties & Real Estate",
    "Teknologi": "Technology",
    "Infrastruktur": "Infrastructure",
    "Transportasi & Logistik": "Transportation & Logistic",
}

# Whitelisted sort orders. The value is spliced into ORDER BY, so it must never
# come from user input directly — the key is what the caller passes.
_SORT_SQL: dict[str, str] = {
    "marketcap": "(l.close * i.listed_shares) DESC NULLS LAST, i.symbol",
    "symbol": "i.symbol ASC",
    "gainers": "chg_pct DESC NULLS LAST, i.symbol",
    "losers": "chg_pct ASC NULLS LAST, i.symbol",
    "volume": "l.volume DESC NULLS LAST, i.symbol",
}
DEFAULT_SORT = "marketcap"

# The universe query: instruments left-joined with their most recent daily bar
# and the one before it (for change%). DISTINCT ON returns the latest bucket per
# symbol; the self-join to `prev` supplies the prior close.
_LIST_SQL = """
WITH latest AS (
    SELECT DISTINCT ON (symbol) symbol, bucket, close, volume
    FROM ohlcv_daily
    ORDER BY symbol, bucket DESC
),
prev AS (
    SELECT symbol, close AS prev_close FROM (
        SELECT symbol, close,
               row_number() OVER (PARTITION BY symbol ORDER BY bucket DESC) AS rn
        FROM ohlcv_daily
    ) t WHERE rn = 2
)
SELECT
    i.symbol, i.name, i.sector, i.sub_sector, i.industry, i.board,
    i.listing_date, i.listed_shares, i.is_active,
    l.close  AS last_close,
    l.volume AS last_volume,
    l.bucket AS last_date,
    COALESCE(p.prev_close, l.close) AS prev_close,
    CASE WHEN COALESCE(p.prev_close, 0) > 0
         THEN (l.close - p.prev_close) / p.prev_close * 100.0
         ELSE NULL END AS chg_pct,
    count(*) OVER () AS total_count
FROM instruments i
LEFT JOIN latest l ON l.symbol = i.symbol
LEFT JOIN prev   p ON p.symbol = i.symbol
WHERE (NOT $1::bool OR i.is_active)
  AND ($2::text IS NULL OR i.symbol ILIKE $2 OR i.name ILIKE $2)
  AND ($3::text IS NULL OR i.sector = $3)
ORDER BY {order}
LIMIT $4 OFFSET $5
"""


def _row_to_info(r: Any) -> SymbolInfo:
    last_close = float(r["last_close"]) if r["last_close"] is not None else None
    prev_close = float(r["prev_close"]) if r["prev_close"] is not None else None
    change = (last_close - prev_close) if (last_close is not None and prev_close is not None) else None
    chg_pct = float(r["chg_pct"]) if r["chg_pct"] is not None else None
    listed = int(r["listed_shares"]) if r["listed_shares"] is not None else None
    mktcap = (last_close * listed) if (last_close is not None and listed) else None
    sector = r["sector"]
    return SymbolInfo(
        symbol=r["symbol"],
        name=r["name"],
        sector=sector,
        sectorEn=SECTOR_EN.get(sector) if sector else None,
        subSector=r["sub_sector"],
        industry=r["industry"],
        board=r["board"],
        listingDate=r["listing_date"].isoformat() if r["listing_date"] else None,
        listedShares=listed,
        isActive=bool(r["is_active"]),
        lastClose=last_close,
        prevClose=prev_close,
        change=change,
        changePct=chg_pct,
        volume=int(r["last_volume"]) if r["last_volume"] is not None else None,
        marketCap=mktcap,
        lastDate=r["last_date"].date().isoformat() if r["last_date"] else None,
    )


async def list_symbols(
    q: str | None = None,
    sector: str | None = None,
    active_only: bool = True,
    sort: str = DEFAULT_SORT,
    limit: int = 1000,
    offset: int = 0,
) -> SymbolListResponse:
    """A filtered, paged slice of the listed board. Empty on DB failure."""
    from api.core.db import get_pool

    order = _SORT_SQL.get(sort, _SORT_SQL[DEFAULT_SORT])
    like = f"%{q.strip()}%" if q and q.strip() else None
    sect = sector.strip() if sector and sector.strip() else None

    try:
        pool = await get_pool()
        records = await pool.fetch(
            _LIST_SQL.format(order=order),
            active_only, like, sect, int(limit), int(offset),
        )
    except Exception as exc:  # noqa: BLE001 — degrade to empty, never 500
        logger.warning("symbols_service: database unavailable — %s", exc)
        return SymbolListResponse(symbols=[], total=0, source="empty")

    total = int(records[0]["total_count"]) if records else 0
    return SymbolListResponse(
        symbols=[_row_to_info(r) for r in records],
        total=total,
        source="db",
    )


async def list_sectors() -> SectorListResponse:
    """Active-instrument counts per IDX-IC sector, for the filter UI."""
    from api.core.db import get_pool

    try:
        pool = await get_pool()
        rows = await pool.fetch(
            "SELECT sector, count(*) AS n FROM instruments "
            "WHERE is_active AND sector IS NOT NULL "
            "GROUP BY sector ORDER BY n DESC"
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("symbols_service: sector read unavailable — %s", exc)
        return SectorListResponse(sectors=[], source="empty")

    return SectorListResponse(
        sectors=[
            SectorCount(sector=r["sector"], sectorEn=SECTOR_EN.get(r["sector"]), count=int(r["n"]))
            for r in rows
        ],
        source="db",
    )
