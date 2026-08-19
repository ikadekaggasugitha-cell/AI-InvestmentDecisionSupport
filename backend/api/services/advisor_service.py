"""
Advisor Service — Phases 9A · 9B · 9C · 9D

9A  Live Redis context  — replaces static seed files with async Redis reads;
                          seed JSON used as fallback when Redis is unavailable.
9B  Claude tool use     — 5 internal tools executed server-side; client only
                          receives streaming text deltas.
9C  Prompt caching      — system prompt marked with cache_control so Anthropic
                          caches the static prefix across requests (~60% token saving).
9D  Session persistence — conversation history persisted in Redis per session_id;
                          survives page refresh within a 1-hour TTL.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import AsyncIterator

import anthropic

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

# ── Whitelisted IDX symbols for tool inputs (Phase 9B security) ──────────────
_VALID_SYMBOLS = {
    "BBCA", "BBRI", "BMRI", "TLKM", "ASII",
    "ADRO", "BREN", "GOTO", "ANTM", "UNVR",
}

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

OJK constraints:
- Outputs are probability scores (0–100), not buy/sell instructions.
- Always remind users that investment decisions are solely their responsibility.
- Never guarantee returns or promise profit."""

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
]


# ── Phase 9A: Live Redis context assembly ─────────────────────────────────────

async def _load_live_context(uid: str) -> dict:
    """
    Gather live data from Redis in parallel.
    Falls back to seed JSON for any source that is unavailable.
    """
    redis = get_redis()

    async def _get_signals() -> list:
        try:
            raw = await redis.get(REDIS_KEYS["signals_latest"])
            if raw:
                return json.loads(raw)[:5]
        except Exception as exc:
            logger.debug("context: signals Redis miss — %s", exc)
        try:
            return json.loads(_SIGNALS_SEED.read_text())[:5]
        except Exception:
            return []

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

    signals, risk, portfolio, news = await asyncio.gather(
        _get_signals(), _get_risk(uid), _get_portfolio(), _get_news()
    )

    # Tag freshness for context block
    signals_age = _signals_age_minutes(signals)

    return {
        "signals": signals,
        "signals_age_min": signals_age,
        "risk": risk,
        "portfolio": portfolio,
        "news": news,
    }


def _signals_age_minutes(signals: list) -> int | None:
    """Return age in minutes of the signals batch, or None if unknown."""
    if not signals:
        return None
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

    return "\n".join(lines)


# ── Phase 9B: Tool execution ──────────────────────────────────────────────────

async def _execute_tool(name: str, inputs: dict, uid: str) -> dict:
    """
    Execute a single tool call server-side. Returns a dict that becomes
    the tool_result content (serialised to JSON before passing to Claude).
    """
    redis = get_redis()

    if name == "get_stock_price":
        symbol = inputs.get("symbol", "").upper()
        if symbol not in _VALID_SYMBOLS:
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
        if symbol not in _VALID_SYMBOLS:
            return {"error": f"Symbol {symbol!r} not in IDX universe"}
        try:
            raw = await redis.get(REDIS_KEYS["signals_latest"])
            if raw:
                signals = json.loads(raw)
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
            signals = json.loads(_SIGNALS_SEED.read_text())
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

    return {"error": f"Unknown tool: {name!r}"}


def _content_blocks_to_dicts(content) -> list[dict]:
    """Convert SDK typed content blocks to plain dicts for subsequent API calls."""
    result = []
    for block in content:
        if hasattr(block, "type"):
            if block.type == "text":
                result.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                result.append({
                    "type": "tool_use",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                })
    return result


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
    Stream a Claude response for the given chat request.

    Phases active:
      9A  Context assembled from live Redis (signals, risk, market, news)
      9B  Claude may invoke tools; server executes them transparently
      9C  System prompt uses cache_control for Anthropic prompt caching
      9D  History loaded from / saved to Redis when session_id is provided
    """
    settings = get_settings()

    if not settings.has_claude:
        yield StreamChunk(
            type="error",
            content=(
                "ANTHROPIC_API_KEY tidak dikonfigurasi. "
                "Tambahkan key di .env untuk mengaktifkan AI Advisor."
                if request.locale == "id"
                else "ANTHROPIC_API_KEY is not configured. Add the key to .env to enable AI Advisor."
            ),
        )
        return

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    # ── Phase 9D: Load history from Redis if session_id provided and no history ──
    history = list(request.history)
    if request.session_id and not history:
        history = await _load_session_history(request.session_id)

    # ── Phase 9A: Assemble live context ─────────────────────────────────────────
    ctx = await _load_live_context(request.uid)
    context_block = _build_context_block(ctx)
    base_system = _SYSTEM_ID if request.locale == "id" else _SYSTEM_EN

    # ── Phase 9C: Prompt caching — system is a list of blocks ───────────────────
    system_payload: list[dict] = [
        {
            "type": "text",
            "text": base_system,
            "cache_control": {"type": "ephemeral"},  # cache the static persona block
        },
        {
            "type": "text",
            "text": context_block,
            # live context is NOT cached — it changes every 15 min
        },
    ]

    # ── Build messages list ───────────────────────────────────────────────────
    messages: list[dict] = [
        {"role": m.role, "content": m.content}
        for m in history[-10:]  # last 10 turns
    ]
    messages.append({"role": "user", "content": request.message})

    # ── Phase 9B: Tool-use streaming loop ────────────────────────────────────
    accumulated_assistant_text = ""
    try:
        for iteration in range(MAX_TOOL_ITERATIONS + 1):
            async with client.messages.stream(
                model=settings.claude_model,
                max_tokens=settings.claude_max_tokens,
                system=system_payload,  # type: ignore[arg-type]
                messages=messages,
                tools=_TOOLS,
            ) as stream:
                async for text in stream.text_stream:
                    accumulated_assistant_text += text
                    yield StreamChunk(type="delta", content=text)

                final_msg = await stream.get_final_message()

            if final_msg.stop_reason == "end_turn":
                # Normal completion — done
                break

            if final_msg.stop_reason == "tool_use":
                if iteration >= MAX_TOOL_ITERATIONS:
                    logger.warning("advisor: tool loop limit reached (%d)", MAX_TOOL_ITERATIONS)
                    yield StreamChunk(type="delta", content="\n\n[Data retrieval limit reached.]")
                    break

                # Extract tool_use blocks and execute them
                tool_use_blocks = [b for b in final_msg.content if b.type == "tool_use"]
                tool_results = []

                for block in tool_use_blocks:
                    logger.info("advisor: executing tool=%s inputs=%s", block.name, block.input)
                    result = await _execute_tool(block.name, block.input, request.uid)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result),
                    })

                # Append assistant's tool-use turn + tool results as user turn
                messages.append({
                    "role": "assistant",
                    "content": _content_blocks_to_dicts(final_msg.content),
                })
                messages.append({"role": "user", "content": tool_results})
                accumulated_assistant_text = ""  # reset for next iteration
                continue

            # Unexpected stop reason
            logger.warning("advisor: unexpected stop_reason=%s", final_msg.stop_reason)
            break

        yield StreamChunk(type="done", content="")

        # ── Phase 9D: Persist updated history ────────────────────────────────────
        if request.session_id and accumulated_assistant_text:
            updated_history = list(history)
            updated_history.append(ChatMessage(role="user", content=request.message))
            updated_history.append(ChatMessage(role="assistant", content=accumulated_assistant_text))
            await _save_session_history(request.session_id, updated_history)

    except anthropic.APIStatusError as exc:
        logger.error("Claude API error: %s %s", exc.status_code, exc.message)
        yield StreamChunk(type="error", content=f"Claude API error: {exc.status_code}")
    except Exception as exc:
        logger.exception("Unexpected advisor error: %s", exc)
        yield StreamChunk(type="error", content="Unexpected error occurred.")
