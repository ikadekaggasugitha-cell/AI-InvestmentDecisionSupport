"""
Signal Worker — Phase 3

Celery task that refreshes AI signals every 15 minutes during market hours.
Writes results to Redis (TTL 900s) so the API endpoint serves from cache.
"""

import json
import logging
from datetime import datetime, timezone

from workers.celery_app import celery_app
from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS

logger = logging.getLogger(__name__)


@celery_app.task(
    name="workers.signal_worker.refresh_signals",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def refresh_signals(self) -> dict:
    """
    Full signal refresh pipeline:
    1. Query latest features from TimescaleDB
    2. Run LightGBM inference + SHAP
    3. Write result to Redis with 15-min TTL
    4. Persist signal row to TimescaleDB audit log

    Phase 1: This task is registered but does nothing (USE_MOCK_SIGNALS=true).
    Phase 3: Uncomment the live inference block below.
    """
    settings = get_settings()

    if settings.use_mock_signals:
        logger.info("signal_worker: mock mode — skipping inference")
        return {"status": "skipped", "reason": "use_mock_signals=true"}

    try:
        # ── Phase 3 live inference block ──────────────────────────────────────
        import asyncio
        import pandas as pd
        import asyncpg
        from ml.inference.signal_inference import SignalInference
        from ml.features.engineer import build_features
        import redis as sync_redis

        # 1. Load features from TimescaleDB (synchronous context inside Celery)
        async def _fetch_features():
            conn = await asyncpg.connect(
                settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
            )
            rows = await conn.fetch(
                """
                SELECT symbol, time::date as date, open, high, low, close,
                       volume, foreign_net
                FROM ohlcv
                WHERE time >= NOW() - INTERVAL '120 days'
                ORDER BY symbol, time
                """
            )
            await conn.close()
            return pd.DataFrame([dict(r) for r in rows])

        ohlcv = asyncio.run(_fetch_features())

        # Minimal universe and macro stubs — replace with real tables in production
        universe = ohlcv[["date", "symbol"]].copy()
        universe["sector"] = "Unknown"
        universe["pe"] = float("nan")
        macro = pd.DataFrame({
            "date":    pd.date_range(ohlcv["date"].min(), ohlcv["date"].max(), freq="B"),
            "bi_rate": 5.75, "usdidr": 16_200.0,
        })

        features_df = build_features(ohlcv, universe, macro)
        # Keep only the latest row per symbol
        latest = features_df.groupby(level="symbol").tail(1)
        latest.index = latest.index.get_level_values("symbol")

        # 2. Market prices from Redis
        r = sync_redis.from_url(settings.redis_url, decode_responses=True)
        prices = {}
        snapshot = r.hgetall("market:snapshot")
        for sym, tick_json in snapshot.items():
            tick = json.loads(tick_json)
            prices[sym] = tick.get("price", 0)

        # 3. Run inference
        engine = SignalInference.load()
        response = engine.run(latest, prices)

        # 4. Write to Redis
        r.setex(REDIS_KEYS["signals_latest"], 900, response.model_dump_json())

        # 5. Persist to TimescaleDB audit log (fire-and-forget)
        async def _persist():
            conn = await asyncpg.connect(
                settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
            )
            for sig in response.signals:
                await conn.execute(
                    """
                    INSERT INTO signals
                        (generated_at, symbol, uprob, confidence, action, model_version, model_score, shap_json)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    """,
                    datetime.now(timezone.utc),
                    sig.symbol, sig.uprob, sig.confidence,
                    sig.action, response.modelVersion,
                    sig.modelScore,
                    json.dumps([s.model_dump() for s in sig.shap]),
                )
            await conn.close()

        asyncio.run(_persist())

        logger.info(
            "signal_worker: refreshed %d signals (version=%s)",
            len(response.signals), response.modelVersion,
        )
        return {"status": "ok", "n_signals": len(response.signals), "version": response.modelVersion}

    except Exception as exc:
        logger.exception("signal_worker: failed — %s", exc)
        raise self.retry(exc=exc)
