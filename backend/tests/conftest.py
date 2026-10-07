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
# The suite runs with the paywall off so the route tests reach the behaviour they
# are about. The gate itself is not left untested: TestPaywallGate in
# tests/test_paywall.py turns this on and drives all three states, including the
# database being unreachable.
os.environ.setdefault("PAYWALL_ENABLED", "false")
os.environ.setdefault("USE_MOCK_SIGNALS", "true")
os.environ.setdefault("USE_MOCK_RISK", "true")
os.environ.setdefault("USE_MOCK_MARKET", "true")
os.environ.setdefault("USE_MOCK_PORTFOLIO", "true")
os.environ.setdefault("USE_MOCK_BROKSUM", "true")
os.environ.setdefault("METRICS_ENABLED", "false")
os.environ.setdefault("SENTRY_DSN", "")
# Rate limiting stays ON. It used to be disabled here on the grounds that
# "rate limiting has its own dedicated tests" — those tests did not exist, so the
# feature ran permanently unexercised, and a version incompatibility in it (slowapi
# could not find the route handler on FastAPI 0.141, so every route was silently
# exempt) went unnoticed for as long as this line stood. See tests/test_rate_limit.py.
#
# The suite still needs a bigger budget, because every request arrives from one
# client address and would otherwise exhaust the production 120/minute partway
# through. A larger budget keeps the limiter on the request path, which is the thing
# that was actually missing: an off switch proves nothing about the code it disables.
os.environ.setdefault("RATE_LIMIT_ENABLED", "true")
os.environ.setdefault("RATE_LIMIT_TEST_BUDGET", "1000000/minute")

import asyncio

import pytest
import pytest_asyncio
from unittest.mock import patch

from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

from api.core import db as db_module
from api.core import redis_client as redis_module


ENV = {
    "PAYWALL_ENABLED": "false",
    "USE_MOCK_SIGNALS": "false",
    "USE_MOCK_RISK": "false",
    "USE_MOCK_MARKET": "false",
    "USE_MOCK_PORTFOLIO": "false",
    "USE_MOCK_BROKSUM": "false",
    "AUTH_BYPASS": "true",
    "METRICS_ENABLED": "false",
    "RATE_LIMIT_ENABLED": "true",
    # Larger than production so the suite's hundreds of requests from one address
    # do not exhaust the budget mid-test. The limiter stays active.
    "RATE_LIMIT_TEST_BUDGET": "1000000/minute",
}


# The environment a live-path test runs under: the five USE_MOCK_* flags off, so
# the real branches execute. Shared from here rather than from a single test
# module, so any future live-path test can ask for it.
LIVE_ENV = {
    "PAYWALL_ENABLED": "false",
    "USE_MOCK_SIGNALS": "false",
    "USE_MOCK_RISK": "false",
    "USE_MOCK_MARKET": "false",
    "USE_MOCK_PORTFOLIO": "false",
    "USE_MOCK_BROKSUM": "false",
    "AUTH_BYPASS": "true",
    "METRICS_ENABLED": "false",
    "RATE_LIMIT_ENABLED": "true",
    # Larger than production so the suite's hundreds of requests from one address
    # do not exhaust the budget mid-test. The limiter stays active.
    "RATE_LIMIT_TEST_BUDGET": "1000000/minute",
}


@pytest.fixture
def seeded_positions():
    """
    Positions for the fake portfolios table, keyed by portfolio id.

    Every analytics path reads `lots_json` now (ADR-0005), so a test that wants a
    curve or a risk figure has to say whose positions it is describing. Without
    this the default is an empty portfolio and the honest answer is "nothing to
    measure" — correct, and useless for a test about the arithmetic.

    Two accounts with different holdings are available so a cross-account leak is
    visible rather than merely absent: if one account's curve can be produced from
    the other's positions, the values differ.
    """
    import json as _json

    return {
        "default": _json.dumps({"BBCA": 2000, "BBRI": 3500, "TLKM": 5000}),
        "pf_alice": _json.dumps({"ASII": 2800, "ICBP": 1500}),
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

    async def delete(self, *keys: str) -> int:
        """Absent before this, and its absence was silent: cache invalidation
        raises AttributeError on a real Redis-shaped object, which the callers
        catch and log as a warning. A test asserting the cache was cleared would
        then pass against code that cleared nothing."""
        removed = 0
        for key in keys:
            if self._store.pop(key, None) is not None:
                removed += 1
        return removed

    async def keys(self, pattern: str = "*"):
        """Glob matching, which is all the callers need.

        `fnmatch` rather than a hand-rolled matcher because a subtly wrong pattern
        implementation would make an invalidation test pass or fail for reasons
        that have nothing to do with the code under test.
        """
        import fnmatch

        return [k for k in self._store if fnmatch.fnmatch(k, pattern)]


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
        # id -> (owner_id, is_default, lots_json). owner_id is accounts.id, which
        # is a UUID; ownership was a free-text token subject before migration
        # 0005 and is a foreign key now.
        self.rows: dict[str, tuple[str, bool, str]] = {}

    async def fetchval(self, query: str, *args):
        if "SELECT id FROM portfolios WHERE user_id" in query:
            for pid, (owner, is_default, _) in self.rows.items():
                if owner == args[0] and is_default:
                    return pid
            return None
        if "SELECT lots_json FROM portfolios" in query:
            # portfolio_access.load_lots. Returns the stored JSON text, so the
            # loader's str/bytes handling is exercised rather than bypassed.
            row = self.rows.get(args[0])
            return row[2] if row is not None else None
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
        if "UPDATE portfolios SET lots_json" in query:
            # ($1 is the jsonb payload, $2 the portfolio id) — the parameter order
            # in the SQL, which is the reverse of the column order.
            lots, pid = args[0], args[1]
            if pid not in self.rows:
                raise AssertionError(f"no such portfolio: {pid!r}")
            owner, is_default, _ = self.rows[pid]
            self.rows[pid] = (owner, is_default, lots)
            return "UPDATE 1"
        raise AssertionError(f"unexpected execute: {query!r}")

    def lots_for(self, portfolio_id: str) -> dict:
        """The stored positions for one portfolio, decoded."""
        import json as _json

        return _json.loads(self.rows[portfolio_id][2])


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

class _IdentityPool:
    """
    In-memory users, sessions and subscriptions.

    AUTH_BYPASS resolves to a real Account row rather than a string, because
    portfolios.user_id is a foreign key and a synthetic principal cannot own
    anything. That means the whole suite now needs an identity table even though
    it has no database, so this provides the minimum: enough for the bypass
    account to be created, a session to be opened, and the entitlement check to
    answer yes or no.

    `subscriptions` is exposed so a test can seed an expired and an unexpired
    period and check that only the latter grants access.
    """

    def __init__(self) -> None:
        import uuid
        from datetime import datetime, timedelta, timezone

        self._uuid = uuid
        self._now = datetime
        self._tz = timezone
        self._timedelta = timedelta
        self.users: dict[str, dict] = {}          # lower(email) -> row
        self.consents: dict[str, dict] = {}   # user_id -> latest acceptance
        self.sessions: dict[str, dict] = {}       # sha256(token) -> row
        self.subscriptions: list[dict] = []
        self.fail = False                         # simulate a full outage
        self.fail_subscriptions = False            # simulate the entitlement query alone failing

    # -- accounts

    async def fetchrow(self, query, *args):
        self._guard()
        if "INSERT INTO users" in query:
            email = args[0].lower()
            if email in self.users:
                return None
            row = {
                "id": self._uuid.uuid4(),
                "email": email,
                "password_hash": args[1] if len(args) > 1 else "!bypass",
                "full_name": args[2] if len(args) > 2 else "Operator Tunggal",
                "phone_number": args[3] if len(args) > 3 else "000000000000",
                "role": args[4] if len(args) > 4 else "admin",
                "blocked_at": None,
                "created_at": self._now.now(self._tz.utc),
            }
            self.users[email] = row
            return row
        if "FROM users" in query and "lower(email)" in query:
            row = self.users.get(args[0].lower())
            if row is None:
                return None
            return {**row, "password_hash": row["password_hash"]}
        if "FROM users" in query and "WHERE id = $1" in query:
            for row in self.users.values():
                if str(row["id"]) == str(args[0]):
                    return row
            return None
        # Checked before the profile branch: set_blocked's RETURNING clause also
        # lists full_name, so a `and "full_name" in query` test matches both
        # statements and the wrong branch reads args[2] off a two-argument call.
        if "INSERT INTO consent_acceptances" in query:
            row = {
                "id": self._uuid.uuid4(),
                "user_id": args[0],
                "version": args[1],
                "accepted_at": self._now.now(self._tz.utc),
            }
            self.consents[str(args[0])] = row
            return {"version": row["version"], "accepted_at": row["accepted_at"]}
        if "FROM consent_acceptances" in query:
            return self.consents.get(str(args[0]))
        if "UPDATE users SET blocked_at" in query:
            # accounts.set_blocked. $1 is the id, $2 the boolean.
            for row in self.users.values():
                if str(row["id"]) == str(args[0]):
                    row["blocked_at"] = (
                        self._now.now(self._tz.utc) if args[1] else None
                    )
                    return {k: row[k] for k in
                            ("id", "email", "full_name", "phone_number", "role",
                             "blocked_at", "created_at")}
            return None
        if "UPDATE users" in query and "full_name" in query:
            for row in self.users.values():
                if str(row["id"]) == str(args[0]):
                    row["full_name"] = args[1]
                    row["phone_number"] = args[2]
                    return {k: row[k] for k in
                            ("id", "email", "full_name", "phone_number", "role",
                             "blocked_at", "created_at")}
            return None
        if "FROM subscriptions" in query and "ORDER BY expires_at DESC" in query:
            # subscription router: the longest unexpired period. ORDER BY honoured
            # here because which row comes back is the whole point of the query.
            target = str(args[0])
            now = self._now.now(self._tz.utc)
            live = [
                r for r in self.subscriptions
                if str(r["user_id"]) == target and r["expires_at"] > now
            ]
            if not live:
                return None
            best = max(live, key=lambda r: r["expires_at"])
            return {"id": best["user_id"], "expires_at": best["expires_at"]}
        if "JOIN users" in query and "FROM sessions" in query:
            # accounts.authenticate: session lookup, expiry and blocked check in
            # one statement.
            row = self.sessions.get(args[0])
            if row is None:
                return None
            if row["expires_at"] <= self._now.now(self._tz.utc):
                return None
            for user in self.users.values():
                if str(user["id"]) == str(row["user_id"]):
                    return {
                        "id": user["id"],
                        "email": user["email"],
                        "full_name": user["full_name"],
                        "phone_number": user["phone_number"],
                        "role": user["role"],
                        "blocked_at": user["blocked_at"],
                        "created_at": user["created_at"],
                    }
            return None
        raise AssertionError(f"unexpected identity fetchrow: {query!r}")

    async def fetch(self, query, *args):
        if "FROM consent_acceptances" in query:
            rows = [
                {"version": r["version"], "accepted_at": r["accepted_at"]}
                for r in self.consents.values()
            ]
            return rows
        if "FROM users" in query:
            # Newest first, matching the endpoint's ORDER BY. The fake does not
            # implement LIMIT/OFFSET: paging is FastAPI's job and is tested against
            # the response shape, not against this stand-in.
            rows = sorted(self.users.values(),
                          key=lambda r: r["created_at"], reverse=True)
            return [{k: r[k] for k in
                     ("id", "email", "full_name", "phone_number", "role",
                      "blocked_at", "created_at")} for r in rows]
        raise AssertionError(f"unexpected identity fetch: {query!r}")

    # -- sessions + entitlement

    async def execute(self, query, *args):
        self._guard()
        if "INSERT INTO sessions" in query:
            self.sessions[args[0]] = {
                "id": args[0],
                "user_id": args[1],
                "expires_at": args[2],
            }
            return "INSERT 0 1"
        if "DELETE FROM sessions WHERE id = $1" in query:
            existed = self.sessions.pop(args[0], None) is not None
            return "DELETE 1" if existed else "DELETE 0"
        if "DELETE FROM sessions WHERE expires_at" in query:
            return "DELETE 0"
        if "DELETE FROM sessions WHERE user_id" in query:
            target = str(args[0])
            doomed = [k for k, v in self.sessions.items() if str(v["user_id"]) == target]
            for k in doomed:
                del self.sessions[k]
            return f"DELETE {len(doomed)}"
        if "UPDATE users SET password_hash" in query:
            for row in self.users.values():
                if str(row["id"]) == str(args[0]):
                    row["password_hash"] = args[1]
            return "UPDATE 1"
        raise AssertionError(f"unexpected identity execute: {query!r}")

    async def fetchval(self, query, *args):
        self._guard()
        if self.fail_subscriptions and "FROM subscriptions" in query:
            raise ConnectionError("entitlement query is unreachable")
        if "FROM subscriptions" in query and "expires_at > NOW()" in query:
            target = str(args[0])
            now = self._now.now(self._tz.utc)
            for row in self.subscriptions:
                if str(row["user_id"]) == target and row["expires_at"] > now:
                    return 1
            return None
        raise AssertionError(f"unexpected identity fetchval: {query!r}")

    def _guard(self):
        if self.fail:
            raise ConnectionError("identity database is unreachable")

    # -- helpers for tests

    def add_subscription(self, account_id, days: int) -> None:
        self.subscriptions.append(
            {
                "user_id": account_id,
                "expires_at": self._now.now(self._tz.utc) + self._timedelta(days=days),
            }
        )


@pytest.fixture(autouse=True)
def fake_identity():
    """
    Give the identity layer a working in-memory users/sessions/subscriptions set.

    Autouse for the same reason fake_portfolios is: AUTH_BYPASS now resolves to a
    real Account row, so without this every authenticated route in the suite would
    fail at the account lookup before reaching whatever it is actually testing.

    Yielded so a test can seed a subscription, block an account, or set `fail` to
    make the database unreachable.
    """
    pool = _IdentityPool()

    async def _get_pool():
        return pool

    with patch("api.services.accounts.get_pool", _get_pool), \
         patch("api.services.sessions.get_pool", _get_pool), \
         patch("api.services.entitlements.get_pool", _get_pool), \
         patch("api.services.consent.get_pool", _get_pool), \
         patch("api.routers.subscription.get_pool", _get_pool):
        yield pool
