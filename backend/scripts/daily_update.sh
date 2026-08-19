#!/bin/bash
# Wrapper the daily-update scheduler calls. Sets the venv + infra env, then runs
# the cron-friendly refresh. Edit the two URLs if your DB/Redis move.
#
# Used by deploy/com.aidss.daily-update.plist (macOS launchd) and equally
# runnable from a Linux crontab line.
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BACKEND_DIR"

export PYTHONPATH="$BACKEND_DIR"
export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://aidss:aidss@localhost:55432/aidss}"
export REDIS_URL="${REDIS_URL:-redis://localhost:56379/0}"
export USE_MOCK_SIGNALS=false
export USE_MOCK_MARKET=false

PYTHON="${AIDSS_PYTHON:-$BACKEND_DIR/.venv/bin/python}"
exec "$PYTHON" -m scripts.daily_update "$@"
