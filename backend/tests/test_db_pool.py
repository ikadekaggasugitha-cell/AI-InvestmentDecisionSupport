"""
Shared DB pool helpers.

The pool itself needs a live Postgres, so these cover the pure, always-reachable
bits: the DSN rewrite (asyncpg rejects SQLAlchemy's `+asyncpg` dialect form) and
that shutdown is safe when no pool was ever built.
"""

import api.core.db as db


def test_dsn_strips_sqlalchemy_dialect():
    dsn = db._dsn()
    assert dsn.startswith("postgresql://")
    assert "+asyncpg" not in dsn


async def test_close_pool_is_a_noop_when_uninitialised():
    # No pool has been created in the test process (mock mode never hits the DB),
    # so closing must not raise.
    assert db._pool is None
    await db.close_pool()
    assert db._pool is None
