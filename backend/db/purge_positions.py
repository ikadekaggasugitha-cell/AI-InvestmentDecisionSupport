"""
Remove positions naming a ticker that is not in `instruments`.

`PUT /v1/portfolio/positions` refuses unknown symbols now, which stops new ones
arriving. This clears the ones already stored: positions written before that check
existed, or written while `instruments` was still empty because
`workers/instruments_worker` had not finished.

Why a command rather than a migration. A migration cannot tell a legitimate
position from a typo — both are entries in `lots_json`, with no record of when or
how they were entered. A command lets an operator look first, which is what
`--dry-run` is for.

Deleting a position is recoverable: the person re-enters it. It is still a write to
their portfolio, so the default is to report and change nothing.

Usage:
    python -m db.purge_positions --dry-run
    python -m db.purge_positions
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.core.db import get_pool  # noqa: E402


async def _find_unlisted() -> dict[str, list[str]]:
    """Portfolio id -> the unlisted symbols it holds.

    Returns an empty dict when `instruments` is empty. That is a fresh deployment
    whose worker has not run, and "everything is unlisted" is not a safe thing to
    act on: it would empty every portfolio in the system.
    """
    pool = await get_pool()

    listed = {str(r["symbol"]) for r in await pool.fetch("SELECT symbol FROM instruments")}
    if not listed:
        return {}

    found: dict[str, list[str]] = {}
    for row in await pool.fetch("SELECT id, lots_json FROM portfolios"):
        raw = row["lots_json"]
        if isinstance(raw, (str, bytes)):
            raw = json.loads(raw)
        if not isinstance(raw, dict):
            continue
        unlisted = sorted(str(s) for s in raw if str(s).upper() not in listed)
        if unlisted:
            found[str(row["id"])] = unlisted
    return found


async def _apply(unlisted: dict[str, list[str]]) -> int:
    """Remove those symbols from those rows. Returns the number of rows changed.

    Every unlisted symbol for a portfolio is removed in one pass rather than one
    pass per symbol: several can share a row, and rewriting the same row once per
    symbol would be both slower and, with concurrent writes, wrong.
    """
    pool = await get_pool()
    listed = {str(r["symbol"]) for r in await pool.fetch("SELECT symbol FROM instruments")}

    changed = 0
    for portfolio_id, symbols in unlisted.items():
        row = await pool.fetchrow(
            "SELECT lots_json FROM portfolios WHERE id = $1", portfolio_id
        )
        if row is None:
            continue
        raw = row["lots_json"]
        if isinstance(raw, (str, bytes)):
            raw = json.loads(raw)
        if not isinstance(raw, dict):
            continue

        drop = set(symbols)
        kept = {k: v for k, v in raw.items() if str(k).upper() in listed and str(k) not in drop}
        await pool.execute(
            "UPDATE portfolios SET lots_json = $1::jsonb, updated_at = NOW() WHERE id = $2",
            json.dumps(kept),
            portfolio_id,
        )
        changed += 1
    return changed


async def _run(dry_run: bool) -> int:
    unlisted = await _find_unlisted()

    if not unlisted:
        print("Every position names a listed ticker.")
        return 0

    total = 0
    for portfolio_id, symbols in sorted(unlisted.items()):
        print(f"{portfolio_id}: {', '.join(symbols)}")
        total += len(symbols)

    print(f"{total} unlisted position(s) across {len(unlisted)} portfolio(s).")
    if dry_run:
        print("Nothing was deleted.")
        return 0

    changed = await _apply(unlisted)
    print(f"Cleaned {changed} portfolio row(s).")
    print(
        "Derived figures are not recalculated here — reopen the Portfolio page to "
        "see fresh equity and risk numbers."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m db.purge_positions",
        description="Remove positions whose ticker is not a listed IDX instrument.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be removed without changing anything",
    )
    args = parser.parse_args(argv)
    return asyncio.run(_run(args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())