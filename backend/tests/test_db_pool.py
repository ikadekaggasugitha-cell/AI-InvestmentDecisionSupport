"""
Tests for the shared asyncpg pool's queue behaviour.

This file exists because of a specific failure. `asyncpg.Pool.acquire()` has
`timeout=None` by default, which means "wait forever". Every data service calls
`pool.fetch(...)` / `fetchrow` / `fetchval` / `execute`, and each of those calls
`self.acquire()` internally. With `max_size=10` and no acquire deadline, the
eleventh concurrent request does not get an error — it queues without limit,
its latency grows without limit, and it eventually times out in the browser
while the server is still holding it.

A request that fails honestly and immediately is cheaper than one that hangs.
These tests pin that down.
"""

import asyncio

import asyncpg
import pytest

from api.core.db import _dsn, get_pool


class TestTheHazardIsReal:
    """What the installed asyncpg actually does. These assert upstream behaviour,
    so a version bump that quietly fixes it would show up here."""

    def test_acquire_defaults_to_waiting_forever(self):
        import inspect

        default = inspect.signature(asyncpg.Pool.acquire).parameters["timeout"].default
        assert default is None, (
            "asyncpg now defaults acquire() to a deadline. If that default is "
            "shorter than our worst-case query, the explicit timeout in db.py "
            "is no longer the binding constraint and the numbers should be "
            "re-checked rather than left as they are."
        )

    def test_no_max_overflow_parameter_exists(self):
        import inspect

        params = inspect.signature(asyncpg.create_pool).parameters
        assert "max_overflow" not in params, (
            "asyncpg grew a max_overflow parameter. max_size would stop being a "
            "hard ceiling, and the saturation analysis in tasks/plan-beban.md "
            "would need redoing."
        )

    async def test_an_exhausted_pool_does_not_raise(self):
        """The actual bug, observed rather than inferred."""
        pool = await asyncpg.create_pool(dsn=_dsn(), min_size=1, max_size=1)
        try:
            async with pool.acquire():
                # The only connection is now busy. The next acquire must wait.
                with pytest.raises(asyncio.TimeoutError):
                    await asyncio.wait_for(pool.acquire(), timeout=1.0)
        finally:
            await pool.close()


class TestPoolQueueIsBounded:
    async def test_exhaustion_surfaces_as_a_named_error_not_a_hang(self):
        from api.core.db import PoolExhausted

        pool = await asyncpg.create_pool(dsn=_dsn(), min_size=1, max_size=1)
        try:
            async with pool.acquire():
                with pytest.raises(PoolExhausted):
                    await asyncio.wait_for(
                        _acquire_with_deadline(pool, 0.25), timeout=5.0
                    )
        finally:
            await pool.close()

    async def test_the_deadline_is_short_enough_to_be_useful(self):
        from api.core.config import get_settings

        acquire_timeout = get_settings().db_acquire_timeout
        # Long enough for a normal query to finish, short enough that a caller
        # is not still holding a socket seconds after the client gave up.
        assert 0 < acquire_timeout <= 10.0, (
            f"acquire deadline is {acquire_timeout}s. Under 0.1s a routine query "
            "loses its connection to a neighbour; over 10s the queue is still "
            "unbounded in the way this change exists to remove."
        )

    async def test_a_free_connection_is_still_served(self):
        """A deadline must not turn ordinary traffic into failures."""
        from api.core.db import BoundedPool

        pool = await asyncpg.create_pool(dsn=_dsn(), min_size=1, max_size=2)
        bounded = BoundedPool(pool)
        try:
            assert await bounded.fetchval("SELECT 1") == 1
        finally:
            await pool.close()

    async def test_all_four_pool_methods_are_bounded(self):
        """Every method the data services use must be covered, not just the one
        a new test happens to call. A wrapper missing `fetchrow` would leave 11
        of the 33 call sites unprotected with nothing to say so."""
        from api.core.db import BoundedPool

        pool = await asyncpg.create_pool(dsn=_dsn(), min_size=1, max_size=2)
        bounded = BoundedPool(pool)
        try:
            for name in ("fetch", "fetchrow", "fetchval", "execute"):
                assert callable(getattr(bounded, name)), f"{name} is missing"
            # Compared field-by-field: asyncpg returns Record objects, not dicts.
            assert await bounded.fetchval("SELECT 1") == 1
            assert [(r["n"]) for r in await bounded.fetch("SELECT 1 AS n")] == [1]
            assert (await bounded.fetchrow("SELECT 1 AS n"))["n"] == 1
            assert await bounded.execute("SELECT 1") == "SELECT 1"
        finally:
            await pool.close()

    async def test_lifecycle_methods_still_reach_the_real_pool(self):
        """`__getattr__` forwards these as-is, because they take no connection.
        Wrapping them would hand a spurious connection as the first argument —
        `close()` raises rather than quietly leaking, which is how this was
        caught the first time."""
        from api.core.db import BoundedPool

        pool = await asyncpg.create_pool(dsn=_dsn(), min_size=1, max_size=1)
        bounded = BoundedPool(pool)
        try:
            assert bounded.get_size() == 1
            await bounded.close()
            assert bounded.is_closing()
        finally:
            await pool.close()

    async def test_exhaustion_reports_the_deadline_not_a_hang(self):
        """End to end through the wrapper, which is what the app actually calls."""
        from api.core.db import BoundedPool, PoolExhausted

        pool = await asyncpg.create_pool(dsn=_dsn(), min_size=1, max_size=1)
        bounded = BoundedPool(pool)
        try:
            async with bounded.acquire():
                with pytest.raises(PoolExhausted):
                    await asyncio.wait_for(bounded.fetchval("SELECT 1"), timeout=15.0)
        finally:
            await pool.close()

    async def test_the_app_pool_is_the_bounded_one(self):
        """Otherwise all of the above passes while production stays unbounded."""
        from api.core.db import BoundedPool

        pool = await get_pool()
        assert isinstance(pool, BoundedPool), (
            "get_pool() handed back a bare asyncpg pool. All 33 call sites are "
            "then waiting forever again, and this file's other tests would be "
            "describing a pool the app never uses."
        )


async def _acquire_with_deadline(pool: asyncpg.Pool, timeout: float):
    from api.core.db import PoolExhausted

    try:
        async with pool.acquire(timeout=timeout):
            return "acquired"
    except asyncio.TimeoutError as exc:
        raise PoolExhausted(timeout) from exc