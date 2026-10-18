"""
The `users.blocked_reason` column, in both files it has to live in.

ADR-0001's failure mode, posed against identity: a migration that exists only
under `migrations/` never reaches a freshly rebuilt stack, because db-init
applies `schema.sql` and nothing else. The two files must say the same thing
about the second kind of block.

The reason is the guarantee, not a note: 'admin' may only be opened by the
admin endpoint, 'subscription_expired' may be reopened by payment. That rule is
enforced in code elsewhere; this file pins the shape the database refuses to
let drift — the vocabulary, and the pairing of `blocked_at` with `blocked_reason`.
"""

import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
SCHEMA = BACKEND / "db" / "schema.sql"
MIGRATION = BACKEND / "db" / "migrations" / "0013_subscription_suspension.sql"


def _sql_without_comments(path: Path) -> str:
    return re.sub(r"--[^\n]*", "", path.read_text())


def _columns_of_create_users() -> str:
    """The body of CREATE TABLE users in schema.sql, guarded loudly."""
    body = re.search(
        r"CREATE TABLE IF NOT EXISTS\s+users\s*\((.*?)\n\);",
        SCHEMA.read_text(),
        re.S,
    )
    assert body, "failed to parse CREATE TABLE users out of schema.sql"
    return body.group(1)


class TestTheColumnExists:
    def test_it_is_in_the_migration_and_the_schema(self):
        blueprint = _sql_without_comments(SCHEMA)
        migration = _sql_without_comments(MIGRATION)
        assert "blocked_reason" in migration, (
            "the migration never adds the column, so an existing database has "
            "no place to record why an account is closed"
        )
        assert "blocked_reason" in blueprint, (
            "schema.sql is what db-init applies; a fresh stack without the "
            "column makes every suspension an unnamed block"
        )

    def test_it_is_a_column_of_users_in_the_schema(self):
        assert re.search(r"^\s*blocked_reason\s+VARCHAR", _columns_of_create_users(), re.M), (
            "blocked_reason must be a declared column of users, not prose"
        )


class TestTheConstraints:
    def test_the_vocabulary_is_a_named_check(self):
        for path in (SCHEMA, MIGRATION):
            sql = _sql_without_comments(path)
            assert "ck_users_blocked_reason" in sql, f"{path.name} lacks the vocabulary check"
            assert "'admin'" in sql and "'subscription_expired'" in sql, (
                "the vocabulary 'admin' | 'subscription_expired' must be in the "
                "database, or a third value becomes a second opinion anywhere code refines it"
            )

    def test_the_pairing_check_refuses_half_written_blocks(self):
        """"One fact in two columns, or none." A blocked row with no reason —
        or an open row still carrying a reason — is the row every reader then
        guesses about."""
        for path in (SCHEMA, MIGRATION):
            sql = " ".join(_sql_without_comments(path).split())
            upper = sql.upper()
            assert "ck_users_blocked_reason_shape" in sql, f"{path.name} lacks the shape check"
            assert "BLOCKED_AT IS NULL AND BLOCKED_REASON IS NULL" in upper, (
                f"{path.name} does not refuse a reason on an unblocked account"
            )
            assert "BLOCKED_AT IS NOT NULL AND BLOCKED_REASON IS NOT NULL" in upper, (
                f"{path.name} does not refuse a blocked account with no reason"
            )

    def test_the_shape_lives_in_the_table_itself_in_the_schema(self):
        """A fresh stack never runs the migration, so the pairing must be inside
        its CREATE TABLE, not an ALTER the fresh stack will never see."""
        assert "ck_users_blocked_reason_shape" in _columns_of_create_users(), (
            "schema.sql's users table has no pairing check; a fresh stack would "
            "accept half-written blocks from day one"
        )


class TestTheBackfill:
    def test_existing_blocks_become_admin(self):
        migration = _sql_without_comments(MIGRATION).upper()
        assert re.search(
            r"UPDATE\s+USERS\s+SET\s+BLOCKED_REASON\s*=\s*'ADMIN'", migration
        ), "existing blocked rows must be recorded as 'admin': they were written by the admin endpoint"

    def test_the_backfill_only_fills_what_is_missing(self):
        """Re-running (or any row that already carries a reason) must never be
        overwritten — a reason the code did not write could be replaced by one
        big word nobody said."""
        migration = _sql_without_comments(MIGRATION).upper()
        update = re.search(r"UPDATE\s+USERS\s+SET\s+BLOCKED_REASON.*?;", migration, re.S)
        assert update, "failed to find the backfill statement"
        assert "BLOCKED_REASON IS NULL" in update.group(0), (
            "the backfill has no guard, so re-running it replaces every reasons "
            "with 'admin'"
        )

    def test_the_backfill_targets_blocked_rows_only(self):
        migration = _sql_without_comments(MIGRATION).upper()
        update = re.search(r"UPDATE\s+USERS\s+SET\s+BLOCKED_REASON.*?;", migration, re.S)
        assert "BLOCKED_AT IS NOT NULL" in update.group(0), (
            "writing a reason onto an unblocked account would violate the shape "
            "the migration itself creates"
        )


class TestNothingElseChanged:
    def test_subscriptions_gains_no_status_column(self):
        """CONTEXT.md rule 1: access is `expires_at`, and money state never
        became access. The suspension lives on `users`, not here."""
        body = re.search(
            r"CREATE TABLE IF NOT EXISTS\s+subscriptions\s*\((.*?)\n\);",
            SCHEMA.read_text(),
            re.S,
        ).group(1)
        assert not re.search(r"^\s*status\b", body, re.M | re.I), (
            "subscriptions grew a status column; access would have two sources "
            "of truth"
        )
