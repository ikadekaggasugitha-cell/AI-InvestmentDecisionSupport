"""
Portfolio Service — Phase 6

Routing logic: Redis cache → live Black-Litterman + HRP optimiser → seed fallback.

The optimiser is the default path. USE_MOCK_PORTFOLIO=true forces the seed
weights (useful for offline demos); otherwise the service pulls 252 days of
close prices from TimescaleDB, blends the latest LightGBM signal views via
Black-Litterman, and only falls back to the seed when the price history is not
yet populated — so a fresh deployment degrades gracefully instead of 500ing.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from api.core.config import get_settings
from api.core.redis_client import get_redis, redis_get_json, redis_set_json, REDIS_KEYS
from api.models.portfolio import EquityCurveResponse, PortfolioOptimisationResponse

logger = logging.getLogger(__name__)

_SEED_PATH = Path(__file__).parent.parent / "seed" / "portfolio.json"
_CACHE_TTL = 3600  # 1 hour; recomputed hourly by Celery beat

# Minimum trading days of history before the optimiser is trusted. Below this,
# the covariance and BL posterior are too noisy to allocate real capital on, so
# the service falls back to the seed rather than emit a confident-looking result
# built on a handful of bars.
_MIN_HISTORY_DAYS = 120


def _load_seed() -> PortfolioOptimisationResponse:
    data = json.loads(_SEED_PATH.read_text())
    return PortfolioOptimisationResponse(**data)


async def get_portfolio_optimisation(uid: str = "default") -> PortfolioOptimisationResponse:
    settings = get_settings()

    # ── Mock path ─────────────────────────────────────────────────────────────
    if settings.use_mock_portfolio:
        logger.debug("portfolio_service: mock mode — serving seed weights")
        return _load_seed()

    # ── Cache check ───────────────────────────────────────────────────────────
    # Via the resilient helper: Redis is a cache, not the system of record, so a
    # cache outage must degrade to a recompute — not 500 the endpoint. The old
    # `await get_redis().get()` here sat outside the try/except and turned a
    # Redis outage into a hard error the moment real mode was switched on.
    cache_key = REDIS_KEYS["portfolio_optimise"].format(uid=uid)
    cached = await redis_get_json(cache_key)
    if cached:
        logger.debug("portfolio_service: cache hit for uid=%s", uid)
        return PortfolioOptimisationResponse(**cached)

    # ── Live optimisation ─────────────────────────────────────────────────────
    try:
        result = await _run_live_optimisation(uid)
        await redis_set_json(cache_key, result.model_dump(), ttl=_CACHE_TTL)
        return result
    except Exception as exc:
        logger.warning(
            "portfolio_service: live optimisation unavailable (%s) — "
            "falling back to seed weights", exc,
        )
        return _load_seed()


async def _run_live_optimisation(uid: str) -> PortfolioOptimisationResponse:
    """
    Run the real Black-Litterman + HRP optimiser on live inputs:
      1. 252 days of close prices from TimescaleDB (wide frame, one column/symbol)
      2. Latest LightGBM uprob scores from the signals:latest Redis key
      3. Current prices from market:snapshot, falling back to the last close

    Raises when history is missing or too short so the caller degrades to seed.
    """
    from ml.inference.portfolio_optimizer import IDX_NAMES, PortfolioOptimizer

    universe = list(IDX_NAMES.keys())
    prices = await _load_price_matrix(universe, days=252)

    if prices.empty or len(prices) < _MIN_HISTORY_DAYS:
        raise RuntimeError(
            f"insufficient price history: {len(prices)} rows < {_MIN_HISTORY_DAYS} "
            "required. Run workers.ohlcv_worker.backfill_ohlcv to populate `ohlcv`."
        )

    signal_scores = await _load_signal_scores()
    market_prices = await _load_market_prices(prices)

    result = PortfolioOptimizer().optimise(
        prices=prices,
        signal_scores=signal_scores,
        market_prices=market_prices,
    )
    logger.info(
        "portfolio_service: live optimisation over %d symbols, %d price rows, "
        "%d signal views",
        prices.shape[1], prices.shape[0], len(signal_scores),
    )
    return result


async def _load_price_matrix(symbols: list[str], days: int) -> pd.DataFrame:
    """
    Wide close-price frame — index=date, columns=symbol — from TimescaleDB.

    Returns an empty frame when the database is unreachable or the table is
    empty, which the caller reads as "no history yet" and falls back to seed.
    """
    from api.core.db import get_pool

    try:
        pool = await get_pool()
        records = await pool.fetch(
            """
            SELECT time::date AS d, symbol, close
            FROM ohlcv
            WHERE symbol = ANY($1::text[])
              AND time > NOW() - ($2 || ' days')::INTERVAL
            ORDER BY time
            """,
            symbols, str(int(days * 1.5)),  # calendar days ≈ 1.5× trading days
        )
    except Exception as exc:  # noqa: BLE001 — DB down → no history, fall back to seed
        logger.warning("portfolio_service: database unavailable — %s", exc)
        return pd.DataFrame()

    if not records:
        return pd.DataFrame()

    frame = pd.DataFrame(
        [{"d": r["d"], "symbol": r["symbol"], "close": float(r["close"])} for r in records]
    )
    # Pivot to wide, drop any symbol/day with gaps so the covariance is clean.
    wide = frame.pivot_table(index="d", columns="symbol", values="close")
    return wide.dropna(axis=1, how="any").tail(days)


async def _load_signal_scores() -> dict[str, float]:
    """
    Map symbol → conviction score on the 0-100 scale the BL view builder expects
    (50 = neutral). Sourced from signals:latest; empty dict when unavailable, in
    which case the optimiser falls back to pure CAPM equilibrium.
    """
    payload = await redis_get_json(REDIS_KEYS["signals_latest"])
    if not payload:
        return {}

    signals = payload.get("signals", payload) if isinstance(payload, dict) else payload
    scores: dict[str, float] = {}
    for sig in signals or []:
        symbol = sig.get("symbol")
        uprob = sig.get("uprob")
        if symbol is None or uprob is None:
            continue
        # uprob is a 0..1 probability; the view builder works in 0..100.
        scores[symbol] = float(uprob) * 100.0
    return scores


async def _load_market_prices(prices: pd.DataFrame) -> dict[str, float]:
    """
    Current price per symbol from the market:snapshot hash, defaulting to the
    last close in the price frame when the live snapshot has no entry.
    """
    last_close: dict[str, float] = {
        sym: float(prices[sym].iloc[-1]) for sym in prices.columns
    }

    redis = get_redis()
    if not redis:
        return last_close

    try:
        async with redis as r:
            raw = await r.hgetall(REDIS_KEYS["market_snapshot"])
    except Exception as exc:  # noqa: BLE001 — snapshot is a nicety, not required
        logger.debug("portfolio_service: market snapshot unavailable — %s", exc)
        return last_close

    for sym in list(last_close.keys()):
        entry = raw.get(sym) if raw else None
        if not entry:
            continue
        try:
            tick: dict[str, Any] = json.loads(entry)
            price = tick.get("price") or tick.get("last") or tick.get("close")
            if price:
                last_close[sym] = float(price)
        except (ValueError, TypeError):
            continue
    return last_close


# ── Equity curve ─────────────────────────────────────────────────────────────

_EQUITY_TTL = 3600  # 1 hour, matching the optimiser
_MIN_EQUITY_DAYS = 2  # one point is not a curve


async def get_equity_curve_cached(days: int = 252) -> EquityCurveResponse:
    """
    get_equity_curve behind the Redis cache.

    Keyed on the day count, not on the portfolio: the curve is a pure function
    of the holdings and the price history, both of which change once a day, so
    a per-portfolio key would only multiply cache entries without changing the
    result while positions are still the seeded ones.
    """
    from api.core.redis_client import REDIS_KEYS

    # .format(), not an f-string: the key template carries a {days} placeholder,
    # and concatenation produced the literal key "portfolio:equity:{days}:60".
    key = REDIS_KEYS["portfolio_equity"].format(days=int(days))
    cached_response = await redis_get_json(key)
    if cached_response:
        return EquityCurveResponse(**cached_response)

    response = await get_equity_curve(days)
    await redis_set_json(key, response.model_dump(), ttl=_EQUITY_TTL)
    return response


async def get_equity_curve(days: int = 252) -> EquityCurveResponse:
    """
    Realised portfolio value over time, from actual closes times actual lots.

    The Portfolio page used to draw a bundled 12-month sample (`PORTFOLIO_HISTORY`
    in the frontend) labelled with nothing, sitting next to a live allocation
    table. This is the honest version of that chart: every point is a real
    session close multiplied by the held lots.

    Holdings come from api/core/holdings, the same source risk_service uses, so
    the curve and the risk metrics describe one portfolio. There is a test
    asserting exactly that, because the two drifting apart is exactly the bug
    this codebase had once with the risk worker's private copy.

    The benchmark is the composite index, fetched from the quote provider because
    `ohlcv` holds listed equities only. It is rebased to the portfolio's first
    value so both lines share a scale; a raw index level beside a rupiah total
    would look comparable and mean nothing.
    """
    from api.core.holdings import PORTFOLIO_LOTS
    from api.models.portfolio import EquityCurveResponse, EquityPoint

    settings = get_settings()
    days = max(int(days), _MIN_EQUITY_DAYS)

    if settings.use_mock_market:
        return _empty_equity(days, "mock")

    prices = await _load_price_matrix(sorted(PORTFOLIO_LOTS), days)
    if prices.empty or len(prices) < _MIN_EQUITY_DAYS:
        logger.warning(
            "portfolio_service: only %d sessions of holdings history — no equity curve",
            0 if prices.empty else len(prices),
        )
        return _empty_equity(days, "mock")

    # 1 lot = 100 shares.
    lots = pd.Series({s: n * 100 for s, n in PORTFOLIO_LOTS.items()})
    held = [s for s in prices.columns if s in lots.index]
    if not held:
        return _empty_equity(days, "mock")

    value = (prices[held] * lots[held]).sum(axis=1)
    # Localise before anything is compared against provider data. The DB stores
    # `time::date`, so this side comes back tz-naive, while every provider bar is
    # tz-aware UTC. A naive Timestamp never equals an aware one, so the reindex
    # below matched nothing and the benchmark vanished on a range whose two ends
    # printed identically. Session closes are defined as midnight UTC, so
    # attaching UTC here is exact rather than a convenience.
    value.index = pd.to_datetime(value.index, utc=True)

    # Index series, rebase-to-start so it shares the portfolio's scale.
    #
    # The provider's window is anchored to *now*, not to the data we hold, so
    # asking it for "the last N days" returns a range that can miss ours
    # entirely. That is not hypothetical: with a hole in the stored history the
    # two windows were 0 sessions apart and the benchmark silently vanished.
    # So derive the request from the portfolio's own date range instead.
    benchmark: pd.Series | None = None
    try:
        from ingestor.providers import get_provider

        first_date, last_date = value.index.min(), value.index.max()
        span_calendar_days = int((last_date - first_date).days) + 1  # both tz-aware UTC now
        # get_daily_bars expands its own request to ~1.5x the requested count in
        # calendar days, plus a 10-day margin for holidays.
        trading_days_needed = max(days, int((span_calendar_days - 10) / 1.5) + 1)

        # Shared instance — do not close it. Awaited directly: this is already
        # an async function, so wrapping this in asyncio.run() would raise
        # "cannot be called from a running event loop" and silently cost the
        # curve its benchmark.
        bars = await get_provider().get_daily_bars("^JKSE", trading_days_needed)
        if not bars:
            logger.warning("portfolio_service: ^JKSE returned no bars — curve has no benchmark")
        else:
            idx = pd.Series(
                [b.close for b in bars], index=pd.to_datetime([b.date for b in bars])
            )
            idx = idx[~idx.index.duplicated(keep="last")].sort_index()
            benchmark = idx.reindex(value.index).ffill()
            if benchmark.dropna().empty:
                # Two very different causes, so say which. "Your history is
                # stale" sent the wrong way when the real problem was a hole in
                # the middle of the range: the end was current, so the daily
                # update had nothing to add and the gap never closed.
                overlap = len(set(value.index) & set(idx.index))
                logger.warning(
                    "portfolio_service: no benchmark — ^JKSE covers %s..%s but the "
                    "portfolio's bars cover %s..%s (%d overlapping sessions). Our "
                    "history starts %d days before the index window does, so this "
                    "is a gap in the stored bars, not a stale tail: backfill it "
                    "with `python -m scripts.daily_update --days N`.",
                    idx.index.min().date(), idx.index.max().date(),
                    first_date.date(), last_date.date(), overlap,
                    (datetime.now(timezone.utc).date() - first_date.date()).days,
                )
    except Exception as exc:  # noqa: BLE001 — the curve is useful without it
        logger.warning("portfolio_service: ^JKSE fetch failed, curve has no benchmark — %s", exc)

    start = float(value.iloc[0])
    rebased = None
    if benchmark is not None and len(benchmark.dropna()):
        first = float(benchmark.dropna().iloc[0])
        if first > 0:
            rebased = benchmark / first * start

    changes = value.pct_change()
    points = [
        EquityPoint(
            date=idx.strftime("%Y-%m-%d"),
            value=round(float(val), 2),
            benchmark=round(float(rebased.loc[idx]), 2) if rebased is not None and pd.notna(rebased.get(idx)) else None,
            ret=round(float(changes.loc[idx]), 6) if pd.notna(changes.loc[idx]) else None,
        )
        for idx, val in value.items()
    ]

    return EquityCurveResponse(
        points=points,
        days=days,
        startValue=round(start, 2),
        endValue=round(float(value.iloc[-1]), 2),
        totalReturn=round(float(value.iloc[-1] / start - 1), 6) if start else None,
        computedAt=datetime.now(timezone.utc).isoformat(),
        source="live",
        benchmarkSource="^JKSE" if rebased is not None else None,
    )


def _empty_equity(days: int, source: str) -> "EquityCurveResponse":
    """
    No points, and no fabricated ones.

    The alternative — returning a straight line or a random walk — would render a
    confident-looking chart of a portfolio history that does not exist, next to
    live figures. The frontend shows its empty state instead.
    """
    from api.models.portfolio import EquityCurveResponse

    return EquityCurveResponse(
        points=[],
        days=days,
        computedAt=datetime.now(timezone.utc).isoformat(),
        source=source,
    )
