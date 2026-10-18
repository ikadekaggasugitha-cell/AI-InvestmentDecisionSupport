"""
Suspend accounts whose subscription has lapsed — operator's manual pass.

The beat (`workers/payment_worker.suspend_lapsed_subscriptions`) runs this
hourly. The command exists for the moment a person reports that they paid for
a new period, the payment was declined, and they want the suspension's door
back exactly as the beat would leave it — and for the off-chance the beat
cannot run: a worker outage suspending nobody is recoverable, a queue nobody
can open is not.

Why a command still needs --dry-run. The write is a closed row on someone's
account, which is worth looking at before doing. The selection is the same
guarded predicate the beat runs — `services.accounts` owns it, so the CLI can
only ever agree with the beat, never carry a second opinion about what lapsed
means.

Usage:
    python -m db.suspend_lapsed --dry-run
    python -m db.suspend_lapsed
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.core.db import close_pool  # noqa: E402
from api.services.accounts import find_lapsed_accounts, suspend_lapsed_accounts  # noqa: E402


async def _run(dry_run: bool) -> int:
    try:
        candidates = await find_lapsed_accounts()

        if not candidates:
            print("Every account with a past subscription still has live access.")
            return 0

        for row in candidates:
            print(f"{row['id']}: {row['email']}")

        print(f"{len(candidates)} account(s) lapsed and still open.")
        if dry_run:
            print("Nothing was suspended.")
            return 0

        suspended = await suspend_lapsed_accounts()
        print(f"Suspended {len(suspended)} account(s).")
        print(
            "They can pay again immediately: /v1/auth, pricing and /v1/payments "
            "still answer them, and a settled payment reopens the account with "
            "the period it bought."
        )
        return 0
    finally:
        try:
            await close_pool()
        except Exception:  # noqa: BLE001 — a half-open pool must not fail the run
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m db.suspend_lapsed",
        description="Suspend accounts whose last subscription has ended.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report who would be suspended without changing anything",
    )
    args = parser.parse_args(argv)
    return asyncio.run(_run(args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
