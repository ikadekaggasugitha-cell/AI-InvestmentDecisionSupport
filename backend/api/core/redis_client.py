import json
import logging
import time
from typing import Any

import redis.asyncio as aioredis
from redis.exceptions import RedisError

from api.core.config import get_settings

logger = logging.getLogger(__name__)

_pool: aioredis.ConnectionPool | None = None

# Throttle the "cache unavailable" warning. Without this, running without Redis
# emits a stack-trace-sized warning on every single cache read, burying the
# genuine errors in the log.
_LAST_WARNED_AT: float = 0.0
_WARN_INTERVAL_SEC = 60.0


def _warn_cache_unavailable(op: str, key: str, exc: Exception) -> None:
    global _LAST_WARNED_AT
    now = time.monotonic()
    if now - _LAST_WARNED_AT >= _WARN_INTERVAL_SEC:
        _LAST_WARNED_AT = now
        logger.warning(
            "redis unavailable (%s %s): %s — serving uncached; "
            "responses stay correct but every request recomputes",
            op, key, exc,
        )


def get_redis_pool() -> aioredis.ConnectionPool:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = aioredis.ConnectionPool.from_url(
            settings.redis_url,
            max_connections=20,
            decode_responses=True,
        )
    return _pool


def get_redis() -> aioredis.Redis:
    return aioredis.Redis(connection_pool=get_redis_pool())


# ── Typed helpers ─────────────────────────────────────────────────────────────

async def redis_get_json(key: str) -> Any | None:
    """
    Read a cached value, or None if absent OR the cache is unreachable.

    Redis is a cache here, not the system of record: every caller can recompute
    or refetch what it holds. Propagating a connection error would turn a
    missing optional dependency into an HTTP 500 on endpoints that are perfectly
    able to answer without it — which is exactly what happened before this
    guard: no Redis running meant /v1/technicals returned 500 rather than
    computing from the feed.
    """
    try:
        async with get_redis() as r:
            raw = await r.get(key)
            return json.loads(raw) if raw else None
    except RedisError as exc:
        _warn_cache_unavailable("read", key, exc)
        return None
    except (TypeError, ValueError) as exc:
        # Corrupt or non-JSON payload — drop it rather than fail the request.
        logger.warning("redis: discarding unreadable value at %s (%s)", key, exc)
        return None


async def redis_set_json(key: str, value: Any, ttl: int | None = None) -> None:
    """Write to cache. A cache write failure must never fail the request."""
    try:
        async with get_redis() as r:
            serialised = json.dumps(value, default=str)
            if ttl:
                await r.setex(key, ttl, serialised)
            else:
                await r.set(key, serialised)
    except RedisError as exc:
        _warn_cache_unavailable("write", key, exc)


async def redis_hget_all(key: str) -> dict[str, str]:
    try:
        async with get_redis() as r:
            return await r.hgetall(key)
    except RedisError as exc:
        _warn_cache_unavailable("read", key, exc)
        return {}


async def redis_hset(key: str, mapping: dict[str, str]) -> None:
    try:
        async with get_redis() as r:
            await r.hset(key, mapping=mapping)
    except RedisError as exc:
        _warn_cache_unavailable("write", key, exc)


# ── Redis key constants ───────────────────────────────────────────────────────

REDIS_KEYS = {
    "market_snapshot": "market:snapshot",          # HSET symbol → StockTick JSON
    "signals_latest":  "signals:latest",            # STRING  AISignal[]  TTL 900s
    "risk_portfolio":  "risk:portfolio:{uid}",      # STRING  RiskMetricsResult TTL 3600s
    # Portfolio optimiser output — a DISTINCT key from risk_portfolio. The
    # portfolio service used to reuse risk_portfolio, so once the risk endpoint
    # populated risk:portfolio:default the optimiser read a RiskMetricsResult
    # back and 500'd on validation. Separate namespaces keep them from colliding.
    "portfolio_optimise": "portfolio:optimise:{uid}",  # STRING PortfolioOptimisationResponse TTL 3600s
    "sentiment":       "sentiment:{doc_hash}",      # STRING  float  TTL 86400s
    "intraday":        "market:intraday",            # STRING  IntradayPoint[]
    # Phase 9A: news retrieval for advisor RAG context
    "news_latest":     "news:idx:latest",           # ZSET  score=timestamp  value=JSON headline
    # Phase 9D: advisor session history persistence
    "chat_session":    "chat:{session_id}",         # STRING  ChatMessage[]  TTL 3600s
    # Phase 10: broker summary + technical analysis. Both refresh once per
    # session, so the TTL is a day rather than minutes.
    "broksum":         "broksum:{symbol}",          # STRING  snapshot dict  TTL 86400s
    "technicals":      "technicals:{symbol}",       # STRING  TA payload     TTL 86400s
    "ohlcv_series":    "ohlcv:{symbol}:{days}",     # STRING  OHLCVCandle[]  TTL 3600s
    # Phase 5 monitoring: latest feature-drift (PSI) report, written weekly by
    # workers.monitoring_worker.check_drift. No TTL — the last report stands
    # until the next run, so /health and the operator always see current state.
    "drift_latest":    "drift:latest",              # STRING  drift report dict
}
