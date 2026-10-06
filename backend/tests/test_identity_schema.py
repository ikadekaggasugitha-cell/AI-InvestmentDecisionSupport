"""
The identity schema must keep the shape the ADRs decided.

These assertions are static — they parse the two SQL files rather than connecting
to a database — because CI runs without a Postgres service and because a check
that only runs where a database happens to exist is not a check.

Each test below pins a decision that was made for a reason and would otherwise be
quietly undone by the next person who finds a column inconvenient:

- ADR-0001 — a table that exists only in migrations/ never appears in a rebuilt
  stack, because the db-init service applies schema.sql and nothing else. That is
  not a theoretical risk; it is the reason 0004 said "fresh installs also get this
  table from schema.sql".
- ADR-0002 — no status column on subscriptions, and owner_sub retired in stages.
- ADR-0004 — opaque sessions storing a hash, revoked by deleting rows.
- CONTEXT.md — "subscriber" is a derived term, never a stored value.

A reverted decision here costs a migration. A migration costs a rewrite of the
column on every existing row, so the cheap place to catch it is a text file.
"""

import re
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "db"
SCHEMA = DB / "schema.sql"
MIGRATION = DB / "migrations" / "0005_auth_and_sessions.sql"
MIGRATION_0006 = DB / "migrations" / "0006_retire_owner_sub.sql"

CREATE_TABLE_RE = re.compile(
    r"CREATE TABLE IF NOT EXISTS\s+(?P<name>\w+)\s*\((?P<body>.*?)\n\);", re.I | re.S
)


def _tables(path: Path) -> dict[str, str]:
    """Map table name to the text of its column definitions."""
    return {m.group("name").lower(): m.group("body") for m in CREATE_TABLE_RE.finditer(path.read_text())}


def _columns(body: str) -> dict[str, str]:
    """Map column name to its definition line, ignoring index and constraint lines."""
    out: dict[str, str] = {}
    for raw in body.splitlines():
        line = raw.strip().rstrip(",")
        if not line or line.upper().startswith(("PRIMARY KEY", "UNIQUE", "CHECK", "FOREIGN KEY")):
            continue
        name = line.split()[0]
        if re.fullmatch(r"\w+", name):
            out[name.lower()] = line
    return out


class TestSchemaAndMigrationAgree:
    """ADR-0001's failure mode: a table in migrations/ that a rebuilt stack never gets."""

    def test_both_files_exist(self):
        assert SCHEMA.is_file(), "schema.sql is what db-init applies on every deploy"
        assert MIGRATION.is_file(), "0005 is how an existing database gets the same tables"

    def test_every_migrated_table_is_also_in_schema(self):
        migrated = set(_tables(MIGRATION))
        declared = set(_tables(SCHEMA))
        assert migrated, "failed to parse any CREATE TABLE out of 0005"
        missing = sorted(migrated - declared)
        assert not missing, (
            f"{missing} exist only in migrations/0005. docker-compose db-init applies "
            "schema.sql and nothing else, so these tables would never appear in a "
            "freshly rebuilt stack."
        )

    def test_identity_tables_are_present_in_schema(self):
        declared = set(_tables(SCHEMA))
        for name in ("users", "sessions", "subscriptions"):
            assert name in declared, f"{name} missing from schema.sql"


class TestUsersTable:
    def test_role_is_authorisation_only(self):
        """CONTEXT.md: Subscriber is derived, so it must not be a storable role."""
        cols = _columns(_tables(SCHEMA)["users"])
        match = re.search(r"CHECK\s*\((.*?)\)", cols["role"], re.I)
        assert match, "users.role must stay constrained; an open CHECK will drift"
        allowed = set(re.findall(r"'([^']+)'", match.group(1)))
        assert allowed == {"user", "admin"}, (
            f"users.role allows {sorted(allowed)}; CONTEXT.md fixes it at user and admin"
        )
        assert "subscriber" not in allowed, (
            "subscriber is a derived term in CONTEXT.md, not a role. Storing it "
            "creates two sources of truth for one fact."
        )

    def test_default_role_is_not_privileged(self):
        cols = _columns(_tables(SCHEMA)["users"])
        assert "DEFAULT 'user'" in cols["role"], "a new account must not default to admin"

    def test_phone_number_is_required(self):
        """legal-and-consent.md requires it and it is the only notification channel."""
        cols = _columns(_tables(SCHEMA)["users"])
        assert "NOT NULL" in cols["phone_number"], (
            "phone_number is the only notification channel the product has; making it "
            "nullable means half-registered accounts nobody can reach"
        )

    def test_blocked_timestamp_not_a_boolean(self):
        cols = _columns(_tables(SCHEMA)["users"])
        assert "is_active" not in cols, (
            "blocked_at replaced is_active so that 'when was it blocked' is a fact "
            "rather than something the boolean discards"
        )
        assert "blocked_at" in cols
        assert "NOT NULL" not in cols["blocked_at"], "NULL is what means 'not blocked'"

    def test_email_uniqueness_is_case_insensitive(self):
        text = SCHEMA.read_text()
        assert re.search(r"CREATE UNIQUE INDEX[^;]*lower\(\s*email\s*\)", text, re.I), (
            "without a unique index on lower(email), User@x and user@x become two "
            "accounts, two sessions and two portfolios"
        )

    def test_no_seeded_system_account(self):
        """schema.sql runs on every deploy, so a credential here would never rotate."""
        text = SCHEMA.read_text()
        seeds = re.findall(r"INSERT\s+INTO\s+users\b", text, re.I)
        assert not seeds, (
            "schema.sql is applied by db-init on every `docker compose up`; a seeded "
            "credential would be copied into every install. Promote admins with a "
            "maintenance script instead."
        )


class TestSessionsTable:
    def test_no_revocation_column(self):
        """ADR-0004: revocation is deleting the row, so no revoked_at."""
        cols = _columns(_tables(SCHEMA)["sessions"])
        assert "revoked_at" not in cols, (
            "revocation is DELETE FROM sessions; a revoked_at column would be a "
            "second representation of the same fact"
        )

    def test_token_column_is_sized_for_a_sha256(self):
        cols = _columns(_tables(SCHEMA)["sessions"])
        assert "VARCHAR(64)" in cols["id"], (
            "the stored id is a hex SHA-256, which is 64 characters"
        )

    def test_session_is_bound_to_an_account(self):
        cols = _columns(_tables(SCHEMA)["sessions"])
        assert "REFERENCES users(id)" in cols["user_id"], (
            "a session must name the account it authenticates"
        )


class TestSubscriptionsTable:
    def test_no_status_column(self):
        """ADR-0002: access is derived from expires_at, never stored."""
        cols = _columns(_tables(SCHEMA)["subscriptions"])
        assert "status" not in cols, (
            "a stored status is a second source of truth for the same fact as "
            "expires_at, and the beat job that kept it current is what we removed"
        )

    def test_no_cancellation_column(self):
        """CONTEXT.md rule 8: blocking the account is what stops access."""
        cols = _columns(_tables(SCHEMA)["subscriptions"])
        assert "canceled_at" not in cols and "cancelled_at" not in cols, (
            "nothing can write a cancellation; blocking the account is the mechanism, "
            "and it already exists on users"
        )

    def test_no_payment_columns_yet(self):
        """R5-Q3: they arrive in Phase 2 with payments, not before."""
        cols = _columns(_tables(SCHEMA)["subscriptions"])
        for name in ("plan_id", "plan_type", "price", "price_paid"):
            assert name not in cols, (
                f"{name} cannot be filled until payments exist; adding it now produces "
                "a column that can only ever be NULL"
            )

    def test_expiry_is_the_only_temporal_fact(self):
        cols = _columns(_tables(SCHEMA)["subscriptions"])
        assert "expires_at" in cols
        assert "starts_at" not in cols, (
            "an access check is `expires_at > NOW()`; starts_at is read by nothing and "
            "a per-row default would be wrong for an early renewal"
        )


class TestPortfoliosOwnership:
    def test_owner_is_a_required_foreign_key(self):
        """The column that decides who owns what must be unnullable and enforced."""
        cols = _columns(_tables(SCHEMA)["portfolios"])
        assert "user_id" in cols
        assert "REFERENCES users(id)" in cols["user_id"], (
            "an owner column without a foreign key is the string key this migration "
            "exists to remove"
        )
        assert "NOT NULL" in cols["user_id"], (
            "a nullable owner is a portfolio nobody owns; 0006 sets it NOT NULL"
        )

    def test_owner_sub_is_gone(self):
        """ADR-0002: retired in 0006. A column nothing can write is not a safety net."""
        cols = _columns(_tables(SCHEMA)["portfolios"])
        assert "owner_sub" not in cols, (
            "owner_sub held the JWT subject; an opaque session carries a user_id, so "
            "nothing can write it any more"
        )
        # A mention in a comment is fine and wanted: the comment is what tells the
        # next reader why the column is absent. What must not survive is the column.
        column_block = re.search(
            r"CREATE TABLE IF NOT EXISTS portfolios\s*\((.*?)\n\);", SCHEMA.read_text(), re.S
        )
        assert column_block and "owner_sub" not in column_block.group(1), (
            "a vestigial owner_sub column invites someone to keep reading it"
        )

    def test_indexes_key_on_the_column_that_is_written(self):
        """A unique index on a dropped column guards nothing: NULLs do not collide."""
        text = SCHEMA.read_text()
        for name in ("uq_portfolios_one_default", "idx_portfolios_user"):
            match = re.search(rf"{name}[^;]*;", text, re.I)
            assert match, f"{name} is missing from schema.sql"
            assert "user_id" in match.group(0), (
                f"{name} must key on user_id; on owner_sub it protects nothing"
            )

    def test_migration_0006_hands_the_bypass_portfolio_to_its_own_account(self):
        text = MIGRATION_0006.read_text()
        assert re.search(r"UPDATE\s+portfolios", text, re.I), "0006 must backfill before dropping"
        assert "dev-user" in text, (
            "the principal 0004 warned about has no account to join on; 0005 gives it "
            "one, so its portfolio has to be handed over rather than left behind"
        )

    def test_migration_0006_refuses_to_invent_an_owner(self):
        """Deleting an unowned portfolio loses someone's positions. Say so instead."""
        text = MIGRATION_0006.read_text()
        assert re.search(r"RAISE\s+EXCEPTION", text, re.I), (
            "unresolvable rows must stop the migration, not be deleted or reassigned"
        )
        assert not re.search(r"DELETE\s+FROM\s+portfolios", text, re.I), (
            "0006 must not delete portfolios"
        )

    def test_migration_0006_drops_the_column_only_after_the_check(self):
        text = MIGRATION_0006.read_text()
        check = text.find("RAISE EXCEPTION")
        drop = text.find("DROP COLUMN")
        assert check != -1 and drop != -1
        assert check < drop, (
            "the orphan check has to run first, or the column that identifies the "
            "orphans is already gone when it runs"
        )


class TestNoOrphanedTransactionTasks:
    def test_expiry_sweep_task_is_not_scheduled(self):
        """It would write a status column this schema deliberately has none of."""
        celery = Path(__file__).resolve().parents[1] / "workers" / "celery_app.py"
        text = celery.read_text()
        assert "check_and_expire" not in text, (
            "access is derived from expires_at; a sweep that marks rows expired would "
            "be writing a fact the schema no longer stores"
        )

class TestMigration0006IsIdempotent:
    """0006 dropped a column its own backfill reads.

    The first version guarded the backfill on nothing, so re-running it against an
    already-migrated database aborted on `column p.owner_sub does not exist`. The
    ledger reports MODIFIED rather than broken, which is how a migration that is
    unsafe to re-run can still look installed.
    """

    def test_backfill_is_guarded_on_the_column_still_existing(self):
        text = MIGRATION_0006.read_text()
        assert re.search(
            r"IF\s+EXISTS[\s\S]{0,200}column_name\s*=\s*'owner_sub'", text, re.I
        ), "the dev-user backfill must check that owner_sub still exists"

    def test_the_orphan_check_is_guarded_too(self):
        text = MIGRATION_0006.read_text()
        assert text.count("column_name = 'owner_sub'") >= 2, (
            "both the backfill and the orphan check reference owner_sub, so both "
            "have to be guarded or a re-run aborts"
        )

    def test_dropping_the_column_is_still_if_exists(self):
        text = MIGRATION_0006.read_text()
        assert re.search(r"DROP\s+COLUMN\s+IF\s+EXISTS\s+owner_sub", text, re.I), (
            "the drop itself must stay idempotent"
        )
