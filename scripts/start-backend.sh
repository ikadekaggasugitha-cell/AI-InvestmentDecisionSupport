#!/usr/bin/env bash
#
# Start the AIDSS FastAPI backend for local development.
#
# Port 8000 is occupied by an unrelated PHP server on this machine, so the
# backend listens on 8010 instead. The frontend points here via .env.local
# (VITE_API_BASE=http://localhost:8010). AUTH_BYPASS=true skips the JWT guard
# for local dev — do NOT use it in production.
#
# Postgres/Redis are optional: without them the backend logs a warning and
# serves labelled seed data, so the UI still works end to end.
#
# Usage:  ./scripts/start-backend.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
cd "$BACKEND_DIR"

PORT="${AIDSS_PORT:-8010}"
PY="$BACKEND_DIR/.venv/bin/python"
[ -x "$PY" ] || PY="python3"

echo "Starting AIDSS backend on http://127.0.0.1:${PORT} (AUTH_BYPASS=true) …"
exec env AUTH_BYPASS=true "$PY" -m uvicorn api.main:app \
  --host 127.0.0.1 --port "$PORT" --reload
