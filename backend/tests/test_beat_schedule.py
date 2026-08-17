"""
Beat schedule tests.

Celery evaluates crontab hours against `app.conf.timezone`, which is
Asia/Jakarta here — not UTC. The schedules were originally written as UTC hours
under a comment asserting they were UTC, so every task fired seven hours early:
the "16:15 WIB, after the close" OHLCV job actually ran at 09:15 WIB, fifteen
minutes after the open, and the market-hours jobs started at 02:00 WIB.

A comment cannot prevent that recurring. These tests assert against the actual
IDX session clock, so anyone who edits an hour has to keep it correct.
"""

import zoneinfo
from datetime import datetime

import pytest

from workers.celery_app import celery_app

WIB = zoneinfo.ZoneInfo("Asia/Jakarta")

# IDX: 09:00–12:00 and 13:30–16:00 WIB, Monday to Friday.
MARKET_OPEN_HOUR = 9
MARKET_CLOSE_HOUR = 16

EOD_TASKS = ["refresh-ohlcv-eod", "refresh-broksum-eod"]
INTRADAY_TASKS = [
    "refresh-signals-market-hours",
    "refresh-risk-market-hours",
    "fetch-bei-disclosures",
]


def _schedule(name: str):
    entry = celery_app.conf.beat_schedule.get(name)
    assert entry is not None, f"{name} is not in beat_schedule"
    return entry["schedule"]


def _hours(name: str) -> set[int]:
    """Hours the crontab matches, as integers."""
    return {int(h) for h in _schedule(name).hour}


class TestScheduleTimezone:
    def test_app_timezone_is_jakarta(self):
        assert celery_app.conf.timezone == "Asia/Jakarta"

    def test_crontabs_resolve_against_jakarta_not_utc(self):
        """
        The premise of every hour in this file. If someone sets
        `timezone="UTC"`, all the hours below become wrong by seven and these
        tests must fail loudly rather than the schedules drifting silently.
        """
        cron = _schedule("refresh-ohlcv-eod")
        assert str(cron.tz) == "Asia/Jakarta"

        # Empirical: the clock the schedule matches against is UTC+7.
        now_wib = cron.now()
        assert now_wib.utcoffset().total_seconds() == 7 * 3600


class TestEndOfDayTasks:
    @pytest.mark.parametrize("name", EOD_TASKS)
    def test_fires_after_the_close(self, name):
        """
        The whole point of an EOD job. At hour=9 these ran just after the open
        and wrote a bar for a session that had barely started.
        """
        for hour in _hours(name):
            assert hour >= MARKET_CLOSE_HOUR, (
                f"{name} fires at {hour:02d}:xx WIB, before the "
                f"{MARKET_CLOSE_HOUR}:00 close"
            )

    @pytest.mark.parametrize("name", EOD_TASKS)
    def test_fires_once_per_day(self, name):
        cron = _schedule(name)
        assert len(cron.hour) == 1, f"{name} should run once per session"
        assert len(cron.minute) == 1, f"{name} should run at one minute past"

    def test_ohlcv_lands_before_broksum(self):
        """
        The broksum snapshot and every price-action feature read `ohlcv`, so
        bars must be current first.
        """
        ohlcv = _schedule("refresh-ohlcv-eod")
        broksum = _schedule("refresh-broksum-eod")
        ohlcv_at = min(ohlcv.hour) * 60 + min(ohlcv.minute)
        broksum_at = min(broksum.hour) * 60 + min(broksum.minute)
        assert ohlcv_at < broksum_at

    @pytest.mark.parametrize("name", EOD_TASKS)
    def test_weekdays_only(self, name):
        cron = _schedule(name)
        assert set(cron.day_of_week) == {1, 2, 3, 4, 5}, (
            f"{name} must not run at the weekend — IDX is closed"
        )


class TestIntradayTasks:
    @pytest.mark.parametrize("name", INTRADAY_TASKS)
    def test_runs_within_trading_hours(self, name):
        """
        At hour="2-9" these covered 02:00–09:59 WIB: the night, plus the first
        hour of trading. Nothing ran during session 2 at all.
        """
        hours = _hours(name)
        assert min(hours) >= MARKET_OPEN_HOUR, (
            f"{name} starts at {min(hours):02d}:xx WIB, before the open"
        )
        assert max(hours) <= MARKET_CLOSE_HOUR, (
            f"{name} still running at {max(hours):02d}:xx WIB, after the close"
        )

    @pytest.mark.parametrize("name", INTRADAY_TASKS)
    def test_covers_both_sessions(self, name):
        """
        IDX trades 09:00–12:00 and 13:30–16:00. A schedule that misses the
        afternoon leaves signals stale for half the day.
        """
        hours = _hours(name)
        assert hours & {9, 10, 11}, f"{name} misses session 1"
        assert hours & {14, 15}, f"{name} misses session 2"

    @pytest.mark.parametrize("name", INTRADAY_TASKS)
    def test_weekdays_only(self, name):
        assert set(_schedule(name).day_of_week) == {1, 2, 3, 4, 5}


class TestRegisteredTasks:
    def test_every_scheduled_task_module_is_imported(self):
        """
        A beat entry naming a task the worker never imported is accepted by
        beat and then fails at dispatch with NotRegistered.
        """
        imported = set(celery_app.conf.imports or ()) | set(celery_app.conf.include or ())
        for name, entry in celery_app.conf.beat_schedule.items():
            module = entry["task"].rsplit(".", 1)[0]
            assert module in imported, (
                f"{name} dispatches {entry['task']} but {module} is not imported"
            )

    def test_acks_late_is_on(self):
        """
        Every DB write in the workers upserts on a unique key precisely because
        acks_late re-runs a task whose worker died. Turning it off would make
        that defensive work pointless; turning it on without the keys would
        double-count.
        """
        assert celery_app.conf.task_acks_late is True
