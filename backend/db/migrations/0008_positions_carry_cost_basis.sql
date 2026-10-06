-- Positions carry their cost basis, not just a lot count.
--
-- Why: lots_json was {symbol: lots}, which is enough for analytics and nothing
-- else. But "what did I pay" is not derivable from any price feed, so the moment
-- a position exists the cost basis has to live somewhere. Leaving it in
-- localStorage splits one position across two stores — the server knows how many
-- lots, the browser knows the price — and those two answers drift apart the
-- first time someone edits a position on a second device.
--
-- The shape becomes {symbol: {lots: int, avgPrice: number}}. Kept in one column
-- rather than a new table: a position and its cost basis are one fact written
-- together, and a transactions table belongs to Fase 2 along with the rest of
-- billing, which is not written yet.
--
-- Backwards compatible by reading, not by guessing: load_lots accepts both shapes
-- so an install that has not run the reshape still works. The reshape below is
-- therefore idempotent and safe to run on a partially migrated database.

BEGIN;

-- ── Reshape symbol: lots into symbol: {lots, avgPrice} ─────────────────────
--
-- avgPrice is left NULL rather than filled from the current price. Substituting
-- today's close for a purchase price would make every position's cost basis, and
-- therefore every unrealised P&L figure, quietly wrong from the moment this runs.
-- A NULL cost basis is visibly absent, which is what it actually is.
DO $$
DECLARE
    shaped  INTEGER;
    legacy  INTEGER;
BEGIN
    SELECT count(*) INTO shaped FROM portfolios
    WHERE lots_json <> '{}'::jsonb
      AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(lots_json) k
                      WHERE jsonb_typeof(lots_json -> k) = 'object');

    IF shaped > 0 THEN
        RAISE NOTICE 'reshaping % portfolio row(s) to carry a cost basis', shaped;
    END IF;
END
$$;

UPDATE portfolios AS p
SET lots_json = reshaped.doc
FROM (
    SELECT src.id,
           (
               SELECT jsonb_object_agg(
                   e.key,
                   jsonb_build_object('lots', e.value::int, 'avgPrice', NULL)
               )
               FROM jsonb_each_text(src.lots_json) AS e(key, value)
           ) AS doc
    FROM portfolios AS src
    WHERE src.lots_json <> '{}'::jsonb
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(src.lots_json) k
          WHERE jsonb_typeof(src.lots_json -> k) = 'object'
      )
) AS reshaped
WHERE p.id = reshaped.id;

COMMIT;