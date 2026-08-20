#!/usr/bin/env bash
#
# Start the AIDSS Celery BEAT scheduler — the process that fires the daily/
# intraday tasks on the schedule in workers/celery_app.py (all times WIB):
#
#   16:15  refresh-ohlcv-eod        whole IDX board, incl. foreign flow
#   16:30  refresh-broksum-eod      warm foreign+volume accumulation cache
#   */15   refresh-signals          during trading hours
#   :05    refresh-risk             hourly during trading hours
#   Sat 08 check-model-drift-weekly
#
# Beat only DISPATCHES; start-worker.sh must also be running to EXECUTE the
# tasks. Both require Redis. For 24/7 operation supervise both — see README.
#
# Usage:  ./scripts/start-beat.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
cd "$BACKEND_DIR"

PY="$BACKEND_DIR/.venv/bin/python"
[ -x "$PY" ] || PY="python3"

echo "Starting AIDSS Celery beat scheduler (timezone Asia/Jakarta)…"
exec "$PY" -m celery -A workers.celery_app beat \
  --loglevel=info
