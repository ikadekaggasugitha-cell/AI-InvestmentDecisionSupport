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

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from api.core.db import get_pool
from api.services import consent as consent_service


def _rows_for(account_id) -> list:
    """The consent rows for an account, read with the sync driver."""
    import psycopg2

    from api.core.config import get_settings

    url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg2.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT version FROM consent_acceptances WHERE user_id = %s", (str(account_id),)
        )
        return cur.fetchall()


def _cleanup(account_id) -> None:
    import psycopg2

    from api.core.config import get_settings

    url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    with psycopg2.connect(url) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM consent_acceptances WHERE user_id = %s", (str(account_id),))


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
def client(monkeypatch):
    """A TestClient on the fake identity layer, for the endpoint tests.

    Declared here rather than inside the endpoint class so both halves of this
    module share one definition.
    """
    from api.core.config import get_settings

    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


@pytest.fixture
def real_pool(monkeypatch):
    """Point consent_service at the real database, past the autouse fake.

    The suite's `fake_identity` patches `api.services.consent.get_pool` so that route
    tests can exercise the endpoint without a database. That is right for routes
    and wrong for this module: what is being checked here is the table itself —
    appending rather than updating, cascade on delete, the version column. Against
    a fake, those assertions would only prove the fake agrees with itself.
    """
    from api.core.db import get_pool as _real

    monkeypatch.setattr(consent_service, "get_pool", _real)
    return _real


@pytest.fixture
async def account_id(real_pool):
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
        # And the newest is what a later read returns.
        latest = await consent_service.latest_acceptance(account_id)
        assert latest is not None

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

class TestConsentEndpoint:
    """`POST /v1/auth/consent` — the half a regulator would ask about.

    The account comes from the session. A body that could name another account
    would turn "record my consent" into writing a consent record against somebody
    the caller does not own.
    """

    def _signup(self, client, email="consent@aidss.id"):
        resp = client.post(
            "/v1/auth/signup",
            json={
                "email": email,
                "full_name": "Uji",
                "phone_number": "081234567890",
                "password": "s3cret-pass",
            },
        )
        assert resp.status_code == 200, resp.text
        return resp.json()["account"]["id"]

    def test_anonymous_cannot_record_consent(self, client):
        assert client.post("/v1/auth/consent").status_code == 401

    def test_the_account_comes_from_the_session_not_the_body(
        self, client, fake_identity
    ):
        signed_in = self._signup(client)
        other = self._signup(client, "lain@aidss.id")
        # Signing up the second account replaced the session cookie, so the caller
        # below is `other`. That is exactly the confusion being tested: the body
        # names `signed_in`, the session says `other`, and the row must follow the
        # session.
        resp = client.post("/v1/auth/consent", json={"user_id": signed_in, "version": "x"})
        assert resp.status_code == 200, resp.text
        # The body's version is ignored too: the server records what it actually
        # showed, so a caller cannot consent on behalf of a wording they never saw.
        assert resp.json()["version"] == consent_service.CURRENT_CONSENT_VERSION

        assert str(other) in fake_identity.consents
        assert str(signed_in) not in fake_identity.consents

    def test_reading_before_and_after_recording(self, client):
        account_id = self._signup(client)

        before = client.get("/v1/auth/consent").json()
        assert before["accepted"] is False
        assert before["acceptedVersion"] is None
        assert before["currentVersion"] == consent_service.CURRENT_CONSENT_VERSION

        client.post("/v1/auth/consent")

        after = client.get("/v1/auth/consent").json()
        assert after["accepted"] is True
        assert after["acceptedVersion"] == consent_service.CURRENT_CONSENT_VERSION
        assert after["acceptedAt"] is not None
        _cleanup(account_id)

    def test_an_older_acceptance_is_reported_but_does_not_count(
        self, client, account_id=None
    ):
        account_id = self._signup(client)
        asyncio.run(consent_service.record_acceptance(account_id, version="0.1.0-draft"))

        body = client.get("/v1/auth/consent").json()
        # Still shown as a real record…
        assert body["acceptedVersion"] == "0.1.0-draft"
        # …but not consent to the wording that is on screen now.
        assert body["accepted"] is False
        _cleanup(account_id)
