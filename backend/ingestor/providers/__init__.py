"""
Market data providers.

One interface, swappable implementations. `get_provider()` resolves the
configured vendor so no caller has to know which feed is behind it.
"""

from ingestor.providers.base import (
    DailyBar,
    MarketDataError,
    MarketDataProvider,
    Quote,
    QuoteBatch,
)

__all__ = [
    "DailyBar",
    "MarketDataError",
    "MarketDataProvider",
    "Quote",
    "QuoteBatch",
    "get_provider",
]


_INSTANCES: dict[str, MarketDataProvider] = {}


def get_provider(vendor: str | None = None) -> MarketDataProvider:
    """
    Resolve the configured market data provider.

    Instances are cached per vendor and shared. This matters: the Yahoo
    provider holds a cookie jar and a crumb token, and building a fresh one per
    call re-runs the whole handshake. Fetching ten symbols was opening ten
    sessions and acquiring ten crumbs to issue ten requests — three times the
    round trips for no benefit, and a good way to look like abuse.

    Callers must therefore NOT close a provider they obtained here; use
    `close_providers()` at shutdown. `get_history_provider()` returns an
    unshared instance for exactly that reason.

    Add a licensed real-time feed by implementing MarketDataProvider and
    registering it here; nothing downstream changes.
    """
    from api.core.config import get_settings

    vendor = (vendor or get_settings().idx_feed_vendor or "yahoo").lower()

    cached = _INSTANCES.get(vendor)
    if cached is not None:
        return cached

    if vendor == "yahoo":
        from ingestor.providers.yahoo import YahooProvider
        _INSTANCES[vendor] = YahooProvider()
        return _INSTANCES[vendor]

    if vendor == "idx":
        from ingestor.providers.idx import IdxProvider
        _INSTANCES[vendor] = IdxProvider()
        return _INSTANCES[vendor]

    raise MarketDataError(
        f"Unknown IDX_FEED_VENDOR={vendor!r}. Supported: 'yahoo', 'idx'. "
        "A licensed real-time feed can be added by implementing "
        "MarketDataProvider in ingestor/providers/."
    )


def get_history_provider() -> MarketDataProvider:
    """
    Provider for DAILY BAR ingestion, which is a different job from quoting.

    Bars come from IDX regardless of the quote vendor: it is the authoritative
    source and the only one carrying foreign flow, listed shares and traded
    value. Quotes stay on the configured `idx_feed_vendor` because IDX publishes
    end-of-day only, while Yahoo refreshes through the session (delayed).

    Returns an UNSHARED instance, unlike `get_provider()`. Backfill runs for
    tens of minutes and the caller owns its lifetime — it should close the
    provider when finished rather than leaving a long-lived session pinned in
    the shared cache.
    """
    from ingestor.providers.idx import IdxProvider

    return IdxProvider()


async def close_providers() -> None:
    """Close every shared provider. Call once at application shutdown."""
    for provider in list(_INSTANCES.values()):
        try:
            await provider.close()
        except Exception:  # noqa: BLE001 — shutdown must not raise
            pass
    _INSTANCES.clear()
