from fastapi import APIRouter, Query

from api.core.auth import CurrentUser
from api.models.news import NewsResponse
from api.services.news_service import get_news

router = APIRouter(prefix="/v1/news", tags=["news"])


@router.get("", response_model=NewsResponse, summary="Recent IDX disclosures")
async def news_endpoint(
    _user: CurrentUser,
    limit: int = Query(20, ge=1, le=100),
    daysBack: int = Query(7, ge=1, le=90, description="Filing window in days"),
) -> NewsResponse:
    """
    Keterbukaan informasi filed with IDX, newest first.

    These are primary documents: each is filed by the issuer and timestamped by
    the exchange, so items carry an emiten code and a filing date rather than a
    publisher's framing.

    `source` is `"unavailable"` when IDX could not be reached — distinct from an
    empty list on a genuinely quiet day.
    """
    return await get_news(limit=limit, days_back=daysBack)
