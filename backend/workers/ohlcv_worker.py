"""
Daily OHLCV Worker — Phase 10

Populates the `ohlcv` hypertable with daily bars from Yahoo Finance.

Why this exists
---------------
Every price-action feature — trend, support/resistance, candlestick patterns,
gap detection, gap-fill probability — reads daily bars out of `ohlcv`. Before
this worker, nothing in the codebase wrote to that table: `tick_aggregator`
publishes snapshots to Redis only, and `signal_worker`/`risk_worker`/
`train_signals` are all readers. The table was queried by three components and
filled by none.

Cadence
-------
`backfill_ohlcv` is a one-shot bootstrap over `OHLCV_BACKFILL_DAYS` (400 by
default, which must exceed TA_GAP_LOOKBACK_DAYS=252 or gap-fill probability
runs on a truncated sample). `refresh_ohlcv_daily` appends the latest session
once per weekday after the close.

Both are idempotent: writes upsert on the `UNIQUE (time, symbol)` key added in
db/schema.sql, so a Celery retry (acks_late=True) re-runs safely instead of
duplicating bars.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from api.core.config import get_settings
from workers.celery_app import celery_app

logger = logging.getLogger(__name__)

_UPSERT_SQL = """
INSERT INTO ohlcv (
    time, symbol, open, high, low, close, volume, foreign_net,
    foreign_buy, foreign_sell, listed_shares, frequency, value_idr, source
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
ON CONFLICT (time, symbol) DO UPDATE SET
    open        = EXCLUDED.open,
    high        = EXCLUDED.high,
    low         = EXCLUDED.low,
    close       = EXCLUDED.close,
    volume      = EXCLUDED.volume,
    -- COALESCE so a later Yahoo row (which carries no foreign flow) cannot
    -- erase values an earlier IDX row already established. Yahoo is the faster
    -- bootstrap; IDX is the authority. Neither should overwrite the other with
    -- NULL just by running second.
    foreign_net   = COALESCE(EXCLUDED.foreign_net,   ohlcv.foreign_net),
    foreign_buy   = COALESCE(EXCLUDED.foreign_buy,   ohlcv.foreign_buy),
    foreign_sell  = COALESCE(EXCLUDED.foreign_sell,  ohlcv.foreign_sell),
    listed_shares = COALESCE(EXCLUDED.listed_shares, ohlcv.listed_shares),
    frequency     = COALESCE(EXCLUDED.frequency,     ohlcv.frequency),
    value_idr     = COALESCE(EXCLUDED.value_idr,     ohlcv.value_idr),
    source        = EXCLUDED.source
"""


def _bar_to_row(bar: Any) -> tuple[Any, ...]:
    """Flatten a DailyBar into the parameter order _UPSERT_SQL expects."""
    return (
        bar.date, bar.symbol, bar.open, bar.high, bar.low, bar.close, bar.volume,
        bar.foreign_net, bar.foreign_buy, bar.foreign_sell,
        bar.listed_shares, bar.frequency, bar.value_idr, bar.source,
    )


async def _fetch_sessions(
    start: date,
    end: date,
    symbols: set[str] | None = None,
) -> list[tuple[Any, ...]]:
    """
    Pull whole trading sessions from IDX, newest date first.

    IDX indexes by DATE and returns every instrument for that session, the
    inverse of Yahoo's symbol-indexed history. Walking dates is therefore the
    efficient shape here: three years of the entire board costs ~750 requests,
    where the per-symbol route would cost ~950 and still carry no foreign flow.

    `symbols=None` ingests the full board — which is the point, since the model
    universe is selected from traded value across all of it.
    """
    from ingestor.providers import get_history_provider

    provider = get_history_provider()
    rows: list[tuple[Any, ...]] = []
    sessions_with_data = 0

    try:
        cursor = end
        while cursor >= start:
            if cursor.weekday() >= 5:
                cursor -= timedelta(days=1)
                continue

            bars = await provider.get_session_bars(cursor)
            if bars:
                sessions_with_data += 1
                for bar in bars:
                    if symbols is None or bar.symbol in symbols:
                        rows.append(_bar_to_row(bar))

            cursor -= timedelta(days=1)
    finally:
        await provider.close()

    logger.info(
        "ohlcv_worker: %d rows from %d sessions (%s .. %s)",
        len(rows), sessions_with_data, start.isoformat(), end.isoformat(),
    )
    return rows


async def _fetch_bars(symbol: str, days: int) -> list[tuple[Any, ...]]:
    """
    Daily bars for a single symbol via the quote provider (Yahoo by default).

    Retained as the fast bootstrap path: one request returns 400 sessions for a
    symbol, which is useful for filling a gap quickly. It carries no foreign
    flow — those columns stay NULL and the COALESCE in _UPSERT_SQL prevents this
    route from erasing values IDX already wrote.
    """
    from ingestor.providers import get_provider

    provider = get_provider()
    bars = await provider.get_daily_bars(symbol, days)

    if not bars:
        logger.warning("ohlcv_worker: no bars returned for %s", symbol)
        return []

    return [_bar_to_row(bar) for bar in bars]


async def _write_bars(rows: list[tuple[Any, ...]]) -> int:
    """Upsert bars and return the number written."""
    if not rows:
        return 0

    import asyncpg

    settings = get_settings()
    conn = await asyncpg.connect(
        settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    )
    try:
        await conn.executemany(_UPSERT_SQL, rows)
        return len(rows)
    finally:
        await conn.close()


async def _refresh_continuous_aggregate(start: datetime, end: datetime) -> None:
    """
    Materialise `ohlcv_daily` over a historical window.

    The aggregate's own policy uses start_offset => INTERVAL '7 days', so a
    400-day backfill never appears in it on its own. Anything older than that
    window has to be refreshed explicitly.
    """
    import asyncpg

    settings = get_settings()
    conn = await asyncpg.connect(
        settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    )
    try:
        # CALL refresh_continuous_aggregate cannot run inside a transaction block.
        # The parameters need explicit casts: asyncpg cannot infer a type for a
        # procedure argument, so unqualified $1/$2 raise "could not determine
        # data type of parameter $1" and the whole backfill's aggregate is skipped.
        await conn.execute(
            "CALL refresh_continuous_aggregate('ohlcv_daily', $1::timestamptz, $2::timestamptz)",
            start, end,
        )
    except Exception as exc:  # noqa: BLE001 — refresh is best-effort
        logger.warning("ohlcv_worker: continuous aggregate refresh failed: %s", exc)
    finally:
        await conn.close()


@celery_app.task(
    name="workers.ohlcv_worker.backfill_ohlcv",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
    acks_late=True,
)
def backfill_ohlcv(self, days: int | None = None, full_board: bool = True) -> dict:
    """
    One-shot historical backfill from IDX. Run once when provisioning:

        celery -A workers.celery_app call workers.ohlcv_worker.backfill_ohlcv

    Walks trading sessions backwards from today, writing every instrument IDX
    published for each one. At ~950 instruments per session and a 2-second
    throttle, 400 sessions takes roughly 15 minutes and yields ~270k rows
    complete with foreign flow.

    `full_board=False` restricts storage to `tracked_symbols`. The default is
    the whole board, because the model universe is chosen by ranking traded
    value across it — a filter applied here would decide that ranking in
    advance.
    """
    settings = get_settings()
    days = days or settings.ohlcv_backfill_days
    symbols = None if full_board else set(settings.tracked_symbols)

    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)

    try:
        rows = asyncio.run(_fetch_sessions(start, end, symbols))
    except Exception as exc:  # noqa: BLE001
        logger.error("ohlcv_worker: session fetch failed — %s", exc)
        return {"status": "failed", "error": str(exc), "bars_written": 0}

    written = 0
    if rows:
        try:
            written = asyncio.run(_write_bars(rows))
        except Exception as exc:  # noqa: BLE001
            logger.error("ohlcv_worker: database write failed — %s", exc)
            return {"status": "failed", "error": str(exc), "bars_written": 0}

        asyncio.run(_refresh_continuous_aggregate(
            datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
            datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc)
            + timedelta(days=1),
        ))

    distinct = len({r[1] for r in rows})
    logger.info(
        "ohlcv_worker: backfill complete — %d rows, %d instruments, %s..%s",
        written, distinct, start.isoformat(), end.isoformat(),
    )
    return {
        "status": "ok" if written else "empty",
        "bars_written": written,
        "instruments": distinct,
        "range": [start.isoformat(), end.isoformat()],
        "source": "idx",
    }


@celery_app.task(
    name="workers.ohlcv_worker.refresh_ohlcv_daily",
    bind=True,
    max_retries=3,
    default_retry_delay=300,
    acks_late=True,
)
def refresh_ohlcv_daily(self) -> dict:
    """
    Append the most recent sessions. Runs after the IDX close on weekdays.

    Pulls a 5-day window rather than 1 so a missed run (holiday, outage) heals
    itself on the next execution instead of leaving a hole in the series.
    """
    result = backfill_ohlcv(days=5)
    # Heartbeat so /health can confirm the daily update actually ran.
    try:
        from api.core.redis_client import record_run

        asyncio.run(record_run(
            "refresh-ohlcv-eod",
            status=result.get("status", "ok"),
            detail={"bars_written": result.get("bars_written"),
                    "instruments": result.get("instruments")},
        ))
    except Exception as exc:  # noqa: BLE001 — heartbeat must never fail the task
        logger.debug("ohlcv_worker: heartbeat write skipped — %s", exc)
    return result
