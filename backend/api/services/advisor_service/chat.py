"""Advisor session persistence and the main streaming entry point (Phases 9D, 9B).

Conversation history lives in Redis per session_id and survives a page refresh
within a 1-hour TTL. `stream_advisor_response` is the single entry point the
router streams from.
"""

import json
import logging
from typing import AsyncIterator

from openai import APIError, AsyncOpenAI

from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS, get_redis
from api.models.advisor import ChatMessage, ChatRequest, StreamChunk
from api.services.advisor_service.constants import (
    MAX_TOOL_ITERATIONS,
    SESSION_TTL,
)
from api.services.advisor_service.context import _build_context_block, _load_live_context
from api.services.advisor_service.prompts import (
    _PRICE_ACTION_GUIDE,
    _SYSTEM_EN,
    _SYSTEM_ID,
    _WIDGET_SPEC,
)
from api.services.advisor_service.tools import _OPENAI_TOOLS, _execute_tool

logger = logging.getLogger(__name__)
def _chat_key(user_id: str, session_id: str) -> str:
    """The Redis key for one account's conversation.

    The account id is part of the key, not just the client-chosen session id.
    `session_id` arrives in the request body, so a key built from it alone lets any
    authenticated caller read or overwrite another account's discussion by trying
    ids. Two accounts naming the same session now land on different keys.
    """
    return REDIS_KEYS["chat_session"].format(user_id=user_id, session_id=session_id)


async def _load_session_history(user_id: str, session_id: str) -> list[ChatMessage]:
    """Load persisted conversation history from Redis."""
    try:
        redis = get_redis()
        raw = await redis.get(_chat_key(user_id, session_id))
        if raw:
            return [ChatMessage(**m) for m in json.loads(raw)]
    except Exception as exc:
        logger.debug("session_load failed: %s", exc)
    return []


async def _save_session_history(
    user_id: str, session_id: str, history: list[ChatMessage]
) -> None:
    """Persist conversation history to Redis with SESSION_TTL."""
    try:
        redis = get_redis()
        payload = json.dumps([m.model_dump() for m in history[-20:]])  # keep last 20 turns
        await redis.setex(_chat_key(user_id, session_id), SESSION_TTL, payload)
    except Exception as exc:
        logger.debug("session_save failed: %s", exc)


async def stream_advisor_response(
    request: ChatRequest,
    portfolio_id: str,
    user_id: str = "",
) -> AsyncIterator[StreamChunk]:
    """
    Stream an LLM response for the given chat request.

    `portfolio_id` is resolved by the router from the caller's token. It used to
    be read off `request.uid`, a caller-supplied field, which let any
    authenticated caller point the context enrichment and the portfolio tools at
    a portfolio they do not own.

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
        history = await _load_session_history(user_id, str(request.session_id))

    # ── Phase 9A: Assemble live context ─────────────────────────────────────────
    ctx = await _load_live_context(portfolio_id)
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
                    result = await _execute_tool(s["name"], args, portfolio_id)
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
            await _save_session_history(user_id, str(request.session_id), updated_history)

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
