"""
Portfolio Optimisation Router — Phase 6

GET /v1/portfolio/optimise
  Returns Black-Litterman + HRP optimal weights for the authenticated user's portfolio.
  In mock mode (USE_MOCK_PORTFOLIO=true) returns pre-computed seed weights.
"""

import logging

from fastapi import APIRouter, Query

from api.core.auth import CurrentUser
from api.models.portfolio import PortfolioOptimisationResponse
from api.services.portfolio_service import get_portfolio_optimisation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/portfolio", tags=["portfolio"])


@router.get(
    "/optimise",
    response_model=PortfolioOptimisationResponse,
    summary="Get optimised portfolio allocation",
    description=(
        "Returns Black-Litterman + HRP optimal weights blending LightGBM signal views "
        "with CAPM equilibrium returns. OJK disclaimer included in response body."
    ),
)
async def optimise_portfolio(
    current_user: CurrentUser,
    uid: str = Query(default="default", description="Portfolio user ID"),
) -> PortfolioOptimisationResponse:
    logger.info("portfolio/optimise: uid=%s user=%s", uid, current_user.sub)
    return await get_portfolio_optimisation(uid=uid)
