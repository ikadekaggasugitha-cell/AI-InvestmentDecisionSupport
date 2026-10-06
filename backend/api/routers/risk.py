from fastapi import APIRouter

from api.core.auth import CurrentUser
from api.models.risk import RiskMetricsResponse
from api.services.portfolio_access import resolve_portfolio_id
from api.services.risk_service import get_risk_metrics

router = APIRouter(prefix="/v1/risk", tags=["risk"])


@router.get("/portfolio", response_model=RiskMetricsResponse, summary="Get portfolio risk metrics")
async def risk_portfolio_endpoint(
    user: CurrentUser,
) -> RiskMetricsResponse:
    """
    Returns GARCH-computed VaR/CVaR, volatility, beta, Sharpe, stress tests,
    and sector exposure for the caller's own portfolio.

    - **Phase 1**: Returns seed JSON (USE_MOCK_RISK=true)
    - **Phase 4**: Returns live GARCH + historical simulation results

    The portfolio is resolved from the caller's identity, not from a query
    parameter — a `portfolio_id` parameter would let any authenticated caller
    name someone else's portfolio. Results are cached in Redis for 1 hour.
    """
    portfolio_id = await resolve_portfolio_id(str(user.user_id))
    return await get_risk_metrics(portfolio_id=portfolio_id)
