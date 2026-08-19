# Database migrations

`db/schema.sql` is the authoritative as-built schema and is applied to a **fresh**
database by the `db-init` service in `docker-compose.yml`. It uses
`CREATE TABLE IF NOT EXISTS` throughout, so it never alters an existing table.

The files here migrate an **existing** database to match a schema.sql change.
Apply them with the runner, which records what it applied and runs only the
pending files, each in its own transaction:

```sh
python -m db.migrate            # apply all pending migrations
python -m db.migrate --status   # show applied vs pending, change nothing
```

The runner (`db/migrate.py`) creates a `schema_migrations` ledger keyed by
filename + checksum. This closes DEPGAP-06: releases no longer re-apply every
file by hand, and an accidental edit to an already-applied migration is detected
(reported as `MODIFIED`) instead of silently diverging. It depends only on
psycopg2, so it runs in a release step or a one-shot container without the app's
full stack. Alembic remains unused — this plain-SQL convention is intentional.

Migrations are still written to be idempotent (safe to re-run). To apply by hand
without the runner:

```sh
for f in db/migrations/0*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

| File | Gap | Change |
| :--- | :--- | :--- |
| `0001_signals_probability_tier.sql` | GAP-01 | `signals.action` → `signals.probability_tier`, rewrite existing rows, swap CHECK |
| `0002_signals_unique_symbol_time.sql` | GAP-09 | unique index on `signals(symbol, generated_at)` for idempotent audit writes |
