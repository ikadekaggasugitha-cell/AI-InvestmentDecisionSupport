import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS, redis_get_json, redis_set_json
from api.models.signals import AISignal, SignalsResponse

logger = logging.getLogger(__name__)

_SEED_PATH = Path(__file__).parent.parent / "seed" / "signals.json"
_SEED_DATA: list[dict] | None = None

SIGNALS_TTL = 900  # 15 minutes


def _load_seed() -> list[dict]:
    global _SEED_DATA
    if _SEED_DATA is None:
        _SEED_DATA = json.loads(_SEED_PATH.read_text())
    return _SEED_DATA


async def get_signals() -> SignalsResponse:
    """
    Returns AI signals.

    Priority:
      1. Redis cache (always checked first — fastest path)
      2. Mock seed data (when USE_MOCK_SIGNALS=true)
      3. LightGBM inference (Phase 3 — when USE_MOCK_SIGNALS=false)
    """
    settings = get_settings()

    # 1. Try Redis cache
    cached = await redis_get_json(REDIS_KEYS["signals_latest"])
    if cached:
        logger.debug("signals: cache hit")
        return SignalsResponse(**cached)

    # 2. Mock mode — return seed data directly
    if settings.use_mock_signals:
        logger.debug("signals: serving mock seed data")
        raw = _load_seed()
        response = SignalsResponse(
            signals=[AISignal(**s) for s in raw],
            generatedAt=datetime.now(timezone.utc).isoformat(),
            modelVersion="seed-v1.0",
            source="mock",
        )
        # Cache the mock data so repeated requests stay fast
        await redis_set_json(
            REDIS_KEYS["signals_latest"],
            response.model_dump(),
            ttl=SIGNALS_TTL,
        )
        return response

    # 3. Live LightGBM inference — implemented in Phase 3
    raise NotImplementedError(
        "Live signal inference requires USE_MOCK_SIGNALS=false and "
        "a trained LightGBM model. See workers/signal_worker.py."
    )
