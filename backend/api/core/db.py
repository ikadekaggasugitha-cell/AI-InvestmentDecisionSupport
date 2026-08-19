"""
Shared asyncpg connection pool for the API.

Every data service used to open a fresh `asyncpg.connect()` per request and
close it at the end. Under any real concurrency that is a TCP connect, TLS
handshake and Postgres auth round-trip on the critical path of every call — the
work a pool exists to amortise. This module owns one pool for the API process,
created lazily on first use and closed in the FastAPI lifespan.

Workers are deliberately NOT routed through here: each Celery task is a
short-lived, single-shot `asyncio.run(...)` in its own process, so a pool would
be built and torn down per task for no gain. They keep their one-off connects.

The `/health` readiness probe also keeps its own transient connect on purpose:
it must be able to test raw DB connectivity even when the app pool is exhausted
or wedged, which is precisely when readiness matters most.
"""

import asyncio

import asyncpg

from api.core.config import get_settings

_pool: asyncpg.Pool | None = None
_lock = asyncio.Lock()


def _dsn() -> str:
    # asyncpg speaks the plain libpq URL, not SQLAlchemy's +asyncpg dialect form.
    return get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")


async def get_pool() -> asyncpg.Pool:
    """
    Return the process-wide pool, creating it on first call.

    The lock prevents two concurrent first-callers from each building a pool and
    leaking one. Creation can raise (DB down) — callers keep their existing
    try/except and degrade to seed/empty exactly as before; `_pool` stays None
    so the next call retries rather than caching a dead pool.
    """
    global _pool
    if _pool is None:
        async with _lock:
            if _pool is None:
                _pool = await asyncpg.create_pool(
                    dsn=_dsn(),
                    min_size=1,
                    max_size=10,
                    command_timeout=30,
                )
    return _pool


async def close_pool() -> None:
    """Close the pool on shutdown. Safe to call when no pool was created."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
