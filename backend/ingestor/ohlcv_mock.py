"""
Daily OHLCV Mock Generator — Phase 10

Synthetic daily bars for use when the `ohlcv` hypertable is empty (fresh
checkout, no database, USE_MOCK_MARKET=true).

Determinism matters here. The series is seeded from the symbol alone, so the
same symbol yields byte-identical bars on every call. Without that the
candlestick chart would redraw differently on each poll, support/resistance
levels would drift between the card header and the expanded panel, and any
test asserting on a detected pattern would be flaky.

Bars are generated with geometric Brownian motion plus an occasional gap, so
the price-action engine has something real to find: trends, fractal pivots,
and gaps above the 1% detection threshold.
"""

import random
from datetime import datetime, timedelta, timezone
from typing import Any

# Anchor prices, consistent with ingestor/broksum_mock.py
_PRICE_REF: dict[str, float] = {
    "BBCA": 6350, "BBRI": 3120, "BMRI": 4170, "TLKM": 2620,
    "ASII": 4780, "GOTO": 50,   "BREN": 3570, "ADRO": 2530,
    "UNVR": 1775, "ICBP": 7600, "ANTM": 3070, "PTBA": 2360,
    "KLBF": 800, "SMGR": 1580, "EMTK": 505,
}

# Annualised drift per symbol — mirrors the accumulation bias in broksum_mock
# so the two mock sources tell a consistent story.
_DRIFT: dict[str, float] = {
    "BBCA": 0.12, "BBRI": 0.08, "BMRI": 0.06, "TLKM": -0.04,
    "ASII": 0.02, "GOTO": -0.10, "BREN": 0.16, "ADRO": 0.04,
    "UNVR": -0.06, "ICBP": 0.0, "ANTM": 0.08, "PTBA": 0.02,
    "KLBF": -0.02, "SMGR": 0.0, "EMTK": -0.08,
}

_DAILY_VOL = 0.018       # ~28% annualised, typical for IDX large caps
_GAP_PROBABILITY = 0.04  # ~1 gap per 25 sessions
_TRADING_DAYS_PER_YEAR = 252


def _tick_size(price: float) -> float:
    """
    IDX fractional tick-size bands (IDX Regulation II-A).

    Rounding to the real tick grid matters for the price-action engine: fractal
    pivots and support/resistance clustering both depend on prices repeating
    exactly, which never happens with unrounded floats.
    """
    if price < 200:
        return 1
    if price < 500:
        return 2
    if price < 2000:
        return 5
    if price < 5000:
        return 10
    return 25


def _round_to_tick(price: float) -> float:
    tick = _tick_size(price)
    return round(round(price / tick) * tick, 2)


# Canonical series length. Every request is a suffix of this one series, so a
# 60-day chart and a 252-day analysis describe the same price history. Building
# `days` bars directly instead would restart the random walk at a different
# price for every window length, and the candles drawn on screen would not match
# the support/resistance levels computed beside them.
_CANONICAL_SESSIONS = 400


def generate_mock_ohlcv(
    symbol: str,
    days: int = 260,
    end_date: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    Generate `days` trading sessions of daily OHLCV for one symbol.

    Returns rows ordered oldest → newest with keys:
        time, symbol, open, high, low, close, volume
    """
    symbol = symbol.upper()
    series = _canonical_series(symbol, end_date)
    return series[-days:] if days < len(series) else series


def _canonical_series(
    symbol: str,
    end_date: datetime | None = None,
) -> list[dict[str, Any]]:
    """Build the full deterministic series for a symbol, oldest → newest."""
    base_price = _PRICE_REF.get(symbol, 5000.0)
    drift = _DRIFT.get(symbol, 0.0) / _TRADING_DAYS_PER_YEAR
    total = _CANONICAL_SESSIONS

    # Deterministic per symbol — never seeded from wall-clock time.
    rng = random.Random(f"ohlcv:{symbol}")

    if end_date is None:
        end_date = datetime.now(timezone.utc)
    end_date = end_date.replace(hour=0, minute=0, second=0, microsecond=0)

    # Walk backwards to collect weekday session dates, then reverse.
    session_dates: list[datetime] = []
    cursor = end_date
    while len(session_dates) < total:
        if cursor.weekday() < 5:
            session_dates.append(cursor)
        cursor -= timedelta(days=1)
    session_dates.reverse()

    # Draw the whole walk first so it can be rescaled to land on the anchor.
    shocks = [rng.gauss(0, _DAILY_VOL) for _ in range(total)]
    gap_draws = [
        (rng.random(), rng.uniform(0.012, 0.035), rng.random())
        for _ in range(total)
    ]
    open_noise = [rng.gauss(0, _DAILY_VOL * 0.3) for _ in range(total)]
    wick_hi = [abs(rng.gauss(0, _DAILY_VOL * 0.45)) for _ in range(total)]
    wick_lo = [abs(rng.gauss(0, _DAILY_VOL * 0.45)) for _ in range(total)]
    vol_noise = [rng.gauss(1.0, 0.25) for _ in range(total)]

    # Land the final close exactly on the anchor price by rescaling the START,
    # not by damping the walk. Spreading a correction across every step would
    # also cancel the drift and flatten every symbol to "sideways" — the trend
    # detector would then never fire, and the trend badge would be dead UI.
    # Dividing out the realised compound return keeps every shock, and with it
    # the trends, pivots and gaps the price-action engine exists to find.
    total_return = 1.0
    for shock in shocks:
        total_return *= (1 + drift + shock)

    price = base_price / total_return if total_return > 0 else base_price

    rows: list[dict[str, Any]] = []

    for i, session in enumerate(session_dates):
        prev_close = price

        # Occasional overnight gap, sized to clear the 1% detection threshold.
        gap_roll, gap_size, gap_dir = gap_draws[i]
        if gap_roll < _GAP_PROBABILITY:
            gap = gap_size * (1 if gap_dir < 0.55 else -1)
            open_price = prev_close * (1 + gap)
        else:
            open_price = prev_close * (1 + open_noise[i])

        close_price = prev_close * (1 + drift + shocks[i])

        # Wicks extend beyond the body on both sides.
        body_high = max(open_price, close_price)
        body_low = min(open_price, close_price)
        high = body_high * (1 + wick_hi[i])
        low = body_low * (1 - wick_lo[i])

        o = _round_to_tick(open_price)
        c = _round_to_tick(close_price)
        h = _round_to_tick(max(high, o, c))
        l = _round_to_tick(min(low, o, c))

        # Volume rises with the size of the move.
        move = abs(c - o) / o if o else 0
        volume = int(vol_noise[i] * (1 + move * 12) * 8_000_000)

        rows.append({
            "time": session,
            "symbol": symbol,
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": max(100_000, volume),
        })

        price = close_price

    return rows
