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

from api.core.auth import get_current_user
from api.core.config import get_settings
from redis.exceptions import RedisError

from api.core.redis_client import get_redis
from api.services.market_service import generate_snapshot
from api.services.accounts import (
    Account, authenticate, get_account, get_or_create_bypass_account,
)
from api.services.entitlements import has_active_subscription
from api.services.portfolio_access import load_lots, resolve_portfolio_id
from api.services.sessions import SESSION_COOKIE

logger = logging.getLogger(__name__)
router = APIRouter(tags=["market"])

TICK_INTERVAL = 2.0  # seconds — matches frontend 2s setInterval

# Re-read this connection's positions every 30s (15 ticks). Positions are edited by
# hand, not streamed, so a tick-by-tick read would buy nothing and cost one query
# per open socket every two seconds.
POSITIONS_REFRESH_TICKS = 15


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


async def _ws_account(ws: WebSocket) -> Account | None:
    """Resolve the handshake to an Account, or None.

    The ticket exists because a cross-site browser withholds the cookie from the
    upgrade. It names the same account the cookie would have, so both paths end
    at one Account and the caller applies the same gates to either.
    """
    ticket_account_id = await _consume_ticket(ws.query_params.get("ticket"))
    if ticket_account_id is not None:
        # The account was authenticated a moment ago when the ticket was issued,
        # but it may have been blocked in between, so read it rather than trust
        # the ticket's claim about who.
        return await get_account(ticket_account_id)
    token = ws.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    return await authenticate(token)


async def _consume_ticket(ticket: str | None) -> str | None:
    """Consume a single-use WebSocket ticket, returning the account id it names.

    Redis-backed and deliberately short-lived. If the cache is unavailable this
    returns None — the WebSocket closes, which costs a reconnect, rather than
    letting an unauthenticated caller onto the stream.
    """
    if not ticket:
        return None
    try:
        async with get_redis() as r:
            key = f"ws-ticket:{ticket}"
            account_id = await r.get(key)
            if account_id is None:
                return None
            await r.delete(key)   # single use: consumed whether or not it connects
            return _decode(account_id)
    except RedisError as exc:
        logger.warning("ws: ticket check failed, refusing: %s", exc)
        return None


def _decode(value) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


@router.websocket("/v1/ws/market")
async def market_websocket(ws: WebSocket) -> None:
    """
    Streams market snapshots every 2 seconds.

    **Authentication**: the session cookie, sent automatically on the handshake,
    or a single-use ticket in `?ticket=` for the cross-site case.

    The session token used to travel as `?token=<jwt>`, which put a live
    credential in proxy and server access logs and forced it to be readable by
    JavaScript. Now that the cookie is HttpOnly the handshake carries it on its
    own. A browser cannot set headers on a WebSocket upgrade, so when the cookie
    will not be sent — a cross-site frontend, where SameSite=Lax withholds it —
    the client exchanges its cookie for a short-lived single-use ticket over an
    ordinary authenticated request first.

    **Message format**: JSON matching the `MarketSnapshot` schema.

    ```json
    {
      "type": "snapshot",
      "data": { "stocks": {...}, "ihsg": {...}, ... }
    }
    ```
    """
    settings = get_settings()

    # Both gates, in the same order an HTTP request would apply them. A WebSocket
    # cannot use dependency injection, so it resolves them by hand.
    #
    # The entitlement check used to be missing here entirely, which made the live
    # price feed the one stream a signed-in account with no subscription could read
    # for free. `generate_snapshot` is the same data every paid HTTP route serves,
    # so the socket is the cheapest way around the paywall.
    if settings.auth_bypass:
        # The bypass principal still has a real account row, so the snapshot can
        # carry a real portfolio rather than a fabricated one.
        bypass = await get_or_create_bypass_account(settings.auth_bypass_email)
        principal_id = bypass.id
    else:
        account = await _ws_account(ws)
        if account is None:
            raise WebSocketException(
                code=status.WS_1008_POLICY_VIOLATION, reason="Not authenticated"
            )
        if account.blocked_at is not None:
            raise WebSocketException(
                code=status.WS_1008_POLICY_VIOLATION, reason="This account is blocked."
            )
        if settings.paywall_enabled and not await has_active_subscription(account.id):
            raise WebSocketException(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="An active subscription is required for this feed.",
            )
        principal_id = account.id

    # This connection's own portfolio, so the rupiah figures on the feed belong to
    # the person receiving them. generate_snapshot() with no positions returned a
    # hardcoded 13.1 billion rupiah for everyone.
    portfolio_id = await resolve_portfolio_id(str(principal_id))
    lots = await load_lots(portfolio_id)

    tick = 0
    await manager.connect(ws)
    try:
        while True:
            # Positions change rarely and a database read per tick per connection
            # is not free, so the lots are refreshed on a slow interval instead of
            # frozen for the life of the socket.
            if (tick % POSITIONS_REFRESH_TICKS) == 0:
                lots = await load_lots(portfolio_id)
            snapshot = generate_snapshot(lots, portfolio_id)
            tick += 1
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
