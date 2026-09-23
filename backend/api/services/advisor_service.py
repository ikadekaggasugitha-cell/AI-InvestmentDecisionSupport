"""
Advisor Service — Phases 9A · 9B · 9D

Provider-agnostic: the advisor speaks an OpenAI-compatible chat/completions API,
so the active LLM (Groq / OpenRouter / Ollama / OpenAI / Anthropic-compat — set
via LLM_PROVIDER) is transparent to the rest of the app. Groq's free tier is the
default.

9A  Live Redis context  — replaces static seed files with async Redis reads;
                          seed JSON used as fallback when Redis is unavailable.
9B  Tool use            — 5 internal tools executed server-side; client only
                          receives streaming text deltas.
9D  Session persistence — conversation history persisted in Redis per session_id;
                          survives page refresh within a 1-hour TTL.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import AsyncIterator

from openai import APIError, AsyncOpenAI

from api.core.config import get_settings
from api.core.redis_client import get_redis, REDIS_KEYS
from api.models.advisor import ChatMessage, ChatRequest, StreamChunk

logger = logging.getLogger(__name__)

# ── Seed fallbacks (Phase 9A: used only when Redis is unavailable) ────────────
_SIGNALS_SEED  = Path(__file__).parent.parent / "seed" / "signals.json"
_RISK_SEED     = Path(__file__).parent.parent / "seed" / "risk.json"
_PORTFOLIO_SEED = Path(__file__).parent.parent / "seed" / "portfolio.json"

MAX_CONTEXT_TOKENS = 1200   # hard budget for the live context block
MAX_TOOL_ITERATIONS = 3     # prevent infinite tool loops
SESSION_TTL = 3600          # 1 hour chat history TTL

# ── Valid IDX symbols for tool inputs (Phase 9B security) ────────────────────
#
# The advisor now analyses the WHOLE listed board (~960 securities), not the 15
# UI-tracked names, so the allow-list is loaded from the `instruments` table and
# cached. This is what lets a user ask about any IDX ticker — GOTO, AMRT, a
# small-cap — instead of only the tracked handful. Falls back to
# tracked_symbols when the DB is unreachable so the tool still guards inputs.
_VALID_SYMBOLS_CACHE: set[str] = set()
_VALID_SYMBOLS_AT: float | None = None
_VALID_SYMBOLS_TTL = 1800  # refresh the universe every 30 min


async def _get_valid_symbols() -> set[str]:
    global _VALID_SYMBOLS_CACHE, _VALID_SYMBOLS_AT
    import time

    now = time.monotonic()
    if _VALID_SYMBOLS_CACHE and _VALID_SYMBOLS_AT and now - _VALID_SYMBOLS_AT < _VALID_SYMBOLS_TTL:
        return _VALID_SYMBOLS_CACHE
    try:
        from api.core.db import get_pool

        pool = await get_pool()
        rows = await pool.fetch("SELECT symbol FROM instruments WHERE is_active")
        syms = {r["symbol"].upper() for r in rows}
        if syms:
            _VALID_SYMBOLS_CACHE = syms
            _VALID_SYMBOLS_AT = now
            return syms
    except Exception as exc:  # noqa: BLE001 — degrade to the tracked list, never fail a tool
        logger.debug("advisor: universe load failed, using tracked list — %s", exc)
    return _VALID_SYMBOLS_CACHE or {s.upper() for s in get_settings().tracked_symbols}

# ── System prompts (Phase 9C: these receive cache_control) ───────────────────

_SYSTEM_ID = """\
Kamu adalah AIDSS AI Advisor, asisten analitik portofolio untuk pasar saham IDX (Bursa Efek Indonesia).

Peranmu:
- Bantu investor memahami sinyal kuantitatif, metrik risiko, dan alokasi portofolio mereka.
- Jawab dalam Bahasa Indonesia kecuali pengguna menulis dalam bahasa lain.
- Selalu sertakan catatan bahwa output ini adalah analisis model AI, BUKAN saran investasi resmi.
- Jangan pernah memberikan instruksi beli/jual yang definitif. Gunakan framing probabilistik.
- Gunakan tools yang tersedia untuk mengambil data terkini sebelum menjawab pertanyaan harga atau sinyal.
- Jangan menyebut harga, uprob, atau metrik risiko spesifik tanpa terlebih dahulu memanggil tool yang relevan.
- Kamu dapat MEMBACA dan MENGANALISA seluruh papan bursa (~960 saham): harga, sinyal, teknikal, profil emiten, screener per sektor, kondisi pasar, dan aliran dana asing. Semua tool bersifat HANYA-BACA — kamu tidak pernah mengubah data, portofolio, atau membuat order.

Batasan OJK:
- Output hanya berupa skor probabilitas (0–100), bukan instruksi beli/jual.
- Selalu ingatkan pengguna bahwa keputusan investasi adalah tanggung jawab mereka sendiri.
- Jangan pernah memberikan garantee return atau jaminan profit."""

_SYSTEM_EN = """\
You are AIDSS AI Advisor, a quantitative portfolio analytics assistant for the IDX (Indonesia Stock Exchange).

Your role:
- Help investors understand quantitative signals, risk metrics, and portfolio allocation.
- Respond in English when the user writes in English.
- Always note that output is AI model analysis, NOT official investment advice.
- Never give definitive buy/sell instructions. Use probabilistic framing.
- Use the available tools to fetch current data before answering questions about prices or signals.
- Never cite a specific price, uprob, or risk metric without first calling the relevant tool.
- You can READ and ANALYSE the entire exchange board (~960 stocks): prices, signals, technicals, issuer profiles, sector screens, market overview, and foreign fund flow. All tools are READ-ONLY — you never modify data, portfolios, or place orders.

OJK constraints:
- Outputs are probability scores (0–100), not buy/sell instructions.
- Always remind users that investment decisions are solely their responsibility.
- Never guarantee returns or promise profit."""

# ── Visual widget protocol ────────────────────────────────────────────────────
#
# The frontend renders interactive charts/gauges from fenced ```aidss:widget
# blocks the model emits inline. Text outside the blocks renders as Markdown.
# This spec is provider-neutral and appended to both system prompts. The model
# is told to reuse the numbers already in its context (never to invent them),
# so a widget always reflects the same data the dashboard shows.
_WIDGET_SPEC = """\

## Visual output (IMPORTANT)
Besides Markdown text, you can render interactive visuals by emitting fenced
blocks tagged `aidss:widget` containing a single JSON object. Put each block on
its own lines with a short sentence of context around it. Use ONLY numbers that
appear in your context or tool results — never invent values. Emit at most 3–4
widgets per answer, only when they add clarity. Also use normal Markdown
(headings, **bold**, tables, lists) for the rest.

Supported widgets (JSON schema by `type`):

1) Key-metric tiles:
```aidss:widget
{"type":"metric_tiles","title":"Risiko Portofolio","items":[{"label":"VaR 95%","value":"-Rp 384,7 jt","tone":"loss"},{"label":"Beta","value":"0,94","tone":"neutral"},{"label":"Sharpe","value":"1,71","tone":"gain"}]}
```
`tone` ∈ gain | loss | neutral | warning. `value` is a display string.

2) Probability gauge for one stock:
```aidss:widget
{"type":"signal_gauge","symbol":"BBCA","name":"Bank Central Asia","uprob":82,"tier":"HIGH","target":11500,"upside":16.8}
```
`tier` ∈ VERY_HIGH | HIGH | NEUTRAL | LOW. `uprob` and `upside` are numbers.

3) SHAP factor contributions (horizontal bars):
```aidss:widget
{"type":"shap","symbol":"BBCA","factors":[{"label":"Fundamental","value":24},{"label":"Teknikal","value":14},{"label":"Sentimen","value":12},{"label":"Risiko","value":-4}]}
```
`value` is a signed number (positive = pushes probability up).

4) Risk radar (0–100 per dimension):
```aidss:widget
{"type":"risk_radar","items":[{"label":"Pasar","value":58},{"label":"Konsentrasi","value":52},{"label":"Likuiditas","value":22},{"label":"Mata Uang","value":31},{"label":"Kredit","value":12},{"label":"Keseluruhan","value":44}]}
```

5) Portfolio allocation (donut, weight % per holding):
```aidss:widget
{"type":"allocation","title":"Alokasi","items":[{"label":"BBCA","value":22.4},{"label":"BBRI","value":18.1},{"label":"TLKM","value":15.0}]}
```

Rules: emit strictly valid JSON (double quotes, no trailing commas, no comments).
Numbers must be raw (no thousands separators) except display strings in
`metric_tiles.value`. If you lack the data for a widget, omit it rather than
guessing."""

# ── Price-action reading guide ────────────────────────────────────────────────
#
# Appended to both system prompts. The detection is deterministic (done in
# price_action.classify_situation); this teaches the model to REASON over the
# facts rather than restate the label. Provider-neutral, locale-neutral.
_PRICE_ACTION_GUIDE = """\

## Reading price action
When get_technical_analysis returns a `situation`, treat it as the price-action
context and weave it into your reasoning — never just restate the label:
- Combine the situation with the most recent `patterns` and WHERE they occur. A
  candlestick pattern AT a level is far stronger than one mid-range: a Bullish
  Engulfing exactly on support = a real reversal; the same pattern in open space
  is weak. Say this explicitly.
- Ceiling behaviour: `uji_resistance` (testing), `tembus_resistance` (breakout),
  `gagal_breakout` (false break — selling at the top). Floor behaviour:
  `mantul_support` (bounce), `gagal_breakdown` (spring / bear trap),
  `tembus_support` (breakdown — structure broken).
- `volatility_squeeze` = ATR compressed into a coil; a big move may be near but
  the DIRECTION is unconfirmed until a breakout close — state that, don't guess.
- `konsolidasi_lebar` = choppy mid-range: high risk, low reward; advise patience.
- `atrPct` is volatility as % of price — cite it to calibrate expectations and
  how wide a stop must sit. Quote `nearestSupport`/`nearestResistance` by price.
- These are descriptive context, never buy/sell orders. Keep the probabilistic,
  OJK-compliant framing at all times."""

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


# ── Phase 9A: Live Redis context assembly ─────────────────────────────────────

def _normalise_signals(payload: object) -> tuple[list, str | None]:
    """
    Return (signals, computedAt) from either signal payload shape.

    The live cache stores a SignalsResponse.model_dump() —
    {"signals": [...], "computedAt": ..., "source": ...} — while the seed file
    is a bare list. Reading the dict as a list (slicing it, iterating it) raised
    inside a broad except, so every consumer silently fell back to seed while
    reporting source="live". computedAt lives on the response, not the items,
    so it is only recoverable from the dict shape.
    """
    computed_at: str | None = None
    if isinstance(payload, dict):
        computed_at = payload.get("computedAt")
        payload = payload.get("signals", [])
    signals = payload if isinstance(payload, list) else []
    return signals, computed_at


def _pick_signal_highlights(signals: list) -> list:
    """
    Board-wide signal highlights for the context block.

    The cached set now spans the whole board (~960 scored names), so the first 5
    rows are arbitrary. Instead surface the STRONGEST and WEAKEST by upward
    probability — that is what "which stocks look best/worst today" needs — while
    staying compact enough for the context budget.
    """
    if not signals:
        return signals

    def _uprob(s: object) -> float:
        try:
            return float(s.get("uprob")) if isinstance(s, dict) and s.get("uprob") is not None else -1.0
        except (TypeError, ValueError):
            return -1.0

    ranked = sorted(signals, key=_uprob, reverse=True)
    if len(ranked) <= 8:
        return ranked
    top = ranked[:6]
    bottom = ranked[-3:]  # weakest by uprob
    seen = {id(x) for x in top}
    return top + [x for x in bottom if id(x) not in seen]


async def _load_live_context(uid: str) -> dict:
    """
    Gather live data from Redis in parallel.
    Falls back to seed JSON for any source that is unavailable.
    """
    redis = get_redis()

    async def _get_signals() -> tuple[list, str | None]:
        try:
            raw = await redis.get(REDIS_KEYS["signals_latest"])
            if raw:
                signals, computed_at = _normalise_signals(json.loads(raw))
                return _pick_signal_highlights(signals), computed_at
        except Exception as exc:
            logger.debug("context: signals Redis miss — %s", exc)
        try:
            signals, computed_at = _normalise_signals(json.loads(_SIGNALS_SEED.read_text()))
            return _pick_signal_highlights(signals), computed_at
        except Exception:
            return [], None

    async def _get_risk(uid_: str) -> dict:
        try:
            key = REDIS_KEYS["risk_portfolio"].format(uid=uid_)
            raw = await redis.get(key)
            if raw:
                return json.loads(raw)
        except Exception as exc:
            logger.debug("context: risk Redis miss — %s", exc)
        try:
            return json.loads(_RISK_SEED.read_text())
        except Exception:
            return {}

    async def _get_portfolio() -> dict:
        try:
            return json.loads(_PORTFOLIO_SEED.read_text())
        except Exception:
            return {}

    async def _get_news() -> list:
        try:
            items = await redis.zrange(REDIS_KEYS["news_latest"], -5, -1)
            return [json.loads(i) for i in reversed(items)]  # newest first
        except Exception as exc:
            logger.debug("context: news Redis miss — %s", exc)
            return []

    (signals, signals_computed_at), risk, portfolio, news = await asyncio.gather(
        _get_signals(), _get_risk(uid), _get_portfolio(), _get_news()
    )

    # Tag freshness for context block. Prefer the response-level computedAt
    # (the only place it exists); fall back to a per-item timestamp if present.
    signals_age = _signals_age_minutes(signals, signals_computed_at)

    return {
        "signals": signals,
        "signals_age_min": signals_age,
        "risk": risk,
        "portfolio": portfolio,
        "news": news,
    }


def _signals_age_minutes(signals: list, computed_at: str | None = None) -> int | None:
    """Return age in minutes of the signals batch, or None if unknown."""
    if not signals:
        return None
    if not computed_at:
        computed_at = signals[0].get("computedAt") if isinstance(signals[0], dict) else None
    if not computed_at:
        return None
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(computed_at.replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - dt).total_seconds() / 60
        return int(age)
    except Exception:
        return None


def _build_context_block(ctx: dict) -> str:
    """
    Build the live context block injected into the Claude system prompt.
    Stays within MAX_CONTEXT_TOKENS by truncating lower-priority sections.
    """
    lines: list[str] = []

    if ctx.get("portfolio", {}).get("weights"):
        lines.append("## Portfolio Allocation")
        for pos in ctx["portfolio"]["weights"][:5]:
            lines.append(
                f"- {pos['symbol']} ({pos['name']}): {pos['weightPct']}% "
                f"| E[R]={pos['expectedReturn']}%"
            )
        m = ctx["portfolio"].get("metrics", {})
        lines.append(
            f"  Portfolio: E[R]={m.get('expectedReturn')}% "
            f"σ={m.get('expectedVolatility')}% Sharpe={m.get('sharpeRatio')}"
        )

    if ctx.get("signals"):
        age = ctx.get("signals_age_min")
        age_note = f" (computed {age} min ago)" if age is not None else ""
        lines.append(f"\n## AI Signals{age_note}")
        if age is not None and age > 30:
            lines.append("  ⚠ Signals are over 30 minutes old — warn user if quoting specific scores.")
        for sig in ctx["signals"]:
            # Legacy fallback in case a pre-migration payload is still cached.
            tier = sig.get("probabilityTier") or sig.get("action") or sig.get("signal", "")
            lines.append(
                f"- {sig.get('symbol')}: {tier} | uprob={sig.get('uprob', 'N/A')}% "
                f"| target=Rp{sig.get('targetPrice', 'N/A'):,}"
                if isinstance(sig.get("targetPrice"), (int, float))
                else f"- {sig.get('symbol')}: {tier} | uprob={sig.get('uprob', 'N/A')}%"
            )

    if ctx.get("risk"):
        r = ctx["risk"]
        lines.append("\n## Risk Metrics")
        lines.append(
            f"VaR95={r.get('var95', 'N/A')}% CVaR95={r.get('cvar95', 'N/A')}% "
            f"Beta={r.get('beta', 'N/A')} Sharpe={r.get('sharpe', 'N/A')} "
            f"MaxDD={r.get('maxDrawdown', 'N/A')}%"
        )

    if ctx.get("news"):
        lines.append("\n## Recent BEI News")
        for item in ctx["news"][:5]:
            symbol_tag = f" [{item.get('symbol')}]" if item.get("symbol") else ""
            lines.append(f"- {item.get('headline', '')}{symbol_tag}")

    block = "\n".join(lines)

    # Enforce the budget the docstring promises. Sections are appended in
    # priority order (portfolio → signals → risk → news), so trimming the tail
    # drops the lowest-value context first. The estimate is ~4 chars/token —
    # deliberately rough, since this is a cost/size guardrail on a prompt sent
    # to Claude, not an exact accounting. Previously nothing capped this and a
    # large portfolio + full news list could balloon the per-request token cost.
    budget_chars = MAX_CONTEXT_TOKENS * 4
    if len(block) > budget_chars:
        block = block[:budget_chars].rstrip() + "\n  …(context truncated to stay within budget)"
    return block


# ── Phase 9B: Tool execution ──────────────────────────────────────────────────

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


# ── Phase 9D: Session persistence helpers ────────────────────────────────────

async def _load_session_history(session_id: str) -> list[ChatMessage]:
    """Load persisted conversation history from Redis."""
    try:
        redis = get_redis()
        key = REDIS_KEYS["chat_session"].format(session_id=session_id)
        raw = await redis.get(key)
        if raw:
            return [ChatMessage(**m) for m in json.loads(raw)]
    except Exception as exc:
        logger.debug("session_load failed: %s", exc)
    return []


async def _save_session_history(session_id: str, history: list[ChatMessage]) -> None:
    """Persist conversation history to Redis with SESSION_TTL."""
    try:
        redis = get_redis()
        key = REDIS_KEYS["chat_session"].format(session_id=session_id)
        payload = json.dumps([m.model_dump() for m in history[-20:]])  # keep last 20 turns
        await redis.setex(key, SESSION_TTL, payload)
    except Exception as exc:
        logger.debug("session_save failed: %s", exc)


# ── Main streaming entry point ────────────────────────────────────────────────

async def stream_advisor_response(
    request: ChatRequest,
) -> AsyncIterator[StreamChunk]:
    """
    Stream an LLM response for the given chat request.

    Speaks an OpenAI-compatible chat/completions API, so the active provider
    (Groq / OpenRouter / Ollama / OpenAI — see LLM_PROVIDER) is transparent to
    the caller. The SSE contract (delta / done / error chunks) is unchanged.

    Phases active:
      9A  Context assembled from live Redis (signals, risk, market, news)
      9B  The model may invoke tools; the server executes them transparently
      9D  History loaded from / saved to Redis when session_id is provided
    """
    settings = get_settings()

    if not settings.has_llm:
        yield StreamChunk(
            type="error",
            content=(
                f"API key untuk provider '{settings.llm_provider}' belum dikonfigurasi. "
                "Tambahkan GROQ_API_KEY di backend/.env untuk mengaktifkan AI Advisor "
                "(dapatkan gratis di https://console.groq.com/keys)."
                if request.locale == "id"
                else f"No API key configured for provider '{settings.llm_provider}'. "
                "Add GROQ_API_KEY to backend/.env to enable the AI Advisor "
                "(get one free at https://console.groq.com/keys)."
            ),
        )
        return

    client = AsyncOpenAI(
        api_key=settings.llm_resolved_key,
        base_url=settings.llm_resolved_base_url,
    )

    # ── Phase 9D: Load history from Redis if session_id provided and no history ──
    history = list(request.history)
    if request.session_id and not history:
        history = await _load_session_history(request.session_id)

    # ── Phase 9A: Assemble live context ─────────────────────────────────────────
    ctx = await _load_live_context(request.uid)
    context_block = _build_context_block(ctx)
    base_system = (
        (_SYSTEM_ID if request.locale == "id" else _SYSTEM_EN)
        + _PRICE_ACTION_GUIDE
        + _WIDGET_SPEC
    )

    # ── Build messages list (OpenAI format: system first, then turns) ───────────
    # The live context is appended to the system message. Prompt caching is
    # provider-specific and dropped here; the context block stays within
    # MAX_CONTEXT_TOKENS so the per-request cost is bounded regardless.
    messages: list[dict] = [
        {"role": "system", "content": f"{base_system}\n\n{context_block}"}
    ]
    messages.extend(
        {"role": m.role, "content": m.content} for m in history[-10:]
    )
    messages.append({"role": "user", "content": request.message})

    # ── Phase 9B: Tool-use streaming loop ────────────────────────────────────
    accumulated_assistant_text = ""
    try:
        for iteration in range(MAX_TOOL_ITERATIONS + 1):
            final_turn = iteration == MAX_TOOL_ITERATIONS

            # Ending a tool loop by setting tool_choice="none" (or tools=None)
            # does NOT work on Groq's gpt-oss models: the model calls a tool
            # anyway and Groq rejects the whole request with
            #   "Tool choice is none, but model called a tool".
            # Verified across gpt-oss-120b and qwen — none of the models on the
            # default Groq tier honour tool_choice="none". So we NEVER send it.
            # tools stay defined with tool_choice="auto" (which never 400s), and
            # on the final turn we steer the model to a text answer with an
            # explicit instruction instead. With the tool data already in the
            # history, this reliably yields a plain-text summary.
            if final_turn:
                messages.append({
                    "role": "user",
                    "content": (
                        "Data sudah lengkap. Berikan jawaban final dalam teks biasa "
                        "sekarang berdasarkan informasi di atas. Jangan panggil tool lagi."
                        if request.locale == "id"
                        else "The data is complete. Give your final answer in plain text "
                        "now, based on the information above. Do not call any more tools."
                    ),
                })

            stream = await client.chat.completions.create(
                model=settings.llm_model,
                max_tokens=settings.llm_max_tokens,
                messages=messages,  # type: ignore[arg-type]
                tools=_OPENAI_TOOLS,  # type: ignore[arg-type]
                tool_choice="auto",
                stream=True,
            )

            text_this_turn = ""
            finish_reason: str | None = None
            # tool_calls stream in fragments keyed by index; reassemble them.
            tool_calls: dict[int, dict] = {}

            async for chunk in stream:
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta

                if delta and delta.content:
                    text_this_turn += delta.content
                    accumulated_assistant_text += delta.content
                    yield StreamChunk(type="delta", content=delta.content)

                if delta and delta.tool_calls:
                    for tc in delta.tool_calls:
                        slot = tool_calls.setdefault(
                            tc.index, {"id": "", "name": "", "arguments": ""}
                        )
                        if tc.id:
                            slot["id"] = tc.id
                        if tc.function and tc.function.name:
                            slot["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            slot["arguments"] += tc.function.arguments

                if choice.finish_reason:
                    finish_reason = choice.finish_reason

            # Model wants to call tools → execute and loop. Never on the final
            # turn: there is no iteration left to consume the results, and the
            # turn's job was to produce text, so we fall through and stop.
            if finish_reason == "tool_calls" and tool_calls and not final_turn:
                ordered = [tool_calls[i] for i in sorted(tool_calls)]
                messages.append({
                    "role": "assistant",
                    "content": text_this_turn or None,
                    "tool_calls": [
                        {
                            "id": s["id"],
                            "type": "function",
                            "function": {"name": s["name"], "arguments": s["arguments"] or "{}"},
                        }
                        for s in ordered
                    ],
                })
                for s in ordered:
                    try:
                        args = json.loads(s["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    logger.info("advisor: executing tool=%s inputs=%s", s["name"], args)
                    result = await _execute_tool(s["name"], args, request.uid)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": s["id"],
                        "content": json.dumps(result),
                    })
                continue

            # Normal completion (or forced text on the final iteration).
            break

        # Safety net: if every turn produced only tool calls and no prose (rare —
        # the final-turn nudge normally prevents it), don't return an empty
        # answer. Emit a short honest fallback so the UI shows something.
        if not accumulated_assistant_text.strip():
            fallback = (
                "Maaf, saya kesulitan menyusun jawaban akhir. Coba persempit "
                "pertanyaannya atau tanyakan satu saham saja."
                if request.locale == "id"
                else "Sorry, I couldn't compose a final answer. Try narrowing the "
                "question or asking about a single stock."
            )
            accumulated_assistant_text = fallback
            yield StreamChunk(type="delta", content=fallback)

        yield StreamChunk(type="done", content="")

        # ── Phase 9D: Persist updated history ────────────────────────────────────
        if request.session_id and accumulated_assistant_text:
            updated_history = list(history)
            updated_history.append(ChatMessage(role="user", content=request.message))
            updated_history.append(ChatMessage(role="assistant", content=accumulated_assistant_text))
            await _save_session_history(request.session_id, updated_history)

    except APIError as exc:
        logger.error("LLM API error (%s): %s", settings.llm_provider, exc)
        msg = getattr(exc, "message", str(exc))
        yield StreamChunk(
            type="error",
            content=(
                f"Kesalahan API {settings.llm_provider}: {msg}"
                if request.locale == "id"
                else f"{settings.llm_provider} API error: {msg}"
            ),
        )
    except Exception as exc:
        logger.exception("Unexpected advisor error: %s", exc)
        yield StreamChunk(type="error", content="Unexpected error occurred.")
