"""
Delete superseded Gate 2 consent rows.

`consent_acceptances` keeps one row per acceptance, so an account that accepted the
notice twice has two rows and the older one only says "they accepted some earlier
wording". That history is useful until it is old enough that keeping it stops being
defensible under UU PDP, at which point it is just retained personal data nobody
looks at.

The newest row per account is never deleted. It is the answer to "have they accepted
this?", and removing it would leave an account that can never satisfy the gate again
without re-consenting — which is the opposite of what a retention policy is for.

Retention length is `CONSENT_RETENTION_MONTHS` (default 24, ADR-0004). Zero means
keep everything, which is a legitimate policy and does nothing here.

Usage:
    python -m db.purge_consent --dry-run
    python -m db.purge_consent
    python -m db.purge_consent --months 36   # override, for a one-off
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.core.config import get_settings  # noqa: E402
from api.core.db import get_pool  # noqa: E402

# A row is kept when no *other* row for the same account is newer. The `id` tiebreak
# matters: two rows written in the same transaction can share an `accepted_at`, and
# without it "newest" is undefined for that pair — the NOT EXISTS would be true for
# both, so both would be deleted and the account would be left with no consent at all.
#
# Written as one statement rather than a delete loop so the row set cannot change
# between deciding and deleting.
# EXISTS, not NOT EXISTS. The question for a row being considered is "is there
# something newer for this account?" — if yes, this row is superseded and
# disposable; if no, it is the only record of this acceptance and stays.
_IS_SUPERSEDED = """
EXISTS (
    SELECT 1 FROM consent_acceptances AS newer
     WHERE newer.user_id = c.user_id
       AND (newer.accepted_at, newer.id) > (c.accepted_at, c.id)
)
"""

_SQL_DELETE = (
    "DELETE FROM consent_acceptances AS c "
    " WHERE c.accepted_at < NOW() - make_interval(months => $1::int) "
    "   AND " + _IS_SUPERSEDED
)

_SQL_COUNT = (
    "SELECT count(*) AS n FROM consent_acceptances AS c "
    " WHERE c.accepted_at < NOW() - make_interval(months => $1::int) "
    "   AND " + _IS_SUPERSEDED
)


async def _count(months: int) -> int:
    pool = await get_pool()
    row = await pool.fetchrow(_SQL_COUNT, months)
    return int(row["n"]) if row else 0


async def _delete(months: int) -> int:
    pool = await get_pool()
    result = await pool.execute(_SQL_DELETE, months)
    # "DELETE 7" — the number is the second field.
    try:
        return int(str(result).rsplit(" ", 1)[-1])
    except (ValueError, IndexError):
        return 0


async def _run(months: int, dry_run: bool) -> int:
    if months == 0:
        # Keep everything is a policy, not an oversight. Saying so beats printing
        # "0 rows deleted", which reads like the job had nothing to do.
        print("CONSENT_RETENTION_MONTHS=0 — keeping every row.")
        return 0

    deletable = await _count(months)
    if deletable == 0:
        print(f"Nothing older than {months} months.")
        return 0

    if dry_run:
        print(f"{deletable} consent row(s) older than {months} months. Nothing was deleted.")
        print("The most recent acceptance per account is never touched.")
        return 0

    deleted = await _delete(months)
    print(f"Deleted {deleted} superseded consent row(s).")
    print("The most recent acceptance per account was kept.")
    return 0


def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(
        prog="python -m db.purge_consent",
        description="Delete Gate 2 consent rows older than the retention period.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be deleted without deleting anything",
    )
    parser.add_argument(
        "--months",
        type=int,
        default=settings.consent_retention_months,
        help=(
            "override CONSENT_RETENTION_MONTHS for this run "
            f"(default: {settings.consent_retention_months})"
        ),
    )
    args = parser.parse_args(argv)

    if args.months < 0:
        parser.error("--months cannot be negative; use 0 to keep everything")
    return asyncio.run(_run(args.months, args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())