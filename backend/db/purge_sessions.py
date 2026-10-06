"""
Delete expired sessions.

`sessions_service.purge_expired_sessions` has existed since the opaque-session
switch but nothing ever called it, so the table only ever grew. Expired rows are
not a security problem on their own — `authenticate` refuses them on `expires_at`
regardless — but they are the reason a slow query on `idx_sessions_expires_at`
becomes a slow query on every login, and the count of what an operator should be
able to see without asking the database is the count this produces.

Not a Celery task, for the same reason the service function is not: this repo's
Beat schedule has a WIB/UTC history, and a daily delete wants a predictable wall
clock more than it wants a worker. Put it in cron or a scheduler container:

    python -m db.purge_sessions
    python -m db.purge_sessions --dry-run

`--dry-run` counts without deleting, which is the form to run first when the
table is unexpectedly large: it answers "how much of this is expiry versus real
accounts" before anything irreversible happens. Deleting a session is cheap and
recoverable — the person signs in again — so this is not a destructive operation
in any meaningful sense.

Dependencies are the app's own settings and session service, so this cannot point
at a different database than the app does.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.services import sessions as sessions_service  # noqa: E402
from api.services.sessions import purge_expired_sessions  # noqa: E402


async def _count_expired() -> int:
    """Count without deleting, for --dry-run."""
    # Through the session service's own pool accessor, so this and the delete
    # cannot end up aimed at two different databases.
    pool = await sessions_service.get_pool()
    row = await pool.fetchrow("SELECT count(*) AS n FROM sessions WHERE expires_at < NOW()")
    return int(row["n"]) if row else 0


async def _run(dry_run: bool) -> int:
    if dry_run:
        count = await _count_expired()
        print(f"{count} expired session(s). Nothing was deleted.")
        return 0
    deleted = await purge_expired_sessions()
    print(f"Deleted {deleted} expired session(s).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m db.purge_sessions",
        description="Delete sessions whose expiry has passed.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="count expired sessions without deleting anything",
    )
    args = parser.parse_args(argv)
    return asyncio.run(_run(args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())