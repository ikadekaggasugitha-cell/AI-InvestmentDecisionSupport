"""
Scheduler heartbeat tests.

`record_run` / `get_heartbeat` are what make the daily update observable — the
proof that the 24/7 scheduler actually ran, surfaced by /health. These pin the
round trip and the honest "never ran" case.
"""

from api.core.redis_client import REDIS_KEYS, get_heartbeat, record_run


async def test_record_and_read_heartbeat(mock_redis):
    await record_run("refresh-ohlcv-eod", status="ok", detail={"bars_written": 100})

    key = REDIS_KEYS["heartbeat"].format(task="refresh-ohlcv-eod")
    assert key in mock_redis  # persisted under the namespaced key

    hb = await get_heartbeat("refresh-ohlcv-eod")
    assert hb is not None
    assert hb["task"] == "refresh-ohlcv-eod"
    assert hb["status"] == "ok"
    assert hb["detail"]["bars_written"] == 100
    assert hb["at"]  # ISO timestamp present


async def test_missing_heartbeat_is_none(mock_redis):
    assert await get_heartbeat("never-ran") is None


async def test_default_status_is_ok(mock_redis):
    await record_run("refresh-broksum-eod")
    hb = await get_heartbeat("refresh-broksum-eod")
    assert hb["status"] == "ok"
    assert hb["detail"] == {}
