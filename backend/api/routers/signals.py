from fastapi import APIRouter, HTTPException, Path
from api.core.auth import CurrentUser
from api.models.signals import AISignal, SignalsResponse
from api.services.signal_service import get_signal_for, get_signals

router = APIRouter(prefix="/v1/signals", tags=["signals"])


@router.get("", response_model=SignalsResponse, summary="Get AI trading signals")
async def signals_endpoint(_user: CurrentUser) -> SignalsResponse:
    """
    Returns LightGBM-generated probability scores and SHAP factors for
    the whole scored IDX board.

    - **Phase 1**: Returns seed JSON (USE_MOCK_SIGNALS=true)
    - **Phase 3**: Returns live LightGBM inference results from Redis cache

    OJK compliance: all uprob values are probability scores (0–100),
    not trading instructions.
    """
    return await get_signals()


@router.get("/{symbol}", response_model=AISignal, summary="AI signal for one symbol")
async def signal_for_symbol_endpoint(
    _user: CurrentUser,
    symbol: str = Path(..., min_length=2, max_length=8, description="IDX ticker, e.g. BBCA"),
) -> AISignal:
    """
    One symbol's AI signal (uprob, confidence, tier, upside), for the stock
    detail view. 404 when the symbol was not scored — e.g. no bars yet.
    """
    signal = await get_signal_for(symbol)
    if signal is None:
        raise HTTPException(status_code=404, detail=f"No signal for {symbol.upper()}")
    return signal
