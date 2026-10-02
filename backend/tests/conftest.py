"""
Shared pytest fixtures for the AIDSS backend test suite.
"""

import os

# Test environment defaults — MUST be applied at import time, before any test
# module triggers the lru_cached get_settings(). The app used to set these
# inside the session `app` fixture, which runs only when first requested; by
# then another module's import had often already cached Settings with the
# production defaults (metrics on, rate limiting on), so the app was built with
# instrumentation active and the suite failed partway through. conftest.py is
# imported before every test module, so setting them here wins the race.
os.environ.setdefault("AUTH_BYPASS", "true")
os.environ.setdefault("USE_MOCK_SIGNALS", "true")
os.environ.setdefault("USE_MOCK_RISK", "true")
os.environ.setdefault("USE_MOCK_MARKET", "true")
os.environ.setdefault("USE_MOCK_PORTFOLIO", "true")
os.environ.setdefault("USE_MOCK_BROKSUM", "true")
os.environ.setdefault("METRICS_ENABLED", "false")
os.environ.setdefault("SENTRY_DSN", "")
# The suite fires hundreds of requests from one client IP; the default
# 120/minute budget would start returning 429s partway through. Rate limiting
# has its own dedicated tests — disable it everywhere else.
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

import asyncio

import pytest
import pytest_asyncio
from unittest.mock import patch

from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

from api.core import db as db_module
from api.core import redis_client as redis_module


ENV = {
    "USE_MOCK_SIGNALS": "false",
    "USE_MOCK_RISK": "false",
    "USE_MOCK_MARKET": "false",
    "USE_MOCK_PORTFOLIO": "false",
    "USE_MOCK_BROKSUM": "false",
    "AUTH_BYPASS": "true",
    "METRICS_ENABLED": "false",
    "RATE_LIMIT_ENABLED": "false",
}


# The environment a live-path test runs under: the five USE_MOCK_* flags off, so
# the real branches execute. Shared from here rather than from a single test
# module, so any future live-path test can ask for it.
LIVE_ENV = {
    "USE_MOCK_SIGNALS": "false",
    "USE_MOCK_RISK": "false",
    "USE_MOCK_MARKET": "false",
    "USE_MOCK_PORTFOLIO": "false",
    "USE_MOCK_BROKSUM": "false",
    "AUTH_BYPASS": "true",
    "METRICS_ENABLED": "false",
    "RATE_LIMIT_ENABLED": "false",
}


@pytest.fixture
def live_settings(monkeypatch):
    """
    Rebuild Settings with the mock flags off, and restore afterwards.

    Both halves matter. Setting the env is only half: `get_settings` is
    lru_cached process-wide, so without the cache_clear on the way in the flags
    would not take effect, and without the one on the way out the live Settings
    would leak into whichever test ran next. The teardown half is not optional —
    an earlier version of this fixture cleared only on entry, and two unrelated
    test modules started failing depending on collection order.
    """
    from api.core.config import get_settings

    for key, value in LIVE_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    try:
        yield get_settings()
    finally:
        get_settings.cache_clear()


@pytest.fixture(scope="session")
def app():
    """Create the FastAPI app once per test session with all mocks active."""
    from api.core.config import get_settings
    # Defensive: if any earlier import cached Settings before the env above was
    # visible, drop that cache so the app is built from the test environment.
    get_settings.cache_clear()

    from api.main import create_app
    return create_app()


@pytest.fixture
def client(app):
    """Synchronous test client."""
    return TestClient(app)


@pytest_asyncio.fixture
async def async_client(app):
    """Async test client for testing streaming endpoints."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


class _FakeRedis:
    """
    In-memory stand-in for redis.asyncio.Redis.

    The helpers in api.core.redis_client use `async with get_redis() as r`, so
    the object returned by the patched factory has to be a working async
    context manager. Returning None — as this fixture previously did — raises
    `'NoneType' object does not support the asynchronous context manager
    protocol` on the first cache read, which is why every test using it failed.
    """

    def __init__(self, store: dict[str, str]) -> None:
        self._store = store

    async def __aenter__(self) -> "_FakeRedis":
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None

    async def get(self, key: str):
        return self._store.get(key)

    async def set(self, key: str, value: str):
        self._store[key] = value

    async def setex(self, key: str, _ttl: int, value: str):
        self._store[key] = value

    async def hgetall(self, key: str) -> dict:
        return self._store.get(key, {})

    async def hset(self, key: str, mapping: dict) -> None:
        self._store.setdefault(key, {}).update(mapping)


@pytest.fixture
def mock_redis():
    """
    Patch Redis with an in-memory store so unit tests need no live server.

    Yields the backing dict, so a test can seed a cache hit or assert on what
    was written.
    """
    store: dict[str, str] = {}
    with patch("api.core.redis_client.get_redis", lambda: _FakeRedis(store)):
        yield store


class _FakePortfoliosPool:
    """
    In-memory stand-in for the asyncpg pool, covering only the statements
    api/services/portfolio_access.py issues.

    The suite has no database. Every portfolio-scoped route resolves ownership
    before it does any work, and that resolution fails closed on an unreachable
    pool — correctly, but it means the route tests were returning 503 for a
    reason unrelated to what they assert. Patching the pool rather than stubbing
    `resolve_portfolio_id` keeps the real ownership logic — including
    auto-provisioning and the conflict re-read — on the test path.
    """

    def __init__(self) -> None:
        # id -> (owner_sub, is_default, lots_json)
        self.rows: dict[str, tuple[str, bool, str]] = {}

    async def fetchval(self, query: str, *args):
        if "SELECT id FROM portfolios WHERE owner_sub" in query:
            for pid, (owner, is_default, _) in self.rows.items():
                if owner == args[0] and is_default:
                    return pid
            return None
        raise AssertionError(f"unexpected fetchval: {query!r}")

    async def fetchrow(self, query: str, *args):
        if "SELECT 1 FROM portfolios" in query:
            row = self.rows.get(args[0])
            if row is not None and row[0] == args[1]:
                return {"portfolio": 1}
            return None
        raise AssertionError(f"unexpected fetchrow: {query!r}")

    async def execute(self, query: str, *args):
        if "INSERT INTO portfolios" in query:
            pid, owner, lots = args[0], args[1], args[2]
            if pid not in self.rows:
                self.rows[pid] = (owner, True, lots)
            return "INSERT 0 1"
        raise AssertionError(f"unexpected execute: {query!r}")


@pytest.fixture(autouse=True)
def _close_db_pool():
    """
    Drop the shared asyncpg pool after every test.

    api.core.db keeps a module-level pool created on first use. The app runs one
    event loop for its lifetime, so that is fine in production — but each
    `async def` test gets a fresh loop, and a pool bound to a closed loop raises
    "attached to a different loop" on the next test that touches the database.

    This also decouples the suite from whether Postgres is running. Before this,
    a handful of live-path tests passed only because no database was listening:
    with one up they reached the real pool and failed. Either way they should
    pass, and failing closed on a dead database is the product's behaviour, not
    something the tests should be quietly relying on.
    """
    yield
    _drop_module_pool(db_module, "_pool", lambda p: p.close())
    _drop_module_pool(redis_module, "_pool", lambda p: p.disconnect())


def _drop_module_pool(module, attr: str, closer) -> None:
    """Detach and close a module-level connection pool.

    Both api.core.db and api.core.redis_client hold a process-wide pool created
    on first use. The app runs one event loop for its lifetime, so a pool bound
    to one loop is correct there. Tests do not: every `async def` test gets a
    fresh loop, and reusing a pool across them raises "attached to a different
    loop" the second time a test touches the database or Redis.
    """
    pool = getattr(module, attr, None)
    if pool is None:
        return
    setattr(module, attr, None)
    try:
        loop = asyncio.get_event_loop_policy().get_event_loop()
        if loop.is_closed():
            return
        if loop.is_running():
            loop.create_task(closer(pool))
        else:
            loop.run_until_complete(closer(pool))
    except Exception:
        pass


@pytest.fixture(autouse=True)
def fake_portfolios():
    """
    Give the ownership layer a working in-memory portfolios table, for every
    test. Autouse because the suite has no database at all: without this every
    portfolio-scoped route returns 503 from the ownership check before it can
    reach the behaviour the test is actually about.

    Yielded so a test can assert on provisioned rows, or pre-seed another
    principal's portfolio to prove cross-access is refused.
    """
    pool = _FakePortfoliosPool()

    async def _get_pool():
        return pool

    with patch("api.services.portfolio_access.get_pool", _get_pool):
        yield pool
