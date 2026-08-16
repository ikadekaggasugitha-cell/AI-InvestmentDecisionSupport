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
        import asyncio
        import asyncpg
        import redis as sync_redis

        from api.services.signal_service import _compute_live_signals

        # Reuse the API's scoring path rather than a parallel implementation.
        # The worker previously built features with ml.features.engineer while
        # the model is trained on ml.features.point_in_time — two builders for
        # one model is how a worker starts serving quietly different numbers
        # from the endpoint beside it.
        response = asyncio.run(_compute_live_signals())

        r = sync_redis.from_url(settings.redis_url, decode_responses=True)

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
