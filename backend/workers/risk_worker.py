"""
Risk Worker — Phase 4

Celery task that refreshes portfolio risk metrics every hour during market hours.
Runs GARCH + historical simulation, writes result to Redis (TTL 3600s).
Also runs Kupiec backtest and logs breach rate to MLflow for model monitoring.
"""

import logging
from datetime import datetime, timezone

from workers.celery_app import celery_app

from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS

logger = logging.getLogger(__name__)

# Holdings are no longer a constant. This worker reads each portfolio's own
# `lots_json` and walks every portfolio that has positions (ADR-0005); it used to
# measure one hardcoded book, so a second account's dashboard could only ever be
# warmed with the first account's numbers.


@celery_app.task(
    name="workers.risk_worker.refresh_risk",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def refresh_risk(self, portfolio_id: str | None = None) -> dict:
    """
    Full risk refresh pipeline, for one portfolio or for all of them.

    1. Load 252-day OHLCV from TimescaleDB
    2. Run GARCH + historical simulation CVaR
    3. Compute sector exposure from the portfolio's own holdings
    4. Run Kupiec backtest on rolling 90-day window
    5. Write to Redis; persist to risk_snapshots table

    `portfolio_id` of None means "every portfolio with positions", which is what
    the hourly beat schedule wants. It used to default to the literal "default",
    so with per-account portfolios that refreshed exactly one account and left
    everyone else to recompute synchronously on their next page load.
    """
    settings = get_settings()

    if settings.use_mock_risk:
        logger.info("risk_worker: mock mode — skipping GARCH")
        return {"status": "skipped", "reason": "use_mock_risk=true"}

    try:
        import asyncio as _asyncio

        portfolios = (
            [(portfolio_id, None)] if portfolio_id else _portfolios_with_positions(_asyncio)
        )
        if not portfolios:
            logger.info("risk_worker: no portfolio holds any positions — nothing to do")
            return {"status": "empty", "refreshed": []}

        refreshed: list[str] = []
        failures: dict[str, str] = {}
        for pid, lots in portfolios:
            try:
                _refresh_one(settings, pid, lots)
                refreshed.append(pid)
            except Exception as exc:  # noqa: BLE001 — one bad portfolio is not all of them
                logger.exception("risk_worker: %s failed — %s", pid, exc)
                failures[pid] = str(exc)

        result: dict = {"status": "ok" if not failures else "partial", "refreshed": refreshed}
        if failures:
            result["failed"] = failures
        return result

    except Exception as exc:
        logger.exception("risk_worker: failed — %s", exc)
        raise self.retry(exc=exc)


def _portfolios_with_positions(asyncio_mod) -> list[tuple[str, dict[str, int]]]:
    """Every portfolio that holds something, as (portfolio_id, lots).

    An empty portfolio is skipped rather than measured: GARCH on nothing has no
    answer, and writing a row of zeros for it would put a risk figure on a
    dashboard that has no positions behind it.
    """
    import json as _json

    import asyncpg

    settings = get_settings()

    async def _fetch():
        conn = await asyncpg.connect(
            settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        )
        try:
            return await conn.fetch("SELECT id, lots_json FROM portfolios")
        finally:
            await conn.close()

    rows = asyncio_mod.run(_fetch())
    out: list[tuple[str, dict[str, int]]] = []
    for row in rows:
        raw = row["lots_json"]
        if isinstance(raw, (str, bytes)):
            raw = _json.loads(raw)
        if isinstance(raw, dict) and raw:
            out.append((row["id"], {str(k): int(v) for k, v in raw.items() if v}))
    return out


def _refresh_one(settings, portfolio_id: str, holdings: dict[str, int] | None = None) -> dict:
    """Refresh one portfolio. Raises on failure so the caller can record it."""
    try:
        import asyncio
        import pandas as pd
        import asyncpg
        import redis as sync_redis
        from ml.inference.risk_engine import RiskEngine, kupiec_test

        async def _fetch_ohlcv():
            conn = await asyncpg.connect(
                settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
            )
            try:
                rows = await conn.fetch(
                    """
                    SELECT o.symbol, o.time::date AS date, o.close, o.volume,
                           o.foreign_net, i.sector AS sector
                    FROM ohlcv o
                    LEFT JOIN instruments i USING (symbol)
                    WHERE o.symbol = ANY($1::text[])
                      AND o.time >= NOW() - INTERVAL '252 days'
                    ORDER BY o.symbol, o.time
                    """,
                    list(holdings),
                )
            finally:
                await conn.close()
            return pd.DataFrame([dict(r) for r in rows])

        ohlcv = asyncio.run(_fetch_ohlcv())

        # The index does not come from `ohlcv`. That table is written solely by
        # ohlcv_worker from IdxProvider.get_session_bars, which returns listed
        # equities for a session — never the index — so a
        # `SELECT ... FROM ohlcv WHERE symbol = '^JKSE'` query is permanently
        # empty. With no index series, RiskEngine falls back to beta = 1.0 and
        # alpha = 0.0, which reads as "moves exactly with the market" while
        # measuring nothing. Fetch it from the quote provider instead, as
        # risk_service._compute_live_risk already does. Do NOT close the
        # provider: it is a shared instance whose session and crumb are reused.
        ihsg_returns = pd.Series(dtype=float)
        try:
            from ingestor.providers import get_provider

            async def _fetch_ihsg():
                return await get_provider().get_daily_bars("^JKSE", 252)

            bars = asyncio.run(_fetch_ihsg())
            if bars:
                ihsg_returns = pd.Series(
                    [b.close for b in bars],
                    index=pd.to_datetime([b.date for b in bars]),
                ).pct_change().dropna()
            else:
                logger.warning(
                    "risk_worker: no ^JKSE bars — beta and alpha are unavailable, "
                    "not defaulted"
                )
        except Exception as exc:  # noqa: BLE001 — beta degrades, risk still computes
            logger.warning("risk_worker: ^JKSE unavailable, beta unreliable — %s", exc)

        r = sync_redis.from_url(settings.redis_url, decode_responses=True)

        # From this portfolio's own lots and the closes just loaded. The previous
        # expression read `portfolioValue` out of the shared market snapshot, which
        # is one arbitrary account's total (ADR-0005), and then fell back to a
        # constant. VaR is a rupiah figure, so a wrong portfolio value here makes
        # every downstream number wrong while looking entirely plausible.
        latest_close = ohlcv.sort_values("date").groupby("symbol")["close"].last()
        portfolio_value = float(
            sum(latest_close.get(sym, 0.0) * lots * 100 for sym, lots in holdings.items())
        )

        engine = RiskEngine(
            ohlcv=ohlcv,
            holdings=holdings,
            portfolio_value=portfolio_value,
            ihsg_returns=ihsg_returns,
        )
        response = engine.compute()

        # Kupiec backtest over the portfolio's own return series.
        #
        # The previous expression was ohlcv.set_index("date")["close"].pct_change(),
        # which is wrong twice over: the date index repeats once per symbol, so
        # pct_change() measured the gap between one symbol's close and the next
        # symbol's close, and .tail(90) took 90 rows rather than 90 sessions. A
        # realistic series produced a -0.49 "daily return" that way.
        #
        # var_pct is also passed as abs(): RiskMetrics stores var95 negative by
        # convention, and kupiec_test compares `returns < -var_pct`. With a
        # negative var_pct that test becomes `returns < +|VaR|`, true for
        # essentially every row — breach rate came out at 0.965.
        if not ohlcv.empty:
            port_ret = engine.portfolio_returns()
            var_pct = abs(response.risk.var95) / max(portfolio_value, 1)
            bt = kupiec_test(port_ret.tail(90), var_pct)
            logger.info("kupiec_backtest: p=%.4f passes=%s breach=%.2f%% n=%d",
                        bt["p_value"], bt["passes"], bt["breach_rate"] * 100, len(port_ret))

        # Write to Redis
        cache_key = REDIS_KEYS["risk_portfolio"].format(uid=portfolio_id)
        r.setex(cache_key, 3600, response.model_dump_json())

        # Persist to TimescaleDB
        async def _persist():
            conn = await asyncpg.connect(
                settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
            )
            rm = response.risk
            await conn.execute(
                """
                INSERT INTO risk_snapshots
                    (computed_at, portfolio_id, var95, cvar95, volatility, beta, sharpe, alpha, payload_json)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                datetime.now(timezone.utc), portfolio_id,
                rm.var95, rm.cvar95, rm.volatility, rm.beta, rm.sharpe, rm.alpha,
                response.model_dump_json(),
            )
            await conn.close()

        asyncio.run(_persist())

        logger.info("risk_worker: refreshed for portfolio=%s", portfolio_id)
        return {"status": "ok", "portfolio_id": portfolio_id}

    except Exception as exc:
        # No retry from here: the caller collects per-portfolio failures so one
        # broken portfolio does not abort the rest, and Celery's retry would
        # re-run the whole sweep for it.
        logger.exception("risk_worker: %s failed — %s", portfolio_id, exc)
        raise
