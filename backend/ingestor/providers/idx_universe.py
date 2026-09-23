"""
IDX instrument-universe provider — the full listed board with names and sectors.

Why this is separate from `idx.py`
----------------------------------
`idx.py` answers "what were every instrument's OHLCV bars for a session?" This
module answers a different question: "what securities are listed, and what are
their names, sectors and boards?" That is reference data, not time series, so it
has its own provider and feeds the `instruments` dimension table rather than
`ohlcv`.

Source
------
IDX `GetCompanyProfiles?emitenType=s` returns all ~960 listed stocks in ONE
response, each carrying NamaEmiten, Sektor / SubSektor (IDX-IC), Industri /
SubIndustri, PapanPencatatan (board), TanggalPencatatan (listing date) and
Status. It does NOT carry shares outstanding, so `GetSecuritiesStock` is merged
in as a best-effort second source for `listed_shares` (its `Shares` field). If
that second call fails the universe is still complete — only listed_shares is
left NULL, to be filled from `ohlcv.listed_shares` later.

Robustness ("tidak rapuh")
--------------------------
idx.co.id sits behind Cloudflare. Two things were learned the hard way and are
baked in here:

  * `curl_cffi(impersonate="chrome")` — the value the older `idx.py` still uses —
    now draws a 403 "Just a moment…" challenge. Recent named profiles
    (`chrome131`, `chrome124`, `safari`) pass. So this provider ROTATES through a
    list of known-good impersonations and drops any that get challenged.
  * The JSON endpoints only clear once a normal homepage GET has planted the
    Cloudflare cookie. So every session warms up on `https://www.idx.co.id/`
    before touching an API path.

The provider RAISES `MarketDataError` only when it cannot get the universe at
all. The worker treats that as "keep the last good universe" — the DB is the
durable cache, so a bad fetch degrades to staleness, never to an empty board.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass
from datetime import date as _date
from datetime import datetime
from typing import Any

from ingestor.providers.base import MarketDataError

logger = logging.getLogger(__name__)

_ORIGIN = "https://www.idx.co.id/"
_PROFILES_URL = "https://www.idx.co.id/primary/ListedCompany/GetCompanyProfiles"
_SECURITIES_URL = "https://www.idx.co.id/primary/StockData/GetSecuritiesStock"

# One page big enough to hold the whole board; the endpoints return everything in
# a single response at this length.
_PAGE_LENGTH = 2000

# Known-good curl_cffi impersonation profiles, newest first. Bare "chrome" is
# deliberately absent: it is currently challenged by Cloudflare. The provider
# rotates to the next entry whenever one starts drawing challenges.
_IMPERSONATIONS = ("chrome131", "chrome124", "chrome120", "safari", "edge101")


@dataclass(frozen=True)
class Instrument:
    """One listed IDX security's reference data."""

    symbol: str
    name: str | None = None
    sector: str | None = None
    sub_sector: str | None = None
    industry: str | None = None
    sub_industry: str | None = None
    board: str | None = None
    listing_date: _date | None = None
    listed_shares: int | None = None
    status: str | None = None


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_listing_date(value: Any) -> _date | None:
    raw = _clean(value)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _as_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


class IdxUniverseProvider:
    """Fetches the listed-board reference data from IDX, resiliently."""

    name = "idx_universe"

    MAX_RETRIES = 4
    BASE_BACKOFF = 2.0
    MIN_REQUEST_INTERVAL = 1.0

    def __init__(self) -> None:
        self._session: Any = None
        self._imp_index = 0
        self._warmed = False
        self._last_request = 0.0
        self._lock = asyncio.Lock()

    # ── Session / Cloudflare handling ─────────────────────────────────────────

    def _build_session(self, impersonate: str) -> Any:
        try:
            from curl_cffi import requests as curl_requests
        except ImportError as exc:  # pragma: no cover — dependency is pinned
            raise MarketDataError(
                "curl_cffi is required for the IDX universe provider. "
                "Install it: pip install curl_cffi"
            ) from exc

        session = curl_requests.Session(impersonate=impersonate, timeout=60)
        session.headers.update({
            "Referer": _ORIGIN,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        })
        return session

    def _ensure_session(self) -> Any:
        """Session bound to the current impersonation, warmed past Cloudflare."""
        if self._session is None:
            impersonate = _IMPERSONATIONS[self._imp_index % len(_IMPERSONATIONS)]
            self._session = self._build_session(impersonate)
            self._warmed = False
            logger.info("idx_universe: session using impersonate=%s", impersonate)

        if not self._warmed:
            # The JSON API only clears once the homepage has set the CF cookie.
            try:
                self._session.get(_ORIGIN, timeout=40)
            except Exception as exc:  # noqa: BLE001 — warmup is best-effort
                logger.debug("idx_universe: homepage warmup failed: %s", exc)
            self._warmed = True

        return self._session

    def _rotate_impersonation(self) -> None:
        """Drop the current session and move to the next impersonation profile."""
        self._reset_session()
        self._imp_index += 1

    def _reset_session(self) -> None:
        if self._session is not None:
            try:
                self._session.close()
            except Exception:  # noqa: BLE001
                pass
        self._session = None
        self._warmed = False

    async def close(self) -> None:
        self._reset_session()

    async def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.MIN_REQUEST_INTERVAL:
            await asyncio.sleep(self.MIN_REQUEST_INTERVAL - elapsed)
        self._last_request = time.monotonic()

    async def _request_json(self, url: str, params: dict[str, Any]) -> dict | None:
        """
        GET with retry, impersonation rotation and Cloudflare-challenge detection.

        Returns None when every attempt failed; the caller decides whether that
        is fatal (no universe at all) or merely a missing enrichment.
        """
        for attempt in range(self.MAX_RETRIES):
            try:
                await self._throttle()

                def _do() -> Any:
                    return self._ensure_session().get(url, params=params, timeout=60)

                resp = await asyncio.to_thread(_do)
                ctype = resp.headers.get("content-type", "")

                if resp.status_code == 200 and "json" in ctype:
                    return resp.json()

                # 403 / HTML body == Cloudflare challenge for this fingerprint.
                # Rotating the impersonation is the fix, not backing off harder.
                if resp.status_code in (403, 503) or "json" not in ctype:
                    logger.warning(
                        "idx_universe: HTTP %d ctype=%s — rotating impersonation "
                        "(attempt %d/%d)",
                        resp.status_code, ctype[:30], attempt + 1, self.MAX_RETRIES,
                    )
                    self._rotate_impersonation()
                else:
                    logger.warning(
                        "idx_universe: HTTP %d (attempt %d/%d)",
                        resp.status_code, attempt + 1, self.MAX_RETRIES,
                    )
            except MarketDataError:
                raise
            except Exception as exc:  # noqa: BLE001 — network faults expected
                logger.warning(
                    "idx_universe: request error %s (attempt %d/%d)",
                    type(exc).__name__, attempt + 1, self.MAX_RETRIES,
                )
                self._rotate_impersonation()

            if attempt < self.MAX_RETRIES - 1:
                await asyncio.sleep(
                    self.BASE_BACKOFF * (2 ** attempt) + random.uniform(0, 1.0)
                )

        return None

    # ── Fetch + parse ─────────────────────────────────────────────────────────

    async def _fetch_shares(self) -> dict[str, int]:
        """Best-effort map of symbol → listed shares from GetSecuritiesStock."""
        payload = await self._request_json(
            _SECURITIES_URL, {"start": 0, "length": _PAGE_LENGTH}
        )
        if not payload:
            logger.warning(
                "idx_universe: GetSecuritiesStock unavailable — listed_shares "
                "will be left for the OHLCV feed to fill."
            )
            return {}

        shares: dict[str, int] = {}
        for row in payload.get("data") or []:
            code = _clean(row.get("Code"))
            n = _as_int(row.get("Shares"))
            if code and n is not None:
                shares[code.upper()] = n
        return shares

    async def fetch_universe(self) -> list[Instrument]:
        """
        The full listed board with metadata.

        Raises MarketDataError only when the primary profiles endpoint yields
        nothing — i.e. there is no universe to return at all.
        """
        async with self._lock:
            payload = await self._request_json(
                _PROFILES_URL,
                {"start": 0, "length": _PAGE_LENGTH, "emitenType": "s"},
            )
            if not payload:
                raise MarketDataError(
                    "idx_universe: GetCompanyProfiles returned no data after "
                    "rotating every impersonation profile. Universe left unchanged."
                )

            rows = payload.get("data") or []
            shares = await self._fetch_shares()

        instruments: list[Instrument] = []
        seen: set[str] = set()
        for row in rows:
            symbol = _clean(row.get("KodeEmiten"))
            if not symbol:
                continue
            symbol = symbol.upper()
            if symbol in seen:
                continue
            seen.add(symbol)

            instruments.append(Instrument(
                symbol=symbol,
                name=_clean(row.get("NamaEmiten")),
                sector=_clean(row.get("Sektor")),
                sub_sector=_clean(row.get("SubSektor")),
                industry=_clean(row.get("Industri")),
                sub_industry=_clean(row.get("SubIndustri")),
                board=_clean(row.get("PapanPencatatan")),
                listing_date=_parse_listing_date(row.get("TanggalPencatatan")),
                listed_shares=shares.get(symbol),
                status=_clean(row.get("Status")),
            ))

        if not instruments:
            raise MarketDataError(
                "idx_universe: GetCompanyProfiles returned rows but none had a "
                "usable KodeEmiten."
            )

        logger.info(
            "idx_universe: fetched %d instruments (%d with listed_shares)",
            len(instruments), sum(1 for i in instruments if i.listed_shares),
        )
        return instruments


async def probe() -> dict[str, Any]:
    """Diagnostic: `python -m ingestor.providers.idx_universe`"""
    provider = IdxUniverseProvider()
    try:
        universe = await provider.fetch_universe()
        from collections import Counter
        sectors = Counter(i.sector or "?" for i in universe)
        sample = next((i for i in universe if i.symbol == "BBCA"), universe[0])
        return {
            "count": len(universe),
            "sectors": dict(sectors.most_common()),
            "with_shares": sum(1 for i in universe if i.listed_shares),
            "sample": {
                "symbol": sample.symbol,
                "name": sample.name,
                "sector": sample.sector,
                "sub_sector": sample.sub_sector,
                "board": sample.board,
                "listing_date": sample.listing_date.isoformat() if sample.listing_date else None,
                "listed_shares": sample.listed_shares,
            },
        }
    finally:
        await provider.close()


if __name__ == "__main__":  # pragma: no cover
    import json

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    print(json.dumps(asyncio.run(probe()), indent=2, ensure_ascii=False))
