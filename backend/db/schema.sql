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

-- ── Instrument universe (dimension table) ────────────────────────────────────
-- One row per listed IDX security, with the metadata the exchange publishes.
-- NOT a hypertable: no time axis, refreshed in place by the instruments worker
-- from IDX GetCompanyProfiles. The refresh is upsert-only and never deletes, so
-- a failed IDX fetch can never wipe the universe; vanished securities are flagged
-- is_active=false instead of removed. See db/migrations/0003 for the rationale.
CREATE TABLE IF NOT EXISTS instruments (
    symbol         TEXT        PRIMARY KEY,   -- bare IDX code, e.g. 'BBCA'
    name           TEXT,                      -- NamaEmiten, full company name
    sector         TEXT,                      -- Sektor  (IDX-IC top level, 11 sectors)
    sub_sector     TEXT,                      -- SubSektor
    industry       TEXT,                      -- Industri
    sub_industry   TEXT,                      -- SubIndustri
    board          TEXT,                      -- PapanPencatatan (Utama, Pengembangan, …)
    listing_date   DATE,                      -- TanggalPencatatan
    listed_shares  BIGINT,                    -- shares outstanding, for market cap
    status         TEXT,                      -- raw IDX Status code, kept for audit
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    source         TEXT        NOT NULL DEFAULT 'idx',
    first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_instruments_sector ON instruments (sector);
CREATE INDEX IF NOT EXISTS idx_instruments_active ON instruments (is_active) WHERE is_active;

-- ── Identity (accounts, sessions, access periods) ────────────────────────────
-- Everything below is Phase 1 of the multi-user work. Fresh installs get these
-- tables here; existing databases get them from migrations/0005. Both files must
-- agree, because the db-init service only ever runs this one — a table that
-- exists solely in migrations/ never appears in a rebuilt stack.
--
-- See ADR-0001, ADR-0002, ADR-0004, ADR-0005 and docs/status.md.

-- One person. Carries nothing about payment on purpose: role answers "may this
-- person use the system" and a Subscription answers "may this person use the
-- paid data". Those are computed separately, so an expired subscriber is still a
-- valid account rather than a broken one.
--
-- No system account is seeded anywhere. This file is applied on every
-- `docker compose up`, so a credential written here would be copied into every
-- install and could never be rotated.
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,   -- Argon2id, never a plaintext password
    full_name     VARCHAR(150) NOT NULL,
    phone_number  VARCHAR(30)  NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    blocked_at    TIMESTAMPTZ,             -- NULL = not blocked. Set in Phase 4.
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Uniqueness on lower(email), not on email: without this, `User@aidss.id` and
-- `user@aidss.id` become two accounts, two sessions and two portfolios.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- Replaces the JWT. The cookie carries 64 random hex characters; this stores
-- SHA-256 of that value so database read access does not hand over live
-- sessions. Deleting rows revokes every device at once, so there is no
-- revoked_at column.
CREATE TABLE IF NOT EXISTS sessions (
    id         VARCHAR(64) PRIMARY KEY,     -- sha-256(token), hex
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Gate 2 consent, recorded server-side so the acceptance can be evidenced rather
-- than only remembered by a browser. `version` records which wording was accepted,
-- so an acceptance of the previous text stays readable after the text changes.
CREATE TABLE IF NOT EXISTS consent_acceptances (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version     VARCHAR(32) NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_acceptances (user_id, accepted_at DESC);

-- One row per purchased period, never mutated, and with no status column: access
-- is derived from expires_at, and payment state belongs to `transactions` in
-- Phase 2. A stored status would be a second source of truth for one fact, and
-- the beat job that kept it current was exactly the thing being removed.
CREATE TABLE IF NOT EXISTS subscriptions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

-- Serves the access check `MAX(expires_at) WHERE expires_at > NOW()`. A partial
-- unique index on "currently active" is impossible: predicates must be IMMUTABLE
-- and NOW() is STABLE.
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_access
    ON subscriptions (user_id, expires_at DESC);

-- ── Portfolios (ownable rows) ────────────────────────────────────────────────
-- A portfolio is a real row so ownership can be enforced. Before this, every
-- portfolio-scoped endpoint took its identity from a query parameter any caller
-- could set, and Redis keys were the only place a portfolio existed — so there
-- was nothing to check access against. See db/migrations/0004 for the rationale.
--
-- user_id is the owner, and it is NOT NULL. owner_sub is gone: it was the JWT
-- subject, an opaque session carries a user_id instead, and a string that cannot
-- be written is a string that cannot be checked. Migrations 0005 added the column
-- and 0006 retired the old one; see ADR-0002.
--
-- Both indexes key on user_id. uq_portfolios_one_default is what makes
-- find-or-create of a default portfolio a single statement (portfolio_access.py),
-- so it has to guard the column that is actually written.
-- Plain dimension table — no time axis, updated in place.
CREATE TABLE IF NOT EXISTS portfolios (
    id          TEXT        PRIMARY KEY,        -- e.g. 'pf_3f9c1a2b4d5e'
    user_id     UUID        NOT NULL REFERENCES users(id),
    name        TEXT        NOT NULL DEFAULT 'Default',
    lots_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- {symbol: {lots, avgPrice}}
    is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Lets auto-provisioning find-or-create a default in one statement instead of
-- counting rows, and keeps two concurrent first requests from creating two.
CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolios_one_default
    ON portfolios (user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios (user_id);

-- ── Signal outputs (immutable audit log) ─────────────────────────────────────
-- NOTE: on a hypertable every unique index must contain the partitioning
-- column, so the surrogate key is composite (generated_at, id). A bare
-- `id BIGSERIAL PRIMARY KEY` makes create_hypertable() fail and the table
-- silently stays a plain Postgres table with no retention or compression.
CREATE TABLE IF NOT EXISTS signals (
    id               BIGSERIAL    NOT NULL,
    generated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    symbol           TEXT         NOT NULL,
    uprob            SMALLINT     CHECK (uprob BETWEEN 0 AND 100),
    confidence       SMALLINT     CHECK (confidence BETWEEN 0 AND 100),
    -- Probability tier, not a trade instruction. The former values
    -- ('STRONG BUY','BUY','HOLD','SELL') read as buy/sell commands to anyone
    -- reading the schema, which conflicts with CMP-01 (GAP-01). See
    -- db/migrations/0001_signals_probability_tier.sql for existing databases.
    probability_tier TEXT         CHECK (probability_tier IN ('VERY_HIGH','HIGH','NEUTRAL','LOW')),
    model_version    TEXT         NOT NULL,
    model_score      NUMERIC(5,2),
    shap_json        JSONB,
    features_json    JSONB,       -- feature values used at inference time
    PRIMARY KEY (generated_at, id)
);

SELECT create_hypertable('signals', 'generated_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_time ON signals (symbol, generated_at DESC);
-- Idempotent audit writes: the signal worker upserts one batch per run keyed on
-- (symbol, generated_at); a Celery retry must not double-insert (GAP-09).
CREATE UNIQUE INDEX IF NOT EXISTS uq_signals_symbol_time ON signals (symbol, generated_at);

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
