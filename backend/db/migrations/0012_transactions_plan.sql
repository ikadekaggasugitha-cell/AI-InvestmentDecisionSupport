-- Migration 0012 — which purchase length a transaction is for.
--
-- Why: the admin approve action has to write a Subscription for the length the
-- blueprint fixes — 30 days monthly, 365 days annual (plan-pembayaran.md). The
-- row's `amount` cannot carry that answer: a price that changed once would make
-- "150000" ambiguous, and deriving the duration by matching the amount against
-- today's price would quietly grant the wrong period instead of failing loudly.
-- So the plan a buyer chose is recorded on the row, at declaration time, where
-- it cannot drift from the money.
--
-- It is one column, not a join: the value is a fixed vocabulary with no identity
-- of its own — CONTEXT.md's Plan has no rows to disagree with.
--
-- `payment_method` (qris | va_bca | va_mandiri | bank_transfer in the
-- blueprint) stays what the payer says they used; it is not the plan, and
-- overloading it would read two facts through one column.
--
-- DEFAULT 'monthly' only keeps `NOT NULL` legal against the table as it exists
-- on installs that pre-date this migration. Every writer (manual declaration,
-- gateway checkout) sends the plan explicitly, so no API path relies on the
-- default.

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'monthly';

ALTER TABLE transactions
    DROP CONSTRAINT IF EXISTS ck_transactions_plan;

ALTER TABLE transactions
    ADD CONSTRAINT ck_transactions_plan CHECK (plan IN ('monthly', 'annual'));
