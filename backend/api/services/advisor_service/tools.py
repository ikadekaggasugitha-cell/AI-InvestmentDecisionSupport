"""Advisor tool definitions and server-side execution (Phase 9B).

The client only ever receives streaming text deltas; every tool below runs
here, against the same live context the REST views read.
"""

import json
import logging

from api.core.redis_client import REDIS_KEYS, get_redis
from api.services.advisor_service.constants import (
    _RISK_SEED,
    _SIGNALS_SEED,
)
from api.services.advisor_service.context import _normalise_signals
from api.services.advisor_service.symbols import _get_valid_symbols

logger = logging.getLogger(__name__)
# ── Tool definitions (Phase 9B) ───────────────────────────────────────────────

_TOOLS: list[dict] = [
    {
        "name": "get_stock_price",
        "description": (
            "Get the current IDX market price, intraday change percentage, and trading volume "
            "for a single stock symbol. Always call this before citing a price."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "IDX stock symbol (e.g. BBCA, BBRI, TLKM)",
                }
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "get_signal",
        "description": (
            "Get the LightGBM AI signal for a stock: uprob (upside probability 0–100), "
            "probabilityTier (VERY_HIGH / HIGH / NEUTRAL / LOW), and top SHAP factor "
            "explanations. The tier is a probability band, not a buy/sell instruction."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "IDX stock symbol",
                }
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "get_portfolio_summary",
        "description": (
            "Get the current portfolio allocation: top holdings by weight, "
            "expected return per position, and portfolio-level Sharpe ratio."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_risk_metrics",
        "description": (
            "Get current portfolio risk metrics: VaR95, CVaR95, beta, Sharpe ratio, "
            "maximum drawdown, and stress test scenarios."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_technical_analysis",
        "description": (
            "Get chart / technical analysis for one stock: EMA trend (up/down/sideways) "
            "with strength, support & resistance levels, the price-action situation "
            "(testing resistance, breakout, false break, bounce off support, spring, "
            "volatility squeeze, or wide consolidation — measured with ATR-scaled zones "
            "so it self-adjusts per stock), recent candlestick patterns, unfilled price "
            "gaps with historical fill probability, volume intensity (heavy/thin, spike), "
            "smart-money accumulation (blended volume flow + IDX foreign flow — the free "
            "substitute for per-broker bandarmology), and an entry / stop-loss plan with "
            "the reasoning behind it. Call this for any question about charts, entry timing, "
            "stop loss, breakouts, gaps, volume, or whether a stock is being accumulated. "
            "Levels and situations are descriptive context, not buy/sell orders."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "IDX stock symbol (e.g. BBCA, BBRI, TLKM)",
                }
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "get_recent_news",
        "description": (
            "Get the most recent IDX/BEI news headlines and disclosures, "
            "optionally filtered to a specific stock symbol."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "Optional: filter news to this IDX symbol (e.g. BBCA)",
                }
            },
            "required": [],
        },
    },
    {
        "name": "screen_stocks",
        "description": (
            "Screen / browse the WHOLE listed IDX board (~960 stocks). Use this "
            "for any question about MULTIPLE or UNKNOWN stocks: 'what technology "
            "stocks are there', 'top gainers today', 'most active', 'banks on the "
            "main board', 'search for stocks named …'. Returns a compact list with "
            "symbol, name, sector, last price, change % and market cap. Not for a "
            "single known symbol — use get_stock_price / get_technical_analysis for "
            "that."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sector": {
                    "type": "string",
                    "description": "IDX-IC sector in Indonesian: Keuangan, Energi, "
                    "Teknologi, Barang Baku, Barang Konsumen Primer, Barang Konsumen "
                    "Non-Primer, Kesehatan, Perindustrian, Infrastruktur, Properti & "
                    "Real Estat, Transportasi & Logistik.",
                },
                "query": {"type": "string", "description": "Search by ticker or company name."},
                "sort": {
                    "type": "string",
                    "enum": ["marketcap", "gainers", "losers", "volume", "symbol"],
                    "description": "Ranking. gainers/losers = biggest % movers; volume = most active.",
                },
                "limit": {"type": "integer", "description": "Max rows (default 10, max 25)."},
            },
            "required": [],
        },
    },
    {
        "name": "get_stock_profile",
        "description": (
            "Get the company/issuer profile for one IDX stock: full name, IDX-IC "
            "sector and sub-sector, listing board (Utama/Pengembangan/Pemantauan "
            "Khusus/Akselerasi), listing date, shares outstanding and market "
            "capitalisation. Use for 'what does this company do / what sector / when "
            "did it list / how big is it' questions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string", "description": "IDX stock symbol (e.g. BBCA)"}
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "get_market_overview",
        "description": (
            "Read the whole-board market snapshot: how many stocks are advancing / "
            "declining / unchanged, the IHSG index and USD/IDR, the day's biggest "
            "gainers and losers, and average performance PER SECTOR (which sector is "
            "strongest/weakest today). Call this for market-wide questions: 'how is "
            "the market today', 'which sector is leading', 'is it a green or red day', "
            "'market breadth'. Read-only board analytics."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_foreign_flow",
        "description": (
            "Read board-wide foreign fund flow (the free bandarmology substitute): "
            "which stocks foreign investors are net BUYING and net SELLING the most "
            "today, in IDR billions, with their sectors. Call this for 'where is "
            "foreign money going', 'asing lagi masuk/keluar di saham apa', smart-money "
            "or bandar questions at the board level. Read-only."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
]


# OpenAI-compatible tool schema (Groq / OpenRouter / Ollama / OpenAI all use
# this shape). Derived from the single _TOOLS definition above so the two never
# drift.
_OPENAI_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": t["name"],
            "description": t["description"],
            "parameters": t["input_schema"],
        },
    }
    for t in _TOOLS
]


async def _execute_tool(name: str, inputs: dict, uid: str) -> dict:
    """
    Execute a single tool call server-side. Returns a dict that becomes
    the tool_result content (serialised to JSON before passing to Claude).
    """
    redis = get_redis()

    if name == "get_stock_price":
        symbol = inputs.get("symbol", "").upper()
        if symbol not in await _get_valid_symbols():
            return {"error": f"Symbol {symbol!r} not in IDX universe"}
        try:
            raw = await redis.hget(REDIS_KEYS["market_snapshot"], symbol)
            if raw:
                tick = json.loads(raw)
                return {
                    "symbol": symbol,
                    "price": tick.get("price"),
                    "change": tick.get("change"),
                    "changePct": tick.get("changePct"),
                    "volume": tick.get("volume"),
                    "source": "live",
                }
        except Exception as exc:
            logger.debug("tool get_stock_price Redis miss: %s", exc)
        return {"symbol": symbol, "error": "Price data unavailable"}

    if name == "get_signal":
        symbol = inputs.get("symbol", "").upper()
        if symbol not in await _get_valid_symbols():
            return {"error": f"Symbol {symbol!r} not in IDX universe"}
        try:
            raw = await redis.get(REDIS_KEYS["signals_latest"])
            if raw:
                signals, _ = _normalise_signals(json.loads(raw))
                for sig in signals:
                    if sig.get("symbol") == symbol:
                        return {
                            "symbol": symbol,
                            "probabilityTier": sig.get("probabilityTier") or sig.get("action"),
                            "uprob": sig.get("uprob"),
                            "confidence": sig.get("confidence"),
                            "targetPrice": sig.get("targetPrice"),
                            "shap": sig.get("shap", [])[:3],  # top 3 factors
                            "source": "live",
                        }
        except Exception as exc:
            logger.debug("tool get_signal Redis miss: %s", exc)
        # Seed fallback
        try:
            signals, _ = _normalise_signals(json.loads(_SIGNALS_SEED.read_text()))
            for sig in signals:
                if sig.get("symbol") == symbol:
                    return {**sig, "source": "seed"}
        except Exception:
            pass
        return {"symbol": symbol, "error": "Signal data unavailable"}

    if name == "get_portfolio_summary":
        try:
            # Use the real optimiser service, which runs Black-Litterman + HRP
            # over live price history and degrades to seed weights on its own
            # when the backfill is incomplete. Its `source` field ("live" vs
            # "mock") is surfaced verbatim so the model can caveat accordingly.
            from api.services.portfolio_service import get_portfolio_optimisation

            result = await get_portfolio_optimisation(uid=uid)
            data = result.model_dump()
            return {
                "weights": data.get("weights", [])[:5],
                "metrics": data.get("metrics", {}),
                "source": data.get("source", "live"),
            }
        except Exception as exc:
            logger.debug("tool get_portfolio_summary failed: %s", exc)
            return {"error": "Portfolio data unavailable"}

    if name == "get_risk_metrics":
        try:
            key = REDIS_KEYS["risk_portfolio"].format(uid=uid)
            raw = await redis.get(key)
            if raw:
                return {**json.loads(raw), "source": "live"}
        except Exception as exc:
            logger.debug("tool get_risk_metrics Redis miss: %s", exc)
        try:
            data = json.loads(_RISK_SEED.read_text())
            return {**data, "source": "seed"}
        except Exception:
            return {"error": "Risk data unavailable"}

    if name == "get_technical_analysis":
        symbol = inputs.get("symbol", "").upper()
        if symbol not in await _get_valid_symbols():
            return {"error": f"Symbol {symbol!r} not in IDX universe"}
        try:
            from api.services.technicals_service import get_technical_analysis

            resp = await get_technical_analysis(symbol)
            d = resp.model_dump()
            acc = d.get("accumulation", {})
            gaps = [g for g in d.get("gaps", []) if not g.get("isFilled")][:2]
            # Price-action detail the model previously never saw: where price sits
            # in the structure (ATR-scaled), the recent candle patterns, and the
            # nearest S/R levels. Detection is deterministic here — the LLM only
            # narrates and reasons over these facts.
            patterns = [
                {k: p.get(k) for k in ("patternId", "date", "significance", "signal")}
                for p in d.get("patterns", [])[-3:]
            ]
            key_levels = [
                {"type": l.get("type"), "price": l.get("price"), "strength": l.get("strength")}
                for l in d.get("supportResistance", [])[:4]
            ]
            return {
                "symbol": symbol,
                "trend": d.get("trend", {}),
                "situation": d.get("situation", {}),
                "patterns": patterns,
                "supportResistance": key_levels,
                "volume": {
                    "level": d.get("volume", {}).get("level"),
                    "ratio": d.get("volume", {}).get("ratio"),
                    "spike": d.get("volume", {}).get("spike"),
                    "trend": d.get("volume", {}).get("trend"),
                },
                "accumulation": {
                    "phase": acc.get("phase"),
                    "score": acc.get("score"),
                    "method": acc.get("method"),
                    "foreignPhase": acc.get("foreignPhase"),
                    "netForeign5d": acc.get("netForeign5d"),
                    "foreignConsistencyDays": acc.get("foreignConsistencyDays"),
                },
                "unfilledGaps": gaps,
                "entrySignal": d.get("entrySignal", {}),
                "tradePlan": d.get("tradePlan", {}),
                "technicalNote": d.get("technicalNote", ""),
                "source": d.get("source"),
            }
        except Exception as exc:  # noqa: BLE001
            logger.debug("tool get_technical_analysis failed: %s", exc)
            return {"symbol": symbol, "error": "Technical analysis unavailable"}

    if name == "get_recent_news":
        symbol_filter = inputs.get("symbol", "").upper() or None
        try:
            items_raw = await redis.zrange(REDIS_KEYS["news_latest"], -10, -1)
            items = [json.loads(i) for i in reversed(items_raw)]
            if symbol_filter:
                items = [i for i in items if i.get("symbol") == symbol_filter]
            return {"news": items[:5], "count": len(items), "source": "live"}
        except Exception as exc:
            logger.debug("tool get_recent_news Redis miss: %s", exc)
        return {"news": [], "source": "unavailable"}

    if name == "screen_stocks":
        try:
            from api.services.symbols_service import list_symbols

            sort = (inputs.get("sort") or "marketcap").lower()
            if sort not in {"marketcap", "gainers", "losers", "volume", "symbol"}:
                sort = "marketcap"
            limit = min(max(int(inputs.get("limit") or 10), 1), 25)
            resp = await list_symbols(
                q=inputs.get("query") or None,
                sector=inputs.get("sector") or None,
                sort=sort,
                limit=limit,
            )
            rows = [
                {
                    "symbol": s.symbol,
                    "name": s.name,
                    "sector": s.sector,
                    "price": s.lastClose,
                    "changePct": round(s.changePct, 2) if s.changePct is not None else None,
                    "marketCap": s.marketCap,
                    "board": s.board,
                }
                for s in resp.symbols
            ]
            return {"count": resp.total, "shown": len(rows), "stocks": rows, "source": resp.source}
        except Exception as exc:  # noqa: BLE001
            logger.debug("tool screen_stocks failed: %s", exc)
            return {"error": "Screener unavailable"}

    if name == "get_stock_profile":
        symbol = inputs.get("symbol", "").upper()
        if symbol not in await _get_valid_symbols():
            return {"error": f"Symbol {symbol!r} not in IDX universe"}
        try:
            from api.services.symbols_service import list_symbols

            resp = await list_symbols(q=symbol, limit=25)
            match = next((s for s in resp.symbols if s.symbol.upper() == symbol), None)
            if not match:
                return {"symbol": symbol, "error": "Profile unavailable"}
            return {
                "symbol": match.symbol,
                "name": match.name,
                "sector": match.sector,
                "subSector": match.subSector,
                "industry": match.industry,
                "board": match.board,
                "listingDate": match.listingDate,
                "listedShares": match.listedShares,
                "marketCap": match.marketCap,
                "lastClose": match.lastClose,
                "source": resp.source,
            }
        except Exception as exc:  # noqa: BLE001
            logger.debug("tool get_stock_profile failed: %s", exc)
            return {"symbol": symbol, "error": "Profile unavailable"}

    if name == "get_market_overview":
        try:
            raw = await redis.hgetall(REDIS_KEYS["market_snapshot"])
            ticks = [json.loads(v) for v in raw.values()]
            if not ticks:
                return {"error": "Market snapshot unavailable"}

            def _cp(t: dict) -> float:
                v = t.get("changePct")
                return float(v) if isinstance(v, (int, float)) else 0.0

            advancing = sum(1 for t in ticks if _cp(t) > 0)
            declining = sum(1 for t in ticks if _cp(t) < 0)
            unchanged = len(ticks) - advancing - declining

            from collections import defaultdict

            buckets: dict[str, list[float]] = defaultdict(list)
            for t in ticks:
                buckets[t.get("sector") or "—"].append(_cp(t))
            sector_perf = sorted(
                (
                    {"sector": s, "avgChangePct": round(sum(v) / len(v), 2), "count": len(v)}
                    for s, v in buckets.items() if v
                ),
                key=lambda x: x["avgChangePct"],
                reverse=True,
            )

            movers = sorted(ticks, key=_cp, reverse=True)
            gainers = [{"symbol": t.get("symbol"), "changePct": round(_cp(t), 2)} for t in movers[:5]]
            losers = [{"symbol": t.get("symbol"), "changePct": round(_cp(t), 2)} for t in movers[-5:] if _cp(t) < 0]

            # IHSG / FX / market-open from the full snapshot JSON (best effort).
            ihsg = fx = None
            is_open = None
            try:
                sj = await redis.get("market:snapshot:json")
                if sj:
                    snap = json.loads(sj)
                    ihsg = snap.get("ihsg")
                    fx = snap.get("fx")
                    is_open = snap.get("isMarketOpen")
            except Exception:  # noqa: BLE001
                pass

            return {
                "totalStocks": len(ticks),
                "advancing": advancing,
                "declining": declining,
                "unchanged": unchanged,
                "ihsg": ihsg,
                "usdIdr": fx,
                "isMarketOpen": is_open,
                "sectorPerformance": sector_perf,
                "topGainers": gainers,
                "topLosers": list(reversed(losers)),
                "source": "live",
            }
        except Exception as exc:  # noqa: BLE001
            logger.debug("tool get_market_overview failed: %s", exc)
            return {"error": "Market overview unavailable"}

    if name == "get_foreign_flow":
        try:
            raw = await redis.hgetall(REDIS_KEYS["market_snapshot"])
            ticks = [json.loads(v) for v in raw.values()]
            withfn = [
                t for t in ticks
                if isinstance(t.get("foreignNet"), (int, float)) and t.get("foreignNet") != 0
            ]
            if not withfn:
                return {
                    "topForeignBuy": [], "topForeignSell": [],
                    "note": "No foreign-flow data ingested yet (needs IDX EOD backfill).",
                    "source": "live",
                }
            ranked = sorted(withfn, key=lambda t: float(t.get("foreignNet") or 0), reverse=True)

            def _row(t: dict) -> dict:
                return {
                    "symbol": t.get("symbol"),
                    "sector": t.get("sector"),
                    "foreignNetB": round(float(t.get("foreignNet") or 0), 1),
                }

            top_buy = [_row(t) for t in ranked if float(t.get("foreignNet") or 0) > 0][:8]
            top_sell = [_row(t) for t in reversed(ranked) if float(t.get("foreignNet") or 0) < 0][:8]
            return {
                "topForeignBuy": top_buy,
                "topForeignSell": top_sell,
                "unit": "IDR miliar",
                "note": "Net foreign flow (EOD, valued at current price). Positive = net buy.",
                "source": "live",
            }
        except Exception as exc:  # noqa: BLE001
            logger.debug("tool get_foreign_flow failed: %s", exc)
            return {"error": "Foreign flow unavailable"}

    return {"error": f"Unknown tool: {name!r}"}
