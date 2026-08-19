"""
Broker Summary Service — Phase 10

Read path for /v1/broksum/*. Mirrors the resolution order used by the other
services: Redis cache first, mock generator when USE_MOCK_BROKSUM=true, then
TimescaleDB.

Everything served here is point-in-time — computed from history as it stands
"now". That is correct for display, and is exactly why these numbers are not
model features; see PHASE10_DISPLAY_FEATURES in ml/features/engineer.py.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS, redis_get_json, redis_set_json
from api.models.broksum import (
    BrokerActivity,
    BrokerRow,
    BrokerSummaryDay,
    BrokerSummaryHistoryResponse,
    BrokerSummaryResponse,
    BrokerSummarySnapshot,
)

logger = logging.getLogger(__name__)

BROKSUM_TTL = 86_400  # one trading session


def _snapshot_from_raw(raw: dict[str, Any]) -> BrokerSummarySnapshot:
    """Build the API snapshot from a compute_accumulation_score() result."""
    return BrokerSummarySnapshot(
        phase=raw.get("phase", "neutral"),
        phaseId=raw.get("phaseId", "Netral"),
        score=float(raw.get("score", 0.0)),
        topBuyers=[BrokerActivity(**b) for b in raw.get("topBuyers", [])],
        topSellers=[BrokerActivity(**s) for s in raw.get("topSellers", [])],
        netLot5d=int(raw.get("netLot5d", 0)),
        netLot20d=int(raw.get("netLot20d", 0)),
        consistencyDays=int(raw.get("consistencyDays", 0)),
        concentration=float(raw.get("concentration", 0.0)),
    )


async def _load_rows(symbol: str, days: int) -> list[dict[str, Any]]:
    """
    Load broker rows for a symbol — mock generator or TimescaleDB.

    Returns an empty list rather than raising when the database is unreachable,
    so a missing Timescale instance degrades the endpoint to "no data" instead
    of a 500.
    """
    settings = get_settings()

    if settings.use_mock_broksum:
        from ingestor.broksum_mock import generate_mock_broksum_history
        return generate_mock_broksum_history(symbol, days=days)

    from api.core.db import get_pool

    try:
        # A DB failure degrades to "no rows" instead of failing the request.
        pool = await get_pool()
        records = await pool.fetch(
            """
            SELECT time, symbol, broker_code, buy_lot, sell_lot, buy_val, sell_val,
                   net_lot, net_val, avg_buy_price, avg_sell_price
            FROM broker_summary
            WHERE symbol = $1 AND time > NOW() - ($2 || ' days')::INTERVAL
            ORDER BY time
            """,
            symbol, str(days),
        )
    except Exception as exc:  # noqa: BLE001 — degrade to no rows when the DB is unusable
        logger.warning("broksum_service: database unavailable for %s — %s", symbol, exc)
        return []

    return [dict(r) for r in records]


async def get_broker_summary(symbol: str) -> BrokerSummaryResponse:
    """Latest session's broker rows plus the accumulation/distribution snapshot."""
    settings = get_settings()
    symbol = symbol.upper()
    cache_key = REDIS_KEYS["broksum"].format(symbol=symbol)

    cached = await redis_get_json(cache_key)
    if cached and "snapshot" in cached:
        return BrokerSummaryResponse(**cached)

    rows = await _load_rows(symbol, days=30)
    source = "mock" if settings.use_mock_broksum else "live"

    if not rows:
        # No per-broker flow (IDX's broker summary is a gated feed). Fall back to
        # the real volume-based accumulation read from OHLCV rather than an empty
        # neutral card, so "is this stock being accumulated?" still gets a real,
        # daily-updated answer. Labelled source="volume" so it is never mistaken
        # for licensed broker flow.
        snapshot = await _volume_snapshot(symbol)
        response = BrokerSummaryResponse(
            symbol=symbol,
            date=datetime.now(timezone.utc).date().isoformat(),
            snapshot=snapshot,
            brokers=[],
            source="volume" if snapshot.method == "volume" else source,
        )
        if snapshot.method == "volume":
            await redis_set_json(cache_key, response.model_dump(), ttl=BROKSUM_TTL)
        return response

    import pandas as pd
    from ml.features.broksum_features import compute_accumulation_score

    frame = pd.DataFrame(rows)
    snapshot_raw = compute_accumulation_score(frame, symbol)

    # Latest session only, ordered by how much each broker actually moved.
    latest_time = frame["time"].max()
    latest = frame[frame["time"] == latest_time]
    brokers = [
        BrokerRow(
            brokerCode=r["broker_code"],
            buyLot=int(r.get("buy_lot") or 0),
            sellLot=int(r.get("sell_lot") or 0),
            buyVal=float(r.get("buy_val") or 0.0),
            sellVal=float(r.get("sell_val") or 0.0),
            netLot=int(r.get("net_lot") or 0),
            netVal=float(r.get("net_val") or 0.0),
            avgBuyPrice=float(r.get("avg_buy_price") or 0.0),
            avgSellPrice=float(r.get("avg_sell_price") or 0.0),
        )
        for r in latest.to_dict("records")
    ]
    brokers.sort(key=lambda b: abs(b.netLot), reverse=True)

    response = BrokerSummaryResponse(
        symbol=symbol,
        date=pd.to_datetime(latest_time).date().isoformat(),
        snapshot=_snapshot_from_raw(snapshot_raw),
        brokers=brokers,
        source=source,
    )
    await redis_set_json(cache_key, response.model_dump(), ttl=BROKSUM_TTL)
    return response


async def _volume_snapshot(symbol: str) -> BrokerSummarySnapshot:
    """
    Accumulation snapshot derived from OHLCV+volume (no broker feed needed).

    Returns a neutral placeholder when there are not enough bars; otherwise a
    real read with method="volume" so the caller can label the source honestly.
    """
    from api.services.technicals_service import load_ohlcv
    from ml.features.volume_accumulation import analyse_accumulation

    try:
        frame, _src = await load_ohlcv(symbol, days=90)
        r = analyse_accumulation(frame)
    except Exception as exc:  # noqa: BLE001 — degrade to neutral, never 500
        logger.warning("broksum_service: volume snapshot failed for %s — %s", symbol, exc)
        return BrokerSummarySnapshot(phase="neutral", phaseId="Netral", score=0.0)

    return BrokerSummarySnapshot(
        phase=r["phase"], phaseId=r["phaseId"], score=r["score"],
        consistencyDays=r["consistencyDays"],
        method=r["method"], strength=r["strength"], obvTrend=r["obvTrend"],
        cmf=r["cmf"], mfi=r["mfi"], volumeRatio=r["volumeRatio"],
        volumeLevel=r["volumeLevel"], signals=r["signals"], signalsEn=r["signalsEn"],
    )


async def get_broker_summary_history(
    symbol: str, days: int = 20
) -> BrokerSummaryHistoryResponse:
    """Daily net-lot series with the dominant buyer and seller per session."""
    settings = get_settings()
    symbol = symbol.upper()
    rows = await _load_rows(symbol, days=days)
    source = "mock" if settings.use_mock_broksum else "live"

    if not rows:
        # Volume-based accumulation history from OHLCV — the daily record of how
        # buying/selling pressure built, without a broker feed.
        from api.services.technicals_service import load_ohlcv
        from ml.features.volume_accumulation import accumulation_history

        try:
            frame, _src = await load_ohlcv(symbol, days=max(days + 25, 60))
            hist = accumulation_history(frame, days=days)
        except Exception as exc:  # noqa: BLE001
            logger.warning("broksum_service: volume history failed for %s — %s", symbol, exc)
            hist = []

        return BrokerSummaryHistoryResponse(
            symbol=symbol, days=days,
            history=[
                BrokerSummaryDay(
                    date=h["date"], score=h["score"], phase=h["phase"],
                    volume=h["volume"], close=h["close"],
                )
                for h in hist
            ],
            source="volume" if hist else source,
        )

    import pandas as pd

    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["time"]).dt.date

    history: list[BrokerSummaryDay] = []
    for day, group in frame.groupby("date"):
        by_broker = group.groupby("broker_code")["net_lot"].sum()
        history.append(BrokerSummaryDay(
            date=day.isoformat(),
            netLot=int(group["net_lot"].sum()),
            netVal=float(group["net_val"].sum()) if "net_val" in group else 0.0,
            topBuyer=str(by_broker.idxmax()) if not by_broker.empty else "",
            topSeller=str(by_broker.idxmin()) if not by_broker.empty else "",
        ))

    history.sort(key=lambda d: d.date)
    return BrokerSummaryHistoryResponse(
        symbol=symbol, days=days, history=history[-days:], source=source
    )
