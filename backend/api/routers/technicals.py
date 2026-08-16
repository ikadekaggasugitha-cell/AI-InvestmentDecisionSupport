from fastapi import APIRouter, Path, Query

from api.core.auth import CurrentUser
from api.models.technicals import OHLCVResponse, TechnicalAnalysisResponse
from api.services.technicals_service import get_ohlcv_history, get_technical_analysis

router = APIRouter(prefix="/v1/technicals", tags=["technicals"])


@router.get(
    "/{symbol}",
    response_model=TechnicalAnalysisResponse,
    summary="Trend, support/resistance, patterns and open gaps",
)
async def technical_analysis_endpoint(
    _user: CurrentUser,
    symbol: str = Path(..., min_length=2, max_length=8, description="IDX ticker, e.g. BBCA"),
) -> TechnicalAnalysisResponse:
    """
    Point-in-time price action for a symbol: EMA trend, Williams fractal
    support/resistance, recent candlestick patterns, and unfilled gaps with
    historical fill probability.

    These values describe the series as it stands today. They are deliberately
    NOT model features — see PHASE10_DISPLAY_FEATURES in ml/features/engineer.py
    for why attaching them to historical rows leaks the future into training.

    OJK compliance: technical levels are descriptive, not buy/sell instructions.
    """
    return await get_technical_analysis(symbol)


@router.get(
    "/{symbol}/ohlcv",
    response_model=OHLCVResponse,
    summary="Daily OHLCV candles for charting",
)
async def ohlcv_endpoint(
    _user: CurrentUser,
    symbol: str = Path(..., min_length=2, max_length=8),
    days: int = Query(120, ge=20, le=400, description="Sessions to return"),
) -> OHLCVResponse:
    """
    Daily candles ordered oldest first, with `time` as `yyyy-mm-dd` so the
    payload drops straight into Lightweight Charts.

    Capped at 400 days to match the `ohlcv` retention policy.
    """
    return await get_ohlcv_history(symbol, days=days)
