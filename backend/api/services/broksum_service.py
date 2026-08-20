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
        # the free, real "smart money" read from OHLCV + IDX foreign flow rather
        # than an empty neutral card, so "is this stock being accumulated, and by
        # whom?" still gets a real, daily-updated answer. `method` labels the
        # source ("volume+foreign" | "volume") so it is never mistaken for
        # licensed per-broker flow.
        snapshot = await _free_snapshot(symbol)
        response = BrokerSummaryResponse(
            symbol=symbol,
            date=datetime.now(timezone.utc).date().isoformat(),
            snapshot=snapshot,
            brokers=[],
            source=snapshot.method if snapshot.method != "broker" else source,
        )
        if snapshot.method in ("volume", "volume+foreign"):
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


async def _free_snapshot(symbol: str) -> BrokerSummarySnapshot:
    """
    "Smart money" accumulation snapshot from OHLCV + IDX foreign flow — the free
    substitute for gated per-broker flow, no licensed feed needed.

    Blends volume-flow (how hard buying pressure is) with foreign flow (who —
    institutional/asing). When foreign flow is available, "ASING" is surfaced as
    the dominant party in topBuyers/topSellers so the existing broker panel keeps
    a "who is accumulating" column. Returns a neutral placeholder when there are
    too few bars; `method` reports which dimensions contributed.
    """
    from api.services.technicals_service import _combine_accumulation, load_ohlcv
    from ml.features.foreign_flow import analyse_foreign_flow
    from ml.features.volume_accumulation import analyse_accumulation

    try:
        frame, _src = await load_ohlcv(symbol, days=90)
        vol = analyse_accumulation(frame)
        ff = analyse_foreign_flow(frame)
        c = _combine_accumulation(vol, ff)
    except Exception as exc:  # noqa: BLE001 — degrade to neutral, never 500
        logger.warning("broksum_service: free snapshot failed for %s — %s", symbol, exc)
        return BrokerSummarySnapshot(phase="neutral", phaseId="Netral", score=0.0)

    top_buyers: list[BrokerActivity] = []
    top_sellers: list[BrokerActivity] = []
    net5 = int(c.get("netForeign5d", 0))
    net20 = int(c.get("netForeign20d", 0))
    if c.get("foreignAvailable"):
        asing = BrokerActivity(broker="ASING", netLot5d=net5, netLot20d=net20)
        if net5 > 0:
            top_buyers = [asing]
        elif net5 < 0:
            top_sellers = [asing]

    return BrokerSummarySnapshot(
        phase=c["phase"], phaseId=c["phaseId"], score=c["score"],
        topBuyers=top_buyers, topSellers=top_sellers,
        netLot5d=net5, netLot20d=net20,
        consistencyDays=c["consistencyDays"],
        method=c["method"], strength=c["strength"], obvTrend=c["obvTrend"],
        cmf=c["cmf"], mfi=c["mfi"],
        volumeRatio=vol.get("volumeRatio", 1.0), volumeLevel=vol.get("volumeLevel", "normal"),
        signals=c["signals"], signalsEn=c["signalsEn"],
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
        # No per-broker feed. Prefer the free foreign-flow history (net foreign
        # per session + who is dominant); fall back to volume-flow history when a
        # symbol carries no foreign flow. Either way this is a real, daily record
        # of how buying/selling pressure built up.
        from api.services.technicals_service import load_ohlcv
        from ml.features.foreign_flow import foreign_flow_history
        from ml.features.volume_accumulation import accumulation_history

        try:
            frame, _src = await load_ohlcv(symbol, days=max(days + 25, 60))
        except Exception as exc:  # noqa: BLE001 — degrade to no history, never 500
            logger.warning("broksum_service: history load failed for %s — %s", symbol, exc)
            return BrokerSummaryHistoryResponse(symbol=symbol, days=days, history=[], source=source)

        fhist = foreign_flow_history(frame, days=days)
        if fhist:
            return BrokerSummaryHistoryResponse(
                symbol=symbol, days=days,
                history=[
                    BrokerSummaryDay(
                        date=h["date"], netLot=h["netForeign"], score=h["score"],
                        phase=h["phase"], close=h["close"],
                        topBuyer="ASING" if h["netForeign"] > 0 else "",
                        topSeller="ASING" if h["netForeign"] < 0 else "",
                    )
                    for h in fhist
                ],
                source="foreign",
            )

        vhist = accumulation_history(frame, days=days)
        return BrokerSummaryHistoryResponse(
            symbol=symbol, days=days,
            history=[
                BrokerSummaryDay(
                    date=h["date"], score=h["score"], phase=h["phase"],
                    volume=h["volume"], close=h["close"],
                )
                for h in vhist
            ],
            source="volume" if vhist else source,
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
