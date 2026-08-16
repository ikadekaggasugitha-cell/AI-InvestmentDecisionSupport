from fastapi import APIRouter, Depends
from api.core.auth import CurrentUser
from api.models.signals import SignalsResponse
from api.services.signal_service import get_signals

router = APIRouter(prefix="/v1/signals", tags=["signals"])


@router.get("", response_model=SignalsResponse, summary="Get AI trading signals")
async def signals_endpoint(_user: CurrentUser) -> SignalsResponse:
    """
    Returns LightGBM-generated probability scores and SHAP factors for
    the tracked IDX universe.

    - **Phase 1**: Returns seed JSON (USE_MOCK_SIGNALS=true)
    - **Phase 3**: Returns live LightGBM inference results from Redis cache

    OJK compliance: all uprob values are probability scores (0–100),
    not trading instructions.
    """
    return await get_signals()
