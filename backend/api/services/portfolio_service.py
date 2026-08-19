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
from pathlib import Path
from typing import Any

import pandas as pd

from api.core.config import get_settings
from api.core.redis_client import get_redis, redis_get_json, redis_set_json, REDIS_KEYS
from api.models.portfolio import PortfolioOptimisationResponse

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
