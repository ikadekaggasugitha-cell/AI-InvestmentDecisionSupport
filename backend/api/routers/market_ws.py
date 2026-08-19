"""
WebSocket endpoint for real-time market data.

Phase 1: Broadcasts GBM simulation every 2 seconds (mirrors frontend behaviour).
Phase 2: Reads from Redis 'market:snapshot' (written by tick-aggregator).
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import (
    APIRouter, Depends, WebSocket, WebSocketDisconnect, WebSocketException, status,
)

from api.core.auth import get_current_user, verify_token
from api.core.config import get_settings
from api.services.market_service import generate_snapshot

logger = logging.getLogger(__name__)
router = APIRouter(tags=["market"])

TICK_INTERVAL = 2.0  # seconds — matches frontend 2s setInterval


class ConnectionManager:
    """Thread-safe WebSocket connection pool with fan-out broadcast."""

    def __init__(self) -> None:
        self._active: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._active.add(ws)
        logger.info("ws: client connected (total=%d)", len(self._active))

    def disconnect(self, ws: WebSocket) -> None:
        self._active.discard(ws)
        logger.info("ws: client disconnected (total=%d)", len(self._active))

    async def broadcast(self, payload: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._active):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def connection_count(self) -> int:
        return len(self._active)


manager = ConnectionManager()


@router.websocket("/v1/ws/market")
async def market_websocket(ws: WebSocket) -> None:
    """
    Streams market snapshots every 2 seconds.

    **Authentication**: Pass JWT as query param `?token=<jwt>` or in the
    `Authorization` header during the HTTP upgrade handshake.

    **Message format**: JSON matching the `MarketSnapshot` schema.

    ```json
    {
      "type": "snapshot",
      "data": { "stocks": {...}, "ihsg": {...}, ... }
    }
    ```
    """
    settings = get_settings()

    # Auth check on upgrade (bypass in dev)
    if not settings.auth_bypass:
        token = ws.query_params.get("token")
        if not token:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Missing token")
        try:
            verify_token(token)
        except Exception:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")

    await manager.connect(ws)
    try:
        while True:
            snapshot = generate_snapshot()
            await ws.send_text(
                json.dumps(
                    {"type": "snapshot", "data": snapshot.model_dump(mode="json")},
                    default=str,
                )
            )
            await asyncio.sleep(TICK_INTERVAL)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("ws: unexpected error: %s", exc)
    finally:
        manager.disconnect(ws)


@router.get(
    "/v1/ws/market/stats",
    summary="WebSocket connection stats",
    dependencies=[Depends(get_current_user)],
)
async def ws_stats() -> dict[str, int]:
    """
    Current active WebSocket connection count.

    Guarded like every other data route (the surrounding router is not, because
    it also hosts the WS handshake which cannot carry an HTTPBearer header). In
    AUTH_BYPASS dev it stays open; in production it needs a token. Prometheus
    should read connection metrics from /metrics rather than here.
    """
    return {"active_connections": manager.connection_count}
