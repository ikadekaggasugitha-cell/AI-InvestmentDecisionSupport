"""
Instruments Worker — the IDX universe refresh.

Fills and maintains the `instruments` dimension table from IDX
GetCompanyProfiles (via ingestor.providers.idx_universe). This is what makes the
app's stock list the full listed board (~960 securities with names and IDX-IC
sectors) instead of a hardcoded 15.

Cadence
-------
`refresh_instruments` runs once per weekday morning, before the market opens.
The listed board changes slowly — a handful of IPOs and delistings a month — so
a daily sync is ample; there is nothing intraday to chase.

Durability
----------
The write is UPSERT-ONLY. A fetch that fails, or returns fewer rows than a real
board could have, can never empty the table:

  * upserts use COALESCE so a field missing from one fetch does not wipe a value
    an earlier fetch established;
  * the "mark vanished securities inactive" step is GUARDED by a sanity floor —
    if the fetch came back suspiciously small we skip deactivation entirely,
    rather than flag the whole board delisted off a truncated response.

Idempotent: re-running produces the same table.
"""

import asyncio
import logging
from typing import Any

from api.core.config import get_settings
from workers.celery_app import celery_app

logger = logging.getLogger(__name__)

# Below this many fetched instruments we assume the fetch was truncated (partial
# Cloudflare clearance, endpoint hiccup) and refuse to deactivate anything. The
# real board is ~960; a healthy fetch is never in the low hundreds.
_MIN_HEALTHY_COUNT = 500

_UPSERT_SQL = """
INSERT INTO instruments (
    symbol, name, sector, sub_sector, industry, sub_industry,
    board, listing_date, listed_shares, status, is_active, source, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, TRUE, 'idx', now())
ON CONFLICT (symbol) DO UPDATE SET
    -- COALESCE(EXCLUDED, existing): a fetch that momentarily lacks a field must
    -- not erase a value an earlier good fetch already stored.
    name          = COALESCE(EXCLUDED.name,          instruments.name),
    sector        = COALESCE(EXCLUDED.sector,        instruments.sector),
    sub_sector    = COALESCE(EXCLUDED.sub_sector,    instruments.sub_sector),
    industry      = COALESCE(EXCLUDED.industry,      instruments.industry),
    sub_industry  = COALESCE(EXCLUDED.sub_industry,  instruments.sub_industry),
    board         = COALESCE(EXCLUDED.board,         instruments.board),
    listing_date  = COALESCE(EXCLUDED.listing_date,  instruments.listing_date),
    listed_shares = COALESCE(EXCLUDED.listed_shares, instruments.listed_shares),
    status        = EXCLUDED.status,
    is_active     = TRUE,
    updated_at    = now()
"""

# Securities that were active but no longer appear in the feed. Guarded by the
# healthy-count check in sync_instruments before this ever runs.
_DEACTIVATE_SQL = """
UPDATE instruments
   SET is_active = FALSE, updated_at = now()
 WHERE is_active = TRUE
   AND symbol <> ALL($1::text[])
"""


def _instrument_to_row(inst: Any) -> tuple[Any, ...]:
    return (
        inst.symbol, inst.name, inst.sector, inst.sub_sector, inst.industry,
        inst.sub_industry, inst.board, inst.listing_date, inst.listed_shares,
        inst.status,
    )


async def sync_instruments() -> dict:
    """
    Fetch the IDX universe and upsert it. Returns a summary dict.

    Reusable outside Celery (the bootstrap script calls this directly). Raises
    nothing on an IDX outage: it logs and returns status='failed' so the table
    keeps its last good contents.
    """
    from ingestor.providers.base import MarketDataError
    from ingestor.providers.idx_universe import IdxUniverseProvider

    provider = IdxUniverseProvider()
    try:
        universe = await provider.fetch_universe()
    except MarketDataError as exc:
        logger.error("instruments_worker: IDX fetch failed — %s", exc)
        return {"status": "failed", "error": str(exc), "instruments": 0}
    finally:
        await provider.close()

    rows = [_instrument_to_row(i) for i in universe]
    symbols = [i.symbol for i in universe]

    import asyncpg

    settings = get_settings()
    conn = await asyncpg.connect(
        settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    )
    try:
        await conn.executemany(_UPSERT_SQL, rows)

        deactivated = 0
        if len(universe) >= _MIN_HEALTHY_COUNT:
            result = await conn.execute(_DEACTIVATE_SQL, symbols)
            # asyncpg returns "UPDATE <n>"
            deactivated = int(result.split()[-1]) if result.split()[-1].isdigit() else 0
        else:
            logger.warning(
                "instruments_worker: only %d instruments fetched (< %d) — "
                "skipping deactivation to avoid flagging the board off a "
                "truncated fetch.",
                len(universe), _MIN_HEALTHY_COUNT,
            )
    finally:
        await conn.close()

    logger.info(
        "instruments_worker: synced %d instruments (%d deactivated)",
        len(rows), deactivated,
    )
    return {
        "status": "ok",
        "instruments": len(rows),
        "deactivated": deactivated,
    }


@celery_app.task(
    name="workers.instruments_worker.refresh_instruments",
    bind=True,
    max_retries=3,
    default_retry_delay=300,
    acks_late=True,
)
def refresh_instruments(self) -> dict:
    """Sync the IDX universe into `instruments`. Runs daily pre-open."""
    result = asyncio.run(sync_instruments())
    try:
        from api.core.redis_client import record_run

        asyncio.run(record_run(
            "refresh-instruments",
            status=result.get("status", "ok"),
            detail={"instruments": result.get("instruments"),
                    "deactivated": result.get("deactivated")},
        ))
    except Exception as exc:  # noqa: BLE001 — heartbeat must never fail the task
        logger.debug("instruments_worker: heartbeat write skipped — %s", exc)
    return result
