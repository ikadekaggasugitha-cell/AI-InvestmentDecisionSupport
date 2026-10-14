-- Migration 0011 — system_settings, and the one setting it holds today.
--
-- Why: `docs/status.md` recorded "harga dan rekening tujuan tidak ada sumbernya".
-- The price existed in a document and nowhere else, so nothing could read it and
-- nobody could change it. This table is that source.
--
-- The shape is the blueprint's (`saas-subscription-platform.md` §5), unchanged.
-- One table rather than a `prices` table because the price is configuration and
-- not a domain entity: CONTEXT.md's Plan has no identity and changes without a
-- trace, so it must not own a row per plan that later histories could disagree
-- with.
--
-- Only `pricing` is seeded. The blueprint also specifies `bank_accounts` and
-- `contact_support`; both belong to a payment path that does not exist, and
-- seeding rows nothing can read or write is the state docs/status.md already
-- lists as a debt.

CREATE TABLE IF NOT EXISTS system_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ON CONFLICT DO NOTHING, deliberately. This migration runs once, but it also has
-- to be safe to re-run by hand (every migration here is), and re-running it must
-- not snap the price back to the seeded number and undo whatever an operator set
-- since. The seed is the initial value; the table is the truth from then on.
INSERT INTO system_settings (key, value, description) VALUES
('pricing', '{"monthly": 15000, "annual": 150000}'::jsonb,
 'Harga paket langganan dalam IDR')
ON CONFLICT (key) DO NOTHING;

-- No index on `value`: nothing queries it. The primary key is the only access
-- path, and a second index here would only add write cost.
--
-- No `active` flag beside the price. Whether the price is current is the row
-- existing at all; a boolean would be a second place for one fact to disagree
-- with itself (CONTEXT.md rule 5).