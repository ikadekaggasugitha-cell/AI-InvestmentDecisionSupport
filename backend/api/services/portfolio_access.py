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

  * A caller with no explicit id gets their own auto-provisioned default. It
    starts empty, which is ADR-0005: a portfolio that is not yet anyone's should
    say so rather than display ten IDX positions belonging to somebody else.

  * An explicit id that the caller does not own raises 404, not 403. A 403 would
    confirm the portfolio exists, which is itself a leak — it turns the endpoint
    into an oracle for guessing other users' portfolio ids.
"""

import json
import logging
import secrets
from dataclasses import dataclass

from fastapi import HTTPException, status

from api.core.db import get_pool

logger = logging.getLogger(__name__)

# The literal single-operator portfolio id. Kept as a constant so the auto-
# provision path and any operator override agree, and so it is greppable.
DEFAULT_PORTFOLIO = "default"


async def resolve_portfolio_id(user_id: str, requested: str | None = None) -> str:
    """
    Resolve the portfolio a caller is allowed to act on.

    Args:
        user_id: the authenticated principal's account id.
        requested: a caller-supplied portfolio id, or None/empty for "mine".

    Returns:
        A portfolio id owned by `user_id`. Never returns an id the caller does not
        own.

    Raises:
        HTTPException 404 — a requested id exists but belongs to someone else,
        or does not exist at all. Deliberately indistinguishable.
        HTTPException 503 — the database is unreachable, so ownership genuinely
        cannot be established. Failing closed here is the point of the module:
        the alternative is serving a portfolio on an unchecked identity.
    """
    if not requested:
        return await _default_portfolio_for(user_id)
    if await _owns(user_id, requested):
        return requested
    # 404, not 403: do not confirm that someone else's portfolio exists.
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Portfolio not found.",
    )


@dataclass(frozen=True)
class Position:
    """One holding: how many lots, and what they cost.

    avg_price is optional because it is genuinely unknown, not zero. A position
    entered without a purchase price has a real lot count and no cost basis, and
    conflating those two states would show a 0% return on a position nobody said
    was free.
    """

    lots: int
    avg_price: float | None = None


async def load_lots(portfolio_id: str) -> dict[str, int]:
    """The positions this portfolio actually holds, as symbol -> lots.

    The single read path for positions (ADR-0005). Four modules used to import the
    same `PORTFOLIO_LOTS` constant instead, so every account was measured against
    one hardcoded portfolio no matter whose name was on the row.

    An empty result is a real answer, not a failure: a new account genuinely holds
    nothing, and the callers below are required to stop before computing rather
    than substitute a plausible-looking number. A database failure is the opposite
    and raises, so "I do not know" can never be rendered as "you hold nothing".

    Args:
        portfolio_id: an id already resolved by resolve_portfolio_id, so ownership
            is settled by the caller. This function does not re-check it.

    Raises:
        HTTPException 503 — the database is unreachable.
    """
    try:
        pool = await get_pool()
        raw = await pool.fetchval(
            "SELECT lots_json FROM portfolios WHERE id = $1", portfolio_id
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("portfolio_access: cannot read positions for %s — %s", portfolio_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot read portfolio positions right now.",
        ) from exc

    if not raw:
        return {}
    if isinstance(raw, str):
        raw = json.loads(raw)
    # Lots are whole 1-lot units and positive. Anything else is a malformed row,
    # and silently coercing it would put a wrong position on someone's dashboard.
    # The value may be a bare number (the pre-0008 shape) or {lots, avgPrice}.
    return {
        symbol: position.lots
        for symbol, position in load_positions_from(raw).items()
    }


async def load_positions(portfolio_id: str) -> dict[str, "Position"]:
    """The full positions, cost basis included.

    load_lots is what analytics needs and deliberately drops avgPrice, because a
    risk engine has no use for a purchase price. Anything rendering a position to
    a person — cost basis, unrealised P&L, the position table itself — needs both
    halves, and reconstructing the price from the lots map is how the two drift.
    """
    raw = await _read_lots_json(portfolio_id)
    return load_positions_from(raw)


def load_positions_from(raw) -> dict[str, "Position"]:
    """Parse a `lots_json` value into positions.

    Accepts both shapes. `{symbol: lots}` predates migration 0008 and still appears
    in any install that has not run it; `{symbol: {lots, avgPrice}}` is what is
    written now. Both are read, so a database mid-migration answers correctly
    rather than reporting every position as malformed.
    """
    if not raw:
        return {}
    if isinstance(raw, (str, bytes)):
        raw = json.loads(raw)

    out: dict[str, Position] = {}
    for symbol, value in raw.items():
        if isinstance(value, dict):
            lots = value.get("lots")
            avg_price = value.get("avgPrice")
        else:
            lots, avg_price = value, None

        # A malformed row is skipped rather than coerced: guessing a lot count puts
        # a position on someone's dashboard that they never entered, and a negative
        # lot in a long-only portfolio makes every downstream percentage meaningless.
        if not isinstance(lots, (int, float)) or lots <= 0:
            continue
        if avg_price is not None and (
            not isinstance(avg_price, (int, float)) or avg_price <= 0
        ):
            avg_price = None
        out[str(symbol)] = Position(lots=int(lots), avg_price=avg_price)
    return out


async def _read_lots_json(portfolio_id: str):
    try:
        pool = await get_pool()
        return await pool.fetchval(
            "SELECT lots_json FROM portfolios WHERE id = $1", portfolio_id
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("portfolio_access: cannot read positions for %s — %s", portfolio_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot read portfolio positions right now.",
        ) from exc


async def replace_positions(portfolio_id: str, positions: dict[str, "Position"]) -> None:
    """Overwrite a portfolio's positions with `positions`.

    A whole-row replace rather than a merge, because the caller's screen is the
    authority on what the portfolio now holds: deleting a position there has to
    remove it here. A merge cannot express a deletion and would quietly refuse it.
    """
    payload = {
        symbol: {"lots": pos.lots, "avgPrice": pos.avg_price}
        for symbol, pos in positions.items()
    }
    try:
        pool = await get_pool()
        await pool.execute(
            "UPDATE portfolios SET lots_json = $1::jsonb, updated_at = NOW() WHERE id = $2",
            json.dumps(payload),
            portfolio_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("portfolio_access: cannot write positions for %s — %s", portfolio_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot save portfolio positions right now.",
        ) from exc

    await invalidate_portfolio_caches(portfolio_id)


async def invalidate_portfolio_caches(portfolio_id: str) -> None:
    """Drop the derived figures a position change makes wrong.

    Risk metrics, the equity curve and the optimisation weights are all pure
    functions of the positions, so they cannot be reused once those change. Without
    this, saving a position leaves the risk page reading numbers computed over the
    previous book for up to an hour — and if the portfolio was empty, the empty
    result was cached too, so the page would keep saying "no positions" while the
    positions endpoint said otherwise.

    Best effort by design: a cache that cannot be reached must not fail the write
    that succeeded. The staleness then degrades to the TTL, which is the same
    outcome as a cache hit on a cold read.
    """
    from api.core.redis_client import REDIS_KEYS, get_redis
    from redis.exceptions import RedisError

    try:
        async with get_redis() as redis:
            keys = [REDIS_KEYS["risk_portfolio"].format(uid=portfolio_id),
                    REDIS_KEYS["portfolio_optimise"].format(uid=portfolio_id)]
            # The equity key carries a day count as well, and the number of day
            # counts a caller may ask for is not bounded by this module.
            for equity_key in await redis.keys(
                REDIS_KEYS["portfolio_equity"].format(uid=portfolio_id, days="*")
            ):
                keys.append(equity_key.decode() if isinstance(equity_key, bytes) else equity_key)
            if keys:
                await redis.delete(*keys)
    except (RedisError, AttributeError) as exc:
        logger.warning(
            "portfolio_access: could not invalidate caches for %s — %s", portfolio_id, exc
        )


async def _owns(user_id: str, portfolio_id: str) -> bool:
    try:
        pool = await get_pool()
        row = await pool.fetchrow(
            "SELECT 1 FROM portfolios WHERE id = $1 AND user_id = $2",
            portfolio_id,
            user_id,
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


async def _default_portfolio_for(user_id: str) -> str:
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

    # Empty, deliberately (ADR-0005). This used to seed the shared
    # PORTFOLIO_LOTS constant, which meant the first person to sign up was handed
    # the operator's positions and every account after them was shown the same
    # portfolio. Positions arrive from the API, not from a constant.
    seeded = json.dumps({})

    for candidate in (DEFAULT_PORTFOLIO, f"pf_{secrets.token_hex(6)}"):
        try:
            await pool.execute(
                """
                INSERT INTO portfolios (id, user_id, name, lots_json, is_default)
                VALUES ($1, $2, 'Default', $3::jsonb, TRUE)
                ON CONFLICT DO NOTHING
                """,
                candidate,
                user_id,
                seeded,
            )
            # Re-read rather than trusting `candidate`: if a concurrent request
            # or an earlier principal won, our row was discarded and the id in
            # hand is not ours.
            resolved = await pool.fetchval(
                "SELECT id FROM portfolios WHERE user_id = $1 AND is_default",
                user_id,
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
                logger.info("portfolio_access: provisioned default %s for %s", resolved, user_id)
            return resolved

    # Both attempts conflicted yet the caller still has no default row, which
    # should be impossible. Fail loudly rather than inventing an id that has no
    # row behind it.
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Could not provision a portfolio.",
    )
