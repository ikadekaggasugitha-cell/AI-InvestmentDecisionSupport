"""
`bank_accounts` in system_settings — the destinations a manual transfer pays to.

Task 3 of the payment plan. The service rules this file pins:

  * Reading and writing happen here, not as SQL in a router — the same rule
    pricing follows, because a second writer would make two places where the
    list can drift apart.
  * An empty list is refused on write. Saving one and deleting every
    destination are the same action, so it stays an operator's decision rather
    than an accident.
  * The account number rejects anything that is not digits: a number with a
    letter in it tells a visitor to transfer to an account that does not exist.
  * `contact_support` is not part of this change — it stays unwritten until its
    own plan.

The suite's fake pool stores the value as a dict; the live driver hands jsonb
over as text. The roundtrip test at the end runs against a real database when
one is up, so the text path cannot drift away unnoticed the way it did for
read_pricing.
"""

import json

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from api.services.settings import (
    BANK_ACCOUNTS_KEY,
    BankAccountEntry,
    BankAccountInvalid,
    read_bank_accounts,
    write_bank_accounts,
)
from tests.test_admin_api import make_admin, signup

_LIST = [
    {"bank": "BCA", "account_number": "1234567890", "holder_name": "PT AIDSS"},
    {"bank": "BNI", "account_number": "9876543210", "holder_name": "PT AIDSS Kedua"},
]


def _stored(fake_identity):
    return fake_identity.settings.get(BANK_ACCOUNTS_KEY)


class TestWriteReadThroughTheService:
    async def test_what_was_written_is_what_is_read_back(self, fake_identity):
        stored = await write_bank_accounts(_LIST)

        assert stored == [
            BankAccountEntry(bank="BCA", account_number="1234567890", holder_name="PT AIDSS"),
            BankAccountEntry(bank="BNI", account_number="9876543210", holder_name="PT AIDSS Kedua"),
        ]
        read, updated = await read_bank_accounts()
        assert read == stored
        assert updated is not None

    async def test_an_install_that_never_set_one_read_empty(self, fake_identity):
        read, updated = await read_bank_accounts()
        assert read == []
        assert updated is None

    async def test_an_empty_list_is_refused_and_changes_nothing(self, fake_identity):
        await write_bank_accounts(_LIST)
        before = json.dumps(_stored(fake_identity), default=str)

        with pytest.raises(BankAccountInvalid):
            await write_bank_accounts([])
        assert json.dumps(_stored(fake_identity), default=str) == before

    async def test_a_number_with_letters_is_refused(self, fake_identity):
        for number in ("1234ABCD7890", "12 34", "", "+62-81"):
            with pytest.raises(BankAccountInvalid):
                await write_bank_accounts(
                    [
                        {
                            "bank": "BCA",
                            "account_number": number,
                            "holder_name": "Pemilik",
                        }
                    ]
                )
        # Nothing partial was stored by any of those attempts.
        assert _stored(fake_identity) is None

    async def test_a_missing_field_is_refused(self, fake_identity):
        with pytest.raises(BankAccountInvalid):
            await write_bank_accounts(
                [{"bank": "BCA", "account_number": "1234567890"}]
            )
        with pytest.raises(BankAccountInvalid):
            await write_bank_accounts(
                [{"account_number": "1234567890", "holder_name": "Pemilik"}]
            )
        with pytest.raises(BankAccountInvalid):
            await write_bank_accounts([{"bank": "", "account_number": "1", "holder_name": "x"}])

    async def test_more_than_the_ceiling_is_refused(self, fake_identity):
        too_many = [
            {
                "bank": "BCA",
                "account_number": f"{n:016d}",
                "holder_name": "Pemilik",
            }
            for n in range(21)
        ]
        with pytest.raises(BankAccountInvalid):
            await write_bank_accounts(too_many)

    async def test_contact_support_is_not_touched(self, fake_identity):
        """This task is one key, not the blueprint's remaining two."""
        await write_bank_accounts(_LIST)
        assert "contact_support" not in fake_identity.settings


class TestOverHTTP:
    """The public read and the admin write, as the payment page and the admin
    panel will call them."""

    @pytest.fixture
    def client(self, monkeypatch, mock_redis):
        monkeypatch.setenv("AUTH_BYPASS", "false")
        monkeypatch.setenv("PAYWALL_ENABLED", "false")
        monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
        monkeypatch.setenv("METRICS_ENABLED", "false")
        get_settings.cache_clear()
        from api.main import create_app

        yield TestClient(create_app())
        get_settings.cache_clear()

    def _put(self, client, accounts):
        return client.put(
            "/v1/admin/settings/bank-accounts",
            json={
                "accounts": [
                    {
                        "bank": a["bank"],
                        "accountNumber": a["account_number"],
                        "holderName": a["holder_name"],
                    }
                    for a in accounts
                ]
            },
        )

    def test_anonymous_reads_the_destinations(self, client):
        """Public like the price: someone who has not signed up still has to
        know where the transfer goes."""
        resp = client.get("/v1/subscriptions/bank-accounts")
        assert resp.status_code == 200
        assert resp.json() == {"accounts": []}

    def test_anonymous_write_is_401_and_a_normal_account_is_403(self, client, fake_identity):
        target = {"bank": "BCA", "account_number": "1234567890", "holder_name": "PT AIDSS"}

        assert self._put(client, [target]).status_code == 401

        signup(client, "biasa@aidss.id")
        assert self._put(client, [target]).status_code == 403
        assert _stored(fake_identity) is None

    def test_an_admin_writes_and_the_public_reads_the_same_list(
        self, client, fake_identity
    ):
        target = {"bank": "BCA", "account_number": "1234567890", "holder_name": "PT AIDSS"}
        make_admin(client, fake_identity)

        written = self._put(client, [target])
        assert written.status_code == 200, written.text
        assert written.json()["accounts"][0]["accountNumber"] == "1234567890"

        # The public reader holds no session — the payment page is exactly that.
        client.cookies.clear()
        public = client.get("/v1/subscriptions/bank-accounts")
        assert public.status_code == 200
        assert public.json() == {
            "accounts": [
                {"bank": "BCA", "accountNumber": "1234567890", "holderName": "PT AIDSS"}
            ]
        }

    def test_an_empty_list_is_422_not_a_delete(self, client, fake_identity):
        make_admin(client, fake_identity)
        assert self._put(client, [{"bank": "BCA", "account_number": "1", "holder_name": "x"}]).status_code == 200

        resp = self._put(client, [])
        assert resp.status_code == 422
        # The earlier list survives a refused write.
        assert len(_stored(fake_identity)["value"]["accounts"]) == 1

    def test_letters_in_the_number_are_422(self, client, fake_identity):
        make_admin(client, fake_identity)
        resp = self._put(
            client,
            [{"bank": "BCA", "account_number": "12AB", "holder_name": "Pemilik"}],
        )
        assert resp.status_code == 422
        assert "digits" in resp.json()["detail"]
        assert _stored(fake_identity) is None

    def test_only_an_admin_can_read_the_form_endpoint(self, client, fake_identity):
        """The admin read is 403 for everyone else, so the form never asks the
        public endpoint and loses the refusal."""
        assert client.get("/v1/admin/settings/bank-accounts").status_code == 401

        signup(client, "biasa@aidss.id")
        assert client.get("/v1/admin/settings/bank-accounts").status_code == 403

        make_admin(client, fake_identity)
        assert client.get("/v1/admin/settings/bank-accounts").status_code == 200


# ── Live roundtrip ───────────────────────────────────────────────────────────

class TestAgainstTheRealDatabase:
    """When a database is up, run the write and the read through the real driver.

    asyncpg hands jsonb over as text, which the suite's fake pool cannot show.
    That exact difference already hid a latent 503 inside read_pricing; this
    roundtrip keeps the text path from drifting again. `real_pool` points the
    settings service past the autouse fake, the same way
    tests/test_consent_service.py does for consent.
    """

    def _restore_row(self, key, previous) -> None:
        import psycopg2
        from psycopg2.extras import Json

        url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
        with psycopg2.connect(url) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM system_settings WHERE key = %s", (key,))
            if previous is not None:
                cur.execute(
                    "INSERT INTO system_settings (key, value, updated_at) VALUES (%s, %s, %s)",
                    (key, Json(previous["value"]), previous["updated_at"]),
                )

    @pytest.fixture(autouse=True)
    def require_database(self):
        import psycopg2

        url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
        try:
            conn = psycopg2.connect(url)
        except Exception:  # noqa: BLE001
            pytest.skip("no database in this environment")
        else:
            conn.close()

    @pytest.fixture
    def real_pool(self, monkeypatch):
        from api.core.db import get_pool as _real
        from api.services import settings as settings_service

        monkeypatch.setattr(settings_service, "get_pool", _real)
        return _real

    async def test_write_and_read_survive_the_text_roundtrip(self, real_pool):
        pool = await real_pool()
        row = await pool.fetchrow(
            "SELECT value, updated_at FROM system_settings WHERE key = $1",
            BANK_ACCOUNTS_KEY,
        )
        previous = (
            None if row is None else {"value": json.loads(row["value"]), "updated_at": row["updated_at"]}
        )
        try:
            entries = [
                BankAccountEntry(bank="BCA", account_number="1234567890", holder_name="PT AIDSS")
            ]

            stored = await write_bank_accounts(
                [
                    {
                        "bank": e.bank,
                        "account_number": e.account_number,
                        "holder_name": e.holder_name,
                    }
                    for e in entries
                ]
            )
            read, updated = await read_bank_accounts()

            assert stored == entries
            assert read == entries
            assert updated is not None
        finally:
            self._restore_row(BANK_ACCOUNTS_KEY, previous)
