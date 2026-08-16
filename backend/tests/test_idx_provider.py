"""
IDX provider tests.

Offline: the fixtures below are verbatim field shapes captured from a live
GetStockSummary response, so the parser is tested against what IDX actually
sends rather than what we assume it sends — without the suite depending on the
exchange being reachable.
"""

from datetime import date, datetime, timezone

import pytest

from ingestor.providers.base import DailyBar
from ingestor.providers.idx import IdxProvider, _session_close_utc


# Verbatim field set from IDX GetStockSummary, 2026-08-14, BBCA.
REAL_ROW = {
    "No": 98, "IDStockSummary": 4074105, "Date": "2026-08-14T00:00:00",
    "StockCode": "BBCA", "StockName": "Bank Central Asia Tbk.",
    "Remarks": "--MO1UQNCNU600G111------------",
    "Previous": 6375.0, "OpenPrice": 6300.0, "FirstTrade": 6325.0,
    "High": 6350.0, "Low": 6275.0, "Close": 6350.0, "Change": -25.0,
    "Volume": 56953500.0, "Value": 360448775000.0, "Frequency": 11663.0,
    "IndexIndividual": 18130.4, "Offer": 6350.0, "OfferVolume": 1452000.0,
    "Bid": 6325.0, "BidVolume": 1758600.0,
    "ListedShares": 122042299500.0, "TradebleShares": 122042299500.0,
    "WeightForIndex": 38391910182.0,
    "ForeignSell": 37845600.0, "ForeignBuy": 38196500.0,
    "DelistingDate": "", "NonRegularVolume": 8369187.0,
    "NonRegularValue": 52954403500.0, "NonRegularFrequency": 29.0,
    "persen": None, "percentage": None,
}


@pytest.fixture
def provider() -> IdxProvider:
    return IdxProvider()


class TestRowParsing:
    def test_parses_a_real_row(self, provider):
        bar = provider._parse_row(REAL_ROW)
        assert bar is not None
        assert bar.symbol == "BBCA"
        assert bar.close == 6350.0
        assert bar.volume == 56_953_500
        assert bar.source == "idx"

    def test_captures_foreign_flow(self, provider):
        """
        The reason this provider exists. Yahoo carries none of this, and three
        model features were previously filled with 0.0 in its absence.
        """
        bar = provider._parse_row(REAL_ROW)
        assert bar.foreign_buy == 38_196_500
        assert bar.foreign_sell == 37_845_600
        assert bar.foreign_net == 350_900

    def test_captures_liquidity_and_share_count(self, provider):
        bar = provider._parse_row(REAL_ROW)
        assert bar.listed_shares == 122_042_299_500
        assert bar.frequency == 11_663
        assert bar.value_idr == pytest.approx(360_448_775_000.0)

    def test_date_normalised_to_midnight_utc(self, provider):
        """The UNIQUE (time, symbol) key only collides if every session lands
        on exactly one timestamp."""
        bar = provider._parse_row(REAL_ROW)
        assert bar.date == datetime(2026, 8, 14, tzinfo=timezone.utc)

    def test_parsed_bar_is_coherent(self, provider):
        assert provider._parse_row(REAL_ROW).is_coherent() is True

    def test_carries_the_prior_session_close(self, provider):
        """
        Daily change is close-to-close. On this row the open (6300) sits BELOW
        the close (6350) while the prior close (6375) sits above it — so
        deriving change from the open yields +0.79% for a day the stock
        actually fell 0.39%. Opposite sign, on a number the UI labels "change".
        """
        bar = provider._parse_row(REAL_ROW)
        assert bar.previous_close == 6375.0
        assert bar.previous_close != bar.open


class TestQuoteChangeDirection:
    def test_change_is_measured_against_the_prior_close(self, provider):
        """Regression: the quote must agree with IDX's own Change field (-25)."""
        import asyncio
        from unittest.mock import patch

        bar = provider._parse_row(REAL_ROW)

        async def _one_session(_self, _session):
            return [bar]

        with patch.object(IdxProvider, "get_session_bars", _one_session):
            batch = asyncio.run(provider.get_quotes(["BBCA"]))

        quote = batch.quotes["BBCA"]
        assert quote.prev_close == 6375.0
        assert quote.change == pytest.approx(-25.0)
        assert quote.change_pct < 0, "a down day must not report a gain"
        assert quote.change_pct == pytest.approx(-0.392, abs=0.01)


class TestRowRejection:
    def test_suspended_instrument_is_dropped(self, provider):
        """
        IDX lists suspended counters with Close = 0. Storing one would put a
        zero price into the series and corrupt every return computed across it.
        """
        row = {**REAL_ROW, "Close": 0.0}
        assert provider._parse_row(row) is None

    def test_missing_stock_code_is_dropped(self, provider):
        assert provider._parse_row({**REAL_ROW, "StockCode": ""}) is None

    def test_unparseable_date_is_dropped(self, provider):
        assert provider._parse_row({**REAL_ROW, "Date": "not-a-date"}) is None

    def test_never_opened_falls_back_to_previous_close(self, provider):
        """
        OpenPrice is 0 for instruments that did not open. Using that literally
        would produce a bar with low=0, which fails coherence and loses a
        session that did in fact trade.
        """
        bar = provider._parse_row({**REAL_ROW, "OpenPrice": 0.0})
        assert bar is not None
        assert bar.open == 6375.0  # Previous
        assert bar.is_coherent()

    def test_absent_foreign_fields_stay_none_not_zero(self, provider):
        """
        None means "not reported"; 0 means "no foreign participation". Once they
        share a value the model cannot tell them apart.
        """
        row = {k: v for k, v in REAL_ROW.items() if k not in ("ForeignBuy", "ForeignSell")}
        bar = provider._parse_row(row)
        assert bar.foreign_buy is None
        assert bar.foreign_sell is None
        assert bar.foreign_net is None


class TestForeignNet:
    def test_none_when_either_side_is_missing(self):
        base = dict(
            symbol="X", date=datetime(2026, 8, 14, tzinfo=timezone.utc),
            open=1.0, high=1.0, low=1.0, close=1.0, volume=0,
        )
        assert DailyBar(**base, foreign_buy=10, foreign_sell=None).foreign_net is None
        assert DailyBar(**base, foreign_buy=None, foreign_sell=10).foreign_net is None

    def test_net_can_be_negative(self):
        bar = DailyBar(
            symbol="X", date=datetime(2026, 8, 14, tzinfo=timezone.utc),
            open=1.0, high=1.0, low=1.0, close=1.0, volume=0,
            foreign_buy=100, foreign_sell=250,
        )
        assert bar.foreign_net == -150


class TestSessionSemantics:
    @pytest.mark.asyncio
    async def test_weekend_returns_empty_without_a_request(self, provider):
        """
        IDX does not trade at weekends. Requesting anyway would waste a slot in
        a 750-request backfill for every Saturday and Sunday in the range.
        """
        saturday = date(2026, 8, 15)
        assert saturday.weekday() == 5
        assert await provider.get_session_bars(saturday) == []

    def test_close_timestamp_is_1600_wib(self):
        """
        IDX closes 16:00 WIB = 09:00 UTC. Quote age is measured from here, so
        an EOD price reports its true age instead of looking live.
        """
        assert _session_close_utc(date(2026, 8, 14)) == datetime(
            2026, 8, 14, 9, 0, tzinfo=timezone.utc
        )


class TestProviderContract:
    def test_satisfies_the_interface(self):
        from ingestor.providers.base import MarketDataProvider

        assert issubclass(IdxProvider, MarketDataProvider)
        assert IdxProvider.name == "idx"

    def test_registry_resolves_idx(self):
        from ingestor.providers import get_provider

        assert get_provider("idx").name == "idx"

    def test_history_provider_is_always_idx(self):
        """
        Bars come from IDX whatever the quote vendor is — it is the only source
        carrying foreign flow.
        """
        from ingestor.providers import get_history_provider

        assert get_history_provider().name == "idx"

    def test_unknown_vendor_names_the_supported_ones(self):
        from ingestor.providers import MarketDataError, get_provider

        with pytest.raises(MarketDataError, match="idx"):
            get_provider("bloomberg")
