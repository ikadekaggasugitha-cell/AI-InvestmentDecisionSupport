"""
Broker Summary Worker — Phase 10

Fetches broker summary once per symbol per session, after the IDX close.

Why end-of-day and not every 5 minutes
--------------------------------------
Every consumer of this data is a daily aggregate: `broksum_net_lot_5d`,
`broksum_net_lot_20d`, `broksum_top3_consistency`, and the accumulation phase
badge. Nothing reads intraday granularity. Polling every 5 minutes would
re-fetch an unchanged end-of-day publication roughly 78 times per session —
about 3,900 requests/day against ~50 — and the entire proxy-pool, user-agent
rotation and session-cycling apparatus existed only to survive rate limits
caused by that self-inflicted volume.

At one request per symbol per day the scraper runs unproxied, and
PROXY_POOL_API_KEY stops being a prerequisite for the feature to work at all.

Idempotency
-----------
Celery runs with acks_late=True, so a worker that dies mid-task re-runs it.
Writes upsert on `UNIQUE (time, symbol, broker_code)`; without that key a retry
would double every lot in the 5-day and 20-day rolling sums.
"""

import asyncio
import logging
from datetime import date, datetime, time, timezone
from typing import Any

from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS
from workers.celery_app import celery_app

logger = logging.getLogger(__name__)

BROKSUM_TTL = 86_400  # 24h — the data only changes once per session

_UPSERT_SQL = """
INSERT INTO broker_summary (
    time, symbol, broker_code, buy_lot, sell_lot,
    buy_val, sell_val, net_lot, net_val, avg_buy_price, avg_sell_price
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT (time, symbol, broker_code) DO UPDATE SET
    buy_lot        = EXCLUDED.buy_lot,
    sell_lot       = EXCLUDED.sell_lot,
    buy_val        = EXCLUDED.buy_val,
    sell_val       = EXCLUDED.sell_val,
    net_lot        = EXCLUDED.net_lot,
    net_val        = EXCLUDED.net_val,
    avg_buy_price  = EXCLUDED.avg_buy_price,
    avg_sell_price = EXCLUDED.avg_sell_price
"""


def _session_timestamp(for_date: date | None = None) -> datetime:
    """
    Midnight UTC of the trading session.

    Broker summary is a once-per-session publication, so the row's timestamp is
    the session date — not the wall clock at fetch time. Using NOW() would give
    every re-run a distinct key and defeat the unique constraint.
    """
    d = for_date or datetime.now(timezone.utc).date()
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _collect_rows(symbols: list[str], settings: Any) -> dict[str, list[dict[str, Any]]]:
    """Fetch broker rows per symbol, from mock or the live scraper."""
    session_ts = _session_timestamp()

    if settings.use_mock_broksum:
        from ingestor.broksum_mock import generate_mock_broksum
        return {
            sym: generate_mock_broksum(sym, date=session_ts)
            for sym in symbols
        }

    from ingestor.broksum_scraper import BroksumScraper

    async def _scrape_all() -> dict[str, list[dict[str, Any]]]:
        scraper = BroksumScraper()
        out: dict[str, list[dict[str, Any]]] = {}
        for sym in symbols:
            try:
                rows = await scraper.scrape_symbol(sym)
                for row in rows:
                    row["time"] = session_ts
                out[sym] = rows
            except Exception as exc:  # noqa: BLE001 — never let one symbol abort the run
                logger.error("broksum_worker: scrape failed for %s — %s", sym, exc)
                out[sym] = []
            await asyncio.sleep(settings.broksum_request_delay_sec)
        return out

    return asyncio.run(_scrape_all())


async def _write_rows(rows_by_symbol: dict[str, list[dict[str, Any]]]) -> int:
    """Upsert all broker rows. Returns the number of rows written."""
    import asyncpg

    settings = get_settings()
    payload: list[tuple[Any, ...]] = []
    for symbol, rows in rows_by_symbol.items():
        for r in rows:
            payload.append((
                r["time"], symbol, r["broker_code"],
                r.get("buy_lot", 0), r.get("sell_lot", 0),
                r.get("buy_val", 0.0), r.get("sell_val", 0.0),
                r.get("net_lot", 0), r.get("net_val", 0.0),
                r.get("avg_buy_price"), r.get("avg_sell_price"),
            ))

    if not payload:
        return 0

    conn = await asyncpg.connect(
        settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    )
    try:
        await conn.executemany(_UPSERT_SQL, payload)
        return len(payload)
    finally:
        await conn.close()


async def _cache_snapshots(rows_by_symbol: dict[str, list[dict[str, Any]]]) -> int:
    """
    Compute the accumulation snapshot per symbol and cache it in Redis.

    The snapshot needs history, not just today, so it is computed from the
    database where available and falls back to the freshly fetched session.
    """
    import pandas as pd

    from api.core.redis_client import redis_set_json
    from ml.features.broksum_features import compute_accumulation_score

    cached = 0
    for symbol, rows in rows_by_symbol.items():
        if not rows:
            continue
        try:
            history = await _load_history(symbol)
            frame = pd.DataFrame(history) if history else pd.DataFrame(rows)
            if frame.empty:
                continue
            if "symbol" not in frame.columns:
                frame["symbol"] = symbol
            snapshot = compute_accumulation_score(frame, symbol)
            await redis_set_json(
                REDIS_KEYS["broksum"].format(symbol=symbol), snapshot, ttl=BROKSUM_TTL
            )
            cached += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("broksum_worker: snapshot failed for %s — %s", symbol, exc)

    return cached


async def _load_history(symbol: str, days: int = 30) -> list[dict[str, Any]]:
    """Read recent broker summary rows for one symbol out of TimescaleDB."""
    import asyncpg

    settings = get_settings()
    try:
        conn = await asyncpg.connect(
            settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        )
    except Exception as exc:  # noqa: BLE001 — DB optional in mock deployments
        logger.debug("broksum_worker: history unavailable for %s — %s", symbol, exc)
        return []

    try:
        records = await conn.fetch(
            """
            SELECT time, symbol, broker_code, buy_lot, sell_lot,
                   net_lot, net_val, avg_buy_price, avg_sell_price
            FROM broker_summary
            WHERE symbol = $1 AND time > NOW() - ($2 || ' days')::INTERVAL
            ORDER BY time
            """,
            symbol, str(days),
        )
        return [dict(r) for r in records]
    finally:
        await conn.close()


@celery_app.task(
    name="workers.broksum_worker.refresh_broksum",
    bind=True,
    max_retries=3,
    default_retry_delay=600,
    acks_late=True,
)
def refresh_broksum(self) -> dict:
    """
    End-of-day broker summary refresh.

    1. Fetch one broker summary per tracked symbol (mock or live scrape)
    2. Upsert into TimescaleDB, keyed on (time, symbol, broker_code)
    3. Compute the accumulation/distribution snapshot and cache it in Redis
    """
    settings = get_settings()
    symbols = settings.tracked_symbols

    rows_by_symbol = _collect_rows(symbols, settings)
    fetched = sum(len(v) for v in rows_by_symbol.values())

    written = 0
    try:
        written = asyncio.run(_write_rows(rows_by_symbol))
    except Exception as exc:  # noqa: BLE001 — Redis cache is still worth populating
        logger.error("broksum_worker: database write failed — %s", exc)

    cached = asyncio.run(_cache_snapshots(rows_by_symbol))

    logger.info(
        "broksum_worker: %d rows fetched, %d written, %d snapshots cached (mock=%s)",
        fetched, written, cached, settings.use_mock_broksum,
    )
    return {
        "status": "ok",
        "source": "mock" if settings.use_mock_broksum else "live",
        "rows_fetched": fetched,
        "rows_written": written,
        "snapshots_cached": cached,
    }


@celery_app.task(
    name="workers.broksum_worker.refresh_accumulation",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
    acks_late=True,
)
def refresh_accumulation(self) -> dict:
    """
    End-of-day "smart money" accumulation refresh — the FREE path.

    IDX per-broker flow is a gated feed, so instead of scraping it this warms the
    accumulation snapshot cache from data we already have for free: OHLCV volume
    (OBV/CMF/MFI) blended with IDX foreign flow (net foreign, from the `ohlcv`
    table the OHLCV worker refreshes at 16:15). Runs after that refresh so the
    foreign_net column is current.

    `get_broker_summary` computes the blended snapshot and caches it under
    REDIS_KEYS["broksum"], so the /v1/broksum and MarketsView badge paths serve a
    warm, real, daily-updated read without any licensed feed.
    """
    from api.services.broksum_service import get_broker_summary

    settings = get_settings()

    async def _warm() -> int:
        from api.core.redis_client import record_run

        warmed = 0
        for sym in settings.tracked_symbols:
            try:
                await get_broker_summary(sym)  # computes blended snapshot + caches
                warmed += 1
            except Exception as exc:  # noqa: BLE001 — one bad symbol must not abort the run
                logger.warning("broksum_worker: accumulation warm failed for %s — %s", sym, exc)
        # Heartbeat in the SAME loop as the warm-up, so the shared Redis pool is
        # never used across two asyncio.run() calls ("Event loop is closed").
        try:
            await record_run(
                "refresh-broksum-eod", status="ok",
                detail={"symbols_warmed": warmed, "method": "foreign+volume"},
            )
        except Exception as exc:  # noqa: BLE001 — heartbeat must never fail the task
            logger.debug("broksum_worker: heartbeat write skipped — %s", exc)
        return warmed

    warmed = asyncio.run(_warm())
    logger.info("broksum_worker: accumulation cache warmed for %d symbols (foreign+volume)", warmed)
    return {"status": "ok", "symbols_warmed": warmed, "method": "foreign+volume"}
