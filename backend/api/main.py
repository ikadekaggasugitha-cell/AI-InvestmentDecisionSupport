"""
AIDSS FastAPI Application — Entry Point

Exposes endpoints consumed by the React frontend:
  GET  /v1/signals              → AI trading signals (LightGBM + SHAP)
  GET  /v1/risk/portfolio       → Portfolio risk metrics (GARCH + CVaR)
  WS   /v1/ws/market            → Live market tick stream
  GET  /v1/portfolio/optimise   → Black-Litterman + HRP portfolio weights
  POST /v1/advisor/chat         → Claude-powered Q&A (SSE streaming)
  GET  /metrics                 → Prometheus metrics (Phase 8)
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import Depends, FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from api.core.auth import get_current_user
from api.core.config import get_settings
from api.core.rate_limit import limiter
from api.routers import (
    advisor, auth, broksum, market_ws, news, portfolio, risk, signals, technicals,
)

# ── Structured logging ────────────────────────────────────────────────────────

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    logger_factory=structlog.PrintLoggerFactory(),
)
logger = structlog.get_logger(__name__)


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

async def _market_poller_task():
    """
    Background loop refreshing the market snapshot from the configured feed.

    The cadence follows the exchange, not a fixed timer. IDX trades 09:00–16:00
    WIB on weekdays; outside those hours the last trade does not change, so
    polling at the intraday rate would issue thousands of requests a night for
    identical data. The previous 10-second loop was faster still — 60 requests
    per change against a feed Yahoo declares delayed by 10 minutes — which is
    how a client provokes the rate limiting it then has to work around.
    """
    from api.services.market_service import fetch_yahoo_market_data, is_market_open

    settings = get_settings()

    ok = await fetch_yahoo_market_data()
    if not ok:
        logger.warning(
            "market_feed_unavailable_at_startup",
            hint="snapshot serves placeholder values until a fetch succeeds; "
                 "check IDX_FEED_VENDOR and network egress",
        )

    consecutive_failures = 0
    while True:
        try:
            interval = (
                settings.market_poll_interval_open_sec
                if is_market_open()
                else settings.market_poll_interval_closed_sec
            )
            # Back off on sustained failure so an upstream outage does not turn
            # into a tight retry loop for its whole duration.
            if consecutive_failures:
                interval = min(interval * (2 ** min(consecutive_failures, 4)), 1800)

            await asyncio.sleep(interval)

            if await fetch_yahoo_market_data():
                consecutive_failures = 0
            else:
                consecutive_failures += 1
        except asyncio.CancelledError:
            break
        except Exception as exc:
            consecutive_failures += 1
            logger.warning("market_poller_task_error", error=str(exc))
            await asyncio.sleep(30.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(
        "aidss_api_starting",
        env=settings.app_env,
        mock_signals=settings.use_mock_signals,
        mock_risk=settings.use_mock_risk,
        mock_market=settings.use_mock_market,
        mock_portfolio=settings.use_mock_portfolio,
    )
    poller = asyncio.create_task(_market_poller_task())
    yield
    poller.cancel()
    try:
        await poller
    except asyncio.CancelledError:
        pass

    # Shared market-data providers hold HTTP sessions and cookie jars.
    from ingestor.providers import close_providers
    await close_providers()

    logger.info("aidss_api_shutdown")



# ── Application factory ───────────────────────────────────────────────────────

def create_app() -> FastAPI:
    settings = get_settings()

    # ── Sentry (Phase 8) ──────────────────────────────────────────────────────
    if settings.sentry_dsn:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            integrations=[FastApiIntegration()],
            environment=settings.app_env,
            traces_sample_rate=0.1,
            send_default_pii=False,
        )
        logger.info("sentry_initialised", dsn_prefix=settings.sentry_dsn[:20])

    app = FastAPI(
        title="AIDSS — AI Investment Decision Support System",
        description="""
## AIDSS Backend API

Provides AI-generated trading signals, portfolio risk metrics, and real-time
IDX market data for the AIDSS React frontend.

### OJK Compliance
All signal outputs are **probability scores** (0–100), not trading instructions.
Operators are required to display the OJK disclaimer before exposing signals to end users.

### Authentication
Pass a JWT Bearer token in the `Authorization` header.
Set `AUTH_BYPASS=true` in `.env` for development.
        """,
        version="1.0.0",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # CORS — allow frontend origin
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # ── Rate limiting ──────────────────────────────────────────────────────────
    # A global default applies to every route via the middleware; the advisor
    # endpoint adds a tighter per-route limit (see api/routers/advisor.py). The
    # ops endpoints below are exempted so an orchestrator's health probes are
    # never throttled. Limiter.enabled is driven by settings, so it can be
    # switched off wholesale in an environment that fronts its own limiter.
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    # Routers
    #
    # Every HTTP data router is guarded by get_current_user. The dependency was
    # defined but wired to nothing, so the API answered any caller regardless of
    # AUTH_BYPASS — the flag only ever gated /docs. Applying it here means that
    # with AUTH_BYPASS=false a valid bearer token is required; with the dev
    # default (true) get_current_user short-circuits to a dev principal so local
    # work and the mock-data tests are unaffected.
    #
    # market_ws is intentionally excluded: HTTPBearer cannot ride the WebSocket
    # handshake, so it authenticates via its own query-parameter token path.
    protected = [Depends(get_current_user)]
    app.include_router(auth.router)  # public: this is where tokens are issued
    app.include_router(signals.router, dependencies=protected)
    app.include_router(risk.router, dependencies=protected)
    app.include_router(market_ws.router)
    app.include_router(portfolio.router, dependencies=protected)
    app.include_router(advisor.router, dependencies=protected)
    app.include_router(broksum.router, dependencies=protected)
    app.include_router(technicals.router, dependencies=protected)
    app.include_router(news.router, dependencies=protected)

    # ── Prometheus metrics (Phase 8) ──────────────────────────────────────────
    if settings.metrics_enabled:
        from prometheus_fastapi_instrumentator import Instrumentator
        Instrumentator().instrument(app).expose(app, endpoint="/metrics")

    # ── Health ────────────────────────────────────────────────────────────────

    @app.get("/livez", tags=["ops"], summary="Liveness — is the process up")
    @limiter.exempt
    async def livez() -> dict[str, str]:
        """
        Process liveness only. Never fails while the event loop runs, so a
        restart policy driven by this will not thrash during a dependency
        outage — use /health for that.
        """
        return {"status": "ok", "version": "1.0.0"}

    @app.get("/health", tags=["ops"], summary="Readiness — are dependencies usable")
    @limiter.exempt
    async def health(response: Response) -> dict[str, object]:
        """
        Checks the dependencies the API actually needs, and returns 503 when a
        hard one is down.

        This used to be a static literal: it answered `{"status":"ok"}` while
        the database was unreachable, every endpoint 500'd and the market poller
        had never succeeded. Any load balancer or orchestrator reading it kept
        routing traffic to a service that could not serve a request.

        Redis is SOFT — it is a cache, and the services degrade to uncached
        reads. The database is HARD for signals and risk. A stale market feed is
        reported but does not fail the check, because it is legitimately stale
        outside trading hours.
        """
        from api.core.redis_client import get_redis
        from api.services.market_service import generate_snapshot

        checks: dict[str, object] = {}
        degraded = False
        unhealthy = False

        # Redis — soft.
        try:
            async with get_redis() as r:
                await r.ping()
            checks["redis"] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks["redis"] = f"unavailable: {type(exc).__name__}"
            degraded = True

        # Database — hard whenever real signals or risk are expected.
        db_required = not (settings.use_mock_signals and settings.use_mock_risk)
        try:
            import asyncpg

            conn = await asyncpg.connect(
                settings.database_url.replace("postgresql+asyncpg://", "postgresql://"),
                timeout=4,
            )
            try:
                bars = await conn.fetchval("SELECT count(*) FROM ohlcv")
            finally:
                await conn.close()
            checks["database"] = "ok"
            checks["ohlcv_rows"] = int(bars or 0)
            if not bars and db_required:
                checks["database"] = "reachable but `ohlcv` is empty — run backfill_ohlcv"
                degraded = True
        except Exception as exc:  # noqa: BLE001
            checks["database"] = f"unavailable: {type(exc).__name__}"
            if db_required:
                unhealthy = True
            else:
                degraded = True

        # Trained model — required only when serving real signals.
        model_dir = Path(__file__).parent.parent / "models"
        models = sorted(model_dir.glob("lgbm_signals_*.pkl")) if model_dir.is_dir() else []
        checks["model"] = models[-1].name if models else "absent"
        if not models and not settings.use_mock_signals:
            checks["model"] = "absent — run `python -m ml.training.train_signals_v2`"
            degraded = True

        # Market feed freshness — reported, never fatal.
        try:
            snap = generate_snapshot()
            checks["market_source"] = snap.dataSource
            checks["market_age_seconds"] = snap.dataAgeSeconds
            if snap.dataSource == "placeholder":
                degraded = True
        except Exception as exc:  # noqa: BLE001
            checks["market_source"] = f"error: {type(exc).__name__}"
            degraded = True

        # Not named `status`: that shadows the imported fastapi.status module
        # and the next line then raises AttributeError on a str.
        overall = "unhealthy" if unhealthy else ("degraded" if degraded else "ok")
        if unhealthy:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

        return {"status": overall, "version": "1.0.0", "checks": checks}

    return app


app = create_app()
