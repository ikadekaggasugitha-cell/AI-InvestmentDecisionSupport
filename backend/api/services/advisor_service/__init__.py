"""
Advisor Service — Phases 9A · 9B · 9C · 9D (package facade).

Provider-agnostic: the advisor speaks an OpenAI-compatible chat/completions API,
so the active LLM (Groq / OpenRouter / Ollama / OpenAI / Anthropic-compat — set
via LLM_PROVIDER) is transparent to the rest of the app. Groq's free tier is the
default.

The implementation lives split in this package:
  prompts.py   — system prompts, widget protocol, price-action guide (9C)
  symbols.py   — IDX universe allow-list guarding tool inputs (9B)
  context.py   — live Redis context assembly, seed fallback (9A)
  tools.py     — tool definitions and server-side execution (9B)
  chat.py      — session persistence (9D) and the streaming entry point

Import through this facade; callers and tests patch the submodule that owns
the name, per normal Python semantics.
"""

from api.services.advisor_service.chat import (
    _chat_key,
    _load_session_history,
    _save_session_history,
    stream_advisor_response,
)
from api.services.advisor_service.constants import (
    MAX_CONTEXT_TOKENS,
    MAX_TOOL_ITERATIONS,
    SESSION_TTL,
)
from api.services.advisor_service.context import (
    _build_context_block,
    _load_live_context,
    _normalise_signals,
    _pick_signal_highlights,
    _signals_age_minutes,
)
from api.services.advisor_service.tools import _TOOLS, _execute_tool

__all__ = [
    "MAX_CONTEXT_TOKENS",
    "MAX_TOOL_ITERATIONS",
    "SESSION_TTL",
    "stream_advisor_response",
    # Re-exported for the test suite's white-box imports; patch the submodule
    # that owns a name rather than these bindings.
    "_TOOLS",
    "_build_context_block",
    "_chat_key",
    "_execute_tool",
    "_load_live_context",
    "_load_session_history",
    "_normalise_signals",
    "_pick_signal_highlights",
    "_save_session_history",
    "_signals_age_minutes",
]
