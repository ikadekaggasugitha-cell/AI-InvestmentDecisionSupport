"""
Minimal migration runner — closes DEPGAP-06 (no migration-tracking table).

The project migrates with plain, idempotent SQL files in db/migrations/ rather
than Alembic (which was pinned but never wired). The one thing that convention
lacked was a record of what had already run, so releases re-applied every file
by hand and hoped idempotency held. This runner adds a `schema_migrations`
ledger and applies only the pending files, in order, each inside a transaction.

Usage:
    python -m db.migrate                 # apply all pending migrations
    python -m db.migrate --status        # list applied vs pending, apply nothing
    DATABASE_URL=... python -m db.migrate

It intentionally has no dependency beyond psycopg2 (already required) so it can
run in a release step or a one-shot container without the app's full stack.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

import psycopg2

_MIGRATIONS_DIR = Path(__file__).parent / "migrations"

_LEDGER_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def _dsn() -> str:
    url = os.environ.get("DATABASE_URL", "postgresql://aidss:aidss@localhost:5432/aidss")
    # Accept the app's async DSN form and normalise it for psycopg2.
    return url.replace("postgresql+asyncpg://", "postgresql://")


def _discover() -> list[Path]:
    """Migration files in numeric order (0001_, 0002_, …)."""
    return sorted(_MIGRATIONS_DIR.glob("[0-9]*.sql"))


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def _applied(cur) -> dict[str, str]:
    cur.execute("SELECT filename, checksum FROM schema_migrations")
    return {row[0]: row[1] for row in cur.fetchall()}


def status(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(_LEDGER_DDL)
        conn.commit()
        applied = _applied(cur)

    print(f"{'STATE':10} {'CHECKSUM':18} FILE")
    changed = 0
    for path in _discover():
        name = path.name
        current = _checksum(path)
        if name not in applied:
            state = "PENDING"
        elif applied[name] != current:
            state = "MODIFIED"  # already applied, but the file changed on disk
            changed += 1
        else:
            state = "applied"
        print(f"{state:10} {current:18} {name}")
    return changed


def migrate(conn) -> int:
    applied_count = 0
    with conn.cursor() as cur:
        cur.execute(_LEDGER_DDL)
        conn.commit()
        applied = _applied(cur)

    for path in _discover():
        name = path.name
        current = _checksum(path)
        if name in applied:
            if applied[name] != current:
                print(
                    f"WARNING: {name} was already applied but its contents changed "
                    f"(recorded {applied[name]}, on disk {current}). Skipping — add a "
                    "new migration rather than editing an applied one.",
                    file=sys.stderr,
                )
            continue

        sql = path.read_text()
        with conn.cursor() as cur:
            try:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (filename, checksum) VALUES (%s, %s)",
                    (name, current),
                )
                conn.commit()
            except Exception:
                conn.rollback()
                print(f"FAILED on {name} — rolled back, nothing else applied.", file=sys.stderr)
                raise
        print(f"applied {name}")
        applied_count += 1

    if applied_count == 0:
        print("Database is up to date — no pending migrations.")
    else:
        print(f"Applied {applied_count} migration(s).")
    return applied_count


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply pending SQL migrations.")
    parser.add_argument(
        "--status", action="store_true", help="Show applied/pending state and exit."
    )
    args = parser.parse_args()

    conn = psycopg2.connect(_dsn())
    try:
        if args.status:
            status(conn)
        else:
            migrate(conn)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
