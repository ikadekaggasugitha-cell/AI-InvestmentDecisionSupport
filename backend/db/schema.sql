-- AIDSS TimescaleDB Schema
-- Run once against a fresh PostgreSQL/TimescaleDB instance.
-- docker exec -i aidss_timescaledb_1 psql -U aidss aidss < db/schema.sql

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── OHLCV time-series ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv (
    time        TIMESTAMPTZ  NOT NULL,
    symbol      TEXT         NOT NULL,
    open        NUMERIC(14,2),
    high        NUMERIC(14,2),
    low         NUMERIC(14,2),
    close       NUMERIC(14,2),
    volume      BIGINT,
    foreign_net NUMERIC(20,2),  -- foreign_buy - foreign_sell, in shares

    -- ── IDX first-party fields ────────────────────────────────────────────
    -- Present only when the row came from IDX GetStockSummary. Yahoo publishes
    -- none of these, so they are NULL on Yahoo-sourced rows — and NULL is the
    -- honest value: 0.0 would be indistinguishable from a genuine zero-flow
    -- session, which is a real and different thing.
    foreign_buy   BIGINT,        -- shares bought by foreign participants
    foreign_sell  BIGINT,        -- shares sold by foreign participants
    listed_shares BIGINT,        -- enables real market cap, not a hardcoded string
    frequency     INTEGER,       -- trade count; a liquidity signal volume misses
    value_idr     NUMERIC(24,2), -- traded value; drives model universe selection
    -- Which feed produced this row. Without it a mixed-source table cannot be
    -- audited, and a reconciliation mismatch cannot be attributed.
    source        TEXT,          -- 'idx' | 'yahoo'

    -- Idempotency: lets the daily backfill re-run with ON CONFLICT DO UPDATE
    -- instead of duplicating bars. Includes `time` so create_hypertable accepts it.
    UNIQUE (time, symbol)
);

SELECT create_hypertable('ohlcv', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol_time ON ohlcv (symbol, time DESC);

-- 1-day continuous aggregate for portfolio history chart
CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    symbol,
    first(open,  time) AS open,
    max(high)          AS high,
    min(low)           AS low,
    last(close,  time) AS close,
    sum(volume)        AS volume,
    sum(foreign_net)   AS foreign_net
FROM ohlcv
GROUP BY bucket, symbol
WITH NO DATA;

SELECT add_continuous_aggregate_policy('ohlcv_daily',
    start_offset => INTERVAL '7 days',
    end_offset   => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- ── Signal outputs (immutable audit log) ─────────────────────────────────────
-- NOTE: on a hypertable every unique index must contain the partitioning
-- column, so the surrogate key is composite (generated_at, id). A bare
-- `id BIGSERIAL PRIMARY KEY` makes create_hypertable() fail and the table
-- silently stays a plain Postgres table with no retention or compression.
CREATE TABLE IF NOT EXISTS signals (
    id            BIGSERIAL    NOT NULL,
    generated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    symbol        TEXT         NOT NULL,
    uprob         SMALLINT     CHECK (uprob BETWEEN 0 AND 100),
    confidence    SMALLINT     CHECK (confidence BETWEEN 0 AND 100),
    action        TEXT         CHECK (action IN ('STRONG BUY','BUY','HOLD','SELL')),
    model_version TEXT         NOT NULL,
    model_score   NUMERIC(5,2),
    shap_json     JSONB,
    features_json JSONB,       -- feature values used at inference time
    PRIMARY KEY (generated_at, id)
);

SELECT create_hypertable('signals', 'generated_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_time ON signals (symbol, generated_at DESC);

-- ── Risk snapshots ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_snapshots (
    id             BIGSERIAL    NOT NULL,
    computed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    portfolio_id   TEXT         NOT NULL DEFAULT 'default',
    var95          NUMERIC(20,2),
    cvar95         NUMERIC(20,2),
    volatility     NUMERIC(8,4),
    beta           NUMERIC(8,4),
    sharpe         NUMERIC(8,4),
    alpha          NUMERIC(8,4),
    payload_json   JSONB,       -- full RiskMetricsResponse
    PRIMARY KEY (computed_at, id)
);

SELECT create_hypertable('risk_snapshots', 'computed_at', if_not_exists => TRUE);

-- ── Sentiment cache (append-only) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sentiment_scores (
    id          BIGSERIAL    PRIMARY KEY,
    scored_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    doc_hash    TEXT         NOT NULL UNIQUE,
    symbol      TEXT,
    source      TEXT,         -- 'bei_disclosure' | 'news_rss'
    score       NUMERIC(5,4), -- -1.0 to 1.0
    confidence  NUMERIC(5,4),
    raw_text    TEXT
);

-- ── Broker Summary (Phase 10) ────────────────────────────────────────────────
-- Per-broker buy/sell lot data scraped from IDX.co.id / RTI Business
CREATE TABLE IF NOT EXISTS broker_summary (
    time            TIMESTAMPTZ    NOT NULL,
    symbol          TEXT           NOT NULL,
    broker_code     TEXT           NOT NULL,
    buy_lot         BIGINT         DEFAULT 0,
    sell_lot        BIGINT         DEFAULT 0,
    buy_val         NUMERIC(20,2)  DEFAULT 0,
    sell_val        NUMERIC(20,2)  DEFAULT 0,
    net_lot         BIGINT         DEFAULT 0,
    net_val         NUMERIC(20,2)  DEFAULT 0,
    avg_buy_price   NUMERIC(14,2),
    avg_sell_price  NUMERIC(14,2),
    -- One row per broker per symbol per session. Celery runs with
    -- acks_late=True, so a retried task MUST NOT double-count lots:
    -- the worker upserts on this key.
    UNIQUE (time, symbol, broker_code)
);

SELECT create_hypertable('broker_summary', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_broksum_symbol_time  ON broker_summary (symbol, time DESC);
CREATE INDEX IF NOT EXISTS idx_broksum_broker_time  ON broker_summary (broker_code, time DESC);
CREATE INDEX IF NOT EXISTS idx_broksum_symbol_broker ON broker_summary (symbol, broker_code, time DESC);

-- ── Gap Events (Phase 10) ────────────────────────────────────────────────────
-- Detected price gaps (>1%) with fill tracking
-- `detected_at` is the SESSION THE GAP OPENED ON (bar timestamp), not the
-- wall-clock time of detection — otherwise every re-scan inserts a duplicate
-- row for the same gap and the unique key below can never fire.
CREATE TABLE IF NOT EXISTS gap_events (
    id               BIGSERIAL      NOT NULL,
    detected_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    symbol           TEXT           NOT NULL,
    gap_type         TEXT           CHECK (gap_type IN ('gap_up', 'gap_down')),
    gap_pct          NUMERIC(8,4),
    gap_top          NUMERIC(14,2),
    gap_bottom       NUMERIC(14,2),
    is_filled        BOOLEAN        DEFAULT FALSE,
    filled_at        TIMESTAMPTZ,
    fill_probability NUMERIC(5,4),
    PRIMARY KEY (detected_at, id),
    UNIQUE (detected_at, symbol, gap_type)
);

SELECT create_hypertable('gap_events', 'detected_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_gap_symbol_time ON gap_events (symbol, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_gap_unfilled    ON gap_events (symbol) WHERE is_filled = FALSE;

-- ── Support / Resistance Levels Cache (Phase 10) ─────────────────────────────
-- Pure cache. `computed_at` is truncated to the session date by the worker so
-- a re-run of the same day upserts in place rather than growing the table.
CREATE TABLE IF NOT EXISTS sr_levels (
    id          BIGSERIAL      NOT NULL,
    computed_at TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    symbol      TEXT           NOT NULL,
    level_type  TEXT           CHECK (level_type IN ('support', 'resistance')),
    price       NUMERIC(14,2)  NOT NULL,
    strength    SMALLINT       CHECK (strength BETWEEN 1 AND 5),
    method      TEXT,          -- 'fractal' | 'pivot' | 'volume_profile'
    PRIMARY KEY (computed_at, id),
    UNIQUE (computed_at, symbol, level_type, price)
);

SELECT create_hypertable('sr_levels', 'computed_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_sr_symbol_time ON sr_levels (symbol, computed_at DESC);

-- ── Data retention policies (TimescaleDB) ────────────────────────────────────
-- `ohlcv` holds the daily bars written by workers/ohlcv_worker.py. Retention
-- must exceed TA_GAP_LOOKBACK_DAYS (252 trading days ≈ 365 calendar days) or
-- gap-fill probability silently runs on a truncated sample. 400d gives headroom.
-- The ohlcv_daily continuous aggregate cannot substitute here: its refresh
-- policy only covers start_offset => 7 days, so historical backfill never
-- lands in it unless refresh_continuous_aggregate() is called explicitly.
SELECT add_retention_policy('ohlcv', INTERVAL '400 days', if_not_exists => TRUE);
SELECT add_retention_policy('signals', INTERVAL '365 days', if_not_exists => TRUE);
SELECT add_retention_policy('broker_summary', INTERVAL '180 days', if_not_exists => TRUE);
SELECT add_retention_policy('gap_events', INTERVAL '365 days', if_not_exists => TRUE);
SELECT add_retention_policy('sr_levels', INTERVAL '90 days', if_not_exists => TRUE);
