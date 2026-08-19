-- Migration 0001 — GAP-01: signals.action → signals.probability_tier
--
-- Replaces the trade-instruction vocabulary (STRONG BUY / BUY / HOLD / SELL)
-- with probability tiers (VERY_HIGH / HIGH / NEUTRAL / LOW). The literal values
-- sat in the public OpenAPI schema and in this CHECK constraint, where they
-- read as buy/sell commands and conflict with CMP-01.
--
-- Fresh installs get the new shape directly from schema.sql. This file migrates
-- an EXISTING database and rewrites the rows already stored. Idempotent: safe
-- to re-run.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_signals_probability_tier.sql

BEGIN;

-- 1. Add the new column (nullable during backfill).
ALTER TABLE signals ADD COLUMN IF NOT EXISTS probability_tier TEXT;

-- 2. Backfill from the old column if it is still present.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'signals' AND column_name = 'action'
    ) THEN
        UPDATE signals
        SET probability_tier = CASE action
            WHEN 'STRONG BUY' THEN 'VERY_HIGH'
            WHEN 'BUY'        THEN 'HIGH'
            WHEN 'HOLD'       THEN 'NEUTRAL'
            WHEN 'SELL'       THEN 'LOW'
            ELSE probability_tier
        END
        WHERE probability_tier IS NULL;

        ALTER TABLE signals DROP COLUMN action;
    END IF;
END $$;

-- 3. Enforce the tier vocabulary. Dropped-and-recreated so a re-run is clean.
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_probability_tier_check;
ALTER TABLE signals
    ADD CONSTRAINT signals_probability_tier_check
    CHECK (probability_tier IN ('VERY_HIGH', 'HIGH', 'NEUTRAL', 'LOW'));

COMMIT;
