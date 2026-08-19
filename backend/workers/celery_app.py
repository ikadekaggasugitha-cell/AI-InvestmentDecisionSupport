"""
Celery application — task queue configuration.

Workers registered here:
  signal_worker  — LightGBM inference + SHAP (Phase 3)
  risk_worker    — GARCH + CVaR (Phase 4)
  sentiment_worker — IndoBERT batch (Phase 5)
  ohlcv_worker   — daily bar backfill from Yahoo (Phase 10)
  broksum_worker — end-of-day broker summary (Phase 10)

Beat schedule runs signal refresh every 15 min and risk refresh every hour
during IDX market hours. The two Phase 10 tasks run once per session after the
close: both produce daily aggregates, so intraday polling would re-fetch
unchanged data.

ALL SCHEDULE HOURS BELOW ARE WIB (Asia/Jakarta), NOT UTC.
------------------------------------------------------------------------------
Celery evaluates `crontab` against `app.conf.timezone`, which is set to
Asia/Jakarta. `enable_utc` governs message timestamps, not schedule matching —
verified: `crontab.now()` returns UTC+7 here.

The schedules were previously written as UTC hours under a comment claiming so,
which put every task 7 hours early. `refresh-ohlcv-eod` at hour=9 was documented
as "16:15 WIB, after the close" and actually fired at 09:15 WIB — fifteen
minutes after the OPEN, writing a bar for a session that had barely started, and
never running again that day. The market-hours tasks (hour="2-9") ran from
02:00 WIB, covering the night and only the first hour of trading.

IDX sessions: 09:00–12:00 and 13:30–16:00 WIB, Monday to Friday.
"""

from celery import Celery
from celery.schedules import crontab

from api.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "aidss",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "workers.signal_worker",
        "workers.risk_worker",
        "workers.ohlcv_worker",
        "workers.broksum_worker",
        "workers.monitoring_worker",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Jakarta",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,

    # Include sentiment worker in the app
    imports=celery_app.conf.get("include", []) + ["workers.sentiment_worker"],

    beat_schedule={
        # Signal refresh every 15 min during trading, Mon–Fri.
        "refresh-signals-market-hours": {
            "task": "workers.signal_worker.refresh_signals",
            "schedule": crontab(
                minute="*/15",
                hour="9-16",     # 09:00–16:59 WIB
                day_of_week="mon-fri",
            ),
        },
        # Risk refresh hourly during trading.
        "refresh-risk-market-hours": {
            "task": "workers.risk_worker.refresh_risk",
            "schedule": crontab(
                minute="5",
                hour="9-16",     # WIB
                day_of_week="mon-fri",
            ),
        },
        # BEI disclosures every 30 min during trading (Phase 5).
        "fetch-bei-disclosures": {
            "task": "workers.sentiment_worker.fetch_bei_disclosures",
            "schedule": crontab(
                minute="*/30",
                hour="9-16",     # WIB
                day_of_week="mon-fri",
            ),
        },
        # ── Phase 10 — once per session, after the close ──────────────────────
        # Daily bars first: the broksum snapshot and every price-action feature
        # read from `ohlcv`, so it has to be current before they run.
        "refresh-ohlcv-eod": {
            "task": "workers.ohlcv_worker.refresh_ohlcv_daily",
            "schedule": crontab(
                minute="15",
                hour="16",       # 16:15 WIB — 15 min after the close
                day_of_week="mon-fri",
            ),
        },
        # Broker summary is an end-of-day publication. One fetch per symbol per
        # session; polling intraday would re-read unchanged data ~78×/day and
        # is the only reason a proxy pool was ever needed.
        "refresh-broksum-eod": {
            "task": "workers.broksum_worker.refresh_broksum",
            "schedule": crontab(
                minute="30",
                hour="16",       # 16:30 WIB — after the OHLCV refresh lands
                day_of_week="mon-fri",
            ),
        },
        # ── Model monitoring — weekly ─────────────────────────────────────────
        # Feature-drift (PSI) of the live board against the training baseline.
        # Weekly on Saturday morning, after the week's daily bars have landed:
        # PSI barely moves day to day and the model does not retrain itself
        # between runs, so a daily check would only re-report the same number.
        "check-model-drift-weekly": {
            "task": "workers.monitoring_worker.check_drift",
            "schedule": crontab(
                minute="0",
                hour="8",
                day_of_week="sat",   # WIB
            ),
        },
    },
)
