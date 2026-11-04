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
from api.services.system_settings_service import (
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


@pytest.fixture
def client(monkeypatch, mock_redis):
    """Module-level, because two classes here drive the same endpoints.

    A fixture declared inside one class cannot be reached from the other, and the
    tempting fix — a second copy of the same four environment lines — is how two
    classes end up testing two different apps.
    """
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def put_accounts(client, accounts):
    """The admin write, in the wire shape the form uses.

    `code` and `enabled` are passed only when the test names them: absent means
    the server's default, and that default is itself a case worth asserting.
    """
    return client.put(
        "/v1/admin/settings/bank-accounts",
        json={
            "accounts": [
                {
                    "bank": a["bank"],
                    "accountNumber": a["account_number"],
                    "holderName": a["holder_name"],
                    **({k: a[k] for k in ("code", "enabled") if k in a}),
                }
                for a in accounts
            ]
        },
    )


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

    def test_anonymous_reads_the_destinations(self, client):
        """Public like the price: someone who has not signed up still has to
        know where the transfer goes."""
        resp = client.get("/v1/subscriptions/bank-accounts")
        assert resp.status_code == 200
        assert resp.json() == {"accounts": []}

    def test_anonymous_write_is_401_and_a_normal_account_is_403(self, client, fake_identity):
        target = {"bank": "BCA", "account_number": "1234567890", "holder_name": "PT AIDSS"}

        assert put_accounts(client, [target]).status_code == 401

        signup(client, "biasa@aidss.id")
        assert put_accounts(client, [target]).status_code == 403
        assert _stored(fake_identity) is None

    def test_an_admin_writes_and_the_public_reads_the_same_list(
        self, client, fake_identity
    ):
        target = {"bank": "BCA", "account_number": "1234567890", "holder_name": "PT AIDSS"}
        make_admin(client, fake_identity)

        written = put_accounts(client, [target])
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
        assert put_accounts(client, [{"bank": "BCA", "account_number": "1", "holder_name": "x"}]).status_code == 200

        resp = put_accounts(client, [])
        assert resp.status_code == 422
        # The earlier list survives a refused write.
        assert len(_stored(fake_identity)["value"]["accounts"]) == 1

    def test_letters_in_the_number_are_422(self, client, fake_identity):
        make_admin(client, fake_identity)
        resp = put_accounts(
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


# ── The bank code and the visibility toggle ───────────────────────────────────


class TestBankCodeAndVisibility:
    """`code` names the bank in the registry; `enabled` decides who sees the row.

    Both are new on top of a stored shape that already exists in live installs,
    so the interesting failure is not the new write — it is the old row.
    """

    async def test_a_row_written_before_the_fields_still_reads(self, fake_identity):
        """The regression this is here to prevent.

        `read_bank_accounts` answers 503 when the stored list is unusable, and the
        payment page turns that into "destinations unreadable". If a row that
        pre-dates `code`/`enabled` parsed as broken, an install working fine
        yesterday would lose its payment page on deploy — for every customer, at
        once, with nothing the operator did.
        """
        fake_identity.settings[BANK_ACCOUNTS_KEY] = {
            "value": {"accounts": [{"bank": "BCA", "account_number": "123", "holder_name": "PT"}]},
            "updated_at": None,
        }

        read, _ = await read_bank_accounts()

        assert read == [
            BankAccountEntry(
                bank="BCA", account_number="123", holder_name="PT", code="other", enabled=True
            )
        ]
        # `other` rather than a refusal, because the name they typed is still the
        # name; and shown, because it was published before.

    async def test_an_unknown_code_is_refused_not_stored(self, fake_identity):
        """A code that is present but unknown came from something that does not
        know the list. Storing it would put a row on the form whose bank cannot
        be selected again."""
        with pytest.raises(BankAccountInvalid, match="unknown bank code"):
            await write_bank_accounts(
                [
                    {
                        "bank": "BCA",
                        "account_number": "123",
                        "holder_name": "PT",
                        "code": "bca_virtual",
                    }
                ]
            )
        assert _stored(fake_identity) is None

    async def test_a_known_code_survives_the_round_trip(self, fake_identity):
        await write_bank_accounts(
            [
                {
                    "bank": "Bank Mandiri",
                    "account_number": "123",
                    "holder_name": "PT",
                    "code": "MANDIRI",
                }
            ]
        )
        read, _ = await read_bank_accounts()
        # Case-folded on the way in: the form sends the registry's own key, and a
        # code that only matched by case would be a second code.
        assert read[0].code == "mandiri"

    def test_the_public_reader_never_sees_a_hidden_destination(self, client, fake_identity):
        """Filtered out of the response, not flagged in it.

        A browser can forget to check a flag; a byte that was never sent cannot be
        misread, and a retired account number has no business reaching a customer
        at all.
        """
        make_admin(client, fake_identity)
        resp = client.put(
            "/v1/admin/settings/bank-accounts",
            json={
                "accounts": [
                    {
                        "bank": "BCA",
                        "accountNumber": "111",
                        "holderName": "PT AIDSS",
                        "code": "bca",
                        "enabled": True,
                    },
                    {
                        "bank": "Lama",
                        "accountNumber": "222",
                        "holderName": "PT AIDSS",
                        "code": "bni",
                        "enabled": False,
                    },
                ]
            },
        )
        assert resp.status_code == 200, resp.text

        # Read the admin view first: the public read below needs the session gone,
        # and this endpoint answers 403 without one.
        admin = client.get("/v1/admin/settings/bank-accounts").json()["accounts"]
        assert [a["enabled"] for a in admin] == [True, False]
        # The code comes back, so the select can re-choose the bank it already
        # holds instead of silently resetting the row to "other" on the next save.
        assert [a["code"] for a in admin] == ["bca", "bni"]

        client.cookies.clear()
        public = client.get("/v1/subscriptions/bank-accounts").json()["accounts"]
        assert [a["accountNumber"] for a in public] == ["111"]
        assert all("enabled" not in a for a in public)

    def test_an_unknown_code_is_422_over_http(self, client, fake_identity):
        make_admin(client, fake_identity)
        resp = put_accounts(
            client,
            [{"bank": "X", "account_number": "1", "holder_name": "y", "code": "not_a_bank"}],
        )
        assert resp.status_code == 422
        assert "unknown bank code" in resp.json()["detail"]

    def test_the_bank_list_comes_from_the_server_and_only_admin_reads_it(self, client, fake_identity):
        """One list, served. A copy in the frontend would eventually disagree with
        the list the server validates against."""
        assert client.get("/v1/admin/settings/bank-options").status_code == 401

        signup(client, "biasa@aidss.id")
        assert client.get("/v1/admin/settings/bank-options").status_code == 403

        make_admin(client, fake_identity)
        codes = [o["code"] for o in client.get("/v1/admin/settings/bank-options").json()["options"]]
        assert {"bca", "mandiri", "bni", "bri", "other"} <= set(codes)


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
        from api.services import system_settings_service as settings_service

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
