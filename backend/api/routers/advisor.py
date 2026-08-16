"""
Advisor Router — Phase 7

POST /v1/advisor/chat
  Streams a Claude response via Server-Sent Events (SSE).
  Each event is a JSON-encoded StreamChunk.

SSE event format:
  data: {"type": "delta", "content": "...partial text..."}
  data: {"type": "done", "content": ""}
  data: {"type": "error", "content": "...error message..."}
"""

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from api.core.auth import CurrentUser
from api.models.advisor import ChatRequest
from api.services.advisor_service import stream_advisor_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/advisor", tags=["advisor"])


async def _sse_generator(request: ChatRequest):
    async for chunk in stream_advisor_response(request):
        yield f"data: {chunk.model_dump_json()}\n\n"


@router.post(
    "/chat",
    summary="Portfolio Q&A with AI Advisor (SSE streaming)",
    description=(
        "Streams a Claude-powered response about the user's portfolio, risk metrics, and signals. "
        "Response is Server-Sent Events (text/event-stream). "
        "OJK disclaimer is embedded in the system prompt — responses are probabilistic, not trading instructions."
    ),
    response_class=StreamingResponse,
)
async def advisor_chat(
    body: ChatRequest,
    current_user: CurrentUser,
) -> StreamingResponse:
    logger.info("advisor/chat: user=%s locale=%s", current_user.sub, body.locale)
    return StreamingResponse(
        _sse_generator(body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
