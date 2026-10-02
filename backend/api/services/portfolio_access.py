"""
Portfolio ownership — the only sanctioned way to turn a token into a portfolio id.

Every portfolio-scoped endpoint used to read its identity from a query parameter
(`portfolio_id` on /v1/risk/portfolio, `uid` on /v1/portfolio/optimise,
/v1/alerts and ChatRequest) that any authenticated caller could set to any
value. `current_user.sub` was logged and otherwise ignored, so one authorised
caller could read another portfolio's risk metrics, allocation and alerts, and
the advisor would answer questions about a portfolio they do not own. There was
nothing to check against: a portfolio existed only as a Redis key, and Redis
holds no notion of who asked.

Portfolios are rows in the `portfolios` table (db/migrations/0004) and this
module is the single place that decides whether a caller may see one.

Two rules, both deliberate:

  * A caller with no explicit id gets their own auto-provisioned default,
    seeded from api/core/holdings.PORTFOLIO_LOTS. That keeps a single-operator
    install showing the same portfolio it always did, instead of an empty one.

  * An explicit id that the caller does not own raises 404, not 403. A 403 would
    confirm the portfolio exists, which is itself a leak — it turns the endpoint
    into an oracle for guessing other users' portfolio ids.
"""

import json
import logging
import secrets

from fastapi import HTTPException, status

from api.core.db import get_pool
from api.core.holdings import PORTFOLIO_LOTS

logger = logging.getLogger(__name__)

# The literal single-operator portfolio id. Kept as a constant so the auto-
# provision path and any operator override agree, and so it is greppable.
DEFAULT_PORTFOLIO = "default"


async def resolve_portfolio_id(sub: str, requested: str | None = None) -> str:
    """
    Resolve the portfolio a caller is allowed to act on.

    Args:
        sub: the authenticated principal, i.e. `TokenPayload.sub`.
        requested: a caller-supplied portfolio id, or None/empty for "mine".

    Returns:
        A portfolio id owned by `sub`. Never returns an id the caller does not
        own.

    Raises:
        HTTPException 404 — a requested id exists but belongs to someone else,
        or does not exist at all. Deliberately indistinguishable.
        HTTPException 503 — the database is unreachable, so ownership genuinely
        cannot be established. Failing closed here is the point of the module:
        the alternative is serving a portfolio on an unchecked identity.
    """
    if not requested:
        return await _default_portfolio_for(sub)
    if await _owns(sub, requested):
        return requested
    # 404, not 403: do not confirm that someone else's portfolio exists.
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Portfolio not found.",
    )


async def _owns(sub: str, portfolio_id: str) -> bool:
    try:
        pool = await get_pool()
        row = await pool.fetchrow(
            "SELECT 1 FROM portfolios WHERE id = $1 AND owner_sub = $2",
            portfolio_id,
            sub,
        )
        return row is not None
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        # Fail closed. An unreachable database must not become "allowed".
        logger.error("portfolio_access: ownership check failed — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot verify portfolio ownership right now.",
        ) from exc


async def _default_portfolio_for(sub: str) -> str:
    """
    The caller's default portfolio, creating it on first use.

    The first principal's default is given the id "default" on purpose. The
    Redis keys that carry risk and optimisation results are
    `risk:portfolio:{id}` and `portfolio:optimise:{id}`, and the Celery
    refresh_risk task pre-warms `risk:portfolio:default` on a schedule. Handing
    out a random id instead would leave that warm cache unread and force the
    dashboard to recompute GARCH synchronously on the first request of every
    hour. Reusing "default" keeps every existing cache key valid and makes this
    change invisible to a single-operator install.

    Because "default" is the primary key, only the first principal can hold it.
    A second principal's ON CONFLICT DO NOTHING discards its row, the re-read
    finds nothing, and it falls through to a generated id — which also gives the
    second principal its own cache namespace. The partial unique index
    uq_portfolios_one_default guarantees at most one default per owner, and the
    re-read after each insert means a lost race resolves to the winner's id
    rather than to a row that does not exist.
    """
    try:
        pool = await get_pool()
    except Exception as exc:  # noqa: BLE001
        logger.error("portfolio_access: cannot reach the database — %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot verify portfolio ownership right now.",
        ) from exc

    seeded = json.dumps(PORTFOLIO_LOTS)

    for candidate in (DEFAULT_PORTFOLIO, f"pf_{secrets.token_hex(6)}"):
        try:
            await pool.execute(
                """
                INSERT INTO portfolios (id, owner_sub, name, lots_json, is_default)
                VALUES ($1, $2, 'Default', $3::jsonb, TRUE)
                ON CONFLICT DO NOTHING
                """,
                candidate,
                sub,
                seeded,
            )
            # Re-read rather than trusting `candidate`: if a concurrent request
            # or an earlier principal won, our row was discarded and the id in
            # hand is not ours.
            resolved = await pool.fetchval(
                "SELECT id FROM portfolios WHERE owner_sub = $1 AND is_default",
                sub,
            )
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("portfolio_access: provisioning failed — %s", exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Cannot verify portfolio ownership right now.",
            ) from exc

        if resolved:
            if candidate == DEFAULT_PORTFOLIO:
                logger.info("portfolio_access: provisioned default %s for %s", resolved, sub)
            return resolved

    # Both attempts conflicted yet the caller still has no default row, which
    # should be impossible. Fail loudly rather than inventing an id that has no
    # row behind it.
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Could not provision a portfolio.",
    )
