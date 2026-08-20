"""
Daily data update — one command, cron-friendly, no Celery broker required.

Run once per trading day after the 16:00 WIB close to keep every endpoint on
fresh data:

    DATABASE_URL=postgresql+asyncpg://aidss:aidss@localhost:5432/aidss \
    REDIS_URL=redis://localhost:6379/0 \
        python -m scripts.daily_update

What it does, in order:
  1. Pull the last N trading sessions of the WHOLE IDX board (foreign flow
     included) into `ohlcv` — idempotent upsert, so re-running is safe.
  2. Recompute the signal cache from the fresh bars (LightGBM inference).
  3. Invalidate the technicals/broksum caches so the next request recomputes
     trend, volume, gap and accumulation reads on the new session.

This is the same work the Celery beat schedule triggers at 16:15/16:30 WIB
(see workers/celery_app.py); this entrypoint exists so a deployment without a
Celery worker can drive it from cron:

    15 16 * * 1-5  cd /app && python -m scripts.daily_update >> /var/log/aidss-daily.log 2>&1
"""

import argparse
import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("daily_update")


def _refresh_ohlcv(days: int) -> dict:
    from workers.ohlcv_worker import backfill_ohlcv

    logger.info("1/3 refreshing OHLCV (whole board, last %d sessions)…", days)
    result = backfill_ohlcv.apply(kwargs={"days": days, "full_board": True}).get()
    logger.info("    %s", result)
    return result


def _refresh_signals() -> None:
    from workers.signal_worker import refresh_signals

    logger.info("2/3 recomputing signal cache…")
    try:
        result = refresh_signals.apply().get()
        logger.info("    %s", result)
    except Exception as exc:  # noqa: BLE001 — a signal miss must not fail the OHLCV update
        logger.warning("    signal refresh skipped: %s", exc)


async def _invalidate_caches() -> None:
    from api.core.config import get_settings
    from api.core.redis_client import get_redis

    logger.info("3/3 invalidating technicals/broksum caches…")
    redis = get_redis()
    try:
        async with redis as r:
            for pattern in ("technicals:*", "broksum:*"):
                keys = await r.keys(pattern)
                if keys:
                    await r.delete(*keys)
        logger.info("    caches cleared — next request recomputes on fresh bars")
    except Exception as exc:  # noqa: BLE001 — TTLs expire these anyway
        logger.warning("    cache invalidation skipped (Redis unavailable): %s", exc)
    _ = get_settings  # keep import meaningful even if settings unused here


async def _record_heartbeat(ohlcv_result: dict) -> None:
    """Persist a run marker so /health can confirm the cron path executed."""
    from api.core.redis_client import record_run

    try:
        await record_run(
            "refresh-ohlcv-eod",
            status=ohlcv_result.get("status", "ok"),
            detail={"via": "scripts.daily_update",
                    "bars_written": ohlcv_result.get("bars_written"),
                    "instruments": ohlcv_result.get("instruments")},
        )
    except Exception as exc:  # noqa: BLE001 — heartbeat must never fail the update
        logger.warning("    heartbeat write skipped: %s", exc)


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily market-data refresh.")
    parser.add_argument(
        "--days", type=int, default=7,
        help="Trailing sessions to re-pull (default 7 — covers a long weekend).",
    )
    parser.add_argument(
        "--skip-signals", action="store_true", help="Only refresh OHLCV + caches.",
    )
    args = parser.parse_args()

    ohlcv_result = _refresh_ohlcv(args.days)
    if not args.skip_signals:
        _refresh_signals()

    # Cache invalidation and the heartbeat share one event loop: both touch the
    # module-global Redis pool, and splitting them across two asyncio.run() calls
    # binds the pool to the first loop and then uses it from the second — which
    # raises "Event loop is closed" on connection cleanup.
    async def _finalise() -> None:
        await _invalidate_caches()
        await _record_heartbeat(ohlcv_result)

    asyncio.run(_finalise())
    logger.info("daily update complete.")


if __name__ == "__main__":
    main()
