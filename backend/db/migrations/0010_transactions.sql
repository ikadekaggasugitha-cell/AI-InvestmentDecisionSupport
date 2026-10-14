-- Transactions: the money flow, and the key a replayed webhook collapses onto.
--
-- Why: `subscriptions` already existed but nothing could ever create one. The
-- access check reads `expires_at`, and there is no INSERT, UPDATE or DELETE
-- against that table anywhere in the backend, so every account answered "no
-- subscription" and always would have. This adds the table that records an
-- attempt to pay, which is the piece that later writes the Subscription.
--
-- It records money flow only. No column here grants or blocks access: Access
-- Status stays derived from `subscriptions.expires_at`, and Payment Status
-- stays here (CONTEXT.md rule 1). Keeping them apart is what stops a failed or
-- expired payment from ever being read as an access decision.
--
-- uq_transactions_midtrans_transaction_id is the idempotency key. Midtrans
-- replays an order when it does not see our response, so the same payment can
-- arrive twice, and each one would otherwise mint a second Transaction and then
-- a second full period. A UNIQUE on the provider's own id makes the second
-- attempt a constraint violation instead of a duplicate. It is named, not
-- inline, so a rollback or a manual inspection can refer to it by name.
--
-- NULLs stay repeatable on purpose: a manual bank transfer has no gateway id,
-- and PostgreSQL ignores NULLs under UNIQUE. Manual transfers therefore keep
-- working, and several of them coexist without colliding.
--
-- What this does NOT do: it stops a duplicate row, not duplicate logic. A
-- webhook arriving after its Transaction already exists still has to be
-- recognised and answered, and that handler does not exist yet. Until it does,
-- this constraint is declared and unexercised. See ADR-0008.
--
-- `status` uses Midtrans' vocabulary because this row is written by a Midtrans
-- callback. CONTEXT.md's Payment Status is the concept; these five values are
-- the gateway's names for it. 'settlement' is not a synonym for "access
-- granted", it means the money arrived.
--
-- `updated_at` has no trigger, matching instruments and broker_summary. Nothing
-- in the project has trigger infrastructure yet, so this column will sit equal
-- to created_at until someone writes the trigger. Recorded rather than quietly
-- copied without comment.

BEGIN;

CREATE TABLE IF NOT EXISTS transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id         UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    invoice_code            VARCHAR(50) NOT NULL UNIQUE,
    amount                  NUMERIC(14,2) NOT NULL,
    payment_gateway         VARCHAR(30) NOT NULL CHECK (payment_gateway IN ('midtrans', 'manual')),
    payment_method          VARCHAR(50) NOT NULL,
    status                  VARCHAR(30) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'settlement', 'expire', 'deny', 'cancel')),
    midtrans_transaction_id VARCHAR(100),
    proof_image_url         TEXT,
    approved_by             UUID REFERENCES users(id),
    approved_at             TIMESTAMPTZ,
    admin_notes             TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_transactions_midtrans_transaction_id UNIQUE (midtrans_transaction_id)
);

-- The read paths are "everything this account paid for" and the admin
-- verification queue. Neither leads with midtrans_transaction_id, so the UNIQUE
-- above is not doing either job. No index on invoice_code either: it is already
-- UNIQUE, so it carries its own index and a second one is pure write overhead.
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions (status);

COMMIT;