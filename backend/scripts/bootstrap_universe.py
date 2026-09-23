"""
Bootstrap the IDX instrument universe.

Fills the `instruments` table with the full listed board from IDX
GetCompanyProfiles, so the app's stock list becomes ~960 securities with names
and IDX-IC sectors instead of the hardcoded 15.

Run once after `python -m db.migrate` has created the table:

    python -m scripts.bootstrap_universe

The listed board is small reference data (~960 rows) and one IDX request, so this
finishes in seconds. To ALSO backfill daily bars for the full board (needed for
prices, signals and analytics across every symbol) pass --with-ohlcv, which
kicks the existing IDX session backfill — that one takes ~15 minutes:

    python -m scripts.bootstrap_universe --with-ohlcv

Idempotent: the sync upserts, so re-running is safe.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter


async def _run(with_ohlcv: bool, days: int | None) -> int:
    from workers.instruments_worker import sync_instruments

    print("Syncing IDX universe into `instruments` …")
    result = await sync_instruments()
    if result.get("status") != "ok":
        print(f"  FAILED: {result.get('error', 'unknown error')}", file=sys.stderr)
        print("  The instruments table was left unchanged (durable cache).",
              file=sys.stderr)
        return 1

    print(f"  {result['instruments']} instruments synced "
          f"({result.get('deactivated', 0)} marked inactive).")

    # Sector breakdown, read straight back from the DB as a sanity check.
    import asyncpg

    from api.core.config import get_settings

    settings = get_settings()
    conn = await asyncpg.connect(
        settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    )
    try:
        rows = await conn.fetch(
            "SELECT sector, count(*) AS n FROM instruments "
            "WHERE is_active GROUP BY sector ORDER BY n DESC"
        )
        active = await conn.fetchval("SELECT count(*) FROM instruments WHERE is_active")
    finally:
        await conn.close()

    print(f"\nActive instruments: {active}")
    print("By sector:")
    for r in rows:
        print(f"  {r['n']:4d}  {r['sector'] or '—'}")

    if with_ohlcv:
        print("\nBackfilling daily bars for the full board (this takes ~15 min) …")
        from workers.ohlcv_worker import backfill_ohlcv

        # Synchronous call (not via Celery) so the script blocks to completion.
        bf = await asyncio.to_thread(backfill_ohlcv, days, True)
        print(f"  OHLCV backfill: {bf.get('status')} — "
              f"{bf.get('bars_written', 0)} bars across "
              f"{bf.get('instruments', 0)} instruments.")

    print("\nDone. Next: start the API and open the Markets view, or run "
          "`python -m ml.training.train_signals_v2` to score the board.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap the IDX instrument universe.")
    parser.add_argument(
        "--with-ohlcv", action="store_true",
        help="Also backfill daily bars for the full board (~15 min).",
    )
    parser.add_argument(
        "--days", type=int, default=None,
        help="OHLCV backfill window in days (default: OHLCV_BACKFILL_DAYS).",
    )
    args = parser.parse_args()
    return asyncio.run(_run(args.with_ohlcv, args.days))


if __name__ == "__main__":
    raise SystemExit(main())
