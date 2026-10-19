-- Migration 0014 — the price list grows a weekly slot, and the default prices move.
--
-- The product now sells three lengths instead of two: 7 days weekly beside the
-- existing 30/365. That is one fact in two halves, and each half gets its own
-- clause here:
--
-- 1. The plan vocabulary. `transactions.plan` carries the length a buyer chose,
--    checked against the two names it had (0012). The CHECK is dropped and
--    re-added with `weekly` in it — re-adding under the same name without
--    dropping would fail on any install that already has the constraint.
--
-- 2. The price. The pivot to three slots would otherwise leave every install's
--    `pricing` row without a `weekly` key, and `read_pricing` answers 503 for a
--    row it cannot read as three prices — after this migration, not before, an
--    install whose pricing row never gained the key would be the broken one.
--    The owner's price decision dates 2026-10-19: weekly 15000, monthly 44000,
--    annual 252000. It applies where the row still holds the two-slot seed
--    exactly; an install whose operator already set their own monthly/annual
--    prices keeps them and only gains the weekly slot, because overwriting a
--    price somebody deliberately set would hand their order back.

ALTER TABLE transactions
    DROP CONSTRAINT IF EXISTS ck_transactions_plan;

ALTER TABLE transactions
    ADD CONSTRAINT ck_transactions_plan
        CHECK (plan IN ('weekly', 'monthly', 'annual'));

UPDATE system_settings
   SET value = value
               || jsonb_build_object('weekly', 15000::int)
               || CASE
                    WHEN value = jsonb_build_object('monthly', 15000::int,
                                                    'annual', 150000::int)
                    THEN jsonb_build_object('monthly', 44000::int,
                                            'annual', 252000::int)
                    ELSE '{}'::jsonb
                  END,
       updated_at = NOW()
 WHERE key = 'pricing'
   AND NOT (value ? 'weekly');
