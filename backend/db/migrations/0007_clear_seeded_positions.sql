-- Clear the seeded portfolio from every existing row (ADR-0005).
--
-- Why this has to be a migration rather than a code change: the seeding happened
-- in portfolio_access, so stopping it there stops new rows and does nothing for
-- the rows already written. Every portfolio that exists today holds the same ten
-- IDX positions, because they were all seeded from api/core/holdings.PORTFOLIO_LOTS
-- on creation. Left alone, the first person to sign up would open the app and see
-- the operator's book — not as a demo, but as their own holdings, on a dashboard
-- that computes VaR, beta and allocation from it.
--
-- This empties them. Positions are entered through the API afterwards, and until
-- then the analytics paths answer "nothing to measure", which is the truth.
--
-- The trade-off is explicit and irreversible: any positions an operator had
-- entered by hand into those rows are also lost, because the column cannot
-- distinguish the seed from real input — they were written by the same statement.
-- There is no way to keep the real ones and drop the fabricated ones without a
-- record of which was which, and no such record was kept. Deploying this to an
-- install where that matters needs a `SELECT lots_json FROM portfolios` first.

BEGIN;

DO $$
DECLARE
    seeded_count INTEGER;
BEGIN
    SELECT count(*) INTO seeded_count
    FROM portfolios
    WHERE lots_json <> '{}'::jsonb;

    IF seeded_count > 0 THEN
        RAISE NOTICE 'clearing seeded positions from % portfolio row(s)', seeded_count;
    END IF;
END
$$;

UPDATE portfolios SET lots_json = '{}'::jsonb WHERE lots_json <> '{}'::jsonb;

COMMIT;