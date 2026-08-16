from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_env: str = "development"
    app_debug: bool = True
    app_port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Auth
    jwt_secret_key: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60
    auth_bypass: bool = True  # Disable JWT in dev

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
    # `use_mock_market=False` is the default: quotes and daily bars come from
    # the real IDX feed. The others stay mocked because they depend on artefacts
    # that do not exist in a fresh checkout — a trained LightGBM model, a fitted
    # GARCH, and a real portfolio ledger. Flipping those on without the
    # artefacts produces errors, not better data.
    use_mock_signals: bool = True
    use_mock_risk: bool = True
    use_mock_market: bool = False     # REAL IDX prices (delayed — see idx_feed_vendor)
    use_mock_portfolio: bool = True   # Phase 6

    # Broker Summary scraping — Phase 10
    #
    # Cadence is END-OF-DAY, once per symbol per session. Every consumer of this
    # data is a daily aggregate (net_lot_5d, net_lot_20d, top3_consistency), so
    # intraday polling would re-fetch an unchanged EOD publication ~78×/day and
    # buy nothing. At ~50 requests/day a proxy pool is unnecessary — it stays
    # supported for operators who need it, but is no longer required to run.
    use_mock_broksum: bool = True
    proxy_pool_api_key: str = ""             # optional; blank = direct requests
    proxy_pool_provider: str = "scraperapi"  # scraperapi | brightdata | smartproxy
    broksum_scrape_source: str = "idx"       # idx | rti | both
    broksum_request_delay_sec: float = 2.0   # polite fixed delay between symbols
    broksum_max_concurrency: int = 2         # keep load on the source trivial
    broksum_user_agents: list[str] = [
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
    tracked_symbols: list[str] = [
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
    model_universe_static: list[str] = []

    # ── Macro inputs ──────────────────────────────────────────────────────────
    #
    # BI 7-Day Reverse Repo Rate. Bank Indonesia publishes this as an HTML page,
    # not an API, so a scraper would be fragile in a way that fails silently.
    # The rate changes about eight times a year at the RDG announcement — a
    # config line updated by hand is more reliable than a parser that breaks
    # without anyone noticing.
    #
    # Format: "YYYY-MM-DD:rate", effective-date ascending. Update after each RDG.
    bi_rate_schedule: list[str] = [
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
