"""
Yahoo Finance provider for IDX (`.JK`) instruments.

Two things make this work where the previous implementation did not.

**TLS impersonation.** Yahoo fingerprints the TLS handshake. A plain
httpx/requests call to `query1.finance.yahoo.com` returns HTTP 429 regardless of
rate — it is not a rate limit, it is a client rejection. `curl_cffi` replays a
real Chrome handshake and the same request returns 200. This is why
`market_service.fetch_yahoo_market_data()` could never have worked: it used
httpx with only a User-Agent header.

**Crumb authentication.** Since 2024 `v7/finance/quote` requires a crumb token
bound to a session cookie. Without it the endpoint 401s. The crumb is fetched
once per session and refreshed on rejection.

Honesty about latency
---------------------
Yahoo self-declares IDX quotes as delayed — `exchangeDataDelayedBy: 10`
(minutes) and `quoteSourceName: "Delayed Quote"`. That value is read from the
response rather than hardcoded, so if the vendor's terms change the system
reports the new number instead of a stale assumption. True real-time IDX data
requires a licensed feed (IDX PDPS, a data vendor, or a broker API); this
provider does not pretend otherwise, and every Quote it returns carries its own
delay so no layer above can present it as live.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from ingestor.providers.base import (
    DailyBar,
    MarketDataError,
    MarketDataProvider,
    MarketState,
    Quote,
    QuoteBatch,
)

logger = logging.getLogger(__name__)

_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"
_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
_CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb"
_COOKIE_URL = "https://fc.yahoo.com"

# Yahoo caps the batch; IDX universes are far smaller but chunking keeps the
# provider correct if the tracked list grows.
_MAX_BATCH = 50

_MARKET_STATE_MAP: dict[str, MarketState] = {
    "REGULAR": "REGULAR",
    "CLOSED": "CLOSED",
    "PRE": "PRE",
    "PREPRE": "PRE",
    "POST": "POST",
    "POSTPOST": "POST",
}


def _to_jk(symbol: str) -> str:
    """
    BBCA -> BBCA.JK.

    Anything already carrying its own namespace passes through: indices ("^JKSE"),
    FX pairs ("IDR=X"), and already-suffixed tickers. Without the "=" check an FX
    request becomes "IDR=X.JK", which Yahoo has no record of — the quote silently
    goes missing rather than erroring.
    """
    if symbol.startswith("^") or "." in symbol or "=" in symbol:
        return symbol
    return f"{symbol}.JK"


def _from_jk(symbol: str) -> str:
    return symbol[:-3] if symbol.endswith(".JK") else symbol


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if out == out else default  # reject NaN


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class _CircuitBreaker:
    """
    Stop hammering a feed that is failing.

    Opens after `threshold` consecutive failures and stays open for
    `cooldown` seconds. Without this, a Yahoo outage during market hours turns
    into one failed request per symbol per tick, which is how a client earns a
    real rate limit on top of the outage it is already suffering.
    """

    def __init__(self, threshold: int = 5, cooldown: float = 120.0) -> None:
        self._threshold = threshold
        self._cooldown = cooldown
        self._failures = 0
        self._opened_at: float | None = None

    @property
    def is_open(self) -> bool:
        if self._opened_at is None:
            return False
        if time.monotonic() - self._opened_at >= self._cooldown:
            # Half-open: let the next call through to probe recovery.
            self._opened_at = None
            self._failures = 0
            return False
        return True

    def record_success(self) -> None:
        self._failures = 0
        self._opened_at = None

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self._threshold and self._opened_at is None:
            self._opened_at = time.monotonic()
            logger.error(
                "yahoo: circuit breaker OPEN after %d consecutive failures; "
                "pausing requests for %.0fs",
                self._failures, self._cooldown,
            )


class YahooProvider(MarketDataProvider):
    """Delayed IDX quotes and daily bars from Yahoo Finance."""

    name = "yahoo"

    MAX_RETRIES = 3
    BASE_BACKOFF = 1.5
    MIN_REQUEST_INTERVAL = 0.35  # polite client-side throttle

    def __init__(self) -> None:
        self._session: Any = None
        self._crumb: str | None = None
        self._breaker = _CircuitBreaker()
        self._last_request = 0.0
        self._lock = asyncio.Lock()

    # ── Session management ────────────────────────────────────────────────────

    def _build_session(self) -> Any:
        try:
            from curl_cffi import requests as curl_requests
        except ImportError as exc:  # pragma: no cover - dependency is pinned
            raise MarketDataError(
                "curl_cffi is required for the Yahoo provider. Plain HTTP "
                "clients receive HTTP 429 from Yahoo regardless of request "
                "rate — the handshake itself is rejected. "
                "Install it: pip install curl_cffi"
            ) from exc

        return curl_requests.Session(impersonate="chrome", timeout=20)

    def _ensure_session(self) -> Any:
        """Create the session and obtain a crumb. Synchronous by design."""
        if self._session is not None and self._crumb:
            return self._session

        session = self._session or self._build_session()

        # Cookie first — the crumb endpoint is worthless without it.
        try:
            session.get(_COOKIE_URL, timeout=15)
        except Exception as exc:  # noqa: BLE001 — cookie priming is best-effort
            logger.debug("yahoo: cookie priming failed (continuing): %s", exc)

        resp = session.get(_CRUMB_URL, timeout=15)
        if resp.status_code != 200 or not resp.text.strip():
            raise MarketDataError(
                f"yahoo: could not obtain crumb (HTTP {resp.status_code}). "
                "The quote endpoint is crumb-gated and will reject requests."
            )

        self._session = session
        self._crumb = resp.text.strip()
        logger.info("yahoo: session established (crumb acquired)")
        return session

    def _reset_session(self) -> None:
        """Force a fresh session + crumb on the next call."""
        self._crumb = None
        if self._session is not None:
            try:
                self._session.close()
            except Exception:  # noqa: BLE001
                pass
        self._session = None

    async def close(self) -> None:
        self._reset_session()

    # ── Request plumbing ──────────────────────────────────────────────────────

    async def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.MIN_REQUEST_INTERVAL:
            await asyncio.sleep(self.MIN_REQUEST_INTERVAL - elapsed)
        self._last_request = time.monotonic()

    async def _request_json(self, url: str, params: dict[str, Any]) -> dict | None:
        """
        GET with retry, backoff, crumb refresh and circuit breaking.

        Returns None when the request could not be satisfied; raises only when
        the provider is unusable at all.
        """
        if self._breaker.is_open:
            logger.warning("yahoo: circuit breaker open, skipping request")
            return None

        for attempt in range(self.MAX_RETRIES):
            try:
                await self._throttle()

                # curl_cffi is synchronous; keep the event loop free.
                def _do() -> Any:
                    session = self._ensure_session()
                    merged = dict(params)
                    if self._crumb:
                        merged["crumb"] = self._crumb
                    return session.get(url, params=merged, timeout=20)

                resp = await asyncio.to_thread(_do)

                if resp.status_code == 200:
                    self._breaker.record_success()
                    return resp.json()

                if resp.status_code in (401, 403):
                    # Almost always an expired crumb rather than a real denial.
                    logger.info(
                        "yahoo: HTTP %d — refreshing session/crumb (attempt %d/%d)",
                        resp.status_code, attempt + 1, self.MAX_RETRIES,
                    )
                    self._reset_session()
                elif resp.status_code == 429:
                    logger.warning(
                        "yahoo: HTTP 429 (attempt %d/%d) — backing off",
                        attempt + 1, self.MAX_RETRIES,
                    )
                    self._reset_session()
                else:
                    logger.warning(
                        "yahoo: HTTP %d (attempt %d/%d)",
                        resp.status_code, attempt + 1, self.MAX_RETRIES,
                    )

            except MarketDataError:
                raise
            except Exception as exc:  # noqa: BLE001 — network faults are expected
                logger.warning(
                    "yahoo: request error %s (attempt %d/%d)",
                    type(exc).__name__, attempt + 1, self.MAX_RETRIES,
                )
                self._reset_session()

            # Exponential backoff with jitter, skipped after the final attempt.
            if attempt < self.MAX_RETRIES - 1:
                delay = self.BASE_BACKOFF * (2 ** attempt) + random.uniform(0, 0.5)
                await asyncio.sleep(delay)

        self._breaker.record_failure()
        return None

    # ── Quotes ────────────────────────────────────────────────────────────────

    def _parse_quote(self, item: dict[str, Any]) -> Quote | None:
        raw_symbol = item.get("symbol") or ""
        if not raw_symbol:
            return None

        price = _as_float(item.get("regularMarketPrice"))
        if price <= 0:
            # No price means no quote. Reporting 0 would render as "Rp 0".
            return None

        prev_close = _as_float(item.get("regularMarketPreviousClose"), price)
        epoch = item.get("regularMarketTime")
        as_of = (
            datetime.fromtimestamp(epoch, tz=timezone.utc)
            if isinstance(epoch, (int, float)) and epoch > 0
            else None
        )

        # Vendor-declared delay, in minutes, read from the payload rather than
        # assumed — if Yahoo's IDX terms change, we report the new value.
        delay_minutes = _as_int(item.get("exchangeDataDelayedBy"), 0)

        return Quote(
            symbol=_from_jk(raw_symbol),
            price=price,
            prev_close=prev_close,
            open=_as_float(item.get("regularMarketOpen"), prev_close),
            day_high=_as_float(item.get("regularMarketDayHigh"), max(price, prev_close)),
            day_low=_as_float(item.get("regularMarketDayLow"), min(price, prev_close)),
            volume=_as_int(item.get("regularMarketVolume"), 0),
            currency=item.get("currency") or "IDR",
            as_of=as_of,
            delay_seconds=max(0, delay_minutes) * 60,
            market_state=_MARKET_STATE_MAP.get(
                str(item.get("marketState", "")).upper(), "UNKNOWN"
            ),
            provider=self.name,
            source_label=item.get("quoteSourceName") or "",
        )

    async def get_quotes(self, symbols: list[str]) -> QuoteBatch:
        if not symbols:
            return QuoteBatch(provider=self.name)

        wanted = [s.upper() for s in symbols]
        quotes: dict[str, Quote] = {}

        async with self._lock:
            for start in range(0, len(wanted), _MAX_BATCH):
                chunk = wanted[start:start + _MAX_BATCH]
                payload = await self._request_json(
                    _QUOTE_URL, {"symbols": ",".join(_to_jk(s) for s in chunk)}
                )
                if not payload:
                    continue

                results = (payload.get("quoteResponse") or {}).get("result") or []
                for item in results:
                    quote = self._parse_quote(item)
                    if quote:
                        quotes[quote.symbol] = quote

        missing = [s for s in wanted if s not in quotes]
        if missing:
            logger.warning("yahoo: no quote returned for %s", ", ".join(missing))

        return QuoteBatch(quotes=quotes, missing=missing, provider=self.name)

    # ── Daily bars ────────────────────────────────────────────────────────────

    async def get_daily_bars(self, symbol: str, days: int) -> list[DailyBar]:
        symbol = symbol.upper()

        # Calendar range must exceed the trading-day count: ~252 sessions a year
        # against 365 days, plus IDX holidays.
        span_days = max(int(days * 1.5) + 10, days + 10)
        payload = await self._request_json(
            _CHART_URL.format(symbol=_to_jk(symbol)),
            {
                "range": f"{span_days}d",
                "interval": "1d",
                "includePrePost": "false",
                "events": "div,split",
            },
        )
        if not payload:
            return []

        chart = payload.get("chart") or {}
        results = chart.get("result") or []
        if not results:
            error = (chart.get("error") or {}).get("description")
            logger.warning("yahoo: no chart data for %s (%s)", symbol, error)
            return []

        result = results[0]
        stamps = result.get("timestamp") or []
        quote_block = ((result.get("indicators") or {}).get("quote") or [{}])[0]

        opens = quote_block.get("open") or []
        highs = quote_block.get("high") or []
        lows = quote_block.get("low") or []
        closes = quote_block.get("close") or []
        volumes = quote_block.get("volume") or []

        bars: list[DailyBar] = []
        dropped = 0

        for i, epoch in enumerate(stamps):
            try:
                o, h, l, c = opens[i], highs[i], lows[i], closes[i]
            except IndexError:
                dropped += 1
                continue

            # Yahoo emits nulls for non-trading days inside the range.
            if None in (o, h, l, c):
                continue

            session = datetime.fromtimestamp(epoch, tz=timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            bar = DailyBar(
                symbol=symbol,
                date=session,
                open=_as_float(o),
                high=_as_float(h),
                low=_as_float(l),
                close=_as_float(c),
                volume=_as_int(volumes[i] if i < len(volumes) else 0, 0),
            )
            if not bar.is_coherent():
                dropped += 1
                continue
            bars.append(bar)

        if dropped:
            logger.warning(
                "yahoo: dropped %d incoherent/incomplete bar(s) for %s", dropped, symbol
            )

        bars.sort(key=lambda b: b.date)
        return bars[-days:] if len(bars) > days else bars


async def probe() -> dict[str, Any]:
    """
    Diagnostic: confirm the feed is reachable and report its declared latency.

    Run with:  python -m ingestor.providers.yahoo
    """
    provider = YahooProvider()
    try:
        batch = await provider.get_quotes(["BBCA", "^JKSE"])
        sample = batch.quotes.get("BBCA")
        return {
            "reachable": bool(batch.quotes),
            "symbols_returned": len(batch),
            "missing": batch.missing,
            "delay_seconds": batch.delay_seconds,
            "market_state": batch.market_state,
            "sample_symbol": sample.symbol if sample else None,
            "sample_price": sample.price if sample else None,
            "sample_as_of": sample.as_of.isoformat() if sample and sample.as_of else None,
            "sample_age_seconds": round(sample.age_seconds) if sample and sample.age_seconds else None,
            "source_label": sample.source_label if sample else "",
        }
    finally:
        await provider.close()


if __name__ == "__main__":  # pragma: no cover
    import json

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    print(json.dumps(asyncio.run(probe()), indent=2))
