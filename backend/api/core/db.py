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

_pool: "BoundedPool | None" = None
# The event loop that created _pool; see get_pool for why.
_pool_loop: asyncio.AbstractEventLoop | None = None
_lock = asyncio.Lock()


def _dsn() -> str:
    # asyncpg speaks the plain libpq URL, not SQLAlchemy's +asyncpg dialect form.
    return get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")


class PoolExhausted(RuntimeError):
    """Every connection was busy for longer than the acquire deadline.

    A distinct type rather than a bare TimeoutError because "no connection was
    free" and "the query itself ran too long" are different failures. A caller
    degrading to empty data cannot tell them apart from `asyncio.TimeoutError`
    alone, and the first is worth retrying while the second is not.
    """


def _deadline() -> float:
    return get_settings().db_acquire_timeout


async def _on_conn(pool: asyncpg.Pool, timeout: float | None, call, *args, **kw):
    """Run one query on a pooled connection whose acquire has a deadline.

    The `except` wraps only the acquire. A `command_timeout` also raises
    `asyncio.TimeoutError`, and folding that into `PoolExhausted` would report a
    slow query as a busy pool — two failures that deserve different answers.
    """
    ctx = pool.acquire(timeout=_deadline() if timeout is None else timeout)
    try:
        con = await ctx.__aenter__()
    except TimeoutError:
        raise PoolExhausted(_deadline()) from None
    try:
        return await call(con, *args, **kw)
    finally:
        await ctx.__aexit__(None, None, None)


class BoundedPool:
    """A pool whose acquire() cannot wait forever.

    `asyncpg.Pool.acquire()` takes `timeout=None`, which means "wait as long as
    it takes". Every data service reaches the database through
    `pool.fetch`/`fetchrow`/`fetchval`/`execute`, and each of those calls
    `self.acquire()` internally with that unbounded default. So with a pool of
    10 connections, the eleventh concurrent request neither succeeds nor fails —
    it joins a queue with no end, its latency grows without bound, and it
    eventually times out in the client while the server is still holding it.

    Subclassing `asyncpg.Pool` would be the tidier fix, but `create_pool`
    hardcodes `Pool(...)` with no `pool_class` parameter, so a subclass would
    mean reaching into its private constructor. This wrapper uses only public
    API. It costs one small class and leaves the 33 existing call sites
    unchanged.
    """

    __slots__ = ("_pool",)

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def fetch(self, query, *args, **kw):
        return await _on_conn(
            self._pool, kw.pop("acquire_timeout", None), lambda c: c.fetch(query, *args, **kw)
        )

    async def fetchrow(self, query, *args, **kw):
        return await _on_conn(
            self._pool,
            kw.pop("acquire_timeout", None),
            lambda c: c.fetchrow(query, *args, **kw),
        )

    async def fetchval(self, query, *args, **kw):
        return await _on_conn(
            self._pool,
            kw.pop("acquire_timeout", None),
            lambda c: c.fetchval(query, *args, **kw),
        )

    async def execute(self, query, *args, **kw):
        return await _on_conn(
            self._pool,
            kw.pop("acquire_timeout", None),
            lambda c: c.execute(query, *args, **kw),
        )

    def acquire(self, *, timeout=None):
        return self._pool.acquire(timeout=_deadline() if timeout is None else timeout)

    def __getattr__(self, name):
        """Forward anything else, but through a bounded acquire.

        Without this, the next pool method someone reaches for would go straight
        to the raw pool and silently restore the unbounded wait.

        Only the four query methods above take a connection; the rest are pool
        lifecycle and introspection (`close`, `get_size`, `is_closing`), which
        take none and are forwarded as-is. Wrapping those would pass a spurious
        connection as the first argument.
        """
        attr = getattr(self._pool, name)
        if not callable(attr):
            return attr

        if name in ("fetch", "fetchrow", "fetchval", "execute"):
            async def bounded(*args, **kw):
                return await _on_conn(
                    self._pool,
                    kw.pop("acquire_timeout", None),
                    lambda c: attr(c, *args, **kw),
                )

            return bounded
        return attr

    def __repr__(self):
        return f"BoundedPool({self._pool!r})"


async def get_pool() -> BoundedPool:
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
                _pool = BoundedPool(
                    await asyncpg.create_pool(
                        dsn=_dsn(),
                        min_size=1,
                        max_size=get_settings().db_pool_max_size,
                        command_timeout=30,
                    )
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
    global _pool, _pool_loop
    if _pool is not None:
        await _pool.close()
        _pool = None
        _pool_loop = None
