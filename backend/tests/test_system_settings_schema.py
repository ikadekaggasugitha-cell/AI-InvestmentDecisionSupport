"""
The `system_settings` table and the shape of the pricing it holds.

ADR-0001's failure mode has a specific shape here: a table that exists only in
`migrations/` is never applied to a freshly rebuilt stack, because docker-compose
runs `db-init`, which applies `schema.sql` and nothing else. `schema.sql` is the
as-built schema; these files migrate an existing database toward it.

The other thing worth pinning is what the table is *for*. `docs/status.md`
recorded "harga dan rekening tujuan tidak ada sumbernya" — the price existed in a
document and nowhere else. This table is that source, which means it is also the
only place a price may be written from.
"""

import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
SCHEMA = BACKEND / "db" / "schema.sql"
MIGRATION = BACKEND / "db" / "migrations" / "0011_system_settings_pricing.sql"

# The prices the owner decided, and the migration that writes them.
SEED_MONTHLY = 15_000
SEED_ANNUAL = 150_000


def _tables(text: str) -> dict[str, str]:
    """Map table name -> the body of its CREATE TABLE.

    Guarded the same way test_identity_schema guards its own parser: a regex that
    stops matching must fail loudly here rather than making every assertion below
    pass against an empty string. ADR-0007 records the same trap.
    """
    out: dict[str, str] = {}
    pattern = re.compile(
        r"CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\((.*?)\n\);", re.S
    )
    for name, body in pattern.findall(text):
        out[name] = body
    return out


def _seeded_keys(sql: str) -> set[str]:
    """Keys named in INSERT statements, ignoring comments.

    Matching the raw text would flag a migration that *explains* why bank_accounts
    is absent, which is the opposite of what this test is for.
    """
    body = re.sub(r"--[^\n]*", "", sql)
    keys = re.search(r"INSERT\s+INTO\s+system_settings\s*\((.*?)\)\s*VALUES(.*?);",
                     body, re.S | re.I)
    if not keys:
        return set()
    return set(re.findall(r"\(\s*'([a-z_]+)'\s*,", keys.group(2), re.I))


def _columns(body: str) -> set[str]:
    return {
        line.strip().split()[0].lower()
        for line in body.splitlines()
        if line.strip() and not line.strip().upper().startswith("CONSTRAINT")
    }


class TestTheTableExists:
    def test_both_files_exist(self):
        assert SCHEMA.is_file(), "schema.sql is what db-init applies on every deploy"
        assert MIGRATION.is_file(), "0011 is how an existing database gets the table"

    def test_the_parser_still_matches(self):
        """Guard the guard, before anything reads through it."""
        body = _tables(SCHEMA.read_text()).get("system_settings")
        assert body, "failed to parse system_settings out of schema.sql"
        assert _columns(body), "parsed a body but found no columns in it"

    def test_it_is_in_both_the_migration_and_the_schema(self):
        assert "system_settings" in _tables(MIGRATION.read_text())
        assert "system_settings" in _tables(SCHEMA.read_text()), (
            "system_settings exists only in the migration. db-init applies "
            "schema.sql, so a freshly rebuilt stack would have no table to read a "
            "price out of and the public endpoint would 503 on every install."
        )


class TestThePricingKey:
    def test_the_columns_are_the_ones_the_queries_use(self):
        cols = _columns(_tables(SCHEMA.read_text())["system_settings"])
        for name in ("key", "value", "description", "updated_at"):
            assert name in cols, f"system_settings.{name} is missing from schema.sql"

    def test_the_value_column_holds_json(self):
        body = _tables(SCHEMA.read_text())["system_settings"]
        assert "JSONB" in body.upper(), (
            "the price is read as a structured object; a TEXT column would make "
            "every read a string that has to be parsed by hand"
        )

    def test_the_row_is_written(self):
        """A table with a reader and no writer is how `blocked_at` shipped."""
        assert "INSERT INTO SYSTEM_SETTINGS" in MIGRATION.read_text().upper(), (
            "0011 creates the table and never fills it, so every install answers "
            "the public pricing endpoint with nothing"
        )

    def test_it_does_not_clobber_a_price_an_admin_already_set(self):
        """The migration runs once. If it overwrote, every redeploy would silently
        undo whatever the operator set — and the operator would never know why the
        number kept snapping back.

        Comments are stripped first. The migration explains this clause in prose,
        and matching the raw text would pass while the SQL lost it.
        """
        sql = re.sub(r"--[^\n]*", "", MIGRATION.read_text()).upper()
        insert = re.search(r"INSERT INTO SYSTEM_SETTINGS.*;", sql, re.S)
        assert insert, "failed to find the seeding statement"
        assert "ON CONFLICT" in insert.group(0), (
            "0011 inserts without ON CONFLICT, so re-running it overwrites the "
            "current price with the seeded one"
        )

    def test_the_seeded_prices_are_the_ones_that_were_decided(self):
        """Matched as numbers inside the JSON literal, not as substrings.

        `str(15000) in text` also passes on 150000 and on the word "15000" in a
        comment, so it would stay green with the monthly price deleted entirely.
        """
        body = re.sub(r"--[^\n]*", "", MIGRATION.read_text())
        found = {
            field: int(re.search(rf'"{field}":\s*(\d+)', body).group(1))
            for field in ("monthly", "annual")
        }
        assert found == {"monthly": SEED_MONTHLY, "annual": SEED_ANNUAL}

    def test_only_the_price_key_is_seeded(self):
        """`bank_accounts` and `contact_support` belong to a payment path that does
        not exist. Seeding them now means shipping rows nothing can read or write,
        which is the state docs/status.md already flags as a debt."""
        seeded = _seeded_keys(MIGRATION.read_text())
        assert seeded == {"pricing"}, (
            f"0011 seeds {sorted(seeded)}; only `pricing` has a reader, a writer "
            "and a path behind it"
        )

    def test_no_status_column_was_sneaked_in(self):
        """CONTEXT.md rule 5. A 'current price is active' flag beside the price is
        a second place for the same fact, and the first time it drifted, the app
        would quote a price it was not selling at."""
        cols = _columns(_tables(SCHEMA.read_text())["system_settings"])
        assert not (cols & {"active", "is_active", "enabled", "status"})