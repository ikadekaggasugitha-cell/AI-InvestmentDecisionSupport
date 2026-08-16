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
from api.core.redis_client import REDIS_KEYS

logger = logging.getLogger(__name__)

PORTFOLIO_HOLDINGS = {
    "BBCA": 1000, "BBRI": 2000, "BMRI": 500,
    "ADRO": 500,  "BREN": 200,  "ANTM": 1000, "TLKM": 500,
}


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
            rows = await conn.fetch(
                """
                SELECT symbol, time::date as date, close, volume, foreign_net,
                       sector
                FROM ohlcv
                LEFT JOIN idx_universe USING (symbol)
                WHERE time >= NOW() - INTERVAL '252 days'
                ORDER BY symbol, time
                """
            )
            ihsg_rows = await conn.fetch(
                """
                SELECT time::date as date, close
                FROM ohlcv WHERE symbol = '^JKSE'
                AND time >= NOW() - INTERVAL '252 days'
                ORDER BY time
                """
            )
            await conn.close()
            return (
                pd.DataFrame([dict(r) for r in rows]),
                pd.DataFrame([dict(r) for r in ihsg_rows]),
            )

        ohlcv, ihsg_df = asyncio.run(_fetch_ohlcv())

        r = sync_redis.from_url(settings.redis_url, decode_responses=True)
        snapshot_json = r.get("market:snapshot:json")
        portfolio_value = 12_480_000_000.0
        if snapshot_json:
            snap = json.loads(snapshot_json)
            portfolio_value = snap.get("portfolioValue", portfolio_value)

        ihsg_returns = (
            ihsg_df.set_index("date")["close"].pct_change().dropna()
            if not ihsg_df.empty else pd.Series(dtype=float)
        )

        engine = RiskEngine(
            ohlcv=ohlcv,
            holdings=PORTFOLIO_HOLDINGS,
            portfolio_value=portfolio_value,
            ihsg_returns=ihsg_returns,
        )
        response = engine.compute()

        # Kupiec backtest (last 90 days)
        if not ohlcv.empty:
            all_rets = ohlcv.set_index("date")["close"].pct_change().dropna()
            var_pct = response.risk.var95 / max(portfolio_value, 1)
            bt = kupiec_test(all_rets.tail(90), var_pct)
            logger.info("kupiec_backtest: p=%.4f passes=%s breach=%.2f%%",
                       bt["p_value"], bt["passes"], bt["breach_rate"] * 100)

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
