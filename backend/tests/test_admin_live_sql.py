"""
The two SQL statements this console added, run against a real Postgres.

The suite's fake pool matches on query text and answers in Python. That is fine
for behaviour and useless for syntax: a `FILTER (WHERE ...)`, an `AT TIME ZONE`,
or a `LEFT JOIN LATERAL` with the wrong alias shape is a green test suite and a
500 in production. `test_bank_accounts.py` learned the sibling of that lesson,
when asyncpg handing jsonb back as text hid a latent 503 inside `read_pricing`
while every fake was contentedly returning a dict.

So this file sends the actual statements to the actual driver. Everything written
here happens inside a transaction that is rolled back, so a developer's database
keeps what it already had; the figures are compared as deltas against a baseline
read rather than as absolutes, because the tables may well hold real rows.

Skipped when no database is reachable, in common with the other live tests.
"""

from datetime import datetime, timedelta, timezone

import pytest

from api.core.config import get_settings
from api.services.admin_analytics_service import _OVERVIEW_SQL, read_overview


class _Rollback(Exception):
    """Raised inside the transaction block to undo everything it wrote."""


@pytest.fixture(autouse=True)
def require_database():
    import psycopg2

    url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    try:
        conn = psycopg2.connect(url)
    except Exception:  # noqa: BLE001
        pytest.skip("no database in this environment")
    else:
        conn.close()


@pytest.fixture
def real_conn(monkeypatch):
    """A connection from the real pool, with the two services pointed at it.

    The autouse `fake_identity` fixture patches `get_pool` on the service
    modules; these tests need the opposite, so the patch is undone here the same
    way `test_bank_accounts.py`'s `real_pool` fixture does it.
    """
    from api.core.db import get_pool as _real
    from api.services import account_service, admin_analytics_service

    monkeypatch.setattr(account_service, "get_pool", _real)
    monkeypatch.setattr(admin_analytics_service, "get_pool", _real)

    return _real


STAMP = datetime.now(timezone.utc).strftime("%H%M%S%f")


async def _seed(conn):
    """One payer holding a live period, one account with two ended periods, one
    settled monthly payment and one still waiting.

    The lapsed account deliberately holds two subscriptions, older first: both
    new queries have to report the furthest end, and one that returned the first
    match would look entirely plausible right up until it understated someone's
    access.
    """
    now = datetime.now(timezone.utc)
    live_id = await conn.fetchval(
        "INSERT INTO users (email, password_hash, full_name, phone_number, role)"
        " VALUES ($1, '!test', 'Hidup', '081234567890', 'user') RETURNING id",
        f"live.{STAMP}@aidss.invalid",
    )
    lapsed_id = await conn.fetchval(
        "INSERT INTO users (email, password_hash, full_name, phone_number, role)"
        " VALUES ($1, '!test', 'Ludes', '081234567891', 'user') RETURNING id",
        f"lapsed.{STAMP}@aidss.invalid",
    )
    await conn.execute(
        "INSERT INTO subscriptions (user_id, expires_at) VALUES ($1, $2)",
        live_id,
        now + timedelta(days=20),
    )
    await conn.execute(
        "INSERT INTO subscriptions (user_id, expires_at) VALUES ($1, $2)",
        lapsed_id,
        now - timedelta(days=40),
    )
    await conn.execute(
        "INSERT INTO subscriptions (user_id, expires_at) VALUES ($1, $2)",
        lapsed_id,
        now - timedelta(days=9),
    )
    await conn.execute(
        "INSERT INTO transactions (user_id, invoice_code, amount, payment_gateway,"
        " payment_method, plan, status, approved_at)"
        " VALUES ($1, $2, 44000, 'manual', 'bank_transfer', 'monthly', 'settlement', NOW())",
        live_id,
        f"SETTLED-{STAMP}",
    )
    await conn.execute(
        "INSERT INTO transactions (user_id, invoice_code, amount, payment_gateway,"
        " payment_method, plan, status)"
        " VALUES ($1, $2, 15000, 'manual', 'bank_transfer', 'weekly', 'pending')",
        live_id,
        f"PENDING-{STAMP}",
    )
    return {"live_id": live_id, "lapsed_id": lapsed_id}


async def _read_then_rollback(conn, body):
    """Run `body(conn)` inside a transaction, then undo it."""
    try:
        async with conn.transaction():
            result = await body(conn)
            raise _Rollback()
    except _Rollback:
        return result


class TestOverviewStatement:
    async def test_the_statement_runs_and_the_deltas_are_the_rows_written(self, real_conn):
        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                base = await conn.fetchrow(_OVERVIEW_SQL)
                await _seed(conn)
                after = await conn.fetchrow(_OVERVIEW_SQL)
                return base, after

            base, after = await _read_then_rollback(conn, body)
        finally:
            await pool.release(conn)

        assert int(after["pending_queue"]) == int(base["pending_queue"]) + 1
        assert int(after["revenue_total"]) == int(base["revenue_total"]) + 44000
        assert int(after["revenue_today"]) == int(base["revenue_today"]) + 44000
        assert int(after["revenue_last_30_days"]) == int(base["revenue_last_30_days"]) + 44000
        assert int(after["settled_last_30_days"]) == int(base["settled_last_30_days"]) + 1
        # A monthly payment normalises to its own amount over a thirty-day month.
        assert int(after["mrr_run_rate"]) == int(base["mrr_run_rate"]) + 44000
        # One new account holding a running period.
        assert int(after["active_subscribers"]) == int(base["active_subscribers"]) + 1
        # One new account whose furthest period has ended. The account holding
        # two ended periods counts once, not twice.
        assert int(after["churned_subscribers"]) == int(base["churned_subscribers"]) + 1

    async def test_the_run_rate_normalises_a_weekly_payment(self, real_conn):
        """15.000 for seven days is not 15.000 of monthly run-rate. If the CASE
        denominators were wrong the run-rate would silently agree with the
        revenue total and nobody would notice for a month."""
        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                base = await conn.fetchrow(_OVERVIEW_SQL)
                user_id = await conn.fetchval(
                    "INSERT INTO users (email, password_hash, full_name, phone_number, role)"
                    " VALUES ($1, '!test', 'Mingguan', '081234567892', 'user') RETURNING id",
                    f"weekly.{STAMP}@aidss.invalid",
                )
                await conn.execute(
                    "INSERT INTO transactions (user_id, invoice_code, amount,"
                    " payment_gateway, payment_method, plan, status, approved_at)"
                    " VALUES ($1, $2, 15000, 'manual', 'bank_transfer', 'weekly',"
                    " 'settlement', NOW())",
                    user_id,
                    f"WEEKLY-{STAMP}",
                )
                after = await conn.fetchrow(_OVERVIEW_SQL)
                return base, after

            base, after = await _read_then_rollback(conn, body)
        finally:
            await pool.release(conn)

        # The statement rounds; `int()` would truncate and land one rupiah short
        # of what Postgres actually answered.
        assert int(after["mrr_run_rate"]) - int(base["mrr_run_rate"]) == round(
            15000 * 30 / 7
        )
        # Revenue stays the actual rupiah; only the run-rate is normalised.
        assert int(after["revenue_total"]) - int(base["revenue_total"]) == 15000

    async def test_a_settled_row_at_wib_dawn_counts_as_today(self, real_conn):
        """`revenue_today` is Jakarta's date, not UTC's.

        01:30 WIB today is 18:30 UTC yesterday. Comparing against a UTC midnight
        would leave the first nine hours of every Jakarta working day out of
        "today", which is exactly when a transfer declared at dawn would land.
        """
        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                base = await conn.fetchrow(_OVERVIEW_SQL)
                user_id = await conn.fetchval(
                    "INSERT INTO users (email, password_hash, full_name, phone_number, role)"
                    " VALUES ($1, '!test', 'Dini hari', '081234567894', 'user') RETURNING id",
                    f"dini.{STAMP}@aidss.invalid",
                )
                # Stamp it at 01:30 WIB on the current Jakarta date.
                wib_now = datetime.now(timezone.utc) + timedelta(hours=7)
                wib_morning = wib_now.replace(hour=1, minute=30, second=0, microsecond=0)
                await conn.execute(
                    "INSERT INTO transactions (user_id, invoice_code, amount,"
                    " payment_gateway, payment_method, plan, status, approved_at)"
                    " VALUES ($1, $2, 25000, 'manual', 'bank_transfer', 'weekly',"
                    " 'settlement', $3)",
                    user_id,
                    f"DAWN-{STAMP}",
                    wib_morning - timedelta(hours=7),
                )
                after = await conn.fetchrow(_OVERVIEW_SQL)
                return base, after

            base, after = await _read_then_rollback(conn, body)
        finally:
            await pool.release(conn)

        assert int(after["revenue_today"]) - int(base["revenue_today"]) == 25000


class TestAccountListStatement:
    async def test_the_lateral_join_reports_the_furthest_period(self, real_conn):
        """Slice 2's expiry column is one statement, not a loop, and the
        statement has to actually run. A `LEFT JOIN LATERAL` with the wrong alias
        shape is a 500 on the accounts page, and the fake never reads the text.

        The statement is run on this connection rather than through
        `list_accounts`, because that function takes its own connection from the
        pool and would not see the rows seeded below.
        """
        from api.services.account_service import _LIST_ACCOUNTS_SQL, _to_account

        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                seeded = await _seed(conn)
                rows = await conn.fetch(_LIST_ACCOUNTS_SQL, 500, 0)
                return seeded, {str(r["id"]): _to_account(r) for r in rows}

            seeded, by_id = await _read_then_rollback(conn, body)
        finally:
            await pool.release(conn)

        now = datetime.now(timezone.utc)
        live = by_id[str(seeded["live_id"])]
        assert live.expires_at is not None
        assert live.expires_at > now

        lapsed = by_id[str(seeded["lapsed_id"])]
        assert lapsed.expires_at is not None
        # The later of the two ended periods, not the first the table offered.
        age = now - lapsed.expires_at
        assert timedelta(days=8) < age < timedelta(days=11)

    async def test_an_account_with_no_period_reads_as_none(self, real_conn):
        from api.services.account_service import _LIST_ACCOUNTS_SQL, _to_account

        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                user_id = await conn.fetchval(
                    "INSERT INTO users (email, password_hash, full_name, phone_number, role)"
                    " VALUES ($1, '!test', 'Polos', '081234567893', 'user') RETURNING id",
                    f"plain.{STAMP}@aidss.invalid",
                )
                rows = await conn.fetch(_LIST_ACCOUNTS_SQL, 500, 0)
                mine = [_to_account(r) for r in rows if str(r["id"]) == str(user_id)]
                return user_id, mine

            user_id, mine = await _read_then_rollback(conn, body)
        finally:
            await pool.release(conn)

        assert mine, f"the new account {user_id} was not in the first 500 rows"
        assert mine[0].expires_at is None

    async def test_the_state_predicate_filters_on_the_driver(self, real_conn):
        """`state` has to arrive as a real WHERE clause.

        The fake answers from a Python list and would agree with a statement that
        filtered nothing at all. Here the driver either applies the predicate or
        it does not, which is the only way a wrong parameter position shows up
        before production.
        """
        from api.services.account_service import _list_accounts_query

        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                open_id = await conn.fetchval(
                    "INSERT INTO users (email, password_hash, full_name, phone_number, role)"
                    " VALUES ($1, '!test', 'Terbuka', '081234567894', 'user') RETURNING id",
                    f"open.{STAMP}@aidss.invalid",
                )
                closed_id = await conn.fetchval(
                    "INSERT INTO users (email, password_hash, full_name, phone_number, role)"
                    " VALUES ($1, '!test', 'Tertutup', '081234567895', 'user') RETURNING id",
                    f"closed.{STAMP}@aidss.invalid",
                )
                await conn.execute(
                    "UPDATE users SET blocked_at = NOW(), blocked_reason = 'admin'"
                    " WHERE id = $1",
                    closed_id,
                )

                async def ids(query, state):
                    sql, params = _list_accounts_query(2000, 0, query, state)
                    return {str(r["id"]) for r in await conn.fetch(sql, *params)}

                return (
                    str(open_id),
                    str(closed_id),
                    await ids(None, "blocked"),
                    await ids(None, "active"),
                    await ids(None, "all"),
                )

            open_id, closed_id, blocked, active, everything = await _read_then_rollback(
                conn, body
            )
        finally:
            await pool.release(conn)

        assert closed_id in blocked and open_id not in blocked
        assert open_id in active and closed_id not in active
        assert {open_id, closed_id} <= everything
        # The filtered sets are slices of the unfiltered one, not a different
        # population: a predicate that also changed the ordering or the join
        # would show up here as rows nobody asked to remove.
        assert blocked <= everything and active <= everything

    async def test_a_search_term_cannot_become_a_wildcard(self, real_conn):
        """The escaping is the statement's job, not the caller's.

        Someone typing "50%" is looking for a name containing "50%". Left
        unescaped, Postgres reads that as "anything starting with 50" and hands
        back rows the operator never searched for, which on this screen reads as
        accounts that do not exist being reported as matches.
        """
        from api.services.account_service import _list_accounts_query

        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                async def person(name, tag):
                    return str(
                        await conn.fetchval(
                            "INSERT INTO users (email, password_hash, full_name,"
                            " phone_number, role)"
                            " VALUES ($1, '!test', $2, '081234567896', 'user')"
                            " RETURNING id",
                            f"{tag}.{STAMP}@aidss.invalid",
                            name,
                        )
                    )

                percent_id = await person("Diskon 50% Hari", "pct")
                hundreds_id = await person("Diskon 500 Hari", "hun")
                under_id = await person("nama_baru", "und")
                spaced_id = await person("nama baru", "spc")

                async def ids(term):
                    sql, params = _list_accounts_query(2000, 0, term)
                    return {str(r["id"]) for r in await conn.fetch(sql, *params)}

                return (
                    await ids("50%"),
                    await ids("a_b"),
                    # The same term without its escapes, run straight, to show
                    # what the escaping is preventing on this driver rather than
                    # asserting it in the abstract.
                    {
                        str(r["id"])
                        for r in await conn.fetch(
                            "SELECT id FROM users WHERE full_name ILIKE $1",
                            "%50%",
                        )
                    },
                    percent_id,
                    hundreds_id,
                    under_id,
                    spaced_id,
                )

            percent, under, naive, percent_id, hundreds_id, under_id, spaced_id = (
                await _read_then_rollback(conn, body)
            )
        finally:
            await pool.release(conn)

        # Membership, not set equality: this runs against a developer's database
        # that may already hold rows nobody seeded here, and a test that demanded
        # an exact population would fail on someone's data rather than on code.
        assert percent_id in percent, "the percent sign stayed a percent sign"
        assert under_id in under, "the underscore stayed an underscore"
        assert hundreds_id not in percent
        assert spaced_id not in under
        # And the unescaped form really would have matched both, so the two
        # assertions above are about the escaping and not about a query that
        # returned nothing whatever it was given.
        assert {percent_id, hundreds_id} <= naive

    async def test_the_page_still_binds_after_the_predicates(self, real_conn):
        """`LIMIT` moves to `$3` once a search term is in front of it.

        The builder computes those numbers instead of writing them down, and this
        is the statement that proves the arithmetic: a page size bound to the
        search term would either 500 on the driver or return a list whose length
        has nothing to do with what was asked.
        """
        from api.services.account_service import _list_accounts_query

        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                for n in range(4):
                    await conn.fetchval(
                        "INSERT INTO users (email, password_hash, full_name,"
                        " phone_number, role)"
                        " VALUES ($1, '!test', $2, '081234567897', 'user') RETURNING id",
                        f"page{n}.{STAMP}@aidss.invalid",
                        f"Berhalaman {n}",
                    )
                sql, params = _list_accounts_query(2, 0, "Berhalaman")
                first = await conn.fetch(sql, *params)
                sql2, params2 = _list_accounts_query(2, 2, "Berhalaman")
                second = await conn.fetch(sql2, *params2)
                return first, second

            first, second = await _read_then_rollback(conn, body)
        finally:
            await pool.release(conn)

        assert len(first) == 2 and len(second) == 2
        assert {str(r["id"]) for r in first}.isdisjoint({str(r["id"]) for r in second})


class TestTheServiceOnARealDatabase:
    async def test_the_service_returns_ints_the_response_model_can_carry(self, real_conn):
        """`read_overview` through the service, so the casts (`::bigint` over a
        NUMERIC sum, Decimal to int) are exercised by the driver rather than by
        the fake's plain Python ints.

        Nothing is seeded: the service reads on its own connection and would not
        see rows inside a transaction it did not open. This proves the real query
        round-trips into the dataclass, which is the part the fake cannot show.
        """
        figures = await read_overview()

        assert isinstance(figures.revenue_total, int)
        assert isinstance(figures.mrr_run_rate, int)
        assert isinstance(figures.active_subscribers, int)
        assert figures.pending_queue >= 0
        assert figures.churned_subscribers >= 0


def test_the_overview_route_is_mounted():
    """Cheap, and it catches the mistake every other test here would miss: a
    router that is written but never included.

    Read from the OpenAPI paths rather than `app.routes`, because FastAPI 0.141
    does not flatten included routers into that list — the same behaviour that
    once made the rate limiter exempt everything silently.
    """
    from api.main import create_app

    paths = create_app().openapi()["paths"]
    assert "/v1/admin/analytics/overview" in paths
