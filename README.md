# AIDSS — AI Investment Decision Support System

A decision-support tool for the Indonesia Stock Exchange (IDX). It serves
AI-generated trading **signals** (LightGBM + SHAP), portfolio **risk** metrics
(GARCH / CVaR), **portfolio optimisation** (Black-Litterman + HRP), live
(delayed) market data, technical analysis, and a Claude-powered advisor — all
behind a React dashboard.

> **Not investment advice.** Every signal is a probability score (0–100), not a
> buy/sell instruction, in line with OJK guidance. Investment decisions are the
> user's own responsibility.

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | React 18 · TypeScript · Vite · Tailwind · Radix/shadcn · Recharts · lightweight-charts |
| Backend  | FastAPI · Pydantic v2 · asyncpg |
| Data     | TimescaleDB (OHLCV, signals, broker summary) · Redis (cache) |
| Async    | Celery + beat (signal/risk/OHLCV/broksum/drift jobs) |
| ML       | LightGBM · SHAP · `arch` (GARCH) · point-in-time feature pipeline |
| Advisor  | Anthropic Claude (streaming, server-side tool use) |

Market data is **real but delayed** (Yahoo self-declares ~10 min). A licensed
real-time IDX feed can be added by implementing `MarketDataProvider` in
`backend/ingestor/providers/`.

## Running

### Frontend

```bash
npm install
npm run dev            # Vite dev server (http://localhost:5173)
npm run typecheck && npm run lint && npm run test   # checks
npm run build          # production bundle
```

Configure via env (`.env` or Vite env vars):

- `VITE_API_BASE` — backend origin (default `http://localhost:8000`)
- `VITE_USE_LIVE_API` — `false` to force the labelled offline seed path
- `VITE_API_TOKEN` — bearer token for a deployed single-operator build (dev with
  `AUTH_BYPASS=true` needs none)

### Backend

```bash
cd backend
docker compose up -d   # TimescaleDB + Redis + API + workers (+ optional MLflow/Redpanda)
# Host ports are overridable if 5432/6379 are taken:
#   AIDSS_DB_PORT=55432 AIDSS_REDIS_PORT=56379 docker compose up -d
```

Or run the API directly:

```bash
cd backend
pip install -r requirements.txt          # full stack (or requirements-test.txt for the lean, test-verified set)
cp .env.example .env                     # every setting is documented; edit as needed
python -m db.migrate                     # apply schema migrations
uvicorn api.main:app --reload
```

Populate real data and train the model:

```bash
python scripts/bootstrap_real_data.py            # backfill real IDX OHLCV
python -m ml.training.train_signals_v2           # train the signal model (enforces AUC/lift gates)
```

Health: `GET /health` (readiness — 503 when a hard dependency is down),
`GET /livez` (liveness). API docs at `/docs` outside production.

### Configuration & safety

- `AUTH_BYPASS=true` (dev default) opens every route as a dev principal. With
  `APP_ENV=production` the app **refuses to start** unless `AUTH_BYPASS=false`, a
  non-default `JWT_SECRET_KEY` is set, and `APP_DEBUG=false`.
- Every data service defaults to its **real** path and degrades to
  clearly-labelled seed/empty data only when its source is genuinely absent (no
  trained model, empty `ohlcv`, feed down) — never silently.

## Tests

- Backend: `cd backend && pytest` (coverage-gated in CI).
- Frontend: `npm run test` (Vitest + Testing Library).
- CI (`.github/workflows/ci.yml`) runs both on every push/PR.
