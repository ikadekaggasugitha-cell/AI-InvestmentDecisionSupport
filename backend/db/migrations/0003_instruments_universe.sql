-- Migration 0003 — the IDX instrument universe as a first-class table.
--
-- Until now the tradable universe lived only as hardcoded Python lists
-- (config.tracked_symbols = 15, bootstrap LIQUID_UNIVERSE = 45) and as the bare
-- `symbol` column on the time-series tables. There was no answer to "what is the
-- full board, with names and sectors?" other than "whatever we typed in".
--
-- This table is that answer: one row per listed IDX security, carrying the
-- metadata the exchange publishes (name, IDX-IC sector/sub-sector, industry,
-- listing board, listing date, listed shares). It is a plain dimension table,
-- NOT a hypertable — it has no time axis and is refreshed in place by
-- workers/instruments_worker.py from IDX GetCompanyProfiles.
--
-- Durability by design: the refresh is UPSERT-ONLY and never DELETEs. A failed
-- or partial IDX fetch can only leave rows unchanged, never wipe the universe —
-- so once populated, the app keeps its full stock list even if IDX is briefly
-- unreachable. Securities that vanish from the feed are flagged is_active=false,
-- not removed, so history and watchlists that reference them still resolve.
--
-- Fresh installs also get this table from schema.sql; this file migrates an
-- existing database. Idempotent: safe to re-run.
--
--   python -m db.migrate

BEGIN;

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
    -- is_active is our own flag, not IDX's: TRUE while the security appears in the
    -- feed, flipped FALSE when it stops appearing (delisted / suspended long-term).
    -- Kept rather than deleted so referencing rows and watchlists still resolve.
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    source         TEXT        NOT NULL DEFAULT 'idx',
    first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sector filtering and the "active board only" browse list are the two hot reads.
CREATE INDEX IF NOT EXISTS idx_instruments_sector ON instruments (sector);
CREATE INDEX IF NOT EXISTS idx_instruments_active ON instruments (is_active) WHERE is_active;

COMMIT;
