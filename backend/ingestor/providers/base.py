"""
Market data provider contract.

Every quote carries its own freshness. This is not decoration: the free IDX
feed is delayed, and a number rendered without its age invites the reader to
treat a 10-minute-old price as the current one. `Quote.age_seconds` and
`Quote.is_stale` exist so the UI can never accidentally present delayed data as
live, and so a stalled upstream feed is visible rather than silent.

Implement this interface to add a licensed real-time vendor; callers depend on
the contract, not on Yahoo.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

MarketState = Literal["REGULAR", "CLOSED", "PRE", "POST", "UNKNOWN"]


class MarketDataError(RuntimeError):
    """Raised when a provider cannot return usable data."""


@dataclass(frozen=True)
class Quote:
    """A single instrument snapshot, with provenance."""

    symbol: str
    price: float
    prev_close: float
    open: float
    day_high: float
    day_low: float
    volume: int
    currency: str = "IDR"

    # ── Provenance ────────────────────────────────────────────────────────────
    # `as_of` is the exchange timestamp of the quote, NOT the time we fetched
    # it. Those differ by the vendor delay plus however long the symbol has been
    # untraded, and only the former tells the reader how old the number is.
    as_of: datetime | None = None
    delay_seconds: int = 0          # vendor-declared feed delay
    market_state: MarketState = "UNKNOWN"
    provider: str = "unknown"
    source_label: str = ""          # vendor's own wording, e.g. "Delayed Quote"

    @property
    def change(self) -> float:
        return self.price - self.prev_close

    @property
    def change_pct(self) -> float:
        return (self.change / self.prev_close * 100) if self.prev_close else 0.0

    @property
    def age_seconds(self) -> float | None:
        """Seconds between the exchange timestamp and now. None if unknown."""
        if self.as_of is None:
            return None
        return (datetime.now(timezone.utc) - self.as_of).total_seconds()

    @property
    def is_delayed(self) -> bool:
        return self.delay_seconds > 0

    def is_stale(self, tolerance_seconds: float) -> bool:
        """
        True when the quote is older than the feed's own delay plus tolerance.

        Only meaningful while the market is open: outside session hours the last
        trade is legitimately hours old, and flagging that as stale would fire
        every evening and every weekend.
        """
        if self.market_state != "REGULAR":
            return False
        age = self.age_seconds
        if age is None:
            return True
        return age > (self.delay_seconds + tolerance_seconds)


@dataclass(frozen=True)
class QuoteBatch:
    """Result of a batch quote request, including what failed."""

    quotes: dict[str, Quote] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    provider: str = "unknown"

    def __len__(self) -> int:
        return len(self.quotes)

    @property
    def delay_seconds(self) -> int:
        """Worst declared delay across the batch."""
        return max((q.delay_seconds for q in self.quotes.values()), default=0)

    @property
    def oldest_as_of(self) -> datetime | None:
        stamps = [q.as_of for q in self.quotes.values() if q.as_of]
        return min(stamps) if stamps else None

    @property
    def market_state(self) -> MarketState:
        """Consensus state — the exchange is one market, not fifteen."""
        states = [q.market_state for q in self.quotes.values()]
        if not states:
            return "UNKNOWN"
        return max(set(states), key=states.count)  # type: ignore[return-value]


@dataclass(frozen=True)
class DailyBar:
    """
    One daily OHLCV bar.

    The fields below `volume` are published by IDX but not by Yahoo. They stay
    None on Yahoo-sourced bars rather than defaulting to 0, because a zero
    foreign flow is a real and different thing from an unreported one — and a
    model cannot distinguish them once they share a value.
    """

    symbol: str
    date: datetime           # midnight UTC of the session
    open: float
    high: float
    low: float
    close: float
    volume: int

    # The PRIOR session's close, not this bar's open. Daily change is measured
    # close-to-close; deriving it from the open gives the intraday move instead,
    # which can carry the opposite sign — a session that opened down and closed
    # up is still a down day if it closed below yesterday.
    previous_close: float | None = None

    foreign_buy: int | None = None
    foreign_sell: int | None = None
    listed_shares: int | None = None
    frequency: int | None = None
    value_idr: float | None = None
    source: str = "unknown"

    @property
    def foreign_net(self) -> int | None:
        """Net foreign flow in shares, or None when the feed does not report it."""
        if self.foreign_buy is None or self.foreign_sell is None:
            return None
        return self.foreign_buy - self.foreign_sell

    def is_coherent(self) -> bool:
        """
        Structural sanity: a bar whose high is below its open is not a bar.

        Vendors do emit these — thin instruments, corporate actions, partial
        sessions — and a single bad bar silently corrupts every downstream
        fractal pivot and gap calculation.
        """
        if min(self.open, self.high, self.low, self.close) <= 0:
            return False
        if self.high < self.low:
            return False
        if not (self.low <= self.open <= self.high):
            return False
        if not (self.low <= self.close <= self.high):
            return False
        if self.volume < 0:
            return False
        return True


class MarketDataProvider(ABC):
    """Interface every market data vendor must satisfy."""

    #: Short identifier recorded on every Quote for provenance.
    name: str = "abstract"

    @abstractmethod
    async def get_quotes(self, symbols: list[str]) -> QuoteBatch:
        """
        Fetch current quotes for IDX tickers (bare codes, e.g. "BBCA").

        Must not raise for individual symbol failures — report them in
        `QuoteBatch.missing` so one delisted ticker cannot blank the dashboard.
        Raises MarketDataError only when the whole request fails.
        """

    @abstractmethod
    async def get_daily_bars(self, symbol: str, days: int) -> list[DailyBar]:
        """Fetch daily OHLCV bars, oldest first. Returns [] when unavailable."""

    async def close(self) -> None:
        """Release any held connections. Safe to call more than once."""
        return None
