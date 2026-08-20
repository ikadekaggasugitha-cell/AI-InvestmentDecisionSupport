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

import asyncio
import logging
from typing import Any

import pandas as pd

from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS, redis_get_json, redis_set_json
from api.models.technicals import (
    AccumulationBadge,
    AccumulationBatchResponse,
    AccumulationHistoryPoint,
    AccumulationHistoryResponse,
    AccumulationInfo,
    CandlestickPattern,
    EntrySignal,
    GapInfo,
    OHLCVCandle,
    OHLCVResponse,
    SRLevel,
    TechnicalAnalysisResponse,
    TradePlanInfo,
    TrendInfo,
    VolumeInfo,
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
                        # IDX bars carry foreign flow; Yahoo bars leave it None.
                        "foreign_net": getattr(b, "foreign_net", None),
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
    from api.core.db import get_pool

    try:
        # A DB failure must degrade to "no rows" rather than 500 an endpoint
        # that can answer from the live feed.
        pool = await get_pool()
        records = await pool.fetch(
            """
            SELECT time, open, high, low, close, volume, foreign_net
            FROM ohlcv
            WHERE symbol = $1 AND time > NOW() - ($2 || ' days')::INTERVAL
            ORDER BY time
            """,
            symbol, str(int(days * 1.5)),  # calendar days ≈ 1.5× trading days
        )
    except Exception as exc:  # noqa: BLE001 — degrade to no rows when the DB is unusable
        logger.warning("technicals_service: database unavailable — %s", exc)
        return []

    return [
        {
            "time": r["time"],
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": int(r["volume"] or 0),
            # Foreign flow drives the accumulation "who" dimension; NULL for
            # Yahoo-sourced rows, which the foreign-flow read treats as absent.
            "foreign_net": float(r["foreign_net"]) if r["foreign_net"] is not None else None,
        }
        for r in records
    ]


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


def _volume_info(ohlcv: pd.DataFrame) -> VolumeInfo:
    """Read trading intensity vs the stock's own 20-day baseline."""
    if ohlcv.empty or len(ohlcv) < 21:
        return VolumeInfo()

    vol = pd.to_numeric(ohlcv["volume"], errors="coerce").fillna(0.0)
    latest = int(vol.iloc[-1])
    avg20 = float(vol.tail(20).mean()) or 1.0
    ratio = float(vol.tail(5).mean() / avg20)
    level = "high" if ratio >= 1.5 else "low" if ratio <= 0.6 else "normal"
    spike = latest >= 2.0 * avg20

    prior5 = float(vol.iloc[-10:-5].mean()) or 1.0
    recent5 = float(vol.tail(5).mean())
    if recent5 >= prior5 * 1.15:
        trend = "rising"
    elif recent5 <= prior5 * 0.85:
        trend = "falling"
    else:
        trend = "flat"

    note_map = {
        "high": ("Volume ramai — minat pasar tinggi", "Heavy volume — strong market interest"),
        "low": ("Volume sepi — minat pasar rendah", "Thin volume — weak market interest"),
        "normal": ("Volume normal", "Normal volume"),
    }
    note, note_en = note_map[level]
    if spike:
        note = f"Lonjakan volume ({latest / avg20:.1f}× rata-rata) — {note.lower()}"
        note_en = f"Volume spike ({latest / avg20:.1f}× average) — {note_en.lower()}"

    return VolumeInfo(
        level=level, ratio=round(ratio, 2), latest=latest,
        average20d=int(avg20), trend=trend, spike=spike, note=note, noteEn=note_en,
    )


_COMBINE_THRESHOLD = 15.0    # |combined score| below this is neutral
# Foreign flow answers "who is buying" (institutional/asing); volume answers
# "how hard". When foreign flow is available it carries slightly more weight.
_W_FOREIGN, _W_VOLUME = 0.55, 0.45


def _combine_accumulation(vol: dict[str, Any], ff: dict[str, Any]) -> dict[str, Any]:
    """
    Fuse the volume-flow and foreign-flow reads into one accumulation dict
    shaped for AccumulationInfo.

    Foreign flow is the free stand-in for per-broker bandarmology, so when it is
    available the combined score is a weighted blend; otherwise it degrades to
    the volume-only read and `method` reports which happened.
    """
    vol = vol or {}
    ff = ff or {}
    foreign_ok = bool(ff.get("available"))

    vol_score = float(vol.get("score", 0.0))
    if foreign_ok:
        combined = _W_FOREIGN * float(ff.get("score", 0.0)) + _W_VOLUME * vol_score
        method = "volume+foreign"
        # Volume reasons first (how hard), then foreign (who) — both are real.
        signals = list(vol.get("signals", [])) + list(ff.get("signals", []))
        signals_en = list(vol.get("signalsEn", [])) + list(ff.get("signalsEn", []))
    else:
        combined = vol_score
        method = "volume"
        signals = list(vol.get("signals", []))
        signals_en = list(vol.get("signalsEn", []))

    combined = max(-100.0, min(100.0, combined))
    if combined >= _COMBINE_THRESHOLD:
        phase, phase_id = "accumulation", "Akumulasi"
    elif combined <= -_COMBINE_THRESHOLD:
        phase, phase_id = "distribution", "Distribusi"
    else:
        phase, phase_id = "neutral", "Netral"

    return {
        "phase": phase,
        "phaseId": phase_id,
        "score": round(combined, 1),
        "strength": int(round(abs(combined))),
        "obvTrend": vol.get("obvTrend", 0.0),
        "cmf": vol.get("cmf", 0.0),
        "mfi": vol.get("mfi", 50.0),
        "consistencyDays": vol.get("consistencyDays", 0),
        "signals": signals,
        "signalsEn": signals_en,
        "method": method,
        "foreignAvailable": foreign_ok,
        "foreignPhase": ff.get("phase", "neutral"),
        "foreignScore": ff.get("score", 0.0),
        "netForeign5d": ff.get("netForeign5d", 0),
        "netForeign20d": ff.get("netForeign20d", 0),
        "foreignConsistencyDays": ff.get("consistencyDays", 0),
    }


def _entry_signal(
    trend: dict[str, Any] | None,
    accumulation: dict[str, Any],
    plan: Any,
    volume: VolumeInfo,
) -> EntrySignal:
    """
    When to enter and why. Combines trend direction, the combined (volume +
    foreign) accumulation read, and whether a usable stop exists into one call
    with a plain-language reason — never a bare buy/sell instruction.
    """
    tdir = (trend or {}).get("trend", "sideways")
    strength = int((trend or {}).get("strength", 0))
    phase = accumulation.get("phase", "neutral")
    foreign_phase = accumulation.get("foreignPhase", "neutral")
    has_stop = plan is not None and getattr(plan, "stopLoss", None) is not None

    # Distribution (combined or foreign), or a broken downtrend → stay out.
    if phase == "distribution" or foreign_phase == "distribution" or (tdir == "downtrend" and strength >= 40):
        if foreign_phase == "distribution":
            reason = "Asing net jual (distribusi) — hindari entry sampai aliran dana berbalik"
            reason_en = "Foreign net selling (distribution) — avoid entry until flow reverses"
        else:
            reason = "Tren turun / distribusi terdeteksi — hindari entry sampai struktur membaik"
            reason_en = "Downtrend / distribution detected — avoid entry until structure improves"
        return EntrySignal(signal="avoid", signalId="Hindari", reason=reason, reasonEn=reason_en)

    # Uptrend (or accumulation) with a definable risk level → a watch entry.
    supportive = tdir == "uptrend" or phase == "accumulation"
    if supportive and has_stop:
        bits_id = [f"tren {tdir}" if tdir != "sideways" else "harga konsolidasi"]
        bits_en = [f"{tdir}" if tdir != "sideways" else "price consolidating"]
        if phase == "accumulation":
            bits_id.append("terindikasi akumulasi volume")
            bits_en.append("volume accumulation")
        if foreign_phase == "accumulation":
            bits_id.append("didukung akumulasi asing")
            bits_en.append("confirmed by foreign accumulation")
        if volume.level == "high":
            bits_id.append("didukung volume ramai")
            bits_en.append("backed by heavy volume")
        bits_id.append(
            f"stop loss jelas di Rp {int(plan.stopLoss):,}".replace(",", ".")
            + f" ({plan.stopLossPct:.1f}%)"
        )
        bits_en.append(f"clear stop at Rp {int(plan.stopLoss):,} ({plan.stopLossPct:.1f}%)")
        reason = "Entry dipertimbangkan: " + ", ".join(bits_id) + "."
        reason_en = "Entry candidate: " + ", ".join(bits_en) + "."
        return EntrySignal(signal="buy_watch", signalId="Pantau Beli", reason=reason, reasonEn=reason_en)

    # Otherwise wait — say what is missing.
    if not has_stop:
        reason = "Belum ada level support yang layak jadi stop loss — tunggu setup lebih jelas"
        reason_en = "No support level fit for a stop yet — wait for a clearer setup"
    else:
        reason = "Struktur belum mendukung — tunggu konfirmasi tren atau akumulasi"
        reason_en = "Structure not supportive yet — wait for trend or accumulation confirmation"
    return EntrySignal(signal="wait", signalId="Tunggu", reason=reason, reasonEn=reason_en)


async def get_technical_analysis(symbol: str) -> TechnicalAnalysisResponse:
    """
    Full chart read: trend, support/resistance, candlestick patterns, open gaps,
    volume intensity, volume-flow accumulation, and an entry / stop-loss plan
    with the reasoning behind it.
    """
    from ml.features.foreign_flow import analyse_foreign_flow
    from ml.features.volume_accumulation import analyse_accumulation
    from ml.inference.trade_plan import _build_technical_note, _compute_trade_plan

    settings = get_settings()
    symbol = symbol.upper()
    cache_key = REDIS_KEYS["technicals"].format(symbol=symbol)

    cached = await redis_get_json(cache_key)
    if cached:
        return TechnicalAnalysisResponse(**cached)

    ohlcv, source = await load_ohlcv(symbol, days=settings.ta_gap_lookback_days)
    raw = analyse(ohlcv)

    trend_raw = raw["trend"]

    # ── Volume, accumulation, entry/stop-loss plan ────────────────────────────
    volume = _volume_info(ohlcv)
    vol_raw = analyse_accumulation(ohlcv) if not ohlcv.empty else {}
    ff_raw = analyse_foreign_flow(ohlcv) if not ohlcv.empty else {}
    acc_raw = _combine_accumulation(vol_raw, ff_raw)

    current_price = float(ohlcv["close"].iloc[-1]) if not ohlcv.empty else 0.0
    # Target for the risk/reward leg: the nearest resistance above price, or a
    # modest +8% when structure offers none, so the plan still has a stop.
    resistances = [
        float(lvl["price"]) for lvl in raw["sr_levels"]
        if lvl.get("type") == "resistance" and float(lvl["price"]) > current_price
    ]
    target_price = min(resistances) if resistances else current_price * 1.08
    plan = _compute_trade_plan(
        current_price=current_price,
        target_price=target_price,
        sr_levels=raw["sr_levels"],
        max_stop_pct=settings.ta_max_stop_loss_pct,
        min_stop_pct=settings.ta_min_stop_loss_pct,
    ) if current_price > 0 else None

    entry = _entry_signal(trend_raw, acc_raw or {}, plan, volume)
    note_id, note_en = _build_technical_note(
        trend_raw, plan, raw["patterns"], raw["gaps"], acc_raw,
    )

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
        volume=volume,
        accumulation=AccumulationInfo(
            phase=acc_raw.get("phase", "neutral"),
            phaseId=acc_raw.get("phaseId", "Netral"),
            score=acc_raw.get("score", 0.0),
            strength=acc_raw.get("strength", 0),
            obvTrend=acc_raw.get("obvTrend", 0.0),
            cmf=acc_raw.get("cmf", 0.0),
            mfi=acc_raw.get("mfi", 50.0),
            consistencyDays=acc_raw.get("consistencyDays", 0),
            signals=acc_raw.get("signals", []),
            signalsEn=acc_raw.get("signalsEn", []),
            method=acc_raw.get("method", "volume"),
            foreignAvailable=acc_raw.get("foreignAvailable", False),
            foreignPhase=acc_raw.get("foreignPhase", "neutral"),
            foreignScore=acc_raw.get("foreignScore", 0.0),
            netForeign5d=acc_raw.get("netForeign5d", 0),
            netForeign20d=acc_raw.get("netForeign20d", 0),
            foreignConsistencyDays=acc_raw.get("foreignConsistencyDays", 0),
        ),
        entrySignal=entry,
        tradePlan=TradePlanInfo(
            entryPrice=plan.entryPrice if plan else None,
            stopLoss=plan.stopLoss if plan else None,
            stopLossPct=plan.stopLossPct if plan else None,
            stopLossReason=plan.stopLossReason if plan else "",
            stopLossReasonEn=plan.stopLossReasonEn if plan else "",
            riskRewardRatio=plan.riskRewardRatio if plan else None,
        ),
        technicalNote=note_id,
        technicalNoteEn=note_en,
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


async def get_accumulation_history(symbol: str, days: int = 30) -> AccumulationHistoryResponse:
    """
    Pullable foreign-flow accumulation history — net foreign flow per session
    with a running cumulative and a rolling accumulation phase.

    This is the free, real "broker/accumulation history" the product needs:
    daily net foreign (institutional) flow from IDX, which shows how buying or
    selling pressure built up over time. Returns `available=False` with an empty
    series when the symbol carries no foreign flow (e.g. a Yahoo-only bootstrap).
    """
    from ml.features.foreign_flow import foreign_flow_history

    symbol = symbol.upper()
    cache_key = f"technicals:acchist:{symbol}:{days}"  # technicals:* → cleared by daily_update
    cached = await redis_get_json(cache_key)
    if cached:
        return AccumulationHistoryResponse(**cached)

    try:
        frame, _src = await load_ohlcv(symbol, days=max(days + 25, 60))
        points = foreign_flow_history(frame, days=days)
    except Exception as exc:  # noqa: BLE001 — degrade to empty, never 500
        logger.warning("technicals_service: accumulation history failed for %s — %s", symbol, exc)
        points = []

    response = AccumulationHistoryResponse(
        symbol=symbol,
        points=[AccumulationHistoryPoint(**p) for p in points],
        available=bool(points),
        source="foreign",
    )
    await redis_set_json(cache_key, response.model_dump(), ttl=TECHNICALS_TTL)
    return response


async def _accumulation_badge(symbol: str) -> AccumulationBadge:
    """
    Compact combined (volume + foreign) accumulation read for one symbol, cached
    a day. Blends the same two dimensions as the detail panel so the MarketsView
    table badge and the expanded card never disagree.
    """
    from ml.features.foreign_flow import analyse_foreign_flow
    from ml.features.volume_accumulation import analyse_accumulation

    symbol = symbol.upper()
    cache_key = f"technicals:acc:{symbol}"  # technicals:* → cleared by daily_update
    cached = await redis_get_json(cache_key)
    if cached:
        return AccumulationBadge(**cached)

    try:
        frame, _src = await load_ohlcv(symbol, days=90)
        vol = analyse_accumulation(frame)
        ff = analyse_foreign_flow(frame)
        r = _combine_accumulation(vol, ff)
    except Exception as exc:  # noqa: BLE001 — one bad symbol must not fail the batch
        logger.warning("technicals_service: accumulation badge failed for %s — %s", symbol, exc)
        return AccumulationBadge(symbol=symbol)

    badge = AccumulationBadge(
        symbol=symbol,
        phase=r["phase"],
        phaseId=r["phaseId"],
        score=r["score"],
        strength=r["strength"],
        consistencyDays=r["consistencyDays"],
        method=r["method"],
        foreignPhase=r["foreignPhase"],
    )
    await redis_set_json(cache_key, badge.model_dump(), ttl=TECHNICALS_TTL)
    return badge


async def get_accumulation_batch(symbols: list[str] | None = None) -> AccumulationBatchResponse:
    """
    Accumulation read for many symbols in ONE request — the batch behind the
    MarketsView badge column. Fetching per-row would be a classic N-request
    waterfall; this fans out concurrently instead and each symbol is cached, so
    a warm board answers instantly.

    Defaults to the tracked universe when no symbols are given.
    """
    settings = get_settings()
    universe = symbols or list(settings.tracked_symbols)
    # De-dup, cap, and normalise so an oversized query can't fan out unbounded.
    seen: list[str] = []
    for s in universe:
        u = s.strip().upper()
        if u and u not in seen:
            seen.append(u)
        if len(seen) >= 60:
            break

    items = await asyncio.gather(*(_accumulation_badge(s) for s in seen))
    return AccumulationBatchResponse(items=list(items), source="volume")
