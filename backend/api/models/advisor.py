"""
Advisor models — Phase 7

Defines request/response shapes for the Claude-powered portfolio Q&A endpoint.
All chat responses include the OJK disclaimer and are explicitly labelled as AI output.
"""

from typing import Literal
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4096, description="User question in Bahasa Indonesia or English")
    history: list[ChatMessage] = Field(default_factory=list, max_length=20, description="Previous turns (newest last)")
    locale: Literal["id", "en"] = "id"
    uid: str = Field(default="default", description="Portfolio user ID for context enrichment")
    # Phase 9D: optional session ID for Redis-backed history persistence
    session_id: str | None = Field(default=None, description="Session UUID for persistent conversation history")


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
