"""
Symbol-universe endpoints — the full listed IDX board for browse and search.

`GET /v1/symbols` replaces the frontend's hardcoded 15-symbol seed: it serves the
whole `instruments` table (~960 securities) with names, IDX-IC sectors and last
daily close, filterable by search text and sector. `GET /v1/symbols/sectors`
backs the sector filter.
"""

from fastapi import APIRouter, Query

from api.core.auth import CurrentUser
from api.models.symbols import SectorListResponse, SymbolListResponse
from api.services.symbols_service import DEFAULT_SORT, list_sectors, list_symbols

router = APIRouter(prefix="/v1/symbols", tags=["symbols"])


@router.get(
    "/sectors",
    response_model=SectorListResponse,
    summary="IDX-IC sectors with active-instrument counts",
)
async def sectors_endpoint(_user: CurrentUser) -> SectorListResponse:
    """The 11 IDX-IC sectors and how many active securities each holds. Declared
    before the list route so `sectors` is never read as a query of the board."""
    return await list_sectors()


@router.get(
    "",
    response_model=SymbolListResponse,
    summary="The listed IDX board — browse, search and filter",
)
async def list_symbols_endpoint(
    _user: CurrentUser,
    q: str | None = Query(None, description="Search by ticker or company name."),
    sector: str | None = Query(None, description="IDX-IC sector, e.g. 'Keuangan'."),
    active: bool = Query(True, description="Only currently-listed securities."),
    sort: str = Query(
        DEFAULT_SORT,
        description="marketcap | symbol | gainers | losers | volume.",
    ),
    limit: int = Query(1000, ge=1, le=2000, description="Page size."),
    offset: int = Query(0, ge=0, description="Page offset."),
) -> SymbolListResponse:
    """
    One entry per IDX security with reference metadata and its last daily close.

    Prices are end-of-day from `ohlcv_daily`; live intraday ticks arrive over the
    market WebSocket. Defaults return the whole active board sorted by market cap,
    which is the natural browse order.
    """
    return await list_symbols(
        q=q, sector=sector, active_only=active, sort=sort, limit=limit, offset=offset
    )
