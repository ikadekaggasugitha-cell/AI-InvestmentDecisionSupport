from functools import lru_cache
from typing import Annotated

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# List settings that accept a comma-separated string as well as JSON.
#
# NoDecode is required, not cosmetic: pydantic-settings JSON-decodes complex
# fields inside EnvSettingsSource, BEFORE any validator runs. Without it,
# CORS_ORIGINS=https://aidss.example.com raised SettingsError at import and a
# `mode="before"` validator never got the chance to see the value.
CommaList = Annotated[list[str], NoDecode]

DEV_JWT_SECRET = "dev-secret-change-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_env: str = "development"
    app_debug: bool = True
    app_port: int = 8000
    # Accepts either a comma-separated string or a JSON array — see the
    # validator below for why the plain form had to be supported.
    cors_origins: CommaList = ["http://localhost:5173", "http://localhost:3000"]

    # Auth
    jwt_secret_key: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60
    # Convenience for local work ONLY. api/core/auth.py short-circuits
    # get_current_user for EVERY route when this is true, so it must never
    # survive into production — enforced by _reject_unsafe_production below.
    auth_bypass: bool = True
    # Single-operator credential for the /v1/auth/token login endpoint. This is
    # a personal decision-support tool, not a multi-tenant service, so there is
    # no user store — one operator authenticates against these. Leave the
    # password blank to disable login (only AUTH_BYPASS access remains). Set a
    # strong AUTH_PASSWORD in any environment where AUTH_BYPASS=false.
    auth_username: str = "operator"
    auth_password: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Database
    database_url: str = "postgresql+asyncpg://aidss:aidss@localhost:5432/aidss"

    # Kafka
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_tick_topic: str = "idx.ticks.raw"
    kafka_group_id: str = "aidss-tick-consumer"

    # ── IDX market data feed ──────────────────────────────────────────────────
    #
    # "yahoo" returns REAL IDX prices but DELAYED — Yahoo self-declares
    # exchangeDataDelayedBy=10 (minutes) and labels the payload "Delayed Quote".
    # That is genuine market data, not simulated, but it is not real time.
    #
    # True real-time IDX requires a licensed feed: IDX PDPS, an authorised data
    # vendor, or a broker API. To add one, implement MarketDataProvider in
    # ingestor/providers/ and register it in get_provider(); nothing downstream
    # changes, and the delay the UI reports drops to whatever that feed declares.
    idx_feed_vendor: str = "yahoo"
    idx_feed_api_key: str = ""
    idx_feed_ws_url: str = ""

    # Poll cadence. Polling faster than the feed updates buys nothing and is how
    # a client earns a real rate limit: the previous 10s loop re-fetched a
    # 10-minute-delayed quote 60× per change.
    market_poll_interval_open_sec: int = 60
    market_poll_interval_closed_sec: int = 900
    # Slack beyond the vendor's declared delay before a quote is called stale.
    market_stale_tolerance_sec: int = 300

    # MLflow
    mlflow_tracking_uri: str = "http://localhost:5000"
    mlflow_experiment_name: str = "aidss-signals"

    # ── Feature flags ─────────────────────────────────────────────────────────
    #
    # Market, signals and risk all default to REAL.
    #
    # Signals need two things present or they fall back to clearly-labelled
    # seed data: a trained model in backend/models/ (build one with
    # `python -m ml.training.train_signals_v2`) and a populated `ohlcv` table.
    # The table is required because the model uses cross-sectional rank
    # features that cannot be reproduced from the fifteen displayed symbols
    # alone — they were fitted against the whole board.
    #
    # Every service now defaults to its REAL path and degrades to seed/empty
    # only when its data source is genuinely absent (no trained model, empty
    # `ohlcv` table, feed down) — never silently, and never as the default.
    use_mock_signals: bool = False    # REAL LightGBM inference when a model exists
    # A model keeps scoring indefinitely once trained, so nothing flagged one
    # that had gone stale. The signal *cache* refreshes every 15 min, but the
    # underlying model does not retrain itself — features drift and the fit ages.
    # Past this many days the model still serves (a stale model beats none) but
    # is reported stale in /health and logs a warning at load, so retraining is
    # visible rather than silently overdue. See ml/monitoring/drift_detector.py.
    model_max_age_days: int = 45
    use_mock_risk: bool = False       # REAL GARCH / CVaR on live returns
    use_mock_market: bool = False     # REAL IDX prices (delayed — see idx_feed_vendor)
    # REAL Black-Litterman + HRP over TimescaleDB price history + live signal
    # views. Falls back to the seed weights when `ohlcv` has < 120 trading days,
    # so a fresh deployment still answers while the backfill runs.
    use_mock_portfolio: bool = False

    # Broker Summary scraping — Phase 10
    #
    # Cadence is END-OF-DAY, once per symbol per session. Every consumer of this
    # data is a daily aggregate (net_lot_5d, net_lot_20d, top3_consistency), so
    # intraday polling would re-fetch an unchanged EOD publication ~78×/day and
    # buy nothing. At ~50 requests/day a proxy pool is unnecessary — it stays
    # supported for operators who need it, but is no longer required to run.
    #
    # REAL by default: reads the `broker_summary` table populated by
    # workers.broksum_worker. Returns "no data" (not a 500, not synthetic rows)
    # until the scraper has run, so the endpoint is safe before the first fetch.
    use_mock_broksum: bool = False
    proxy_pool_api_key: str = ""             # optional; blank = direct requests
    proxy_pool_provider: str = "scraperapi"  # scraperapi | brightdata | smartproxy
    broksum_scrape_source: str = "idx"       # idx | rti | both
    broksum_request_delay_sec: float = 2.0   # polite fixed delay between symbols
    broksum_max_concurrency: int = 2         # keep load on the source trivial
    broksum_user_agents: CommaList = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
    ]

    # Technical Analysis — Phase 10
    ta_sr_method: str = "fractal"            # fractal | pivot | both
    ta_gap_threshold_pct: float = 1.0        # minimum gap % to detect
    ta_gap_lookback_days: int = 252          # 1 year for gap fill probability
    # Bounds on any derived stop loss, as a % below entry.
    #   max — a stop wider than this is not risk control, it is a hope.
    #   min — a stop this tight is inside daily noise and will be taken out by
    #         ordinary intraday movement rather than by the thesis failing.
    # Outside either bound the signal reports no stop at all rather than one
    # that cannot do its job.
    ta_max_stop_loss_pct: float = 8.0
    ta_min_stop_loss_pct: float = 1.5

    # Daily OHLCV backfill — Phase 10
    # Every price-action feature reads daily bars from the `ohlcv` hypertable.
    # Nothing else in the stack writes them (tick_aggregator only feeds Redis),
    # so this worker is the sole source of the history TA depends on.
    ohlcv_backfill_days: int = 400           # must exceed ta_gap_lookback_days
    ohlcv_vendor_suffix: str = ".JK"         # yfinance ticker suffix for IDX

    # ── Universes ─────────────────────────────────────────────────────────────
    #
    # Two distinct lists, because they answer different questions.
    #
    # `tracked_symbols` is the UI universe: what the dashboard, watchlist and
    # advisor cards display. Small on purpose.
    #
    # `model_universe_*` is the TRAINING universe. Fifteen symbols is far too
    # thin to fit anything — roughly 6k rows against 15 features. IDX publishes
    # ~950 instruments per session with three years of history, so the model
    # trains on a real cross-section while the UI stays focused.
    tracked_symbols: CommaList = [
        "BBCA", "BBRI", "BMRI", "TLKM", "ASII", "GOTO", "BREN", "ADRO",
        "UNVR", "ICBP", "ANTM", "PTBA", "KLBF", "SMGR", "EMTK",
    ]

    # "liquidity" derives the universe from traded value in the `ohlcv` table.
    # "static" uses model_universe_static verbatim.
    #
    # Liquidity is the default because LQ45 is reconstituted twice a year and a
    # hardcoded membership list goes stale silently — the code keeps running and
    # simply trains on the wrong names. Ranking by traded value reproduces
    # roughly the same set and cannot drift out of date.
    model_universe_mode: str = "liquidity"     # liquidity | static
    model_universe_size: int = 45
    # Minimum median daily traded value (IDR) to be eligible. Excludes dormant
    # counters whose flat prices teach the model that nothing ever moves.
    model_universe_min_value_idr: float = 5_000_000_000.0
    # Used when model_universe_mode="static". Kept empty rather than filled with
    # a snapshot of LQ45 that would rot; set it explicitly if you want a fixed list.
    model_universe_static: CommaList = []

    # ── Macro inputs ──────────────────────────────────────────────────────────
    #
    # BI 7-Day Reverse Repo Rate. Bank Indonesia publishes this as an HTML page,
    # not an API, so a scraper would be fragile in a way that fails silently.
    # The rate changes about eight times a year at the RDG announcement — a
    # config line updated by hand is more reliable than a parser that breaks
    # without anyone noticing.
    #
    # Format: "YYYY-MM-DD:rate", effective-date ascending. Update after each RDG.
    bi_rate_schedule: CommaList = [
        "2024-01-17:6.00",
        "2024-04-24:6.25",
        "2024-09-18:6.00",
        "2024-10-16:6.00",
        "2025-01-15:5.75",
        "2025-05-21:5.50",
        "2025-07-16:5.25",
        "2025-09-17:5.00",
        "2026-01-21:4.75",
    ]
    # USD/IDR ticker on the quote provider.
    usdidr_symbol: str = "IDR=X"

    # Claude API — Phase 7
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-4-6"
    claude_max_tokens: int = 2048

    # Observability — Phase 8
    metrics_enabled: bool = True
    sentry_dsn: str = ""

    # Rate limiting
    #
    # Closes the open-API abuse surface and, more importantly, caps the LLM cost
    # exposure on the advisor endpoint. Keyed by client IP because there is no
    # user store yet (see GAP-04); revisit once tokens carry a stable subject.
    #
    # Storage is in-process (memory://) so a Redis outage cannot start rejecting
    # requests — the limiter fails open. This bounds a single API process; a
    # multi-instance deployment must move to shared (Redis) storage to enforce a
    # global budget.
    rate_limit_enabled: bool = True
    rate_limit_default: str = "120/minute"   # applied to every route
    rate_limit_advisor: str = "10/minute"    # tighter — each call fans out to Claude

    # ── Validators ────────────────────────────────────────────────────────────

    @field_validator("cors_origins", "tracked_symbols", "model_universe_static",
                     "bi_rate_schedule", "broksum_user_agents", mode="before")
    @classmethod
    def _split_comma_list(cls, value: object) -> object:
        """
        Accept `A,B,C` as well as `["A","B","C"]` for list settings.

        pydantic-settings parses list fields as JSON, so the intuitive
        `CORS_ORIGINS=https://aidss.example.com` raised SettingsError and the
        application refused to start — with no hint that a JSON array was
        required, and the field absent from .env.example entirely. An operator
        deploying the frontend anywhere other than localhost hit this first.
        """
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text:
            return []

        # NoDecode disabled pydantic's own JSON handling, so this validator owns
        # both forms. Handing a JSON string back for pydantic to parse fails with
        # "Input should be a valid list".
        if text[0] == "[":
            import json

            try:
                parsed = json.loads(text)
            except ValueError:
                pass
            else:
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed]

        return [part.strip() for part in text.split(",") if part.strip()]

    @model_validator(mode="after")
    def _reject_unsafe_production(self) -> "Settings":
        """
        Refuse to boot with development credentials in production.

        `APP_ENV=production` previously only hid /docs and /redoc, which reads
        like a hardening step while `AUTH_BYPASS=true` — the default — left
        every endpoint open, and the JWT secret stayed at its published literal.
        Failing at startup is the point: an unauthenticated financial API that
        starts successfully is worse than one that refuses to.
        """
        if self.app_env != "production":
            return self

        problems: list[str] = []
        if self.auth_bypass:
            problems.append(
                "AUTH_BYPASS=true — every endpoint would accept unauthenticated "
                "requests as 'dev-user'. Set AUTH_BYPASS=false."
            )
        if self.jwt_secret_key == DEV_JWT_SECRET:
            problems.append(
                "JWT_SECRET_KEY is still the published development default, so "
                "anyone can mint a valid token. Set a random secret."
            )
        if self.app_debug:
            problems.append("APP_DEBUG=true leaks internals in error responses.")

        if problems:
            raise ValueError(
                "refusing to start with APP_ENV=production:\n  - "
                + "\n  - ".join(problems)
            )
        return self

    # Derived
    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def has_claude(self) -> bool:
        return bool(self.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
