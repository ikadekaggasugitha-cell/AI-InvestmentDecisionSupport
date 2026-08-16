"""
Shared pytest fixtures for the AIDSS backend test suite.
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport


@pytest.fixture(scope="session")
def app():
    """Create the FastAPI app once per test session with all mocks active."""
    import os
    os.environ.setdefault("AUTH_BYPASS", "true")
    os.environ.setdefault("USE_MOCK_SIGNALS", "true")
    os.environ.setdefault("USE_MOCK_RISK", "true")
    os.environ.setdefault("USE_MOCK_MARKET", "true")
    os.environ.setdefault("USE_MOCK_PORTFOLIO", "true")
    os.environ.setdefault("METRICS_ENABLED", "false")
    os.environ.setdefault("SENTRY_DSN", "")

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
