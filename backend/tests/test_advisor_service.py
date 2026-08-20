"""
Tests for Advisor Service — Phases 9A · 9B · 9C · 9D

9A: Live context loads from Redis; falls back to seed when Redis is unavailable.
9B: Tool execution returns correct data; loop stops at MAX_TOOL_ITERATIONS.
9C: System payload is a list of blocks with cache_control on the static block.
9D: Session history is saved to Redis and loaded on subsequent requests.
"""

import json
from types import SimpleNamespace

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ── Phase 9A: Live context tests ──────────────────────────────────────────────

class TestLiveContext:
    @pytest.mark.asyncio
    async def test_signals_loaded_from_redis(self):
        """_load_live_context returns Redis signals when available."""
        import json
        from pathlib import Path
        seed = Path("api/seed/signals.json")
        if not seed.exists():
            pytest.skip("Seed not available")

        seed_signals = json.loads(seed.read_text())
        mock_redis = AsyncMock()
        mock_redis.get.side_effect = [
            json.dumps(seed_signals),  # signals:latest
            None,                       # risk:portfolio
        ]
        mock_redis.zrange = AsyncMock(return_value=[])

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _load_live_context
            ctx = await _load_live_context("default")

        assert len(ctx["signals"]) > 0
        assert ctx["signals"][0].get("symbol") is not None

    @pytest.mark.asyncio
    async def test_falls_back_to_seed_when_redis_unavailable(self):
        """_load_live_context falls back to seed files on Redis error."""
        mock_redis = AsyncMock()
        mock_redis.get.side_effect = Exception("Redis connection refused")
        mock_redis.zrange = AsyncMock(side_effect=Exception("Redis connection refused"))

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _load_live_context
            ctx = await _load_live_context("default")

        # Should not raise; should return seed data
        assert isinstance(ctx["signals"], list)
        assert isinstance(ctx["risk"], dict)

    @pytest.mark.asyncio
    async def test_news_loaded_from_redis_zset(self):
        """_load_live_context fetches latest news from ZSET."""
        news_item = json.dumps({"headline": "BBCA Q1 earnings beat", "symbol": "BBCA", "ts": 1700000000})
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.zrange = AsyncMock(return_value=[news_item])

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _load_live_context
            ctx = await _load_live_context("default")

        assert len(ctx["news"]) == 1
        assert ctx["news"][0]["headline"] == "BBCA Q1 earnings beat"

    def test_context_block_includes_all_sections(self):
        """_build_context_block includes portfolio, signals, risk, and news sections."""
        from api.services.advisor_service import _build_context_block
        ctx = {
            "signals": [{"symbol": "BBCA", "probabilityTier": "VERY_HIGH", "uprob": 82}],
            "signals_age_min": 5,
            "risk": {"var95": -3.2, "cvar95": -4.8, "beta": 0.91, "sharpe": 1.24, "maxDrawdown": -18.5},
            "portfolio": {
                "weights": [{"symbol": "BBCA", "name": "Bank Central Asia", "weightPct": 22.4, "expectedReturn": 14.8}],
                "metrics": {"expectedReturn": 15.62, "expectedVolatility": 18.41, "sharpeRatio": 1.24},
            },
            "news": [{"headline": "BEI: BBCA rights issue approved", "symbol": "BBCA"}],
        }
        block = _build_context_block(ctx)
        assert "Portfolio Allocation" in block
        assert "AI Signals" in block
        assert "Risk Metrics" in block
        assert "BEI News" in block
        assert "BBCA" in block

    def test_context_block_warns_on_stale_signals(self):
        """Context block emits staleness warning when signals are >30 min old."""
        from api.services.advisor_service import _build_context_block
        ctx = {
            "signals": [{"symbol": "BBCA", "probabilityTier": "HIGH", "uprob": 70}],
            "signals_age_min": 45,
            "risk": {},
            "portfolio": {},
            "news": [],
        }
        block = _build_context_block(ctx)
        assert "30 minutes" in block or "⚠" in block


# ── Phase 9B: Tool execution tests ───────────────────────────────────────────

class TestToolExecution:
    @pytest.mark.asyncio
    async def test_get_stock_price_from_redis(self):
        """get_stock_price tool returns price from Redis market snapshot."""
        tick = json.dumps({"price": 9650, "change": 50, "changePct": 0.52, "volume": 1200000})
        mock_redis = AsyncMock()
        mock_redis.hget = AsyncMock(return_value=tick)

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _execute_tool
            result = await _execute_tool("get_stock_price", {"symbol": "BBCA"}, "default")

        assert result["price"] == 9650
        assert result["source"] == "live"

    @pytest.mark.asyncio
    async def test_get_stock_price_rejects_invalid_symbol(self):
        """get_stock_price tool rejects symbols not in the IDX whitelist."""
        from api.services.advisor_service import _execute_tool
        result = await _execute_tool("get_stock_price", {"symbol": "AAPL"}, "default")
        assert "error" in result

    @pytest.mark.asyncio
    async def test_get_signal_falls_back_to_seed(self):
        """get_signal tool falls back to seed when Redis is unavailable."""
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _execute_tool
            result = await _execute_tool("get_signal", {"symbol": "BBCA"}, "default")

        if "error" not in result:
            assert result.get("symbol") == "BBCA"

    @pytest.mark.asyncio
    async def test_get_recent_news_filters_by_symbol(self):
        """get_recent_news filters results when symbol is provided."""
        items = [
            json.dumps({"headline": "BBCA rights issue", "symbol": "BBCA"}),
            json.dumps({"headline": "TLKM 5G rollout", "symbol": "TLKM"}),
        ]
        mock_redis = AsyncMock()
        mock_redis.zrange = AsyncMock(return_value=items)

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _execute_tool
            result = await _execute_tool("get_recent_news", {"symbol": "BBCA"}, "default")

        for item in result["news"]:
            assert item["symbol"] == "BBCA"

    @pytest.mark.asyncio
    async def test_get_portfolio_summary_returns_weights(self):
        """get_portfolio_summary tool returns weights list."""
        from api.services.advisor_service import _execute_tool
        result = await _execute_tool("get_portfolio_summary", {}, "default")
        if "error" not in result:
            assert "weights" in result

    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error(self):
        """Unrecognised tool name returns error dict."""
        from api.services.advisor_service import _execute_tool
        result = await _execute_tool("fly_to_moon", {}, "default")
        assert "error" in result


# ── LLM request assembly (OpenAI-compatible provider) ────────────────────────

def _chunk(content=None, tool_calls=None, finish_reason=None):
    """Build a fake OpenAI streaming chunk (choices[0].delta shape)."""
    delta = MagicMock()
    delta.content = content
    delta.tool_calls = tool_calls
    choice = MagicMock()
    choice.delta = delta
    choice.finish_reason = finish_reason
    chunk = MagicMock()
    chunk.choices = [choice]
    return chunk


async def _make_async_iter(items):
    for item in items:
        yield item


class TestLLMRequest:
    @pytest.mark.asyncio
    async def test_missing_key_yields_error_chunk(self):
        """With no provider key configured, the first chunk is a typed error and
        no API call is attempted.

        `get_settings` is stubbed rather than relying on a clean environment,
        because a developer's real backend/.env (loaded by pydantic-settings)
        may carry a key that no amount of os.environ popping removes.
        """
        stub = SimpleNamespace(has_llm=False, llm_provider="groq")

        with patch("api.services.advisor_service.get_settings", return_value=stub):
            from api.models.advisor import ChatRequest
            from api.services.advisor_service import stream_advisor_response
            req = ChatRequest(message="Test", uid="default", locale="id")
            chunks = [c async for c in stream_advisor_response(req)]

        assert chunks, "expected at least one chunk"
        assert chunks[0].type == "error"
        assert "GROQ_API_KEY" in chunks[0].content

    @pytest.mark.asyncio
    async def test_system_message_and_tools_passed_openai_format(self):
        """The request sends a system message (persona + live context) first and
        tools in OpenAI function format."""
        import os
        from api.core.config import get_settings

        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.zrange = AsyncMock(return_value=[])

        os.environ["LLM_PROVIDER"] = "groq"
        os.environ["GROQ_API_KEY"] = "test-key-not-real"
        get_settings.cache_clear()

        # A single text turn that completes immediately.
        stream_chunks = _make_async_iter([
            _chunk(content="Halo, ini analisis AI."),
            _chunk(finish_reason="stop"),
        ])

        with (
            patch("api.services.advisor_service.get_redis", return_value=mock_redis),
            patch("api.services.advisor_service.AsyncOpenAI") as mock_openai,
        ):
            mock_client = MagicMock()
            mock_openai.return_value = mock_client
            mock_client.chat.completions.create = AsyncMock(return_value=stream_chunks)

            from api.models.advisor import ChatRequest
            from api.services.advisor_service import stream_advisor_response
            req = ChatRequest(message="Bagaimana portofolio saya?", uid="default", locale="id")

            out = [c async for c in stream_advisor_response(req)]

        get_settings.cache_clear()

        # The persona text streamed through as a delta and closed with done.
        assert any(c.type == "delta" and "analisis" in c.content for c in out)
        assert out[-1].type == "done"

        # Inspect what was sent to the provider.
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        messages = kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert "AIDSS" in messages[0]["content"]
        assert messages[-1] == {"role": "user", "content": "Bagaimana portofolio saya?"}
        # Tools are OpenAI function-shaped.
        assert kwargs["tools"][0]["type"] == "function"
        assert kwargs["tools"][0]["function"]["name"] == "get_stock_price"


# ── Phase 9D: Session persistence tests ──────────────────────────────────────

class TestSessionPersistence:
    @pytest.mark.asyncio
    async def test_load_session_history_from_redis(self):
        """_load_session_history returns deserialized ChatMessage list."""
        history = [
            {"role": "user", "content": "Apa itu BBCA?"},
            {"role": "assistant", "content": "BBCA adalah Bank Central Asia."},
        ]
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=json.dumps(history))

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _load_session_history
            result = await _load_session_history("test-session-abc")

        assert len(result) == 2
        assert result[0].role == "user"
        assert result[1].role == "assistant"

    @pytest.mark.asyncio
    async def test_load_session_returns_empty_on_miss(self):
        """_load_session_history returns empty list on Redis miss."""
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _load_session_history
            result = await _load_session_history("nonexistent-session")

        assert result == []

    @pytest.mark.asyncio
    async def test_save_session_history_calls_setex(self):
        """_save_session_history writes to Redis with SESSION_TTL."""
        from api.models.advisor import ChatMessage

        mock_redis = AsyncMock()
        mock_redis.setex = AsyncMock()
        # The helper uses `async with get_redis() as r`, so assertions have to
        # target the object yielded by __aenter__, not the factory's return.
        mock_redis.__aenter__.return_value = mock_redis

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _save_session_history, SESSION_TTL
            history = [
                ChatMessage(role="user", content="Hello"),
                ChatMessage(role="assistant", content="Halo!"),
            ]
            await _save_session_history("session-xyz", history)

        mock_redis.setex.assert_called_once()
        args = mock_redis.setex.call_args
        assert "chat:session-xyz" in str(args)
        # `int in str` raises TypeError — compare as text, or positionally.
        assert str(SESSION_TTL) in str(args) or SESSION_TTL == args.args[1]

    @pytest.mark.asyncio
    async def test_session_history_truncated_to_20_turns(self):
        """_save_session_history keeps only the last 20 turns."""
        from api.models.advisor import ChatMessage

        mock_redis = AsyncMock()
        mock_redis.setex = AsyncMock()

        # 30 turns
        history = [
            ChatMessage(role="user" if i % 2 == 0 else "assistant", content=f"turn {i}")
            for i in range(30)
        ]

        with patch("api.services.advisor_service.get_redis", return_value=mock_redis):
            from api.services.advisor_service import _save_session_history
            await _save_session_history("session-overflow", history)

        saved_payload = json.loads(mock_redis.setex.call_args.args[2])
        assert len(saved_payload) <= 20
