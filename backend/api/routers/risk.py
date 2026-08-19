from fastapi import APIRouter, Query
from api.core.auth import CurrentUser
from api.models.risk import RiskMetricsResponse
from api.services.risk_service import get_risk_metrics

router = APIRouter(prefix="/v1/risk", tags=["risk"])


@router.get("/portfolio", response_model=RiskMetricsResponse, summary="Get portfolio risk metrics")
async def risk_portfolio_endpoint(
    user: CurrentUser,
    portfolio_id: str = Query(default="default", description="Portfolio identifier"),
) -> RiskMetricsResponse:
    """
    Returns GARCH-computed VaR/CVaR, volatility, beta, Sharpe, stress tests,
    and sector exposure for the specified portfolio.

    - **Phase 1**: Returns seed JSON (USE_MOCK_RISK=true)
    - **Phase 4**: Returns live GARCH + historical simulation results

    Results are cached in Redis for 1 hour.
    """
    return await get_risk_metrics(portfolio_id=portfolio_id)
