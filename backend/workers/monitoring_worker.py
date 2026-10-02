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

import logging

from workers.celery_app import celery_app
from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS

logger = logging.getLogger(__name__)


def _record_drift_status(payload: dict) -> None:
    """
    Persist the run's outcome to `drift:latest`, success or skip.

    Only successful runs used to be cached, so a weekly skip left nothing to
    read anywhere: the reason existed in one log line and nowhere else, which
    made "drift monitoring has been inert for months" indistinguishable from
    "drift was checked and found stable". The key already has no TTL, so the
    last run's outcome stands until the next one replaces it.
    """
    import json as _json

    try:
        import redis as sync_redis

        r = sync_redis.from_url(get_settings().redis_url, decode_responses=True)
        r.set(REDIS_KEYS["drift_latest"], _json.dumps(payload))
    except Exception as exc:  # noqa: BLE001 — never lose the finding to a cache
        logger.warning("monitoring_worker: could not record drift status — %s", exc)

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
        outcome = {"status": "skipped", "reason": "use_mock_signals=true"}
        _record_drift_status(outcome)
        return outcome

    bundle = _load_latest_bundle()
    if bundle is None:
        logger.info("monitoring_worker: no trained model — nothing to monitor")
        outcome = {"status": "skipped", "reason": "no_model"}
        _record_drift_status(outcome)
        return outcome

    baseline = bundle.get("feature_baseline")
    if not baseline:
        logger.warning(
            "monitoring_worker: model %s has no feature_baseline — retrain with "
            "`python -m ml.training.train_signals_v2` to enable drift monitoring",
            bundle.get("version"),
        )
        outcome = {
            "status": "skipped",
            "reason": "no_baseline",
            "model_version": bundle.get("version"),
            "detail": (
                "Model carries no feature_baseline, so PSI has no reference to "
                "compare against. Retrain with "
                "`python -m ml.training.train_signals_v2`."
            ),
        }
        _record_drift_status(outcome)
        return outcome

    feature_columns = bundle["features"]
    reference_df = pd.DataFrame(baseline)

    try:
        current_df = asyncio.run(_build_current_features())
    except Exception as exc:
        logger.exception("monitoring_worker: failed building current features — %s", exc)
        raise self.retry(exc=exc)

    if current_df.empty:
        logger.info("monitoring_worker: no live features (empty ohlcv?) — skipping")
        outcome = {
            "status": "skipped",
            "reason": "no_current_features",
            "model_version": bundle.get("version"),
        }
        _record_drift_status(outcome)
        return outcome

    result = check_feature_drift(reference_df, current_df, feature_columns)
    result["model_version"] = bundle.get("version")

    # A cache write failure must not lose the finding — check_feature_drift has
    # already logged it. Report ok; the report simply is not cached.
    _record_drift_status(result)

    logger.info(
        "monitoring_worker: drift check done — max_psi=%.4f needs_retraining=%s",
        result["max_psi"], result["needs_retraining"],
    )
    return {"status": "ok", **result}
