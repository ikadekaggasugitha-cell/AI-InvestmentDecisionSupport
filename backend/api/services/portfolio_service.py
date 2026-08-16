"""
Portfolio Service — Phase 6

Routing logic: Redis cache → mock seed → live Black-Litterman + HRP optimiser.
Controlled by USE_MOCK_PORTFOLIO feature flag.
"""

import json
import logging
from pathlib import Path

from api.core.config import get_settings
from api.core.redis_client import get_redis, REDIS_KEYS
from api.models.portfolio import PortfolioOptimisationResponse

logger = logging.getLogger(__name__)

_SEED_PATH = Path(__file__).parent.parent / "seed" / "portfolio.json"
_CACHE_TTL = 3600  # 1 hour; recomputed hourly by Celery beat


def _load_seed() -> PortfolioOptimisationResponse:
    data = json.loads(_SEED_PATH.read_text())
    return PortfolioOptimisationResponse(**data)


async def get_portfolio_optimisation(uid: str = "default") -> PortfolioOptimisationResponse:
    settings = get_settings()

    # ── Mock path ─────────────────────────────────────────────────────────────
    if settings.use_mock_portfolio:
        logger.debug("portfolio_service: mock mode — serving seed weights")
        return _load_seed()

    # ── Cache check ───────────────────────────────────────────────────────────
    cache_key = REDIS_KEYS["risk_portfolio"].format(uid=uid)
    redis = get_redis()
    if redis:
        cached = await redis.get(cache_key)
        if cached:
            logger.debug("portfolio_service: cache hit for uid=%s", uid)
            return PortfolioOptimisationResponse(**json.loads(cached))

    # ── Live optimisation ─────────────────────────────────────────────────────
    try:
        result = await _run_live_optimisation(uid)
        if redis:
            await redis.setex(cache_key, _CACHE_TTL, result.model_dump_json())
        return result
    except Exception as exc:
        logger.exception("portfolio_service: live optimisation failed — %s", exc)
        logger.warning("portfolio_service: falling back to seed weights")
        return _load_seed()


async def _run_live_optimisation(uid: str) -> PortfolioOptimisationResponse:
    """
    Fetch prices + signal scores from Redis, then run the Black-Litterman optimiser.
    In full production this would:
      1. Pull 252 days of close prices from TimescaleDB
      2. Pull latest signal uprob scores from signals:latest Redis key
      3. Pull current market prices from market:snapshot
    For now raises NotImplementedError until the data pipeline is wired.
    """
    raise NotImplementedError(
        "Live portfolio optimisation requires price history from TimescaleDB. "
        "Set USE_MOCK_PORTFOLIO=true until the data pipeline is complete."
    )
