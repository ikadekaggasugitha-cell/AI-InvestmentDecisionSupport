"""
Cross-source reconciliation.

Two independent feeds now carry IDX closing prices: the exchange itself and
Yahoo. Agreement between them is the strongest evidence available that a bar is
correct, and disagreement is the only signal that will ever surface a silent
ingestion fault — a shifted date, a stale cache, a mis-parsed field, a symbol
mapped to the wrong instrument.

Without this check a wrong price simply flows through to support levels, stop
losses and model features, all of which will happily compute something plausible
from it.

Tolerance
---------
The two sources should agree exactly on a close, since both report the same
exchange print. A small tolerance absorbs rounding at the tick grid; anything
beyond it is a real discrepancy and is reported per symbol rather than as an
aggregate, because one broken symbol matters and an average hides it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

logger = logging.getLogger(__name__)

# Both feeds quote the same print, so this is a rounding allowance, not a band
# for genuine disagreement.
DEFAULT_TOLERANCE_PCT = 0.5


@dataclass
class Discrepancy:
    symbol: str
    idx_close: float
    other_close: float

    @property
    def diff_pct(self) -> float:
        if self.idx_close == 0:
            return float("inf")
        return (self.other_close - self.idx_close) / self.idx_close * 100


@dataclass
class ReconciliationReport:
    session: date
    compared: int = 0
    matched: int = 0
    only_idx: list[str] = field(default_factory=list)
    only_other: list[str] = field(default_factory=list)
    discrepancies: list[Discrepancy] = field(default_factory=list)
    tolerance_pct: float = DEFAULT_TOLERANCE_PCT

    @property
    def match_rate(self) -> float:
        return (self.matched / self.compared) if self.compared else 0.0

    @property
    def passed(self) -> bool:
        """
        A run passes when every symbol present in both sources agrees.

        Symbols in only one source are not failures: Yahoo does not cover the
        whole IDX board, and a suspended instrument legitimately appears in one
        and not the other.
        """
        return self.compared > 0 and not self.discrepancies

    def summary(self) -> str:
        head = (
            f"{self.session.isoformat()}: {self.matched}/{self.compared} agree "
            f"({self.match_rate:.1%}) within {self.tolerance_pct}%"
        )
        if not self.discrepancies:
            return head
        worst = sorted(self.discrepancies, key=lambda d: abs(d.diff_pct), reverse=True)[:5]
        detail = ", ".join(
            f"{d.symbol} idx={d.idx_close:g} other={d.other_close:g} ({d.diff_pct:+.2f}%)"
            for d in worst
        )
        return f"{head} — {len(self.discrepancies)} disagree: {detail}"


def reconcile_closes(
    session: date,
    idx_closes: dict[str, float],
    other_closes: dict[str, float],
    tolerance_pct: float = DEFAULT_TOLERANCE_PCT,
) -> ReconciliationReport:
    """
    Compare closing prices from two feeds for one session.

    Only symbols present in both are compared — coverage differences are
    reported separately so a narrower feed does not look like a data fault.
    """
    report = ReconciliationReport(session=session, tolerance_pct=tolerance_pct)

    idx_syms, other_syms = set(idx_closes), set(other_closes)
    report.only_idx = sorted(idx_syms - other_syms)
    report.only_other = sorted(other_syms - idx_syms)

    for symbol in sorted(idx_syms & other_syms):
        idx_price = idx_closes[symbol]
        other_price = other_closes[symbol]
        report.compared += 1

        if idx_price <= 0:
            report.discrepancies.append(Discrepancy(symbol, idx_price, other_price))
            continue

        diff_pct = abs(other_price - idx_price) / idx_price * 100
        if diff_pct <= tolerance_pct:
            report.matched += 1
        else:
            report.discrepancies.append(Discrepancy(symbol, idx_price, other_price))

    return report


async def reconcile_latest_session(symbols: list[str]) -> ReconciliationReport:
    """
    Fetch the most recent session from both feeds and compare.

    Intended as a post-ingestion gate and as a periodic health check: a feed
    that starts returning wrong prices shows up here before it reaches a chart.
    """
    from datetime import datetime, timedelta, timezone

    from ingestor.providers import get_history_provider
    from ingestor.providers.yahoo import YahooProvider

    wanted = {s.upper() for s in symbols}

    idx = get_history_provider()
    try:
        cursor = datetime.now(timezone.utc).date()
        bars = []
        for _ in range(7):
            bars = await idx.get_session_bars(cursor)
            if bars:
                break
            cursor -= timedelta(days=1)
    finally:
        await idx.close()

    idx_closes = {b.symbol: b.close for b in bars if b.symbol in wanted}

    yahoo = YahooProvider()
    try:
        batch = await yahoo.get_quotes(sorted(wanted))
    finally:
        await yahoo.close()

    other_closes = {s: q.price for s, q in batch.quotes.items()}

    report = reconcile_closes(cursor, idx_closes, other_closes)
    if report.passed:
        logger.info("reconcile: %s", report.summary())
    else:
        logger.warning("reconcile: %s", report.summary())
    return report


if __name__ == "__main__":  # pragma: no cover
    import asyncio

    from api.core.config import get_settings

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    rep = asyncio.run(reconcile_latest_session(get_settings().tracked_symbols))
    print(rep.summary())
    raise SystemExit(0 if rep.passed else 1)
