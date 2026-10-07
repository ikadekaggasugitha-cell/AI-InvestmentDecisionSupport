"""
The server-side half of Gate 2.

Written as plain `async def` tests, like the rest of the database-backed suite, so
they share pytest-asyncio's loop handling and the conftest fixture that drops the
module pool between tests.

What is being tested is a table, so these round-trip against the real
`consent_acceptances` table rather than a hand-written fake — a fake would only
prove the fake agrees with itself.

The availability probe uses psycopg2, not asyncio, and that is not incidental.
`conftest._drop_module_pool` closes the module pool after every test by fetching
the current loop from the event-loop policy; an `asyncio.run()` in a sync fixture
replaces that policy's loop and the two deadlock each other, hanging the whole
suite. A sync driver cannot interfere with a loop it never touches.
"""

import uuid

import pytest

from api.core.db import get_pool
from api.services import consent as consent_service


def _table_exists() -> bool:
    """Whether the local Postgres is up and has `consent_acceptances`."""
    import psycopg2

    from api.core.config import get_settings

    url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = None
    try:
        conn = psycopg2.connect(url)
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.consent_acceptances') IS NOT NULL")
            return bool(cur.fetchone()[0])
    except Exception:  # noqa: BLE001
        return False
    finally:
        if conn is not None:
            conn.close()


@pytest.fixture(autouse=True)
def require_table():
    if not _table_exists():
        pytest.skip("no database with consent_acceptances in this environment")


@pytest.fixture
async def account_id():
    """A real account row, since consent references one with a foreign key."""
    pool = await get_pool()
    new_id = uuid.uuid4()
    await pool.execute(
        """
        INSERT INTO users (id, email, password_hash, full_name, phone_number)
        VALUES ($1, $2, 'h', 'Uji', '081234567890')
        ON CONFLICT (id) DO NOTHING
        """,
        str(new_id),
        f"consent-{new_id}@test.invalid",
    )
    return new_id


class TestRecording:
    async def test_a_row_is_written_and_read_back(self, account_id):
        recorded = await consent_service.record_acceptance(account_id)
        assert recorded.version == consent_service.CURRENT_CONSENT_VERSION

        latest = await consent_service.latest_acceptance(account_id)
        assert latest is not None
        assert latest.version == consent_service.CURRENT_CONSENT_VERSION
        # tz-aware, so it can be compared against another instant without guessing.
        assert latest.accepted_at.tzinfo is not None

    async def test_accepting_twice_keeps_both_rows(self, account_id):
        """An update would erase the earlier record, and the earlier record is the
        part with evidentiary value."""
        await consent_service.record_acceptance(account_id)
        await consent_service.record_acceptance(account_id)

        pool = await get_pool()
        rows = await pool.fetch(
            "SELECT version FROM consent_acceptances WHERE user_id = $1", str(account_id)
        )
        assert len(rows) == 2

    async def test_deleting_the_account_deletes_its_consent(self, account_id):
        """Consent is a record *about* an account. Rows that outlive the account
        cannot be attributed to anyone, which would look like evidence that survives
        the person."""
        await consent_service.record_acceptance(account_id)

        pool = await get_pool()
        await pool.execute("DELETE FROM users WHERE id = $1", str(account_id))

        remaining = await pool.fetchval(
            "SELECT count(*) FROM consent_acceptances WHERE user_id = $1", str(account_id)
        )
        assert int(remaining) == 0


class TestCurrentVersion:
    async def test_no_acceptance_means_not_current(self):
        assert await consent_service.has_current_acceptance(uuid.uuid4()) is False

    async def test_the_current_wording_counts(self, account_id):
        await consent_service.record_acceptance(account_id)
        assert await consent_service.has_current_acceptance(account_id) is True

    async def test_an_older_wording_does_not_count(self, account_id):
        """The point of storing a version. If the text changes, people who accepted
        the old text have not accepted the new one, and treating them as though they
        had would make the whole record decorative."""
        await consent_service.record_acceptance(account_id, version="0.1.0-draft")

        latest = await consent_service.latest_acceptance(account_id)
        assert latest.version == "0.1.0-draft"
        assert await consent_service.has_current_acceptance(account_id) is False

    async def test_re_accepting_the_current_wording_restores_it(self, account_id):
        await consent_service.record_acceptance(account_id, version="0.1.0-draft")
        assert await consent_service.has_current_acceptance(account_id) is False

        await consent_service.record_acceptance(account_id)
        assert await consent_service.has_current_acceptance(account_id) is True


class TestDatabaseFailures:
    """None and "we could not ask" are different answers.

    Returning None on a connection error would report an accepted person as having
    accepted nothing, and would then let the gate re-open for them.
    """

    async def test_an_unreadable_database_is_reported(self, monkeypatch):
        from fastapi import HTTPException

        async def boom():
            raise RuntimeError("db down")

        monkeypatch.setattr(consent_service, "get_pool", boom)

        with pytest.raises(HTTPException) as caught:
            await consent_service.latest_acceptance(uuid.uuid4())
        assert caught.value.status_code == 503

    async def test_a_failed_write_is_reported_rather_than_swallowed(self, monkeypatch):
        from fastapi import HTTPException

        async def boom():
            raise RuntimeError("db down")

        monkeypatch.setattr(consent_service, "get_pool", boom)

        with pytest.raises(HTTPException) as caught:
            await consent_service.record_acceptance(uuid.uuid4())
        assert caught.value.status_code == 503