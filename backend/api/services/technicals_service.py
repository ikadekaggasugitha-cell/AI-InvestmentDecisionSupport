"""
Technical Analysis Service — Phase 10

Read path for /v1/technicals/*. Resolves daily bars from Redis, TimescaleDB, or
the deterministic mock generator, then runs PriceActionAnalyzer over them.

Everything here is point-in-time: computed from the full history as it stands
right now. That is the correct reading for display — "where is support today" —
and is precisely why these values are not model features. Attaching them to
historical training rows is what produced the look-ahead leakage documented in
ml/features/engineer.py.
"""

import logging
from typing import Any

import pandas as pd

from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS, redis_get_json, redis_set_json
from api.models.technicals import (
    CandlestickPattern,
    GapInfo,
    OHLCVCandle,
    OHLCVResponse,
    SRLevel,
    TechnicalAnalysisResponse,
    TrendInfo,
)
from ml.features.price_action import PriceActionAnalyzer

logger = logging.getLogger(__name__)

TECHNICALS_TTL = 86_400  # one trading session
OHLCV_TTL = 3_600

_analyzer = PriceActionAnalyzer()


async def load_ohlcv(symbol: str, days: int = 260) -> tuple[pd.DataFrame, str]:
    """
    Load daily bars for one symbol.

    Resolution order, most authoritative first:
      1. TimescaleDB  — populated by workers.ohlcv_worker
      2. Live provider — direct vendor fetch when the table is empty, so a
         fresh deployment serves real prices before the first backfill runs
      3. Deterministic mock — only when USE_MOCK_MARKET=true or the feed is down

    Returns (frame, source) where source is "db" | "<provider>" | "mock", so
    callers can report which one the numbers came from rather than implying all
    three are equivalent.
    """
    settings = get_settings()
    symbol = symbol.upper()

    if not settings.use_mock_market:
        rows = await _load_ohlcv_from_db(symbol, days)
        if rows:
            return pd.DataFrame(rows), "db"

        # Table empty — go straight to the vendor rather than silently serving
        # synthetic prices. Costs one request and keeps the output real.
        logger.info(
            "technicals_service: `ohlcv` empty for %s — fetching from provider. "
            "Run workers.ohlcv_worker.backfill_ohlcv to populate the table.",
            symbol,
        )
        try:
            from ingestor.providers import get_provider

            bars = await get_provider().get_daily_bars(symbol, days)
            if bars:
                return pd.DataFrame([
                    {
                        "time": b.date, "open": b.open, "high": b.high,
                        "low": b.low, "close": b.close, "volume": b.volume,
                    }
                    for b in bars
                ]), get_provider().name
        except Exception as exc:  # noqa: BLE001 — fall through to mock
            logger.warning("technicals_service: provider fetch failed for %s — %s", symbol, exc)

        logger.warning(
            "technicals_service: no real bars available for %s; serving MOCK data",
            symbol,
        )

    from ingestor.ohlcv_mock import generate_mock_ohlcv
    return pd.DataFrame(generate_mock_ohlcv(symbol, days=days)), "mock"


async def _load_ohlcv_from_db(symbol: str, days: int) -> list[dict[str, Any]]:
    """Query daily bars, returning [] when the database is unreachable or empty."""
    settings = get_settings()
    try:
        # Imported inside the guard: the driver is optional for deployments
        # that run feed-only, and a missing module must degrade to "no rows"
        # rather than 500 an endpoint that can answer from the live feed.
        import asyncpg

        conn = await asyncpg.connect(
            settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        )
    except (ImportError, Exception) as exc:  # noqa: BLE001
        logger.warning("technicals_service: database unavailable — %s", exc)
        return []

    try:
        records = await conn.fetch(
            """
            SELECT time, open, high, low, close, volume
            FROM ohlcv
            WHERE symbol = $1 AND time > NOW() - ($2 || ' days')::INTERVAL
            ORDER BY time
            """,
            symbol, str(int(days * 1.5)),  # calendar days ≈ 1.5× trading days
        )
        return [
            {
                "time": r["time"],
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": int(r["volume"] or 0),
            }
            for r in records
        ]
    finally:
        await conn.close()


def analyse(ohlcv: pd.DataFrame) -> dict[str, Any]:
    """
    Run the full price-action pass over a bar series.

    Returns the raw analyzer output, shared by the API layer and by
    signal_inference for trade-plan derivation, so both read identical levels.
    """
    if ohlcv.empty:
        return {"trend": None, "sr_levels": [], "patterns": [], "gaps": []}

    settings = get_settings()
    return {
        "trend": _analyzer.detect_trend(ohlcv),
        "sr_levels": _analyzer.find_support_resistance(
            ohlcv, method=settings.ta_sr_method
        ),
        "patterns": _analyzer.detect_candlestick_patterns(ohlcv),
        "gaps": _analyzer.detect_gaps(
            ohlcv, threshold_pct=settings.ta_gap_threshold_pct
        ),
    }


async def get_technical_analysis(symbol: str) -> TechnicalAnalysisResponse:
    """Trend, support/resistance, candlestick patterns and open gaps."""
    settings = get_settings()
    symbol = symbol.upper()
    cache_key = REDIS_KEYS["technicals"].format(symbol=symbol)

    cached = await redis_get_json(cache_key)
    if cached:
        return TechnicalAnalysisResponse(**cached)

    ohlcv, source = await load_ohlcv(symbol, days=settings.ta_gap_lookback_days)
    raw = analyse(ohlcv)

    trend_raw = raw["trend"]
    response = TechnicalAnalysisResponse(
        symbol=symbol,
        trend=TrendInfo(
            trend=trend_raw.get("trend", "sideways"),
            trendId=trend_raw.get("trendId", "Sideways"),
            strength=int(trend_raw.get("strength", 0)),
            emaFast=float(trend_raw.get("ema_fast", 0.0)),
            emaSlow=float(trend_raw.get("ema_slow", 0.0)),
        ) if trend_raw else TrendInfo(),
        supportResistance=[
            SRLevel(
                type=lvl["type"],
                price=float(lvl["price"]),
                strength=int(lvl.get("strength", 1)),
                touches=int(lvl.get("touches", 0)),
                method=lvl.get("method", "fractal"),
            )
            for lvl in raw["sr_levels"]
        ],
        patterns=[
            CandlestickPattern(
                pattern=p["pattern"],
                patternId=p.get("patternId", p["pattern"]),
                date=p.get("date", ""),
                significance=p.get("significance", "medium"),
                signal=int(p.get("signal", 0)),
            )
            for p in raw["patterns"]
        ],
        gaps=[
            GapInfo(
                type=g["type"],
                date=g.get("date", ""),
                gapPct=float(g.get("gap_pct", 0.0)),
                top=float(g.get("top", 0.0)),
                bottom=float(g.get("bottom", 0.0)),
                isFilled=bool(g.get("is_filled", False)),
                fillProbability=float(g.get("fill_probability", 0.75)),
                avgFillDays=g.get("avg_fill_days"),
            )
            for g in raw["gaps"]
        ],
        source=source,
    )

    await redis_set_json(cache_key, response.model_dump(), ttl=TECHNICALS_TTL)
    return response


async def get_ohlcv_history(symbol: str, days: int = 120) -> OHLCVResponse:
    """Daily candles for the chart, newest last."""
    symbol = symbol.upper()
    cache_key = REDIS_KEYS["ohlcv_series"].format(symbol=symbol, days=days)

    cached = await redis_get_json(cache_key)
    if cached:
        return OHLCVResponse(**cached)

    frame, _source = await load_ohlcv(symbol, days=days)
    candles = [
        OHLCVCandle(
            # Lightweight Charts accepts 'yyyy-mm-dd' for daily series.
            time=pd.to_datetime(r["time"]).date().isoformat(),
            open=float(r["open"]),
            high=float(r["high"]),
            low=float(r["low"]),
            close=float(r["close"]),
            volume=int(r.get("volume") or 0),
        )
        for r in frame.tail(days).to_dict("records")
    ]

    response = OHLCVResponse(symbol=symbol, candles=candles, days=days)
    await redis_set_json(cache_key, response.model_dump(), ttl=OHLCV_TTL)
    return response
