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
# The event loop that created _pool; see get_pool for why.
_pool_loop: asyncio.AbstractEventLoop | None = None
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

    A pool is rebuilt when the cached one belongs to a different event loop.
    asyncpg connections are bound to the loop that created them, so reusing one
    across two asyncio.run() calls raises "attached to a different loop". The
    API server runs a single loop for its lifetime and never hits this, which is
    why the failure only appears in short-lived scripts and in tests — where each
    `async def` gets a fresh loop and a module-level pool left over from the
    previous test poisons the next one.
    """
    global _pool, _pool_loop
    if _pool is not None and asyncio.get_running_loop() is not _pool_loop:
        # The owning loop is gone, so `await pool.close()` cannot run — that is
        # the very error being recovered from. `terminate()` is synchronous and
        # closes the connections immediately, which releases the sockets instead
        # of leaving them for the garbage collector, whose finaliser would then
        # raise "Event loop is closed" on a dead loop.
        _terminate_quietly(_pool)
        _pool = None
        _pool_loop = None
    if _pool is None:
        async with _lock:
            if _pool is None:
                _pool = await asyncpg.create_pool(
                    dsn=_dsn(),
                    min_size=1,
                    max_size=10,
                    command_timeout=30,
                )
                _pool_loop = asyncio.get_running_loop()
    return _pool


def _terminate_quietly(pool: asyncpg.Pool) -> None:
    """Best-effort synchronous teardown of a pool whose loop has gone."""
    try:
        pool.terminate()
    except Exception:  # noqa: BLE001 — nothing to do, the loop is already gone
        pass


async def close_pool() -> None:
    """Close the pool on shutdown. Safe to call when no pool was created."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
