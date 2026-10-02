#!/usr/bin/env bash
#
# Start the AIDSS Celery BEAT scheduler — the process that fires the daily/
# intraday tasks on the schedule in workers/celery_app.py (all times WIB):
#
#   */15  refresh-signals-market-hours   LightGBM + SHAP, hours 9–16, Mon–Fri
#   :05   refresh-risk-market-hours      GARCH + CVaR, hours 9–16, Mon–Fri
#   */30  fetch-bei-disclosures          IDX filings, hours 9–16, Mon–Fri
#   08:30 refresh-instruments-daily      IDX board, pre-open, Mon–Fri
#   16:15 refresh-ohlcv-eod              whole IDX board, incl. foreign flow
#   16:30 refresh-broksum-eod            warm foreign+volume accumulation cache
#   Sat 08 check-model-drift-weekly      PSI feature drift
#
# Seven tasks, not five: this list previously omitted refresh-instruments-daily
# and described refresh-risk as plain "hourly" without its 9–16 window, so it
# read as covering the night too. The intraday hours span the 12:00–13:30 midday
# break; that is a known gap, not a session-shaped schedule. See
# tests/test_beat_schedule.py, which asserts these hours so the list cannot
# silently drift from the code again.
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
