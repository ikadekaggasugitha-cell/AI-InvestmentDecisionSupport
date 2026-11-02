"""
The console's overview: nine figures, one query, no invented numbers.

Public surface? No. This is the operator's own view of their business, and the
blueprint puts it at `GET /v1/admin/analytics/overview` for the same reason the
price is read twice — once without a session for a person deciding whether to
buy, once with an administrator's role for a person running the thing. A
non-administrator gets 403 here, not a sessionless copy of the same answer.

What the endpoint does *not* do is round anything into a nicer shape or fill a
gap with a zero it did not read. An install with no payments answers with zeros,
because that is the true state; an install whose database would not answer gets a
503, which is a different thing and must not be shown as the same flat line.
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from api.core.auth import AdminUser
from api.services.admin_analytics_service import OverviewUnavailable, read_overview

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


class OverviewResponse(BaseModel):
    """Money, people, and the work still sitting in the queue.

    `mrrRunRate` is the only figure that is not a direct sum or count, and its
    name says so: a normalised run-rate over the last thirty days, not revenue
    received and not a projection of either. The screen prints the formula next
    to it.
    """

    revenueToday: int
    revenueLast30Days: int
    revenueTotal: int
    mrrRunRate: int
    settledLast30Days: int
    pendingQueue: int
    expiredQueue: int
    activeSubscribers: int
    churnedSubscribers: int


@router.get(
    "/analytics/overview",
    response_model=OverviewResponse,
    summary="The operator's overview figures",
    description=(
        "Rupiah settled today (WIB), over a rolling thirty days, and in total;\n"
        "a normalised thirty-day run-rate and how many payments it was built\n"
        "from; subscribers holding a running period and accounts whose last one\n"
        "has ended; and the queue split into what is waiting and what expired\n"
        "while still being money.\n\n"
        "Zeros are an answer. 503 means the numbers could not be read, which is\n"
        "not the same claim and must never be shown as one."
    ),
    responses={
        403: {"description": "Administrator access required"},
        503: {"description": "The figures could not be read"},
    },
)
async def admin_overview(admin: AdminUser) -> OverviewResponse:
    try:
        figures = await read_overview()
    except OverviewUnavailable as exc:
        logger.error("admin overview: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The overview figures could not be read right now.",
        ) from exc
    return OverviewResponse(
        revenueToday=figures.revenue_today,
        revenueLast30Days=figures.revenue_last_30_days,
        revenueTotal=figures.revenue_total,
        mrrRunRate=figures.mrr_run_rate,
        settledLast30Days=figures.settled_last_30_days,
        pendingQueue=figures.pending_queue,
        expiredQueue=figures.expired_queue,
        activeSubscribers=figures.active_subscribers,
        churnedSubscribers=figures.churned_subscribers,
    )
