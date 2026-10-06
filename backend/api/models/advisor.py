"""
Advisor models — Phase 7

Defines request/response shapes for the Claude-powered portfolio Q&A endpoint.
All chat responses include the OJK disclaimer and are explicitly labelled as AI output.
"""

import uuid
from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4096, description="User question in Bahasa Indonesia or English")
    history: list[ChatMessage] = Field(default_factory=list, max_length=20, description="Previous turns (newest last)")
    locale: Literal["id", "en"] = "id"
    # No `uid` field. It was a caller-supplied portfolio identity, which let any
    # authenticated caller ask the advisor questions about a portfolio they do
    # not own. The router now resolves the portfolio from the caller's token and
    # passes it separately. Pydantic ignores unknown keys by default, so a client
    # still sending `uid` is harmless — it is simply no longer read.
    # Phase 9D: optional session ID for Redis-backed history persistence.
    #
    # A UUID, and it is only ever a *suffix*: the Redis key is built as
    # `chat:{user_id}:{session_id}` (advisor_service), so one account cannot read
    # or overwrite another's conversation by supplying a session id it guessed.
    # Before that, the key was `chat:{session_id}` with the id straight from the
    # request body, which meant any authenticated caller could pull up another
    # person's portfolio discussion by trying ids.
    session_id: uuid.UUID | None = Field(
        default=None,
        description="Client-chosen UUID for conversation history. Namespaced per account server-side.",
    )


class StreamChunk(BaseModel):
    """Emitted as SSE data: events during streaming."""
    type: Literal["delta", "done", "error"]
    content: str = ""


class ChatResponse(BaseModel):
    """Returned when streaming is disabled (not the default path)."""
    role: Literal["assistant"] = "assistant"
    content: str
    inputTokens: int
    outputTokens: int
    model: str
    disclaimer: str = (
        "Respons ini adalah output model AI — bukan saran investasi yang diakui OJK. "
        "Keputusan investasi sepenuhnya tanggung jawab pengguna. / "
        "This response is AI-generated — not OJK-recognised investment advice. "
        "Investment decisions are solely the user's responsibility."
    )
