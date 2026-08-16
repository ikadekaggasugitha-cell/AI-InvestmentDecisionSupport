"""
Model universe selection.

Two universes exist for two different jobs. `tracked_symbols` is what the UI
shows — small, curated, stable. The model universe is what the classifier trains
on, and fifteen names is far too thin: roughly 6k rows against 15 features,
where a single symbol's idiosyncratic run dominates the fit.

Why liquidity rather than a hardcoded LQ45 list
-----------------------------------------------
LQ45 is reconstituted every February and August. A membership list pasted into
source goes stale silently — nothing errors, the code simply trains on names
that left the index months ago, and nobody notices until someone checks by hand.

Ranking by median traded value reproduces substantially the same set (LQ45 is
itself selected on liquidity and market cap) and cannot drift out of date,
because it is recomputed from the same `ohlcv` table the model reads. Set
`MODEL_UNIVERSE_MODE=static` with an explicit list if a fixed membership is
required for reproducibility.

Selection uses MEDIAN traded value, not mean: a single block crossing can lift a
dormant counter's average by an order of magnitude, and those are precisely the
instruments whose flat prices teach a model that nothing ever moves.
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from api.core.config import get_settings

logger = logging.getLogger(__name__)

_SELECT_LIQUIDITY_SQL = """
SELECT symbol,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY value_idr) AS median_value,
       count(*)                                               AS sessions
FROM ohlcv
WHERE time > NOW() - ($1 || ' days')::INTERVAL
  AND value_idr IS NOT NULL
GROUP BY symbol
HAVING count(*) >= $2
ORDER BY median_value DESC
LIMIT $3
"""


def select_universe_from_frame(
    ohlcv: pd.DataFrame,
    size: int,
    min_median_value: float,
    min_sessions: int,
) -> list[str]:
    """
    Rank symbols by median traded value. Pure function, so it is testable
    without a database and reusable on any frame the caller already holds.

    Requires columns `symbol` and `value_idr`. Symbols with fewer than
    `min_sessions` observations are excluded: a name that listed last month has
    no history for the model to learn from, and including it produces a column
    that is mostly NaN.
    """
    if ohlcv.empty or "value_idr" not in ohlcv.columns:
        return []

    frame = ohlcv.dropna(subset=["value_idr"])
    if frame.empty:
        return []

    grouped = frame.groupby("symbol")["value_idr"]
    stats = pd.DataFrame({
        "median_value": grouped.median(),
        "sessions": grouped.count(),
    })

    eligible = stats[
        (stats["sessions"] >= min_sessions)
        & (stats["median_value"] >= min_median_value)
    ]
    ranked = eligible.sort_values("median_value", ascending=False)
    return list(ranked.head(size).index)


async def get_model_universe(min_sessions: int = 120) -> list[str]:
    """
    Resolve the training universe.

    Falls back to `tracked_symbols` when the database is unreachable or holds
    too little history — a short universe is a visible problem, whereas an
    empty one silently produces an empty training set.
    """
    settings = get_settings()

    if settings.model_universe_mode == "static":
        static = settings.model_universe_static or settings.tracked_symbols
        logger.info("universe: static mode — %d symbols", len(static))
        return list(static)

    rows = await _query_liquidity(
        lookback_days=int(settings.ohlcv_backfill_days),
        min_sessions=min_sessions,
        size=settings.model_universe_size,
    )

    selected = [
        r["symbol"] for r in rows
        if float(r["median_value"] or 0) >= settings.model_universe_min_value_idr
    ]

    if not selected:
        logger.warning(
            "universe: liquidity selection returned nothing — has "
            "workers.ohlcv_worker.backfill_ohlcv been run? "
            "Falling back to tracked_symbols (%d).",
            len(settings.tracked_symbols),
        )
        return list(settings.tracked_symbols)

    if len(selected) < settings.model_universe_size:
        logger.warning(
            "universe: only %d of %d requested symbols cleared the liquidity "
            "floor of Rp %.0f",
            len(selected), settings.model_universe_size,
            settings.model_universe_min_value_idr,
        )

    logger.info("universe: liquidity mode — %d symbols selected", len(selected))
    return selected


async def _query_liquidity(
    lookback_days: int, min_sessions: int, size: int
) -> list[dict[str, Any]]:
    """Rank symbols by median traded value straight from TimescaleDB."""
    settings = get_settings()
    try:
        import asyncpg

        conn = await asyncpg.connect(
            settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        )
    except (ImportError, Exception) as exc:  # noqa: BLE001
        logger.warning("universe: database unavailable — %s", exc)
        return []

    try:
        records = await conn.fetch(
            _SELECT_LIQUIDITY_SQL, str(lookback_days), min_sessions, size
        )
        return [dict(r) for r in records]
    finally:
        await conn.close()
