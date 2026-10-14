"""
The price: what can be written, what can be read, and what happens when neither
is possible.

The seed values matter to these tests. A test that asserts "the price is 15000"
only proves the fixture is self-consistent, so the numbers below come from
migration 0011 by reading it, and the behaviours asserted are the ones that would
actually hurt somebody: a price of zero, a half-applied update, or an install
that reports a number nobody set.
"""

import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

from api.services.settings import (
    MAX_PRICE_IDR,
    MIN_PRICE_IDR,
    PriceOutOfRange,
    PricingUnavailable,
    read_pricing,
    write_pricing,
)

MIGRATION = Path(__file__).resolve().parents[1] / "db" / "migrations" / "0011_system_settings_pricing.sql"


def _seeded_prices() -> tuple[int, int]:
    """The prices migration 0011 actually seeds, read out of it.

    Hardcoding them here would make this file agree with whatever it was written
    against, not with what ships.
    """
    text = MIGRATION.read_text()
    monthly = int(re.search(r'"monthly":\s*(\d+)', text).group(1))
    annual = int(re.search(r'"annual":\s*(\d+)', text).group(1))
    return monthly, annual


SEED_MONTHLY, SEED_ANNUAL = _seeded_prices()


class TestReading:
    async def test_a_fresh_install_reads_the_seeded_prices(self, fake_identity):
        """The prices the owner decided, reachable without an admin ever acting."""
        pricing = await read_pricing()
        assert pricing.monthly == SEED_MONTHLY
        assert pricing.annual == SEED_ANNUAL

    async def test_it_reports_when_the_price_was_last_changed(self, fake_identity):
        """So "why is the price this?" has an answer that is not a git log."""
        fake_identity.settings["pricing"]["updated_at"] = datetime(
            2026, 10, 1, 9, 30, tzinfo=timezone.utc
        )
        pricing = await read_pricing()
        assert pricing.updated_at == "2026-10-01T09:30:00+00:00"

    async def test_a_missing_row_is_a_failure_not_a_zero(self, fake_identity):
        """`{"monthly": 0}` is a price nobody ever charged. A missing row means the
        migration has not run, and saying so is the only honest answer."""
        fake_identity.settings.clear()
        with pytest.raises(PricingUnavailable):
            await read_pricing()

    async def test_a_row_without_two_prices_is_a_failure_not_a_zero(self, fake_identity):
        fake_identity.settings["pricing"]["value"] = {"monthly": 15000}
        with pytest.raises(PricingUnavailable):
            await read_pricing()

    @pytest.mark.parametrize("stored", [
        {"monthly": 0, "annual": 150000},
        {"monthly": -1, "annual": 150000},
        {"monthly": 10**12, "annual": 150000},
        {"monthly": 15000.7, "annual": 150000},
    ])
    async def test_a_row_holding_an_impossible_price_is_refused(
        self, fake_identity, stored
    ):
        # The writer validates, so this can only happen by a hand-edit or a bad
        # seed. Validating only on write would make the guarantee hold for exactly
        # as long as nobody touches the table.
        fake_identity.settings["pricing"]["value"] = stored
        with pytest.raises(PricingUnavailable):
            await read_pricing()

    async def test_an_unreachable_database_is_a_failure_not_a_zero(self, fake_identity):
        fake_identity.fail = True
        with pytest.raises(ConnectionError):
            await read_pricing()


class TestWriting:
    async def test_it_writes_both_prices(self, fake_identity):
        await write_pricing(20_000, 200_000)
        pricing = await read_pricing()
        assert (pricing.monthly, pricing.annual) == (20_000, 200_000)

    async def test_the_read_path_sees_it_immediately(self, fake_identity):
        """One table, one truth. If the write went somewhere the read does not look,
        the admin would see their change and the public endpoint would not."""
        await write_pricing(25_000, 250_000)
        assert (await read_pricing()).monthly == 25_000

    async def test_it_returns_what_the_server_holds(self, fake_identity):
        written = await write_pricing(30_000, 300_000)
        assert written.monthly == 30_000
        assert written.updated_at is not None

    @pytest.mark.parametrize("monthly", [0, -1, MIN_PRICE_IDR - 1, MAX_PRICE_IDR + 1])
    async def test_it_refuses_a_price_that_is_not_one(self, fake_identity, monthly):
        """Zero would quote a paying customer for free; negative would credit them."""
        with pytest.raises(PriceOutOfRange):
            await write_pricing(monthly, SEED_ANNUAL)
        assert (await read_pricing()).monthly == SEED_MONTHLY, "the bad write landed"

    async def test_it_refuses_a_boolean(self, fake_identity):
        # bool is an int subclass, so `True` passes a naive type check and would
        # be stored as a price of 1. The range test is what catches it — 1 is far
        # below any price anyone would charge.
        with pytest.raises(PriceOutOfRange):
            await write_pricing(True, SEED_ANNUAL)  # type: ignore[arg-type]
        assert (await read_pricing()).monthly == SEED_MONTHLY

    async def test_a_refused_write_leaves_the_old_price_intact(self, fake_identity):
        with pytest.raises(PriceOutOfRange):
            await write_pricing(20_000, 0)
        assert (await read_pricing()).monthly == SEED_MONTHLY
        assert (await read_pricing()).annual == SEED_ANNUAL