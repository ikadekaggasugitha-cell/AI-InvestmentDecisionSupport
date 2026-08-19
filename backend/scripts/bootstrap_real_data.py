"""
Bootstrap real market data into a running stack.

One command to take a freshly provisioned stack (empty TimescaleDB + Redis) to
one where every endpoint serves real data:

    # 1. bring up infra + apply schema
    docker compose up -d timescaledb redis
    docker compose up db-init
    python -m db.migrate

    # 2. fill the ohlcv table with real IDX daily bars (this script)
    DATABASE_URL=postgresql+asyncpg://aidss:aidss@localhost:5432/aidss \
        python -m scripts.bootstrap_real_data

    # 3. train the signal model on that history (writes to backend/models/ if it
    #    clears the walk-forward AUC gate)
    python -m ml.training.train_signals_v2

Prices come per-symbol from the Yahoo provider (real IDX quotes, vendor-delayed).
The universe is broad on purpose: the signal model ranks cross-sectionally, so a
wider board gives it more to learn from. Broker-summary (broksum) is NOT filled
here — IDX no longer serves it publicly (HTTP 404); it needs a licensed feed and
degrades to an empty, honestly-labelled response until one is wired.

Idempotent: _write_bars upserts, so re-running refreshes rather than duplicates.
"""

import argparse
import asyncio
from datetime import datetime, timezone, timedelta

from api.core.config import get_settings
from ml.inference.portfolio_optimizer import IDX_NAMES
from workers.ohlcv_worker import (
    _fetch_bars,
    _refresh_continuous_aggregate,
    _write_bars,
)

# A liquid, LQ45-representative board. Superset of tracked_symbols + the
# portfolio universe so signals, technicals, risk and portfolio all have depth.
LIQUID_UNIVERSE = [
    "BBCA", "BBRI", "BMRI", "BBNI", "TLKM", "ASII", "GOTO", "BREN", "ADRO",
    "UNVR", "ICBP", "INDF", "ANTM", "PTBA", "KLBF", "SMGR", "EMTK", "AMRT",
    "CPIN", "UNTR", "MDKA", "INKP", "TPIA", "BRPT", "MEDC", "PGAS", "ITMG",
    "AKRA", "EXCL", "ISAT", "TOWR", "MAPI", "MNCN", "HRUM", "INCO", "ELSA",
    "JPFA", "SIDO", "BUKA", "ARTO", "BFIN", "ACES", "ESSA", "PWON", "CTRA",
]


async def _run(days: int, universe: list[str]) -> None:
    print(f"Backfilling {len(universe)} symbols x {days} days of real IDX bars…")
    total = 0
    filled = 0
    for i, sym in enumerate(universe, 1):
        try:
            rows = await _fetch_bars(sym, days)
        except Exception as exc:  # noqa: BLE001 — one bad symbol shouldn't abort the run
            print(f"  [{i:>2}/{len(universe)}] {sym}: ERROR {exc}")
            continue
        written = await _write_bars(rows)
        total += written
        filled += 1 if written else 0
        print(f"  [{i:>2}/{len(universe)}] {sym}: {written} bars")

    end = datetime.now(timezone.utc)
    await _refresh_continuous_aggregate(end - timedelta(days=days + 5), end)
    print(f"\nDONE: {total} rows across {filled}/{len(universe)} symbols.")
    print("Next: python -m ml.training.train_signals_v2   # train the signal model")


def main() -> None:
    settings = get_settings()
    default_universe = sorted(
        set(LIQUID_UNIVERSE) | set(settings.tracked_symbols) | set(IDX_NAMES.keys())
    )

    parser = argparse.ArgumentParser(description="Backfill real OHLCV into the stack.")
    parser.add_argument(
        "--days", type=int, default=settings.ohlcv_backfill_days,
        help="Trading days of history per symbol (default from OHLCV_BACKFILL_DAYS).",
    )
    parser.add_argument(
        "--symbols", nargs="*", default=None,
        help="Override the universe (default: liquid board + tracked + portfolio).",
    )
    args = parser.parse_args()

    universe = sorted(set(args.symbols)) if args.symbols else default_universe
    asyncio.run(_run(args.days, universe))


if __name__ == "__main__":
    main()
