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


class TestNotificationOutboxStatement:
    """The outbox's SQL, on a real server.

    Every guarantee this table carries is a database feature, not Python: the
    unique key that stops a second welcome mail, the CHECK that keeps the
    vocabulary closed, the cascade that follows an account away, and the
    `FOR UPDATE SKIP LOCKED` claim that lets two workers drain one queue. A fake
    answering these queries in Python would only be proving the fake agrees with
    the service about a shape neither of them enforced.
    """

    async def _seed_user(self, conn, tag: str) -> str:
        return str(
            await conn.fetchval(
                "INSERT INTO users (email, password_hash, full_name, phone_number, role)"
                " VALUES ($1, '!test', 'Kabar Uji', '081234567898', 'user') RETURNING id",
                f"{tag}.{STAMP}@aidss.invalid",
            )
        )

    async def _enqueue(self, conn, user_id, source_id, event="payment_approved"):
        from api.services.notification_service import _ENQUEUE_SQL

        return await conn.fetchrow(
            _ENQUEUE_SQL,
            user_id,
            event,
            f"{event[:12]}-{STAMP}@example.test",
            "Subjek",
            "Isi pesan",
            source_id,
        )

    async def test_one_source_one_message_however_often_it_is_offered(self, real_conn):
        """The idempotency key, which is the whole reason a repeat approve is safe.

        `approve_transaction` answers a second press with the period it already
        minted. Without this key the same press would also queue a second
        confirmation, and the payer would reasonably wonder which one is real.
        """
        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                user_id = await self._seed_user(conn, "idem")
                source = str((await conn.fetchval("SELECT gen_random_uuid()")))
                first = await self._enqueue(conn, user_id, source)
                second = await self._enqueue(conn, user_id, source)
                count = await conn.fetchval(
                    "SELECT count(*) FROM notification_outbox WHERE source_id = $1", source
                )
                # A different event on the same source is a different message,
                # and must still be allowed — the key is the pair, not the row.
                third = await self._enqueue(conn, user_id, source, event="payment_denied")
                return first, second, count, third

            first, second, count, third = await _read_then_rollback(conn, body)
        finally:
            await pool.release(conn)

        assert first is not None
        assert second is None, "the same message offered twice yields no second row"
        assert int(count) == 1
        assert third is not None

    async def test_the_vocabulary_and_the_references_are_enforced_here(self, real_conn):
        """Not by a comment and not by the service: by the table.

        Each of these is a shape a future caller could invent — an event nobody
        defined, a channel the transport cannot send, an address belonging to no
        account — and the database has to be the one that says no.
        """
        import asyncpg

        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                user_id = await self._seed_user(conn, "checks")
                source = str((await conn.fetchval("SELECT gen_random_uuid()")))
                ghost_id = str((await conn.fetchval("SELECT gen_random_uuid()")))
                raised: dict[str, str] = {}

                # Each refusal is tried in its own savepoint. Inside one
                # transaction, the first error aborts everything after it, so a
                # sequence of expected failures would report the first one and
                # then InFailedSQLTransactionError for the rest — which would look
                # like the other constraints do not exist.
                async def expect(kind, label, awaitable):
                    try:
                        async with conn.transaction():
                            await awaitable()
                    except kind as exc:
                        raised[label] = str(exc)

                await expect(
                    asyncpg.CheckViolationError,
                    "bad_event",
                    lambda: self._enqueue(conn, user_id, source, event="invoice_printed"),
                )
                await expect(
                    asyncpg.CheckViolationError,
                    "bad_channel",
                    lambda: conn.execute(
                        "INSERT INTO notification_outbox (user_id, event, channel,"
                        " recipient, subject, body_text)"
                        " VALUES ($1, 'payment_approved', 'whatsapp', 'x', 's', 'b')",
                        user_id,
                    ),
                )
                await expect(
                    asyncpg.CheckViolationError,
                    "bad_status",
                    lambda: conn.execute(
                        "INSERT INTO notification_outbox (user_id, event, recipient,"
                        " subject, body_text, status)"
                        " VALUES ($1, 'payment_approved', 'x', 's', 'b', 'queued')",
                        user_id,
                    ),
                )
                await expect(
                    asyncpg.ForeignKeyViolationError,
                    "ghost_user",
                    # The id is minted here rather than inside the lambda: `await`
                    # in a lambda is a syntax error, and the value is not what the
                    # test is about.
                    lambda: self._enqueue(conn, ghost_id, source),
                )

                return raised

            raised = await _read_then_rollback(conn, body)
        finally:
            await pool.release(conn)

        assert set(raised) == {"bad_event", "bad_channel", "bad_status", "ghost_user"}, (
            "a CHECK or a foreign key that does not fire is a rule that only "
            "exists in the comment above it"
        )

    async def test_an_account_that_goes_away_takes_its_queued_mail_with_it(
        self, real_conn
    ):
        """Cascade, because a row addressed to nobody is work with no target.

        The consent suite relies on this too: deleting an account must not leave
        the outbox holding a message for a person who no longer exists.
        """
        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                user_id = await self._seed_user(conn, "cascade")
                source = str((await conn.fetchval("SELECT gen_random_uuid()")))
                await self._enqueue(conn, user_id, source)
                before = await conn.fetchval(
                    "SELECT count(*) FROM notification_outbox WHERE user_id = $1", user_id
                )
                await conn.execute("DELETE FROM users WHERE id = $1", user_id)
                after = await conn.fetchval(
                    "SELECT count(*) FROM notification_outbox WHERE user_id = $1", user_id
                )
                return before, after

            before, after = await _read_then_rollback(conn, body)
        finally:
            await pool.release(conn)

        assert int(before) == 1
        assert int(after) == 0

    async def test_the_claim_holds_a_row_back_rather_than_offering_it_twice(
        self, real_conn
    ):
        """`FOR UPDATE SKIP LOCKED`, and the window that follows it.

        The claim bumps `attempts` and pushes `next_attempt_at` past the send
        window in the same statement. Without that, a second worker — or the same
        beat two minutes later while a slow server is still being talked to —
        would claim the row again and send the message twice.

        Three rows, three different jobs: one due now, one due later, and one that
        is claimed second to carry the retry ladder. `next_attempt_at` is set
        explicitly rather than left at its default, because every statement in
        this transaction shares one `NOW()` and an `ORDER BY` on identical values
        would pick rows at random — a test that passes on the ordering Postgres
        happened to choose today is not a test.
        """
        from datetime import timedelta

        from api.services.notification_service import (
            _CLAIM_SQL,
            _MAX_ATTEMPTS,
            _MARK_FAILED_SQL,
            _MARK_SENT_SQL,
        )

        base = datetime.now(timezone.utc)

        pool = await real_conn()
        conn = await pool.acquire()
        try:
            async def body(conn):
                user_id = await self._seed_user(conn, "claim")
                ids = {}
                for name, minutes in (("first", -5), ("later", 30), ("second", -3)):
                    source = str(await conn.fetchval("SELECT gen_random_uuid()"))
                    row = await self._enqueue(conn, user_id, source)
                    ids[name] = str(row["id"])
                    await conn.execute(
                        "UPDATE notification_outbox SET next_attempt_at = $2"
                        " WHERE id = $1",
                        ids[name],
                        base + timedelta(minutes=minutes),
                    )

                # One row per beat, oldest due first.
                claimed_first = await conn.fetch(_CLAIM_SQL, 1, timedelta(minutes=2))
                # The same beat again: `first` is now held back by its own window,
                # so the worker takes `second`, and never `later`, which is not due.
                claimed_second = await conn.fetch(_CLAIM_SQL, 1, timedelta(minutes=2))
                claimed_third = await conn.fetch(_CLAIM_SQL, 5, timedelta(minutes=2))

                await conn.execute(_MARK_SENT_SQL, ids["first"])
                # fetchrow, not fetchval: two columns are asked for, and fetchval
                # would hand back only the first one as a bare string.
                sent_status = await conn.fetchrow(
                    "SELECT status, attempts FROM notification_outbox WHERE id = $1",
                    ids["first"],
                )

                # The retry ladder on the second row, driven the way the service
                # drives it: the threshold is always the same, and what changes is
                # how many attempts the row has already spent. Both halves matter —
                # a statement that simply wrote 'failed' would pass only the second
                # one, and a statement that never wrote it would pass only the first.
                await conn.execute(
                    _MARK_FAILED_SQL,
                    ids["second"],
                    "relay refused",
                    _MAX_ATTEMPTS,
                    timedelta(minutes=5),
                )
                after_one = await conn.fetchval(
                    "SELECT status FROM notification_outbox WHERE id = $1", ids["second"]
                )
                # Spend the rest of the budget, as five claimed attempts would.
                await conn.execute(
                    "UPDATE notification_outbox SET attempts = $2 WHERE id = $1",
                    ids["second"],
                    _MAX_ATTEMPTS,
                )
                await conn.execute(
                    _MARK_FAILED_SQL,
                    ids["second"],
                    "relay refused",
                    _MAX_ATTEMPTS,
                    timedelta(minutes=5),
                )
                after_last = await conn.fetchrow(
                    "SELECT status, last_error, next_attempt_at > NOW() AS waiting"
                    " FROM notification_outbox WHERE id = $1",
                    ids["second"],
                )
                return (
                    [str(r["id"]) for r in claimed_first],
                    [str(r["id"]) for r in claimed_second],
                    [str(r["id"]) for r in claimed_third],
                    sent_status,
                    after_one,
                    after_last,
                )

            got_first, got_second, got_third, sent, after_one, after_last = (
                await _read_then_rollback(conn, body)
            )
        finally:
            await pool.release(conn)

        assert len(got_first) == 1 and len(got_second) == 1
        assert got_first[0] != got_second[0], "two beats must not take the same row"
        assert got_third == [], "the not-yet-due row is not work, and the rest are held"
        assert sent["status"] == "sent"
        assert sent["attempts"] == 1
        assert after_one == "pending", "a first failure must stay retryable"
        assert after_last["status"] == "failed", "the last attempt ends the row"
        assert after_last["last_error"] == "relay refused"
        assert after_last["waiting"] is True, "a failed row is given a backoff, not a retry now"


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
