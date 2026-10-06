-- Migration 0006: retire owner_sub.
--
-- 0005 gave portfolios a real owner and made owner_sub nullable, because an
-- opaque session carries a user_id and nothing can write a token subject any
-- more. It left the column in place on purpose: 0004's own note (lines 18-36)
-- says to drop it only after every principal that has ever existed has a users
-- row, and that the transition spans more than one migration.
--
-- That condition is met now. The development bypass used to authenticate as the
-- literal string "dev-user", which had no account; it now resolves to a real
-- Account row (api/services/accounts.py, get_or_create_bypass_account), because
-- portfolios.user_id is a foreign key and a synthetic principal cannot own
-- anything. So the principal 0004 worried about has an identity after all, and
-- its portfolio can be given to it rather than left behind.
--
-- See ADR-0002. Idempotent: safe to re-run.
BEGIN;

-- ── Hand the dev-bypass principal's portfolio to its own account ─────────────
-- Not misattribution: "dev-user" and the AUTH_BYPASS account are the same person
-- on the same machine, which is exactly why the bypass resolves to a row at all.
-- The email is the documented default of Settings.auth_bypass_email; an install
-- that overrode it still has no dev-user rows to fix, because dev-user only ever
-- existed where the default was in force.
--
-- Guarded on the column still being there. A re-run against an already-migrated
-- database has no owner_sub to match, and referencing it there would abort the
-- whole transaction instead of being a no-op.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'portfolios' AND column_name = 'owner_sub'
    ) THEN
        EXECUTE $inner$
            UPDATE portfolios p
               SET user_id = u.id
              FROM users u
             WHERE p.user_id IS NULL
               AND p.owner_sub = 'dev-user'
               AND u.email = lower('operator@local.invalid')
        $inner$;
    END IF;
END
$$;

-- Anything still without an owner is a principal from an install this migration
-- cannot identify. Deleting it would silently discard someone's positions, and
-- inventing an owner would hand them to the wrong person, so the migration stops
-- and names them instead. Fresh installs have no such row and pass straight
-- through; a single-operator install has only the dev-user row handled above.
DO $$
DECLARE
    orphans TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'portfolios' AND column_name = 'owner_sub') THEN
        RETURN;   -- already migrated; there is nothing left that could be orphaned
    END IF;

    SELECT string_agg(DISTINCT coalesce(owner_sub, '(null)'), ', ')
      INTO orphans
      FROM portfolios
     WHERE user_id IS NULL;

    IF orphans IS NOT NULL THEN
        RAISE EXCEPTION
            'portfolios still have no owner: % . Resolve them by hand (UPDATE portfolios SET user_id = ''<uuid>'' WHERE id = ''<id>''), then re-run this migration. Nothing was dropped.', orphans;
    END IF;
END
$$;

-- ── Move the indexes onto the column that is actually written ───────────────
-- uq_portfolios_one_default is what makes find-or-create of a default portfolio
-- a single statement (portfolio_access.py). Left on owner_sub it would guard
-- nothing: with the column about to be dropped, every row's key would be NULL
-- and NULLs do not collide in a unique index.
DROP INDEX IF EXISTS uq_portfolios_one_default;
DROP INDEX IF EXISTS idx_portfolios_owner;

CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolios_one_default
    ON portfolios (user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios (user_id);

-- ── Drop the column that can no longer be written ───────────────────────────
ALTER TABLE portfolios DROP COLUMN IF EXISTS owner_sub;
ALTER TABLE portfolios ALTER COLUMN user_id SET NOT NULL;

COMMIT;