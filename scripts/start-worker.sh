#!/usr/bin/env bash
#
# Start the AIDSS Celery WORKER — the process that executes scheduled tasks
# (OHLCV refresh, signals, risk, foreign-flow accumulation).
#
# Runs alongside start-beat.sh: beat DISPATCHES tasks on the schedule, the
# worker EXECUTES them. You need both running for the daily update to happen
# automatically. Both require Redis (the broker) to be up.
#
# For 24/7 operation put this under a process supervisor (systemd, supervisord,
# pm2, or `docker compose`) so it restarts on crash/reboot — see README.
#
# Usage:  ./scripts/start-worker.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
cd "$BACKEND_DIR"

PY="$BACKEND_DIR/.venv/bin/python"
[ -x "$PY" ] || PY="python3"

echo "Starting AIDSS Celery worker (concurrency=2)…"
exec "$PY" -m celery -A workers.celery_app worker \
  --loglevel=info --concurrency=2
