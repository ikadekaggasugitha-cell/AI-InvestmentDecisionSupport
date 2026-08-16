"""
Broker Summary Scraper — Phase 10

Scrapes broker summary data from IDX.co.id (primary) and RTI Business (fallback).
Features robust anti-blocking with proxy rotation, UA rotation, cookie cycling,
and exponential backoff.

Run with:
    python -m ingestor.broksum_scraper

Environment:
    USE_MOCK_BROKSUM=false
    PROXY_POOL_API_KEY=xxx
    BROKSUM_SCRAPE_SOURCE=idx   (idx | rti | both)
"""

import asyncio
import hashlib
import json
import logging
import random
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from bs4 import BeautifulSoup

from api.core.config import get_settings

logger = logging.getLogger(__name__)

# ── IDX LQ45 + IDX30 universe ────────────────────────────────────────────────

IDX_BROKSUM_SYMBOLS: list[str] = [
    "BBCA", "BBRI", "BMRI", "TLKM", "ASII", "ADRO", "BREN", "GOTO",
    "ANTM", "UNVR", "ICBP", "INDF", "KLBF", "PGAS", "PTBA", "SMGR",
    "TBIG", "EXCL", "HMSP", "GGRM", "EMTK", "ESSA", "CPIN", "MDKA",
    "ARTO", "BBNI", "BBTN", "BRIS", "BTPS", "MAPI", "ERAA", "AKRA",
    "TOWR", "INKP", "MEDC", "INCO", "BRPT", "SCMA", "TPIA", "ADMR",
    "PGEO", "PNBN", "JPFA", "ACES", "MNCN", "AMRT", "LSIP", "DSNG",
    "HRUM", "ITMG",
]


class ProxyPool:
    """Manages proxy rotation via ScraperAPI / BrightData / SmartProxy."""

    def __init__(self, api_key: str, provider: str = "scraperapi") -> None:
        self._api_key = api_key
        self._provider = provider
        self._request_count = 0

    def get_proxy_url(self, target_url: str) -> str:
        """Returns proxied URL based on provider."""
        self._request_count += 1

        if self._provider == "scraperapi":
            return (
                f"https://api.scraperapi.com?api_key={self._api_key}"
                f"&url={target_url}&render=false&country_code=id"
            )
        elif self._provider == "brightdata":
            # BrightData uses proxy endpoint
            return target_url  # Headers set separately
        else:
            return target_url

    def get_proxy_headers(self) -> dict[str, str]:
        """Returns provider-specific authentication headers."""
        if self._provider == "brightdata":
            return {"Proxy-Authorization": f"Basic {self._api_key}"}
        return {}

    @property
    def stats(self) -> dict:
        return {"provider": self._provider, "requests": self._request_count}


class BroksumScraper:
    """
    Vendor-agnostic broker summary scraper.

    Supports IDX.co.id (primary) and RTI Business (fallback).
    Handles proxy rotation, UA rotation, cookie cycling, and retry logic.
    """

    # IDX.co.id endpoints
    IDX_BROKSUM_URL = "https://www.idx.co.id/umbraco/Surface/TradingSummary/GetBrokerSummary"
    # RTI Business endpoint
    RTI_BROKSUM_URL = "https://www.rti.co.id/api/broker-summary"

    MAX_RETRIES = 3
    RETRY_BASE_DELAY = 2.0

    def __init__(self) -> None:
        self.settings = get_settings()
        self._proxy: ProxyPool | None = None
        self._session_id = 0
        self._cookies: dict[str, str] = {}

        if self.settings.proxy_pool_api_key:
            self._proxy = ProxyPool(
                api_key=self.settings.proxy_pool_api_key,
                provider=self.settings.proxy_pool_provider,
            )

    def _get_ua(self) -> str:
        """Rotate User-Agent from configured pool."""
        return random.choice(self.settings.broksum_user_agents)

    def _cycle_session(self) -> None:
        """Cycle cookies every 10 requests to avoid fingerprinting."""
        self._session_id += 1
        self._cookies = {
            "session_id": hashlib.md5(
                f"aidss-{self._session_id}-{time.time()}".encode()
            ).hexdigest()[:16],
        }

    async def _request_with_retry(
        self,
        url: str,
        params: dict | None = None,
        source: str = "idx",
    ) -> str | None:
        """
        Make HTTP request with exponential backoff retry.
        Returns response text or None on failure.
        """
        for attempt in range(self.MAX_RETRIES):
            try:
                # Cycle session every 10 requests
                if self._session_id % 10 == 0:
                    self._cycle_session()

                # Apply proxy if available
                request_url = url
                extra_headers: dict[str, str] = {}
                if self._proxy:
                    request_url = self._proxy.get_proxy_url(url)
                    extra_headers = self._proxy.get_proxy_headers()

                headers = {
                    "User-Agent": self._get_ua(),
                    "Accept": "application/json, text/html, */*",
                    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
                    "Referer": "https://www.idx.co.id/" if source == "idx" else "https://www.rti.co.id/",
                    "X-Requested-With": "XMLHttpRequest",
                    **extra_headers,
                }

                # Random delay 1-3 seconds between requests
                await asyncio.sleep(random.uniform(1.0, 3.0))

                async with httpx.AsyncClient(
                    timeout=15.0,
                    follow_redirects=True,
                    cookies=self._cookies,
                ) as client:
                    resp = await client.get(request_url, params=params, headers=headers)

                    if resp.status_code == 200:
                        return resp.text
                    elif resp.status_code == 429:
                        # Rate limited — wait longer
                        delay = self.RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(1, 5)
                        logger.warning(
                            "broksum_scraper: rate limited (429), retrying in %.1fs (attempt %d/%d)",
                            delay, attempt + 1, self.MAX_RETRIES,
                        )
                        await asyncio.sleep(delay)
                    elif resp.status_code == 403:
                        logger.warning(
                            "broksum_scraper: blocked (403) from %s, attempt %d/%d",
                            source, attempt + 1, self.MAX_RETRIES,
                        )
                        self._cycle_session()
                        await asyncio.sleep(self.RETRY_BASE_DELAY * (2 ** attempt))
                    else:
                        logger.warning(
                            "broksum_scraper: HTTP %d from %s, attempt %d/%d",
                            resp.status_code, source, attempt + 1, self.MAX_RETRIES,
                        )
                        await asyncio.sleep(self.RETRY_BASE_DELAY * (2 ** attempt))

            except httpx.TimeoutException:
                logger.warning(
                    "broksum_scraper: timeout from %s, attempt %d/%d",
                    source, attempt + 1, self.MAX_RETRIES,
                )
                await asyncio.sleep(self.RETRY_BASE_DELAY * (2 ** attempt))
            except Exception as exc:
                logger.error(
                    "broksum_scraper: unexpected error — %s (attempt %d/%d)",
                    exc, attempt + 1, self.MAX_RETRIES,
                )
                await asyncio.sleep(self.RETRY_BASE_DELAY * (2 ** attempt))

        return None

    def _parse_idx_response(self, raw: str, symbol: str) -> list[dict[str, Any]]:
        """
        Parse IDX.co.id broker summary JSON/HTML response.

        IDX returns a JSON payload with broker-level buy/sell data:
        {
            "data": [
                {"broker": "YP", "bVol": 15000, "sVol": 8000, "bVal": ..., "sVal": ..., ...},
                ...
            ]
        }
        """
        rows: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc)

        try:
            data = json.loads(raw)
            items = data.get("data", [])

            for item in items:
                broker_code = item.get("broker", item.get("kode", "")).strip().upper()
                if not broker_code or len(broker_code) != 2:
                    continue

                buy_lot = int(item.get("bVol", item.get("buy_vol", 0)))
                sell_lot = int(item.get("sVol", item.get("sell_vol", 0)))
                buy_val = float(item.get("bVal", item.get("buy_val", 0)))
                sell_val = float(item.get("sVal", item.get("sell_val", 0)))

                avg_buy_price = round(buy_val / (buy_lot * 100), 2) if buy_lot > 0 else 0
                avg_sell_price = round(sell_val / (sell_lot * 100), 2) if sell_lot > 0 else 0

                rows.append({
                    "time": now,
                    "symbol": symbol,
                    "broker_code": broker_code,
                    "buy_lot": buy_lot,
                    "sell_lot": sell_lot,
                    "buy_val": buy_val,
                    "sell_val": sell_val,
                    "net_lot": buy_lot - sell_lot,
                    "net_val": round(buy_val - sell_val, 2),
                    "avg_buy_price": avg_buy_price,
                    "avg_sell_price": avg_sell_price,
                })

        except json.JSONDecodeError:
            # Fallback: try HTML parsing
            rows = self._parse_idx_html(raw, symbol)
        except Exception as exc:
            logger.error("broksum_scraper: parse error for %s — %s", symbol, exc)

        return rows

    def _parse_idx_html(self, html: str, symbol: str) -> list[dict[str, Any]]:
        """
        Fallback HTML parser for IDX broker summary page.
        Parses <table> elements to extract broker data.
        """
        rows: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc)

        try:
            soup = BeautifulSoup(html, "lxml")
            table = soup.find("table", class_="table-bordered")
            if not table:
                table = soup.find("table")

            if not table:
                logger.warning("broksum_scraper: no table found in HTML for %s", symbol)
                return rows

            tbody = table.find("tbody")
            if not tbody:
                return rows

            for tr in tbody.find_all("tr"):
                cells = tr.find_all("td")
                if len(cells) < 5:
                    continue

                try:
                    broker_code = cells[0].get_text(strip=True).upper()
                    buy_lot = int(cells[1].get_text(strip=True).replace(",", "").replace(".", "") or 0)
                    sell_lot = int(cells[2].get_text(strip=True).replace(",", "").replace(".", "") or 0)
                    buy_val = float(cells[3].get_text(strip=True).replace(",", "").replace(".", "") or 0)
                    sell_val = float(cells[4].get_text(strip=True).replace(",", "").replace(".", "") or 0)

                    avg_buy_price = round(buy_val / (buy_lot * 100), 2) if buy_lot > 0 else 0
                    avg_sell_price = round(sell_val / (sell_lot * 100), 2) if sell_lot > 0 else 0

                    rows.append({
                        "time": now,
                        "symbol": symbol,
                        "broker_code": broker_code,
                        "buy_lot": buy_lot,
                        "sell_lot": sell_lot,
                        "buy_val": buy_val,
                        "sell_val": sell_val,
                        "net_lot": buy_lot - sell_lot,
                        "net_val": round(buy_val - sell_val, 2),
                        "avg_buy_price": avg_buy_price,
                        "avg_sell_price": avg_sell_price,
                    })
                except (ValueError, IndexError):
                    continue

        except Exception as exc:
            logger.error("broksum_scraper: HTML parse error for %s — %s", symbol, exc)

        return rows

    def _parse_rti_response(self, raw: str, symbol: str) -> list[dict[str, Any]]:
        """Parse RTI Business JSON response."""
        rows: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc)

        try:
            data = json.loads(raw)
            items = data if isinstance(data, list) else data.get("data", data.get("result", []))

            for item in items:
                broker_code = str(item.get("broker_code", item.get("code", ""))).strip().upper()
                if not broker_code:
                    continue

                buy_lot = int(item.get("buy_lot", item.get("bLot", 0)))
                sell_lot = int(item.get("sell_lot", item.get("sLot", 0)))
                buy_val = float(item.get("buy_val", item.get("bVal", 0)))
                sell_val = float(item.get("sell_val", item.get("sVal", 0)))

                avg_buy_price = round(buy_val / (buy_lot * 100), 2) if buy_lot > 0 else 0
                avg_sell_price = round(sell_val / (sell_lot * 100), 2) if sell_lot > 0 else 0

                rows.append({
                    "time": now,
                    "symbol": symbol,
                    "broker_code": broker_code,
                    "buy_lot": buy_lot,
                    "sell_lot": sell_lot,
                    "buy_val": buy_val,
                    "sell_val": sell_val,
                    "net_lot": buy_lot - sell_lot,
                    "net_val": round(buy_val - sell_val, 2),
                    "avg_buy_price": avg_buy_price,
                    "avg_sell_price": avg_sell_price,
                })
        except Exception as exc:
            logger.error("broksum_scraper: RTI parse error for %s — %s", symbol, exc)

        return rows

    async def scrape_symbol(self, symbol: str) -> list[dict[str, Any]]:
        """
        Scrape broker summary for a single symbol.
        Tries primary source first, falls back to secondary.
        """
        source = self.settings.broksum_scrape_source
        rows: list[dict[str, Any]] = []

        # Primary: IDX.co.id
        if source in ("idx", "both"):
            raw = await self._request_with_retry(
                self.IDX_BROKSUM_URL,
                params={"code": symbol, "length": "30", "start": "0"},
                source="idx",
            )
            if raw:
                rows = self._parse_idx_response(raw, symbol)

        # Fallback / secondary: RTI Business
        if not rows and source in ("rti", "both"):
            raw = await self._request_with_retry(
                f"{self.RTI_BROKSUM_URL}/{symbol}",
                source="rti",
            )
            if raw:
                rows = self._parse_rti_response(raw, symbol)

        if rows:
            logger.info("broksum_scraper: %s — %d broker rows", symbol, len(rows))
        else:
            logger.warning("broksum_scraper: %s — no data from any source", symbol)

        return rows

    async def scrape_all(
        self,
        symbols: list[str] | None = None,
        concurrency: int = 3,
    ) -> dict[str, list[dict[str, Any]]]:
        """
        Scrape broker summary for all symbols with limited concurrency.

        Args:
            symbols: List of stock symbols. Defaults to IDX_BROKSUM_SYMBOLS.
            concurrency: Max concurrent scraping tasks (keep low to avoid blocking).
        """
        if symbols is None:
            symbols = IDX_BROKSUM_SYMBOLS

        results: dict[str, list[dict[str, Any]]] = {}
        semaphore = asyncio.Semaphore(concurrency)

        async def _scrape_with_limit(sym: str) -> None:
            async with semaphore:
                rows = await self.scrape_symbol(sym)
                results[sym] = rows

        tasks = [_scrape_with_limit(sym) for sym in symbols]
        await asyncio.gather(*tasks, return_exceptions=True)

        total_rows = sum(len(v) for v in results.values())
        logger.info(
            "broksum_scraper: completed — %d symbols, %d total rows",
            len(results), total_rows,
        )

        if self._proxy:
            logger.info("broksum_scraper: proxy stats — %s", self._proxy.stats)

        return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    scraper = BroksumScraper()
    results = asyncio.run(scraper.scrape_all(symbols=["BBCA", "BBRI"]))
    for sym, rows in results.items():
        print(f"\n{sym}: {len(rows)} brokers")
        for r in rows[:3]:
            print(f"  {r['broker_code']}: buy={r['buy_lot']}, sell={r['sell_lot']}, net={r['net_lot']}")
