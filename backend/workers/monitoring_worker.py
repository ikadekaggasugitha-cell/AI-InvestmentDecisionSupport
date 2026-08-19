"""
Monitoring Worker — Phase 5

Weekly feature-drift check. Compares the live serving feature distribution
against the reference distribution captured at training time (PSI), writes the
report to Redis, and logs a warning when drift crosses the retrain threshold.

This is what makes ml/monitoring/drift_detector.py live rather than dead code:
the detector existed but nothing ever called it, so a model could drift out of
its training regime with no signal at all.

Cadence is weekly, not intraday: PSI over a few days of the same board barely
moves, and the model does not retrain itself between runs, so a daily check
would only re-report the same number.
"""

import json
import logging

from workers.celery_app import celery_app
from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS

logger = logging.getLogger(__name__)

# Days of live bars to build the "current" feature distribution from. Wide
# enough that the point-in-time features (60-day windows) are fully formed.
CURRENT_WINDOW_DAYS = 120


def _load_latest_bundle():
    """Load the newest model bundle, or None if there is no trained model."""
    from pathlib import Path

    import joblib

    models_dir = Path(__file__).parent.parent / "models"
    pkls = sorted(models_dir.glob("lgbm_signals_*.pkl"), reverse=True)
    if not pkls:
        return None
    return joblib.load(pkls[0])


async def _build_current_features():
    """
    Build the current serving feature matrix over the full board.

    Reuses the API's cross-section loader and the same point-in-time builder the
    model trained on, so "current" is measured exactly as the model sees it at
    serving time.
    """
    from api.services.signal_service import _load_cross_section
    from ml.features.point_in_time import build_point_in_time_features

    cross_section = await _load_cross_section(CURRENT_WINDOW_DAYS)
    if cross_section.empty:
        return cross_section  # empty DataFrame
    return build_point_in_time_features(cross_section)


@celery_app.task(
    name="workers.monitoring_worker.check_drift",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
    acks_late=True,
)
def check_drift(self) -> dict:
    """
    Compare live features against the training baseline and persist the report.

    Degrades honestly:
      - no trained model            → skipped (nothing to monitor)
      - model has no baseline        → skipped, with a retrain hint (models
                                       trained before baselines were stored)
      - `ohlcv` empty / no features  → skipped (cannot build the current side)
    """
    import asyncio

    import pandas as pd

    from ml.monitoring.drift_detector import check_feature_drift

    settings = get_settings()
    if settings.use_mock_signals:
        logger.info("monitoring_worker: mock mode — skipping drift check")
        return {"status": "skipped", "reason": "use_mock_signals=true"}

    bundle = _load_latest_bundle()
    if bundle is None:
        logger.info("monitoring_worker: no trained model — nothing to monitor")
        return {"status": "skipped", "reason": "no_model"}

    baseline = bundle.get("feature_baseline")
    if not baseline:
        logger.warning(
            "monitoring_worker: model %s has no feature_baseline — retrain with "
            "`python -m ml.training.train_signals_v2` to enable drift monitoring",
            bundle.get("version"),
        )
        return {"status": "skipped", "reason": "no_baseline"}

    feature_columns = bundle["features"]
    reference_df = pd.DataFrame(baseline)

    try:
        current_df = asyncio.run(_build_current_features())
    except Exception as exc:
        logger.exception("monitoring_worker: failed building current features — %s", exc)
        raise self.retry(exc=exc)

    if current_df.empty:
        logger.info("monitoring_worker: no live features (empty ohlcv?) — skipping")
        return {"status": "skipped", "reason": "no_current_features"}

    result = check_feature_drift(reference_df, current_df, feature_columns)
    result["model_version"] = bundle.get("version")

    try:
        import redis as sync_redis

        r = sync_redis.from_url(settings.redis_url, decode_responses=True)
        r.set(REDIS_KEYS["drift_latest"], json.dumps(result))
    except Exception as exc:
        # A cache write failure must not lose the finding — it is already logged
        # by check_feature_drift. Report ok; the report simply is not cached.
        logger.warning("monitoring_worker: could not cache drift report — %s", exc)

    logger.info(
        "monitoring_worker: drift check done — max_psi=%.4f needs_retraining=%s",
        result["max_psi"], result["needs_retraining"],
    )
    return {"status": "ok", **result}
