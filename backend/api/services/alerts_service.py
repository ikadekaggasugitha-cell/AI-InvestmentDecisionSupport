"""
Alerts service — derives the Peringatan feed from live data.

The panel used to show a frozen 5-item seed. This builds it at read time from
the same sources the rest of the app already surfaces:

  • AI signals   — stocks at the probability extremes (VERY_HIGH / LOW)
  • Price action — the day's biggest movers and a notable IHSG move
  • Foreign flow — large net foreign buy / sell (board-level bandarmology)
  • Risk & news  — portfolio risk threshold breaches + latest BEI disclosures

Every source is independently guarded, so one unavailable feed drops its
category rather than failing the whole list. Each alert carries a STABLE `key`
so the frontend's read/dismiss state persists across refetches.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from api.core.redis_client import REDIS_KEYS, get_redis
from api.models.alerts import AlertItem, AlertsResponse
from api.models.risk import RiskMetricsResponse

logger = logging.getLogger(__name__)


def _rel_time(dt: datetime | None) -> tuple[str, str]:
    """(Indonesian, English) relative time. 'baru saja' when unknown/very recent."""
    if dt is None:
        return "baru saja", "just now"
    secs = (datetime.now(timezone.utc) - dt).total_seconds()
    if secs < 90:
        return "baru saja", "just now"
    mins = int(secs // 60)
    if mins < 60:
        return f"{mins} mnt lalu", f"{mins} min ago"
    hours = mins // 60
    if hours < 24:
        return f"{hours} jam lalu", f"{hours} hr ago"
    days = hours // 24
    return f"{days} hr lalu", f"{days}d ago"


def _fmt_rp(value: float) -> str:
    return f"Rp {value:,.0f}".replace(",", ".")


async def _signal_alerts() -> list[dict]:
    """Stocks at the probability extremes, from the live signal cache."""
    from api.services.signal_service import get_signals

    out: list[dict] = []
    try:
        resp = await get_signals()
    except Exception as exc:  # noqa: BLE001
        logger.debug("alerts: signals unavailable — %s", exc)
        return out

    ranked = sorted(resp.signals, key=lambda s: s.uprob, reverse=True)
    for s in [x for x in ranked if x.probabilityTier == "VERY_HIGH"][:3]:
        out.append({
            "key": f"signal:{s.symbol}:VERY_HIGH",
            "type": "signal", "severity": "high", "symbol": s.symbol,
            "msgId": f"{s.symbol} — probabilitas naik {s.uprob}% (Sangat Tinggi). {s.name or ''}".strip(),
            "msgEn": f"{s.symbol} — {s.uprob}% upward probability (Very High). {s.name or ''}".strip(),
        })
    for s in [x for x in ranked if x.probabilityTier == "LOW"][-2:]:
        out.append({
            "key": f"signal:{s.symbol}:LOW",
            "type": "signal", "severity": "medium", "symbol": s.symbol,
            "msgId": f"{s.symbol} — probabilitas naik hanya {s.uprob}% (Rendah). Waspadai risiko penurunan.",
            "msgEn": f"{s.symbol} — only {s.uprob}% upward probability (Low). Watch downside risk.",
        })
    return out


async def _market_alerts(redis) -> list[dict]:
    """Biggest movers and a notable IHSG move, from the market snapshot."""
    out: list[dict] = []
    try:
        raw = await redis.hgetall(REDIS_KEYS["market_snapshot"])
        ticks = [json.loads(v) for v in raw.values()]
    except Exception as exc:  # noqa: BLE001
        logger.debug("alerts: market snapshot unavailable — %s", exc)
        return out

    def _cp(t: dict) -> float:
        v = t.get("changePct")
        return float(v) if isinstance(v, (int, float)) else 0.0

    movers = sorted(ticks, key=_cp, reverse=True)
    for t in movers[:2]:
        if _cp(t) >= 5:
            out.append({
                "key": f"gainer:{t.get('symbol')}",
                "type": "signal", "severity": "medium", "symbol": t.get("symbol"),
                "msgId": f"{t.get('symbol')} melonjak +{_cp(t):.1f}% hari ini.",
                "msgEn": f"{t.get('symbol')} surged +{_cp(t):.1f}% today.",
            })
    for t in movers[-2:]:
        if _cp(t) <= -5:
            out.append({
                "key": f"loser:{t.get('symbol')}",
                "type": "signal", "severity": "medium", "symbol": t.get("symbol"),
                "msgId": f"{t.get('symbol')} anjlok {_cp(t):.1f}% hari ini.",
                "msgEn": f"{t.get('symbol')} dropped {_cp(t):.1f}% today.",
            })

    # IHSG move from the full snapshot JSON.
    try:
        sj = await redis.get("market:snapshot:json")
        if sj:
            ihsg = (json.loads(sj) or {}).get("ihsg") or {}
            pct = ihsg.get("changePct")
            if isinstance(pct, (int, float)) and abs(pct) >= 0.5:
                arah_id = "menguat" if pct > 0 else "melemah"
                arah_en = "up" if pct > 0 else "down"
                sev = "high" if abs(pct) >= 1.5 else "medium"
                out.append({
                    "key": "ihsg:move",
                    "type": "macro", "severity": sev, "symbol": None,
                    "msgId": f"IHSG {arah_id} {abs(pct):.2f}% ke {ihsg.get('value')}.",
                    "msgEn": f"IHSG {arah_en} {abs(pct):.2f}% to {ihsg.get('value')}.",
                })
    except Exception:  # noqa: BLE001
        pass
    return out


async def _foreign_flow_alerts(redis) -> list[dict]:
    """Large net foreign buy / sell across the board."""
    out: list[dict] = []
    try:
        raw = await redis.hgetall(REDIS_KEYS["market_snapshot"])
        ticks = [json.loads(v) for v in raw.values()]
    except Exception as exc:  # noqa: BLE001
        logger.debug("alerts: foreign flow snapshot unavailable — %s", exc)
        return out

    withfn = [t for t in ticks if isinstance(t.get("foreignNet"), (int, float)) and t.get("foreignNet")]
    ranked = sorted(withfn, key=lambda t: float(t.get("foreignNet") or 0), reverse=True)
    # Net buy — only flag material flows (>= 50 IDR bn).
    for t in ranked[:2]:
        fn = float(t.get("foreignNet") or 0)
        if fn >= 50:
            out.append({
                "key": f"foreign_buy:{t.get('symbol')}",
                "type": "signal", "severity": "medium", "symbol": t.get("symbol"),
                "msgId": f"Asing net beli {t.get('symbol')} Rp {fn:,.0f} M.".replace(",", "."),
                "msgEn": f"Foreign net buy {t.get('symbol')} Rp {fn:,.0f}bn.",
            })
    for t in reversed(ranked[-2:]):
        fn = float(t.get("foreignNet") or 0)
        if fn <= -50:
            out.append({
                "key": f"foreign_sell:{t.get('symbol')}",
                "type": "signal", "severity": "medium", "symbol": t.get("symbol"),
                "msgId": f"Asing net jual {t.get('symbol')} Rp {abs(fn):,.0f} M.".replace(",", "."),
                "msgEn": f"Foreign net sell {t.get('symbol')} Rp {abs(fn):,.0f}bn.",
            })
    return out


async def _risk_news_alerts(redis, uid: str) -> list[dict]:
    """Portfolio risk threshold breaches + latest BEI disclosures."""
    out: list[dict] = []
    try:
        raw = await redis.get(REDIS_KEYS["risk_portfolio"].format(uid=uid))
        if raw:
            # The cache holds RiskMetricsResponse.model_dump(), so the scores are
            # nested under "risk". Reading them from the top level returned None
            # for both, and the isinstance guard then silently swallowed it — no
            # risk alert could ever fire. Parsing through the model also validates
            # the shape, so a truncated or wrong-typed cache entry is skipped
            # rather than compared against a threshold.
            rm = RiskMetricsResponse.model_validate_json(raw).risk
            conc = rm.concentrationRisk
            overall = rm.overallRisk
            if conc >= 55:
                out.append({
                    "key": "risk:concentration",
                    "type": "risk", "severity": "high" if conc >= 70 else "medium", "symbol": None,
                    "msgId": f"Risiko konsentrasi tinggi ({conc}/100) — pertimbangkan diversifikasi.",
                    "msgEn": f"High concentration risk ({conc}/100) — consider diversifying.",
                })
            if overall >= 65:
                out.append({
                    "key": "risk:overall",
                    "type": "rebalance", "severity": "medium", "symbol": None,
                    "msgId": f"Risiko portofolio keseluruhan meningkat ({overall}/100).",
                    "msgEn": f"Overall portfolio risk elevated ({overall}/100).",
                })
    except Exception as exc:  # noqa: BLE001
        logger.debug("alerts: risk unavailable — %s", exc)

    try:
        items = await redis.zrange(REDIS_KEYS["news_latest"], -3, -1)
        for i in reversed(items):
            n = json.loads(i)
            head = n.get("headline") or n.get("titleId") or n.get("titleEn")
            if not head:
                continue
            sym = (n.get("symbol") or (n.get("symbols") or [None])[0])
            out.append({
                "key": f"news:{n.get('id') or head[:24]}",
                "type": "macro", "severity": "low", "symbol": sym,
                "msgId": head, "msgEn": n.get("titleEn") or head,
            })
    except Exception as exc:  # noqa: BLE001
        logger.debug("alerts: news unavailable — %s", exc)
    return out


# Severity ordering for the final sort (high first).
_SEV_ORDER = {"high": 0, "medium": 1, "low": 2}


async def get_alerts(uid: str = "default") -> AlertsResponse:
    """Assemble the live alert feed. Returns source='seed' only if nothing at all
    could be derived (all feeds empty), which the caller can surface honestly."""
    redis = get_redis()

    groups = []
    for fn in (
        _signal_alerts(),
        _market_alerts(redis),
        _foreign_flow_alerts(redis),
        _risk_news_alerts(redis, uid),
    ):
        try:
            groups.append(await fn)
        except Exception as exc:  # noqa: BLE001 — a bad group never sinks the feed
            logger.debug("alerts: group failed — %s", exc)

    # Dedupe by key, keep the first (highest-priority group order above).
    seen: set[str] = set()
    merged: list[dict] = []
    for g in groups:
        for a in g:
            if a["key"] in seen:
                continue
            seen.add(a["key"])
            merged.append(a)

    merged.sort(key=lambda a: _SEV_ORDER.get(a["severity"], 3))

    now = datetime.now(timezone.utc)
    time_id, time_en = _rel_time(now)  # live conditions are "baru saja"
    alerts = [
        AlertItem(
            id=idx + 1,
            key=a["key"],
            type=a["type"],
            severity=a["severity"],
            msgId=a["msgId"],
            msgEn=a["msgEn"],
            timeId=time_id,
            timeEn=time_en,
            symbol=a.get("symbol"),
        )
        for idx, a in enumerate(merged[:20])
    ]

    return AlertsResponse(
        alerts=alerts,
        generatedAt=now.isoformat(),
        source="live" if alerts else "seed",
    )
