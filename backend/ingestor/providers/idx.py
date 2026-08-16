"""
IDX first-party provider — Bursa Efek Indonesia's own published data.

Why this exists alongside the Yahoo provider
--------------------------------------------
IDX publishes more than Yahoo does, and it is the authoritative source:

  * `ForeignBuy` / `ForeignSell` — foreign participation per instrument, which
    Yahoo does not carry at all. Three of the Phase 3 model features depend on
    it and were previously filled with 0.0.
  * `ListedShares` — real market capitalisation instead of a hardcoded string.
  * `Frequency` and `Value` — liquidity signals that raw volume misses, and the
    basis for selecting the model universe.
  * ~950 instruments per session, against the 15 we display.

Grain
-----
IDX indexes by DATE and returns every instrument for that session. Yahoo indexes
by SYMBOL and returns every date. That inversion decides the backfill strategy:
three years of the full board is ~750 dated requests here, versus ~950
per-symbol requests from Yahoo that would still lack foreign flow.

`get_session_bars(date)` is therefore the native call. `get_daily_bars(symbol,
days)` from the base interface is implemented for compatibility, but it costs
one request per session and should not be used for bulk work — it logs a
warning if asked for a long range.

Latency
-------
This is an END-OF-DAY publication. Quotes returned here are the session's
closing prices, and `Quote.as_of` is the close, so age is reported truthfully
rather than as if the numbers were live.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from datetime import date as _date
from datetime import datetime, timedelta, timezone
from typing import Any

from ingestor.providers.base import (
    DailyBar,
    MarketDataError,
    MarketDataProvider,
    Quote,
    QuoteBatch,
)

logger = logging.getLogger(__name__)

_STOCK_SUMMARY_URL = "https://www.idx.co.id/primary/TradingSummary/GetStockSummary"
_ORIGIN = "https://www.idx.co.id/"

# One session's board comfortably exceeds 1000 rows; ask for all of it at once.
_PAGE_LENGTH = 5000

# IDX closes at 16:00 WIB (UTC+7) = 09:00 UTC.
_CLOSE_UTC_HOUR = 9


def _session_close_utc(session: _date) -> datetime:
    return datetime(
        session.year, session.month, session.day, _CLOSE_UTC_HOUR, tzinfo=timezone.utc
    )


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if out == out else default  # reject NaN


def _as_int(value: Any, default: int | None = 0) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


class IdxProvider(MarketDataProvider):
    """End-of-day IDX data, direct from the exchange."""

    name = "idx"

    MAX_RETRIES = 3
    BASE_BACKOFF = 2.0
    # IDX is a public exchange site, not a commercial API. One request every two
    # seconds keeps a 750-request backfill to ~25 minutes while staying well
    # below anything that would look like abuse.
    MIN_REQUEST_INTERVAL = 2.0

    def __init__(self) -> None:
        self._session: Any = None
        self._last_request = 0.0
        self._lock = asyncio.Lock()

    # ── Session ───────────────────────────────────────────────────────────────

    def _ensure_session(self) -> Any:
        if self._session is not None:
            return self._session
        try:
            from curl_cffi import requests as curl_requests
        except ImportError as exc:  # pragma: no cover — dependency is pinned
            raise MarketDataError(
                "curl_cffi is required for the IDX provider. "
                "Install it: pip install curl_cffi"
            ) from exc

        session = curl_requests.Session(impersonate="chrome", timeout=40)
        session.headers.update({
            "Referer": _ORIGIN,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        })
        self._session = session
        return session

    async def close(self) -> None:
        if self._session is not None:
            try:
                self._session.close()
            except Exception:  # noqa: BLE001
                pass
            self._session = None

    async def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.MIN_REQUEST_INTERVAL:
            await asyncio.sleep(self.MIN_REQUEST_INTERVAL - elapsed)
        self._last_request = time.monotonic()

    async def _request_json(self, url: str, params: dict[str, Any]) -> dict | None:
        for attempt in range(self.MAX_RETRIES):
            try:
                await self._throttle()

                def _do() -> Any:
                    return self._ensure_session().get(url, params=params, timeout=40)

                resp = await asyncio.to_thread(_do)
                if resp.status_code == 200:
                    ctype = resp.headers.get("content-type", "")
                    if "json" not in ctype:
                        # A maintenance or block page returns 200 with HTML.
                        # Parsing it as data would silently yield zero rows.
                        logger.warning(
                            "idx: expected JSON, got %s (attempt %d/%d)",
                            ctype[:40], attempt + 1, self.MAX_RETRIES,
                        )
                    else:
                        return resp.json()
                else:
                    logger.warning(
                        "idx: HTTP %d (attempt %d/%d)",
                        resp.status_code, attempt + 1, self.MAX_RETRIES,
                    )
            except MarketDataError:
                raise
            except Exception as exc:  # noqa: BLE001 — network faults expected
                logger.warning(
                    "idx: request error %s (attempt %d/%d)",
                    type(exc).__name__, attempt + 1, self.MAX_RETRIES,
                )
                await self.close()

            if attempt < self.MAX_RETRIES - 1:
                await asyncio.sleep(
                    self.BASE_BACKOFF * (2 ** attempt) + random.uniform(0, 1.0)
                )

        return None

    # ── Parsing ───────────────────────────────────────────────────────────────

    def _parse_row(self, row: dict[str, Any]) -> DailyBar | None:
        """
        Build a bar from one StockSummary record, or None if unusable.

        IDX includes suspended and non-trading instruments in the board: those
        carry Close = 0 or a zero range. They are dropped rather than stored,
        because a zero-price bar poisons every return, pivot and gap computed
        downstream.
        """
        symbol = (row.get("StockCode") or "").strip().upper()
        if not symbol:
            return None

        close = _as_float(row.get("Close"))
        if close <= 0:
            return None  # suspended / not traded this session

        raw_date = row.get("Date") or ""
        try:
            session = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
        except ValueError:
            logger.debug("idx: unparseable date %r for %s", raw_date, symbol)
            return None
        session = session.replace(
            hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc
        )

        previous = _as_float(row.get("Previous"), close)
        # `OpenPrice` is 0 on instruments that never opened; fall back to the
        # previous close so the bar stays internally coherent.
        open_price = _as_float(row.get("OpenPrice")) or previous or close
        high = _as_float(row.get("High")) or max(open_price, close)
        low = _as_float(row.get("Low")) or min(open_price, close)

        bar = DailyBar(
            symbol=symbol,
            date=session,
            open=open_price,
            high=max(high, open_price, close),
            low=min(low, open_price, close),
            close=close,
            volume=_as_int(row.get("Volume"), 0) or 0,
            previous_close=previous or None,
            foreign_buy=_as_int(row.get("ForeignBuy"), None),
            foreign_sell=_as_int(row.get("ForeignSell"), None),
            listed_shares=_as_int(row.get("ListedShares"), None),
            frequency=_as_int(row.get("Frequency"), None),
            value_idr=_as_float(row.get("Value"), 0.0),
            source=self.name,
        )
        return bar if bar.is_coherent() else None

    # ── Native call: one session, whole board ─────────────────────────────────

    async def get_session_bars(self, session: _date) -> list[DailyBar]:
        """
        Every instrument's bar for one trading session.

        Returns [] for weekends, public holidays, and any date IDX has no data
        for — the caller cannot distinguish those and does not need to.
        """
        if session.weekday() >= 5:
            return []

        payload = await self._request_json(
            _STOCK_SUMMARY_URL,
            {"length": _PAGE_LENGTH, "start": 0, "date": session.strftime("%Y%m%d")},
        )
        if not payload:
            return []

        rows = payload.get("data") or []
        if not rows:
            return []  # holiday or not yet published

        bars: list[DailyBar] = []
        dropped = 0
        for row in rows:
            bar = self._parse_row(row)
            if bar is None:
                dropped += 1
                continue
            bars.append(bar)

        logger.info(
            "idx: %s — %d bars kept, %d dropped (suspended/incoherent)",
            session.isoformat(), len(bars), dropped,
        )
        return bars

    # ── Base interface ────────────────────────────────────────────────────────

    async def get_daily_bars(self, symbol: str, days: int) -> list[DailyBar]:
        """
        Bars for one symbol.

        Costs one request per calendar day because IDX is indexed by date. Use
        `get_session_bars` for anything bulk — this exists so the provider
        satisfies the interface, not because it is the right tool for backfill.
        """
        if days > 30:
            logger.warning(
                "idx: get_daily_bars(%s, %d) issues one request per session. "
                "Use get_session_bars() for bulk backfill.",
                symbol, days,
            )

        symbol = symbol.upper()
        out: list[DailyBar] = []
        cursor = datetime.now(timezone.utc).date()
        # Walk back over calendar days; span exceeds `days` to absorb weekends
        # and IDX holidays.
        horizon = cursor - timedelta(days=int(days * 1.6) + 10)

        async with self._lock:
            while cursor > horizon and len(out) < days:
                for bar in await self.get_session_bars(cursor):
                    if bar.symbol == symbol:
                        out.append(bar)
                        break
                cursor -= timedelta(days=1)

        out.sort(key=lambda b: b.date)
        return out

    async def get_quotes(self, symbols: list[str]) -> QuoteBatch:
        """
        Latest published close per symbol.

        This is end-of-day data. `as_of` is set to the session close, so a
        consumer sees the real age instead of treating a closing price as live.
        The most recent session is found by walking back from today — the last
        few days may be a weekend, a holiday, or simply not yet published.
        """
        wanted = {s.upper() for s in symbols}
        cursor = datetime.now(timezone.utc).date()

        bars: list[DailyBar] = []
        async with self._lock:
            for _ in range(7):  # a week covers any IDX holiday cluster
                bars = await self.get_session_bars(cursor)
                if bars:
                    break
                cursor -= timedelta(days=1)

        if not bars:
            return QuoteBatch(missing=sorted(wanted), provider=self.name)

        as_of = _session_close_utc(cursor)
        age = max(0.0, (datetime.now(timezone.utc) - as_of).total_seconds())

        by_symbol = {b.symbol: b for b in bars if b.symbol in wanted}
        quotes: dict[str, Quote] = {}
        for sym, bar in by_symbol.items():
            quotes[sym] = Quote(
                symbol=sym,
                price=bar.close,
                # Must be the PRIOR session's close. Using this bar's open makes
                # change_pct the intraday move, which can differ in sign from the
                # daily change the UI labels it as.
                prev_close=bar.previous_close or bar.open,
                open=bar.open,
                day_high=bar.high,
                day_low=bar.low,
                volume=bar.volume,
                currency="IDR",
                as_of=as_of,
                delay_seconds=int(age),
                market_state="CLOSED",
                provider=self.name,
                source_label="IDX End-of-Day",
            )

        return QuoteBatch(
            quotes=quotes,
            missing=sorted(wanted - set(quotes)),
            provider=self.name,
        )


async def probe(session: _date | None = None) -> dict[str, Any]:
    """Diagnostic: `python -m ingestor.providers.idx`"""
    provider = IdxProvider()
    try:
        day = session or (datetime.now(timezone.utc).date() - timedelta(days=1))
        for _ in range(7):
            bars = await provider.get_session_bars(day)
            if bars:
                break
            day -= timedelta(days=1)
        with_fx = [b for b in bars if b.foreign_net is not None]
        sample = next((b for b in bars if b.symbol == "BBCA"), bars[0] if bars else None)
        return {
            "session": day.isoformat(),
            "instruments": len(bars),
            "with_foreign_flow": len(with_fx),
            "sample": {
                "symbol": sample.symbol,
                "close": sample.close,
                "volume": sample.volume,
                "foreign_net": sample.foreign_net,
                "listed_shares": sample.listed_shares,
                "value_idr": sample.value_idr,
            } if sample else None,
        }
    finally:
        await provider.close()


if __name__ == "__main__":  # pragma: no cover
    import json

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    print(json.dumps(asyncio.run(probe()), indent=2))
