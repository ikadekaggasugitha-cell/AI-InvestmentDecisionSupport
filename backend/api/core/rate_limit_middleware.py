"""
Rate limit middleware.

Replaces slowapi's `SlowAPIMiddleware`, which silently exempted every route on this
FastAPI version — see `api/core/rate_limit.py` for the mechanism and the evidence.

The difference in behaviour that matters: this middleware decides from the request
*path*, not from looking up a route handler. There is no route table to walk, so
there is nothing for a framework upgrade to quietly invalidate.
"""

import logging

from fastapi import Request, status
from fastapi.responses import JSONResponse

from api.core.rate_limit import check_request, client_address

logger = logging.getLogger(__name__)


async def rate_limit_middleware(request: Request, call_next):
    """Refuse the request, or pass it through with its budget attached.

    Headers are attached to *allowed* responses too, not just refusals: a client that
    can see how much of its budget is left does not have to discover the limit by
    hitting it.
    """
    try:
        allowed, retry_after, limit = check_request(
            request.url.path, client_address(request)
        )
    except Exception:  # noqa: BLE001
        # The limiter must not be able to take the API down. If deciding fails, serve
        # the request — the budget is then not enforced, which is a smaller problem
        # than an outage. This is the opposite of the paywall, which fails closed on
        # purpose; see the module docstring in api/core/rate_limit.py.
        logger.warning("rate limit: check failed, serving without a budget", exc_info=True)
        return await call_next(request)

    if not allowed:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "detail": (
                    "Too many requests. The limit for this endpoint is "
                    f"{limit.count} per {limit.period} seconds."
                )
            },
            headers={
                "Retry-After": str(retry_after),
                "X-RateLimit-Limit": str(limit.count),
                "X-RateLimit-Window": str(limit.period),
            },
        )

    response = await call_next(request)
    if limit.count:
        response.headers["X-RateLimit-Limit"] = str(limit.count)
        response.headers["X-RateLimit-Window"] = str(limit.period)
    return response