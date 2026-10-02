"""
Portfolio Optimisation Router — Phase 6

GET /v1/portfolio/optimise
  Returns Black-Litterman + HRP optimal weights for the authenticated user's portfolio.
  In mock mode (USE_MOCK_PORTFOLIO=true) returns pre-computed seed weights.
"""

import logging

from fastapi import APIRouter, Query

from api.core.auth import CurrentUser
from api.models.portfolio import EquityCurveResponse, PortfolioOptimisationResponse
from api.services.portfolio_access import resolve_portfolio_id
from api.services.portfolio_service import get_equity_curve_cached, get_portfolio_optimisation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/portfolio", tags=["portfolio"])


@router.get(
    "/optimise",
    response_model=PortfolioOptimisationResponse,
    summary="Get optimised portfolio allocation",
    description=(
        "Returns Black-Litterman + HRP optimal weights blending LightGBM signal views "
        "with CAPM equilibrium returns. OJK disclaimer included in response body. "
        "The portfolio is the caller's own; it is resolved from the caller's "
        "identity rather than a query parameter."
    ),
)
async def optimise_portfolio(
    current_user: CurrentUser,
) -> PortfolioOptimisationResponse:
    uid = await resolve_portfolio_id(current_user.sub)
    logger.info("portfolio/optimise: portfolio=%s user=%s", uid, current_user.sub)
    return await get_portfolio_optimisation(uid=uid)


@router.get(
    "/equity",
    response_model=EquityCurveResponse,
    summary="Realised portfolio value over time",
    description=(
        "Daily portfolio value computed from actual session closes times held lots, "
        "with the composite index rebased to the portfolio's starting value so the "
        "two lines share a scale. Replaces a bundled 12-month sample that the "
        "Portfolio page previously drew with no provenance label. `benchmark` is "
        "null per point when the index level for that session is unavailable — it "
        "is omitted rather than zero-filled, because a zero would draw a line to "
        "the floor and read as a catastrophic loss. `source` is 'mock' with an "
        "empty `points` list when there is not enough price history yet; no curve "
        "is invented to fill the gap."
    ),
)
async def portfolio_equity(
    current_user: CurrentUser,
    days: int = Query(default=252, ge=20, le=1000, description="Trading days of history"),
) -> EquityCurveResponse:
    await resolve_portfolio_id(current_user.sub)
    return await get_equity_curve_cached(days)
