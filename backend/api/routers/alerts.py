from fastapi import APIRouter

from api.core.auth import CurrentUser
from api.models.alerts import AlertsResponse
from api.services.alerts_service import get_alerts
from api.services.portfolio_access import resolve_portfolio_id

router = APIRouter(prefix="/v1/alerts", tags=["alerts"])


@router.get("", response_model=AlertsResponse, summary="Live Peringatan feed")
async def alerts_endpoint(user: CurrentUser) -> AlertsResponse:
    """
    The Peringatan feed, derived at read time from live signals, market movers,
    foreign flow, portfolio risk and BEI news — so it reflects current conditions
    with real timestamps instead of a frozen seed list.

    Scoped to the caller's own portfolio. The `uid` parameter this used to accept
    without annotation was read as a query parameter, which let any caller read
    another portfolio's risk alerts.
    """
    uid = await resolve_portfolio_id(user.sub)
    return await get_alerts(uid)
