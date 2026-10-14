"""
Reading and writing the price.

`system_settings` holds the price and nothing else writes it, which is the point:
the value used to exist in a document, so nothing could read it programmatically
and nobody could change it without editing prose. There is one function that
writes and one that reads, here, rather than SQL in two routers — the same rule
`accounts.py` follows for `blocked_at`, because two writers means an update that
cannot be reconciled with the other one.

Validation lives here, not in the routers. A router checks the shape of the
request (is this an integer?), and that is a different job from deciding what is
a sane amount of money. Putting the bounds in both places guarantees the two
disagree eventually.
"""

import logging
from dataclasses import dataclass

from api.core.db import get_pool

logger = logging.getLogger(__name__)

PRICING_KEY = "pricing"

# Rupiah. Cheap enough that the ceiling is not a product decision and generous
# enough that a mistyped number cannot put a zero in front of a real subscriber:
# the most expensive plan anyone has proposed is six figures, so anything past
# nine figures is a missing decimal point rather than a price.
MIN_PRICE_IDR = 1_000
MAX_PRICE_IDR = 1_000_000_000


class PriceOutOfRange(ValueError):
    """A price outside what an amount of rupiah can plausibly be."""

    def __init__(self, field: str, value: int) -> None:
        super().__init__(f"{field} is {value}, outside {MIN_PRICE_IDR}..{MAX_PRICE_IDR}")
        self.field = field


class PricingUnavailable(RuntimeError):
    """The `pricing` row is missing or unreadable.

    Not the same as "the price is zero". A missing row means the install is
    broken — the migration that seeds it has not run — and answering that with a
    number would report a price nobody ever set.
    """


@dataclass(frozen=True)
class Pricing:
    monthly: int
    annual: int
    updated_at: str | None = None


def _validate(monthly: int, annual: int) -> None:
    for field, value in (("monthly", monthly), ("annual", annual)):
        # No explicit bool check: bool is an int subclass, so True would pass
        # isinstance(value, int) — but True is 1 and False is 0, and both are
        # below MIN_PRICE_IDR, so the range test below refuses them anyway. A
        # dedicated branch here would be unreachable defence.
        if not isinstance(value, int) or value < MIN_PRICE_IDR or value > MAX_PRICE_IDR:
            raise PriceOutOfRange(field, value)


async def read_pricing() -> Pricing:
    """The current price, or raise. Never a substitute number."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT value, updated_at
          FROM system_settings
         WHERE key = $1
        """,
        PRICING_KEY,
    )
    if row is None:
        raise PricingUnavailable(
            f"no '{PRICING_KEY}' row in system_settings — run db.migrate"
        )
    value = row["value"]
    try:
        monthly = value["monthly"]
        annual = value["annual"]
        if isinstance(monthly, bool) or isinstance(annual, bool):
            raise TypeError("a boolean is not a price")
        # The same check the writer runs. A row can be hand-edited or seeded
        # wrong, and `{"monthly": 0}` served as a 200 is exactly the "quote them
        # for free" failure this endpoint exists to avoid — validating only on
        # write would make the guarantee hold for exactly as long as nobody edits
        # the table by hand.
        _validate(monthly, annual)
    except (KeyError, TypeError, ValueError, PriceOutOfRange) as exc:
        raise PricingUnavailable(
            f"'{PRICING_KEY}' does not hold two usable prices: {exc}"
        ) from exc

    # No rounding on the way out. `int(15000.7)` would answer 15000 for a row that
    # says 15000.7 — quoting a number the server does not hold.
    if monthly != int(monthly) or annual != int(annual):
        raise PricingUnavailable(f"'{PRICING_KEY}' holds a fractional price")

    updated = row["updated_at"]
    return Pricing(
        monthly=int(monthly),
        annual=int(annual),
        updated_at=updated.isoformat() if updated else None,
    )


async def write_pricing(monthly: int, annual: int) -> Pricing:
    """Replace both prices and return what the server now holds.

    Written as one statement so the two cannot be half-applied: a reader between
    them would otherwise see a new monthly price against an old annual one, which
    is a combination that never existed.
    """
    _validate(monthly, annual)
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ($1, jsonb_build_object('monthly', $2::int, 'annual', $3::int), NOW())
        ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = EXCLUDED.updated_at
        RETURNING updated_at
        """,
        PRICING_KEY,
        monthly,
        annual,
    )
    logger.info("settings: pricing set to monthly=%s annual=%s", monthly, annual)
    updated = row["updated_at"] if row else None
    return Pricing(monthly=monthly, annual=annual,
                   updated_at=updated.isoformat() if updated else None)