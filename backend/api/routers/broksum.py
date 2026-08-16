from fastapi import APIRouter, Path, Query

from api.core.auth import CurrentUser
from api.models.broksum import BrokerSummaryHistoryResponse, BrokerSummaryResponse
from api.services.broksum_service import get_broker_summary, get_broker_summary_history

router = APIRouter(prefix="/v1/broksum", tags=["broker-summary"])


@router.get(
    "/{symbol}",
    response_model=BrokerSummaryResponse,
    summary="Broker summary and accumulation phase for a symbol",
)
async def broker_summary_endpoint(
    _user: CurrentUser,
    symbol: str = Path(..., min_length=2, max_length=8, description="IDX ticker, e.g. BBCA"),
) -> BrokerSummaryResponse:
    """
    Latest session's per-broker buy/sell lots plus an accumulation /
    distribution snapshot derived from the trailing 30 sessions.

    Data is published once per session, so responses are cached for 24h.

    OJK compliance: broker flow is descriptive market data, not a trading
    instruction. `source` reports `mock` when USE_MOCK_BROKSUM=true — the
    broker codes and lots are simulated in that mode and name no real firm's
    actual trading.
    """
    return await get_broker_summary(symbol)


@router.get(
    "/{symbol}/history",
    response_model=BrokerSummaryHistoryResponse,
    summary="Daily net-lot history for a symbol",
)
async def broker_summary_history_endpoint(
    _user: CurrentUser,
    symbol: str = Path(..., min_length=2, max_length=8),
    days: int = Query(20, ge=1, le=180, description="Sessions to return"),
) -> BrokerSummaryHistoryResponse:
    """
    Net lot per session with the dominant buyer and seller, oldest first.

    Capped at 180 days to match the `broker_summary` retention policy.
    """
    return await get_broker_summary_history(symbol, days=days)
