"""Live Redis context assembly for the advisor (Phase 9A).

Replaces static seed files with async Redis reads; the seed JSON in
api/seed/ is the fallback when Redis is unavailable.
"""

import asyncio
import json
import logging

from api.core.redis_client import REDIS_KEYS, get_redis
from api.services.advisor_service.constants import (
    MAX_CONTEXT_TOKENS,
    _PORTFOLIO_SEED,
    _RISK_SEED,
    _SIGNALS_SEED,
)

logger = logging.getLogger(__name__)
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
