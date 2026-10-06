-- Migration 0005 — users, sessions, subscriptions.
--
-- 0004 made a portfolio an ownable row so access could be checked, but it had no
-- owner to check against: ownership was `owner_sub TEXT`, which is
-- `TokenPayload.sub`, which is literally the single-operator login name. It
-- cannot carry a foreign key, it cannot be checked, and it changes shape when
-- auth moves off tokens. This migration gives it a real owner.
--
-- See ADR-0001 (raw SQL, no ORM), ADR-0002 (owner_sub is retired in stages, not
-- replaced here), ADR-0004 (opaque sessions, hash at rest) and ADR-0005 (the
-- analytics must read the portfolio row, not one shared constant).
--
--   python -m db.migrate
--
-- Idempotent: safe to re-run.
BEGIN;

-- ── users ─────────────────────────────────────────────────────────────────────
-- The identity of one person. Deliberately carries nothing about payment: role
-- answers "may this person use the system", a Subscription answers "may this
-- person use the paid data", and those are computed separately.
--
-- There is no seeded system account. schema.sql is applied by the db-init service
-- on every `docker compose up`, so a credential written here would be copied into
-- every install and could never be rotated. The first admin is promoted by a
-- maintenance script instead.
--
-- Email is stored as given and normalised to lower/trim by the API, but
-- uniqueness is enforced here on lower(email) as well — two paths writing to this
-- table must not be able to create `User@aidss.id` and `user@aidss.id` as separate
-- accounts. Note that this makes `ON CONFLICT (email)` unusable: an expression
-- index is not matched by a column-name conflict target.
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,   -- Argon2id, never a plaintext password
    full_name     VARCHAR(150) NOT NULL,
    -- Not nullable. It is the only notification channel the product has, and
    -- legal-and-consent.md requires it at registration. A half-registered account
    -- with no way to reach it is worse than a failed signup.
    phone_number  VARCHAR(30)  NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    -- NULL means not blocked. A timestamp rather than a boolean because "when was
    -- this account blocked" is a fact an administrator needs and a flag discards.
    -- Written by the admin portal in Phase 4, so it has no writer yet.
    blocked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- ── sessions ──────────────────────────────────────────────────────────────────
-- Replaces the JWT. The cookie carries 64 random hex characters; this table
-- stores SHA-256 of that value, so read access to the database does not
-- directly hand over live sessions.
--
-- The raw token must never be logged, here or in the cache. Deleting the rows on
-- a password change revokes every device at once, which is why there is no
-- revoked_at column: the row is the fact.
CREATE TABLE IF NOT EXISTS sessions (
    id         VARCHAR(64) PRIMARY KEY,     -- sha-256(token), hex
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
-- Supports the maintenance sweep that removes expired rows; there is no Celery
-- task for it on purpose, because beat schedules in this repo have a WIB/UTC
-- history and a session sweep does not deserve a new trap.
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ── subscriptions ─────────────────────────────────────────────────────────────
-- One row per purchased period, never mutated. Renewal inserts a new row rather
-- than moving the old date, so "when does access end" is a fact that cannot go
-- stale, and the period history falls out for free.
--
-- There is no status column on purpose. Status was going to be `pending | active
-- | expired | canceled`, which mixes two lifecycles: `pending` meant three
-- different things depending on whether money had arrived, been uploaded, or
-- simply not been paid yet — and those three send different notifications and
-- have different refund rights. Payment lives on `transactions` (Phase 2);
-- access is derived from expires_at, which is what this table now holds.
--
-- A cancellation column was rejected for the same reason: nothing can write it,
-- and the way to stop someone reaching their account is blocking the account,
-- which is already a fact on `users`.
--
-- plan_type and price_paid arrive in Phase 2 alongside payments. Adding them now
-- would mean two columns that can only ever be NULL.
CREATE TABLE IF NOT EXISTS subscriptions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

-- The access check is `MAX(expires_at) WHERE expires_at > NOW()`, which this
-- index serves directly, including the ORDER BY ... LIMIT 1. A partial unique
-- index on "currently active" is not possible: a partial index predicate must be
-- IMMUTABLE and NOW() is STABLE.
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_access
    ON subscriptions (user_id, expires_at DESC);

-- ── portfolios: gain a real owner ─────────────────────────────────────────────
-- Additive, per 0004's own instruction. owner_sub stays until every principal
-- that has ever existed has a users row.
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

-- Backfill by matching owner_sub against email, which is what owner_sub held: it
-- was AUTH_USERNAME. The dev-bypass principal ("dev-user") matches nothing and
-- deliberately keeps user_id NULL. Assigning its portfolio to whoever registers
-- next would hand one person's data to a stranger, which is precisely why owner_sub
-- is retained rather than backfilled blind.
UPDATE portfolios p
   SET user_id = u.id
  FROM users u
 WHERE p.user_id IS NULL
   AND p.owner_sub IS NOT NULL
   AND lower(u.email) = lower(p.owner_sub);

-- owner_sub becomes nullable now because opaque sessions carry a user_id, not a
-- token subject, so nothing can write this column any more. NOT NULL could no
-- longer be satisfied by api/services/portfolio_access.py.
--
-- The two existing owner_sub indexes are intentionally left alone. They still
-- serve the current read/write path, and moving them before portfolio_access.py
-- reads user_id would drop the one-default-per-owner guarantee in the window
-- between the schema change and the code change. They move in the migration that
-- retires owner_sub, together with the code that stops writing it.
ALTER TABLE portfolios ALTER COLUMN owner_sub DROP NOT NULL;

COMMIT;