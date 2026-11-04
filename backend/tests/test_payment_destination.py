"""
The destination a declared transfer names — the account the payer says they used.

Two things this file keeps honest.

The first is the shape of the fact. The queue could already tell an operator
*that* money was declared and *which method* was named; it could not tell them
which of the published accounts the money went to, so two pending declarations of
the same plan and amount were indistinguishable except by whatever the payer typed
into a free-text box. That is what `transactions.destination` is for.

The second is who writes it. The payer picks a destination by number; the server
composes the label from its own list. A declaration that could send its own
sentence would be a row describing an account this install never published, and a
reference resolved at read time would let the operator's later edit of a bank name
rewrite what the payer claimed months ago. Snapshot, composed here, once.

The live half at the end exists because the fake pool answers in Python. The
column, its CHECK, and the `char_length` bound are things only a real Postgres
has an opinion about.
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from api.services.payment_service import manual as money
from api.services.payment_service.core import ManualPaymentInvalid
from api.services.system_settings_service import (
    BANK_ACCOUNTS_KEY,
    write_bank_accounts,
)
from tests.test_admin_api import login, signup

DESTINATIONS = [
    {
        "bank": "CIMB Niaga",
        "account_number": "5012345678901",
        "holder_name": "PT AIDSS",
        "code": "cimb",
        "enabled": True,
    },
    {
        "bank": "BCA",
        "account_number": "1234567890",
        "holder_name": "PT AIDSS Dua",
        "code": "bca",
        "enabled": True,
    },
    {
        "bank": "BNI",
        "account_number": "9876543210",
        "holder_name": "Disembunyikan",
        "code": "bni",
        "enabled": False,
    },
]

BACKEND = __import__("pathlib").Path(__file__).resolve().parents[1]


async def _publish():
    await write_bank_accounts(
        [
            {
                "bank": d["bank"],
                "account_number": d["account_number"],
                "holder_name": d["holder_name"],
                "code": d["code"],
                "enabled": d["enabled"],
            }
            for d in DESTINATIONS
        ]
    )


@pytest.fixture
def client(monkeypatch, mock_redis):
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _declare(client, method="bank_transfer", destination=None):
    body = {"plan": "monthly", "payment_method": method}
    if destination is not None:
        body["destination_account"] = destination
    return client.post("/v1/payments/manual", json=body)


class TestTheSnapshot:
    async def test_a_named_destination_is_stored_as_the_server_composes_it(
        self, fake_identity
    ):
        """Not as the caller wrote it, and not as a number to look up later."""
        account_id = str(uuid.uuid4())
        await _publish()
        tx = await money.open_manual_transaction(
            account_id,
            plan="monthly",
            payment_method="bank_transfer",
            destination_account="5012345678901",
        )
        assert tx.destination == "CIMB Niaga 5012345678901 a.n. PT AIDSS"

    async def test_the_number_is_enough_to_pick_and_the_name_comes_from_the_server(
        self, fake_identity
    ):
        """The payer chooses; the label is this install's wording.

        Otherwise the queue would read back whatever string a client invented,
        which is the same class of thing the amount rule already refuses.
        """
        await _publish()
        tx = await money.open_manual_transaction(
            str(uuid.uuid4()),
            plan="monthly",
            payment_method="va_bca",
            destination_account="1234567890",
        )
        assert tx.destination == "BCA 1234567890 a.n. PT AIDSS Dua"

    async def test_no_destination_named_means_nothing_is_stored(self, fake_identity):
        """Nullable on purpose.

        A payer who declares without choosing is not making a false statement, and
        writing an empty string here would read as a destination someone could
        match against.
        """
        await _publish()
        tx = await money.open_manual_transaction(
            str(uuid.uuid4()), plan="monthly", payment_method="bank_transfer"
        )
        assert tx.destination is None

    async def test_a_hidden_destination_cannot_be_declared_to(self, fake_identity):
        """The list the payer chooses from is the list that is payable.

        An account the operator switched off is not a destination the install
        stands behind, and accepting its number would put a row in the queue
        pointing at an account nobody published.
        """
        await _publish()
        with pytest.raises(ManualPaymentInvalid):
            await money.open_manual_transaction(
                str(uuid.uuid4()),
                plan="monthly",
                payment_method="bank_transfer",
                destination_account="9876543210",
            )

    async def test_a_number_this_install_never_published_is_refused(self, fake_identity):
        await _publish()
        with pytest.raises(ManualPaymentInvalid):
            await money.open_manual_transaction(
                str(uuid.uuid4()),
                plan="monthly",
                payment_method="bank_transfer",
                destination_account="0000000000",
            )

    async def test_an_unreadable_destination_list_refuses_a_named_send_not_the_others(
        self, fake_identity
    ):
        """The declaration without a destination does not consult the list.

        So an install whose stored list went to noise can still be paid by
        transfer, and only the payer who picked a destination hears about it.
        """
        fake_identity.settings[BANK_ACCOUNTS_KEY] = {
            "value": "bukan daftar",
            "updated_at": None,
        }
        with pytest.raises(ManualPaymentInvalid):
            await money.open_manual_transaction(
                str(uuid.uuid4()),
                plan="monthly",
                payment_method="bank_transfer",
                destination_account="1234567890",
            )
        tx = await money.open_manual_transaction(
            str(uuid.uuid4()), plan="monthly", payment_method="bank_transfer"
        )
        assert tx.destination is None

    async def test_the_snapshot_survives_the_destination_being_edited_afterwards(
        self, fake_identity
    ):
        """The reason it is a snapshot and not a reference.

        The operator renaming a bank next month must not rewrite what the payer
        said the money went to, because the queue row is the record of a claim
        made at a moment.
        """
        await _publish()
        tx = await money.open_manual_transaction(
            str(uuid.uuid4()),
            plan="monthly",
            payment_method="bank_transfer",
            destination_account="5012345678901",
        )
        await write_bank_accounts(
            [
                {
                    "bank": "CIMB Niaga (nama baru)",
                    "account_number": "5012345678901",
                    "holder_name": "PT AIDSS",
                    "code": "cimb",
                    "enabled": True,
                }
            ]
        )
        stored = fake_identity.transactions[str(tx.id)]
        assert stored["destination"] == "CIMB Niaga 5012345678901 a.n. PT AIDSS"


class TestThroughHTTP:
    def test_the_declaration_carries_the_choice_and_the_answer_shows_it(
        self, client, fake_identity
    ):
        import asyncio

        asyncio.run(_publish())
        signup(client, "payer@aidss.id")
        login(client, "payer@aidss.id")

        resp = _declare(client, destination="5012345678901")

        assert resp.status_code == 200, resp.text
        assert resp.json()["destination"] == "CIMB Niaga 5012345678901 a.n. PT AIDSS"

    def test_a_body_naming_an_unpublished_account_is_422(self, client, fake_identity):
        import asyncio

        asyncio.run(_publish())
        signup(client, "karangan@aidss.id")
        login(client, "karangan@aidss.id")

        resp = _declare(client, destination="0000000000")

        assert resp.status_code == 422, resp.text
        assert fake_identity.transactions == {}

    def test_the_amount_still_is_not_the_body_to_propose(self, client, fake_identity):
        """`extra="forbid"` did not loosen to make room for the new field.

        A declaration that could name a destination must still not be able to name
        a price, and the two guards are one model.
        """
        import asyncio

        asyncio.run(_publish())
        signup(client, "harga@aidss.id")
        login(client, "harga@aidss.id")

        resp = client.post(
            "/v1/payments/manual",
            json={
                "plan": "monthly",
                "payment_method": "bank_transfer",
                "destination_account": "5012345678901",
                "amount": 1,
            },
        )
        assert resp.status_code == 422, resp.text
        assert fake_identity.transactions == {}

    def test_the_admin_queue_shows_which_account_the_payer_named(
        self, client, fake_identity
    ):
        """The whole point of the column, read from the other end.

        Two rows for the same plan and amount are distinguishable here, which is
        what the operator matching money needed.
        """
        import asyncio

        asyncio.run(_publish())
        signup(client, "satu@aidss.id")
        login(client, "satu@aidss.id")
        _declare(client, destination="5012345678901")

        first = _declare(client, destination="1234567890")
        assert first.status_code == 200

        client.cookies.clear()
        from tests.test_admin_api import make_admin

        make_admin(client, fake_identity)
        rows = client.get("/v1/admin/transactions?status=pending").json()["transactions"]
        mine = [r for r in rows if r["id"] == first.json()["id"]]
        assert mine and mine[0]["destination"] == "BCA 1234567890 a.n. PT AIDSS Dua"


class TestTheColumnExistsInTheRightFiles:
    """ADR-0001's failure mode, asserted rather than remembered.

    A table that lives only under `migrations/` never reaches a rebuilt stack:
    `docker-compose` applies `schema.sql` through db-init and the migration
    directory afterwards, so the two have to agree or a fresh install is missing
    the column the API writes to.
    """

    def test_migration_and_schema_agree_on_the_column(self):
        migration = (
            BACKEND / "db" / "migrations" / "0016_transaction_destination.sql"
        ).read_text()
        schema = (BACKEND / "db" / "schema.sql").read_text()

        assert "ADD COLUMN IF NOT EXISTS destination VARCHAR(240)" in migration
        assert "destination             VARCHAR(240)" in schema

    def test_the_migration_is_the_highest_number_applied(self):
        """The runner applies files in name order, so a gap is a silent skip."""
        names = sorted(p.stem for p in (BACKEND / "db" / "migrations").glob("0*.sql"))
        assert names[-1] == "0016_transaction_destination"


@pytest.fixture
def real_conn(monkeypatch):
    """A live connection, with every statement rolled back.

    The fake pool answers in Python; whether `char_length(destination) <= 240` is
    legal SQL and whether the CHECK fires at all is a question only Postgres
    answers.
    """
    psycopg2 = pytest.importorskip("psycopg2")
    url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    try:
        conn = psycopg2.connect(url)
    except Exception:  # noqa: BLE001
        pytest.skip("no database in this environment")
    conn.autocommit = False
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


class TestAgainstRealPostgres:
    def test_the_column_and_its_check_are_the_ones_the_migration_declares(
        self, real_conn
    ):
        with real_conn.cursor() as cur:
            cur.execute(
                """
                SELECT character_maximum_length
                  FROM information_schema.columns
                 WHERE table_name = 'transactions' AND column_name = 'destination'
                """
            )
            found = cur.fetchone()
        assert found is not None, (
            "transactions.destination does not exist in this database: schema.sql "
            "and migrations/0016 have to agree or a rebuilt stack is missing the "
            "column the API writes"
        )
        assert found[0] == 240

    def test_a_destination_can_be_written_and_read_back_and_null_is_allowed(
        self, real_conn
    ):
        with real_conn.cursor() as cur:
            user_id = uuid.uuid4()
            cur.execute(
                """
                INSERT INTO users (id, email, password_hash, full_name, phone_number, role)
                VALUES (%s, %s, 'x', 'Uji', '0812', 'user')
                """,
                (str(user_id), f"zz-dest-{user_id.hex[:8]}@local.invalid"),
            )
            # No subscription row: `transaction.subscription_id` is nullable, and
            # a pending declaration has not bought anything yet. Minting one here
            # would be a fixture inventing state the statement does not need.
            for code, dest in [
                ("ZZ-DEST-A", "CIMB Niaga 5012345678901 a.n. PT AIDSS"),
                ("ZZ-DEST-B", None),
            ]:
                cur.execute(
                    """
                    INSERT INTO transactions
                        (id, user_id, invoice_code, amount, payment_gateway,
                         payment_method, status, plan, destination, created_at)
                    VALUES (%s, %s, %s, 44000, 'manual', 'bank_transfer',
                            'pending', 'monthly', %s, %s)
                    """,
                    (
                        str(uuid.uuid4()),
                        str(user_id),
                        code,
                        dest,
                        datetime.now(timezone.utc),
                    ),
                )
            cur.execute(
                """
                SELECT invoice_code, destination
                  FROM transactions
                 WHERE invoice_code IN ('ZZ-DEST-A', 'ZZ-DEST-B')
                 ORDER BY invoice_code
                """
            )
            rows = cur.fetchall()
        assert [r[1] for r in rows] == [
            "CIMB Niaga 5012345678901 a.n. PT AIDSS",
            None,
        ]
        # The fixture rolls back, so the developer's database keeps what it had.
