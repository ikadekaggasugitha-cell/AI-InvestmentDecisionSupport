-- Migration 0013 — WHY an account is blocked.
--
-- Until now a block had one anonymous shape: `blocked_at` filled, and that was
-- all anyone knew. This plan adds a second kind of block — an account whose
-- subscription lapsed is suspended until it pays again — and the two kinds
-- cannot share one clearance, because they have opposite doors:
--
--   'admin' : an administrator closed this account. Only the admin's own
--             unblock endpoint may ever open it again. A payment satisfying
--             this lock would be the whole privilege-escalation door
--             plan-suspend-lapsed.md exists to keep shut.
--   'subscription_expired': the clock ran out. Paying reopens it.
--
-- So `blocked_reason` is not a detail, it is the fact that makes "payment
-- clears its own suspension, never an admin ban" a checkable rule instead of
-- good intentions. One column and one pair of CHECKs — not a status column on
-- `subscriptions`, which stays nothing but `user_id` + `expires_at`
-- (CONTEXT.md rule 1, ADR-0002).
--
-- Backfill: every block that exists at migration time was written by the admin
-- endpoint (the only writer until now — accounts.set_blocked), so every one of
-- them is 'admin'. Filling the existing rows any other way would turn old
-- admin bans into lock a payment can satisfy — silently, using data the code
-- never wrote a reason into.
--
--   python -m db.migrate
--
-- Idempotent: safe to re-run.
BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS blocked_reason VARCHAR(30);

-- Existing rows first: the shape CHECK below refuses a blocked account with an
-- empty reason, and refusing it at read time would be missing the point — the
-- DWELLING state must be impossible, not just warned about.
UPDATE users
   SET blocked_reason = 'admin'
 WHERE blocked_at IS NOT NULL
   AND blocked_reason IS NULL;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS ck_users_blocked_reason;

ALTER TABLE users
    ADD CONSTRAINT ck_users_blocked_reason
    CHECK (blocked_reason IS NULL
           OR blocked_reason IN ('admin', 'subscription_expired'));

-- The pairing: one fact, written in both columns or none (CONTEXT.md rule 5).
-- `blocked_at` filled with `blocked_reason` empty — or the inverse — is a row
-- every reader would have to guess about, so it cannot exist.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS ck_users_blocked_reason_shape;

ALTER TABLE users
    ADD CONSTRAINT ck_users_blocked_reason_shape
    CHECK ((blocked_at IS NULL AND blocked_reason IS NULL)
           OR (blocked_at IS NOT NULL AND blocked_reason IS NOT NULL));

COMMIT;
