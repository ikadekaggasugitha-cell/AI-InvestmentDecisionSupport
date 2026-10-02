"""
Risk Worker — Phase 4

Celery task that refreshes portfolio risk metrics every hour during market hours.
Runs GARCH + historical simulation, writes result to Redis (TTL 3600s).
Also runs Kupiec backtest and logs breach rate to MLflow for model monitoring.
"""

import json
import logging
from datetime import datetime, timezone

from workers.celery_app import celery_app

from api.core.config import get_settings
from api.core.holdings import CAPITAL_IDR, PORTFOLIO_LOTS
from api.core.redis_client import REDIS_KEYS

logger = logging.getLogger(__name__)

# Holdings come from api/core/holdings so this worker measures the same
# portfolio the dashboard shows. It previously carried its own 7-symbol copy
# with different lot counts.


@celery_app.task(
    name="workers.risk_worker.refresh_risk",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def refresh_risk(self, portfolio_id: str = "default") -> dict:
    """
    Full risk refresh pipeline:
    1. Load 252-day OHLCV from TimescaleDB
    2. Run GARCH + historical simulation CVaR
    3. Compute sector exposure from live holdings
    4. Run Kupiec backtest on rolling 90-day window
    5. Write to Redis; persist to risk_snapshots table
    """
    settings = get_settings()

    if settings.use_mock_risk:
        logger.info("risk_worker: mock mode — skipping GARCH")
        return {"status": "skipped", "reason": "use_mock_risk=true"}

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
                    list(PORTFOLIO_LOTS),
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
        snapshot_json = r.get("market:snapshot:json")
        portfolio_value = CAPITAL_IDR
        if snapshot_json:
            snap = json.loads(snapshot_json)
            portfolio_value = snap.get("portfolioValue", portfolio_value)

        engine = RiskEngine(
            ohlcv=ohlcv,
            holdings=PORTFOLIO_LOTS,
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
        logger.exception("risk_worker: failed — %s", exc)
        raise self.retry(exc=exc)
