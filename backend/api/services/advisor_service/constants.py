"""Advisor tuning constants and seed-file fallbacks (Phase 9A)."""

from pathlib import Path

# Resolved from the package directory: parent = api/services, parent.parent = api,
# so the seed path needs one more level up to reach backend/ than it did when
# this lived directly in api/services.
_SERVICES_ROOT = Path(__file__).resolve().parent.parent.parent
_SIGNALS_SEED = _SERVICES_ROOT / "seed" / "signals.json"
_RISK_SEED = _SERVICES_ROOT / "seed" / "risk.json"
_PORTFOLIO_SEED = _SERVICES_ROOT / "seed" / "portfolio.json"

MAX_CONTEXT_TOKENS = 1200   # hard budget for the live context block
MAX_TOOL_ITERATIONS = 3     # prevent infinite tool loops
SESSION_TTL = 3600          # 1 hour chat history TTL

