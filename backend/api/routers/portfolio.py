"""
Portfolio Optimisation Router — Phase 6

GET /v1/portfolio/optimise
  Returns Black-Litterman + HRP optimal weights for the authenticated user's portfolio.
  In mock mode (USE_MOCK_PORTFOLIO=true) returns pre-computed seed weights.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, status

from api.core.auth import CurrentUser
from api.models.portfolio import (
    EquityCurveResponse,
    PortfolioOptimisationResponse,
    PositionsResponse,
    PositionsUpdate,
    PositionOutput,
)
from api.services.portfolio_access import (
    Position, known_symbols, load_positions, replace_positions, resolve_portfolio_id,
)
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
    uid = await resolve_portfolio_id(str(current_user.user_id))
    logger.info("portfolio/optimise: portfolio=%s user=%s", uid, current_user.user_id)
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
    portfolio_id = await resolve_portfolio_id(str(current_user.user_id))
    return await get_equity_curve_cached(days, portfolio_id)


@router.get(
    "/positions",
    response_model=PositionsResponse,
    summary="The caller's positions",
    description=(
        "What this account holds, from `portfolios.lots_json`."
        "\n\n"
        "Before this existed, positions lived only in the browser's localStorage, "
        "so every analytics path computed against an empty portfolio while the "
        "Portfolio page displayed ten seeded positions belonging to nobody. Both "
        "answers were shown to the same person at the same time."
        "\n\n"
        "An empty `positions` list is the correct answer for a new account, and is "
        "not an error."
    ),
)
async def portfolio_positions(current_user: CurrentUser) -> PositionsResponse:
    portfolio_id = await resolve_portfolio_id(str(current_user.user_id))
    stored = await load_positions(portfolio_id)

    rows = [
        PositionOutput(
            symbol=symbol,
            lots=position.lots,
            avgPrice=position.avg_price,
            shares=position.lots * 100,
        )
        for symbol, position in sorted(stored.items())
    ]
    # Null rather than 0 when nothing has a cost basis: a total of zero is a claim
    # about money spent, and a portfolio with no recorded prices has spent nothing
    # *known*.
    bases = [p.avgPrice * p.shares for p in rows if p.avgPrice is not None]
    return PositionsResponse(
        positions=rows,
        computedAt=datetime.now(timezone.utc).isoformat(),
        totalCostBasis=round(sum(bases), 2) if len(bases) == len(rows) and rows else None,
    )


@router.put(
    "/positions",
    response_model=PositionsResponse,
    summary="Replace the caller's positions",
    description=(
        "Replaces the whole position list. Sending an empty list clears the "
        "portfolio, which is how a position is deleted."
        "\n\n"
        "This is the write path that `lots_json` never had: until it existed a "
        "portfolio could only be filled by editing the database by hand, so the "
        "honest empty analytics that ADR-0005 introduced had no way back to a "
        "real one."
    ),
)
async def update_portfolio_positions(
    current_user: CurrentUser, body: PositionsUpdate
) -> PositionsResponse:
    portfolio_id = await resolve_portfolio_id(str(current_user.user_id))

    requested: dict[str, Position] = {}
    for item in body.positions:
        symbol = item.symbol.strip().upper()
        # Last write wins on a duplicate rather than summing: a screen that sent
        # BBCA twice meant one position, and quietly doubling someone's holding
        # because of a UI bug is not a recoverable surprise.
        requested[symbol] = Position(lots=item.lots, avg_price=item.avgPrice)

    # Checked before anything is written, and against the database rather than the
    # frontend's list: a position naming a ticker that is not listed makes VaR,
    # beta and allocation compute over something that does not exist, and every
    # number derived from it looks entirely plausible.
    #
    # An empty universe skips the check rather than rejecting everything — see
    # known_symbols for why that is the safe direction.
    universe = await known_symbols()
    if universe is not None:
        unknown = sorted(set(requested) - universe)
        if unknown:
            logger.info(
                "portfolio/positions: rejecting unknown symbol(s) %s for portfolio=%s",
                unknown, portfolio_id,
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Not a listed IDX ticker: {', '.join(unknown)}",
            )

    await replace_positions(portfolio_id, requested)
    logger.info(
        "portfolio/positions: portfolio=%s user=%s positions=%d",
        portfolio_id, current_user.user_id, len(requested),
    )
    return await portfolio_positions(current_user)
