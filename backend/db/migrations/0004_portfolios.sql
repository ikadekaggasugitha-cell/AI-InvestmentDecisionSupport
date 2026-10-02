-- Migration 0004 — portfolios, and who owns them.
--
-- /v1/risk/portfolio, /v1/portfolio/optimise, /v1/alerts and the advisor chat all
-- took a portfolio identity from a QUERY PARAMETER (portfolio_id / uid) that any
-- authenticated caller could set to any value. current_user.sub was logged and
-- otherwise ignored, so one authorised caller could read another portfolio's
-- risk metrics, allocation and alerts. There was no table to check ownership
-- against because no portfolio was a row anywhere — Redis keys were the only
-- place a portfolio existed, and Redis holds no notion of who asked.
--
-- This table makes a portfolio a first-class, ownable row so access can be
-- checked. api/services/portfolio_access.py is the only sanctioned way in.
--
-- owner_sub is TEXT, not a UUID foreign key. The token subject is
-- TokenPayload.sub, and the `users` table in the SaaS PRD
-- (docs/saas-subscription-platform.md, migration 0005) does not exist yet.
--
-- WHEN 0005 LANDS, do not drop owner_sub — add the key alongside it, backfill,
-- then retire the text column in a later migration. Concretely:
--
--   -- 0006_portfolios_user_id.sql, after 0005 has created `users`
--   --   id UUID PRIMARY KEY DEFAULT gen_random_uuid()
--   ALTER TABLE portfolios ADD COLUMN user_id UUID REFERENCES users(id);
--   UPDATE portfolios p
--      SET user_id = u.id
--     FROM users u
--     WHERE u.email = p.owner_sub;          -- owner_sub held AUTH_USERNAME,
--                                            -- which becomes the user's email
--   -- then: read/writes move to user_id, and owner_sub is dropped only after
--   -- every deployed principal has a matching users row. Keep it until then:
--   -- the dev-bypass principal ("dev-user") has no account and would otherwise
--   -- lose its portfolios.
--
-- So the columns are additive, not a replacement, and the transition spans at
-- least one further migration. Plan for that rather than assuming 0005 alone is
-- enough.
--
-- lots_json holds {symbol: lots} so a portfolio is a real position set rather
-- than a cache key. It is seeded from api/core/holdings.PORTFOLIO_LOTS on
-- auto-provision, which is why a single-operator install keeps the same seeded
-- portfolio it had before this table existed.
--
-- Plain dimension table, not a hypertable: no time axis, updated in place.
-- Fresh installs also get this table from schema.sql; this file migrates an
-- existing database. Idempotent: safe to re-run.
--
--   python -m db.migrate

BEGIN;

CREATE TABLE IF NOT EXISTS portfolios (
    id          TEXT        PRIMARY KEY,        -- e.g. 'pf_3f9c1a2b4d5e'
    owner_sub   TEXT        NOT NULL,           -- TokenPayload.sub
    name        TEXT        NOT NULL DEFAULT 'Default',
    lots_json   JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- {symbol: lots}
    -- Exactly one default per owner, enforced by the partial unique index below
    -- so auto-provisioning can rely on it rather than counting rows.
    is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A partial unique index is what makes "find my default portfolio" an
-- INSERT ... ON CONFLICT DO NOTHING one-liner: two concurrent first requests
-- for a brand-new principal cannot both create a default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolios_one_default
    ON portfolios (owner_sub) WHERE is_default;

-- Owner lookup for the ownership check on every portfolio-scoped request.
CREATE INDEX IF NOT EXISTS idx_portfolios_owner ON portfolios (owner_sub);

COMMIT;
