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

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from api.core.auth import CurrentUser
from api.models.advisor import ChatRequest
from api.services.advisor_service import stream_advisor_response
from api.services.portfolio_access import resolve_portfolio_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/advisor", tags=["advisor"])


async def _sse_generator(request: ChatRequest, portfolio_id: str, user_id: str):
    async for chunk in stream_advisor_response(request, portfolio_id, user_id):
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
    request: Request,
    body: ChatRequest,
    current_user: CurrentUser,
) -> StreamingResponse:
    logger.info("advisor/chat: user=%s locale=%s", current_user.user_id, body.locale)
    # Resolved from the token, not from a body field: the request used to carry
    # its own `uid`, so any authenticated caller could ask about another
    # portfolio's allocation, risk metrics and holdings.
    portfolio_id = await resolve_portfolio_id(str(current_user.user_id))
    return StreamingResponse(
        _sse_generator(body, portfolio_id, str(current_user.user_id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
