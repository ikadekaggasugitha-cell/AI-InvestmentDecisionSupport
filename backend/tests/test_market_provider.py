"""
Market data provider tests.

These are offline: they exercise the contract and the data-quality rules, not
Yahoo's availability. A test that hits the live feed fails when the network
does, which teaches the team to ignore it.
"""

from datetime import datetime, timedelta, timezone

import pytest

from ingestor.providers.base import DailyBar, Quote, QuoteBatch


def _quote(**kw) -> Quote:
    base = dict(
        symbol="BBCA", price=6350.0, prev_close=6375.0, open=6300.0,
        day_high=6350.0, day_low=6275.0, volume=56_953_500,
    )
    base.update(kw)
    return Quote(**base)


class TestQuoteFreshness:
    def test_age_tracks_exchange_time_not_fetch_time(self):
        """
        A price's age is measured from the exchange timestamp. Measuring from
        our fetch time would report a ten-minute-old quote as brand new.
        """
        as_of = datetime.now(timezone.utc) - timedelta(minutes=12)
        q = _quote(as_of=as_of, delay_seconds=600)
        assert 700 < q.age_seconds < 740

    def test_age_is_none_without_a_timestamp(self):
        assert _quote(as_of=None).age_seconds is None

    def test_delay_flag_reflects_the_vendor_declaration(self):
        assert _quote(delay_seconds=600).is_delayed is True
        assert _quote(delay_seconds=0).is_delayed is False

    def test_stale_only_while_the_market_is_open(self):
        """
        Outside session hours the last trade is legitimately hours old. Flagging
        that as stale would fire every evening and every weekend, and an alert
        that always fires is an alert nobody reads.
        """
        old = datetime.now(timezone.utc) - timedelta(hours=18)
        assert _quote(as_of=old, market_state="CLOSED").is_stale(300) is False
        assert _quote(as_of=old, market_state="REGULAR").is_stale(300) is True

    def test_fresh_quote_within_declared_delay_is_not_stale(self):
        as_of = datetime.now(timezone.utc) - timedelta(minutes=9)
        q = _quote(as_of=as_of, delay_seconds=600, market_state="REGULAR")
        assert q.is_stale(300) is False

    def test_missing_timestamp_is_stale_when_open(self):
        assert _quote(as_of=None, market_state="REGULAR").is_stale(300) is True

    def test_change_derives_from_prev_close(self):
        q = _quote(price=6350.0, prev_close=6375.0)
        assert q.change == pytest.approx(-25.0)
        assert q.change_pct == pytest.approx(-0.392, abs=1e-3)

    def test_zero_prev_close_does_not_divide_by_zero(self):
        assert _quote(prev_close=0.0).change_pct == 0.0


class TestQuoteBatch:
    def test_reports_worst_delay_across_the_batch(self):
        batch = QuoteBatch(quotes={
            "A": _quote(symbol="A", delay_seconds=0),
            "B": _quote(symbol="B", delay_seconds=900),
        })
        assert batch.delay_seconds == 900

    def test_oldest_as_of_is_the_conservative_choice(self):
        now = datetime.now(timezone.utc)
        batch = QuoteBatch(quotes={
            "A": _quote(symbol="A", as_of=now),
            "B": _quote(symbol="B", as_of=now - timedelta(minutes=30)),
        })
        assert batch.oldest_as_of == now - timedelta(minutes=30)

    def test_empty_batch_is_safe(self):
        batch = QuoteBatch()
        assert len(batch) == 0
        assert batch.delay_seconds == 0
        assert batch.oldest_as_of is None
        assert batch.market_state == "UNKNOWN"


class TestBarValidation:
    """
    Vendors emit malformed bars — thin instruments, corporate actions, partial
    sessions. One bad bar silently corrupts every fractal pivot and gap
    computed downstream, so they are rejected at the boundary.
    """

    def _bar(self, **kw) -> DailyBar:
        base = dict(
            symbol="BBCA", date=datetime(2026, 8, 14, tzinfo=timezone.utc),
            open=6300.0, high=6350.0, low=6275.0, close=6350.0, volume=1_000,
        )
        base.update(kw)
        return DailyBar(**base)

    def test_accepts_a_well_formed_bar(self):
        assert self._bar().is_coherent() is True

    @pytest.mark.parametrize("bad,reason", [
        (dict(high=6200.0), "high below low"),
        (dict(open=9999.0), "open outside range"),
        (dict(close=1.0), "close outside range"),
        (dict(low=0.0), "non-positive price"),
        (dict(close=-5.0), "negative price"),
        (dict(volume=-1), "negative volume"),
    ])
    def test_rejects_impossible_bars(self, bad, reason):
        assert self._bar(**bad).is_coherent() is False, reason

    def test_zero_volume_is_valid(self):
        """An untraded session is a real thing, unlike a negative price."""
        assert self._bar(volume=0).is_coherent() is True


class TestSymbolMapping:
    def test_idx_codes_gain_the_jk_suffix(self):
        from ingestor.providers.yahoo import _from_jk, _to_jk

        assert _to_jk("BBCA") == "BBCA.JK"
        assert _from_jk("BBCA.JK") == "BBCA"

    def test_index_symbols_pass_through(self):
        from ingestor.providers.yahoo import _to_jk

        assert _to_jk("^JKSE") == "^JKSE"

    def test_already_suffixed_is_not_double_suffixed(self):
        from ingestor.providers.yahoo import _to_jk

        assert _to_jk("BBCA.JK") == "BBCA.JK"


class TestCircuitBreaker:
    def test_opens_after_the_threshold(self):
        from ingestor.providers.yahoo import _CircuitBreaker

        cb = _CircuitBreaker(threshold=3, cooldown=60)
        assert cb.is_open is False
        for _ in range(3):
            cb.record_failure()
        assert cb.is_open is True

    def test_success_resets_the_count(self):
        from ingestor.providers.yahoo import _CircuitBreaker

        cb = _CircuitBreaker(threshold=3, cooldown=60)
        cb.record_failure()
        cb.record_failure()
        cb.record_success()
        cb.record_failure()
        assert cb.is_open is False

    def test_reopens_for_probing_after_cooldown(self):
        from ingestor.providers.yahoo import _CircuitBreaker

        cb = _CircuitBreaker(threshold=1, cooldown=0.0)
        cb.record_failure()
        assert cb.is_open is False  # cooldown elapsed -> half-open probe


class TestQuoteParsing:
    def test_reads_the_declared_delay_rather_than_assuming_one(self):
        """
        The delay comes from the payload. Hardcoding 10 minutes would keep
        reporting 10 after the vendor's terms changed.
        """
        from ingestor.providers.yahoo import YahooProvider

        q = YahooProvider()._parse_quote({
            "symbol": "BBCA.JK", "regularMarketPrice": 6350,
            "regularMarketPreviousClose": 6375, "exchangeDataDelayedBy": 15,
            "marketState": "REGULAR", "quoteSourceName": "Delayed Quote",
        })
        assert q is not None
        assert q.delay_seconds == 900
        assert q.source_label == "Delayed Quote"
        assert q.market_state == "REGULAR"

    def test_a_priceless_quote_is_dropped(self):
        """
        Returning 0.0 would render as "Rp 0" — a real-looking price for an
        instrument that did not report one.
        """
        from ingestor.providers.yahoo import YahooProvider

        assert YahooProvider()._parse_quote({"symbol": "XXXX.JK"}) is None

    def test_nan_price_is_dropped(self):
        from ingestor.providers.yahoo import YahooProvider

        assert YahooProvider()._parse_quote(
            {"symbol": "XXXX.JK", "regularMarketPrice": float("nan")}
        ) is None
