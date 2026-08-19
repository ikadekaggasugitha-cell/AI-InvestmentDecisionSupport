-- Migration 0002 — GAP-09: idempotent signal audit writes
--
-- The signal worker persists one batch of signals per run keyed on
-- (symbol, generated_at). With acks_late=True a Celery retry can redeliver the
-- task, so the INSERT must be an upsert (ON CONFLICT DO NOTHING) — which needs a
-- unique index to conflict against.
--
-- Fresh installs get this index from schema.sql. This file adds it to an
-- EXISTING database. Idempotent.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0002_signals_unique_symbol_time.sql

CREATE UNIQUE INDEX IF NOT EXISTS uq_signals_symbol_time ON signals (symbol, generated_at);
