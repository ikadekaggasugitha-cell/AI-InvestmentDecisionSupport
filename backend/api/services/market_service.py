"""
Market snapshot service — real IDX market data with explicit provenance.

Quotes come from the configured provider (see ingestor/providers/). Every
snapshot carries the exchange timestamp, the vendor-declared delay and the
source label, because the free IDX feed is delayed by ten minutes and a price
rendered without its age reads as the current one.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from api.core.config import get_settings
from api.models.market import (
    FxRate, IhsgSnapshot, IntradayPoint, MarketSnapshot, StockTick,
)

logger = logging.getLogger(__name__)

# ── IDX universe metadata ───────────────────────────────────────────────────

_IDX_METADATA: dict[str, dict[str, Any]] = {
    "BBCA": {"name": "Bank Central Asia",        "sector": "Keuangan",        "sectorEn": "Financials",    "tier": 1, "mktCap": "Rp 1.212T", "pe": 21.4, "lotSize": 100, "portfolioLots": 2000, "defaultPrice": 6350},
    "BBRI": {"name": "Bank Rakyat Indonesia",    "sector": "Keuangan",        "sectorEn": "Financials",    "tier": 1, "mktCap": "Rp 664T",   "pe": 13.8, "lotSize": 100, "portfolioLots": 3500, "defaultPrice": 3120},
    "BMRI": {"name": "Bank Mandiri",             "sector": "Keuangan",        "sectorEn": "Financials",    "tier": 1, "mktCap": "Rp 538T",   "pe": 12.1, "lotSize": 100, "portfolioLots": 3000, "defaultPrice": 4170},
    "TLKM": {"name": "Telkom Indonesia",         "sector": "Telekomunikasi",  "sectorEn": "Telecom",       "tier": 1, "mktCap": "Rp 291T",   "pe": 17.2, "lotSize": 100, "portfolioLots": 5000, "defaultPrice": 2620},
    "ASII": {"name": "Astra International",      "sector": "Konglomerasi",    "sectorEn": "Conglomerate",  "tier": 1, "mktCap": "Rp 191T",   "pe": 11.3, "lotSize": 100, "portfolioLots": 2800, "defaultPrice": 4780},
    "GOTO": {"name": "GoTo Gojek Tokopedia",     "sector": "Teknologi",       "sectorEn": "Technology",    "tier": 1, "mktCap": "Rp 73T",    "pe": None, "lotSize": 100, "portfolioLots": 0,    "defaultPrice": 50},
    "BREN": {"name": "Barito Renewables Energy", "sector": "Energi",          "sectorEn": "Energy",        "tier": 1, "mktCap": "Rp 208T",   "pe": 48.2, "lotSize": 100, "portfolioLots": 1200, "defaultPrice": 3570},
    "ADRO": {"name": "Adaro Energy Indonesia",   "sector": "Energi",          "sectorEn": "Energy",        "tier": 1, "mktCap": "Rp 80T",    "pe": 7.8,  "lotSize": 100, "portfolioLots": 4000, "defaultPrice": 2530},
    "UNVR": {"name": "Unilever Indonesia",       "sector": "Konsumer",        "sectorEn": "Consumer",      "tier": 2, "mktCap": "Rp 117T",   "pe": 23.5, "lotSize": 100, "portfolioLots": 2200, "defaultPrice": 1775},
    "ICBP": {"name": "Indofood CBP Sukses",     "sector": "Konsumer",        "sectorEn": "Consumer",      "tier": 2, "mktCap": "Rp 112T",   "pe": 18.9, "lotSize": 100, "portfolioLots": 1500, "defaultPrice": 7600},
    "ANTM": {"name": "Aneka Tambang",           "sector": "Material",        "sectorEn": "Materials",     "tier": 2, "mktCap": "Rp 44T",    "pe": 14.6, "lotSize": 100, "portfolioLots": 6000, "defaultPrice": 3070},
    "PTBA": {"name": "Bukit Asam",              "sector": "Energi",          "sectorEn": "Energy",        "tier": 2, "mktCap": "Rp 32T",    "pe": 6.4,  "lotSize": 100, "portfolioLots": 0,    "defaultPrice": 2360},
    "KLBF": {"name": "Kalbe Farma",             "sector": "Kesehatan",       "sectorEn": "Healthcare",    "tier": 2, "mktCap": "Rp 76T",    "pe": 22.1, "lotSize": 100, "portfolioLots": 0,    "defaultPrice": 800},
    "SMGR": {"name": "Semen Indonesia",         "sector": "Material",        "sectorEn": "Materials",     "tier": 3, "mktCap": "Rp 25T",    "pe": 15.3, "lotSize": 100, "portfolioLots": 0,    "defaultPrice": 1580},
    "EMTK": {"name": "Elang Mahkota Teknologi", "sector": "Telekomunikasi", "sectorEn": "Telecom",       "tier": 3, "mktCap": "Rp 19T",    "pe": None, "lotSize": 100, "portfolioLots": 0,    "defaultPrice": 505},
}

# ── State storage ─────────────────────────────────────────────────────────────

_current_stocks: dict[str, StockTick] = {}
_history: dict[str, list[float]] = {}
_intraday: list[dict[str, Any]] = []
_ihsg_current: IhsgSnapshot = IhsgSnapshot(value=7448.0, prevClose=7391.0, change=57.0, changePct=0.77)
_portfolio_prev_close: float = 12_480_000_000.0
_last_fetch_time: datetime | None = None
_fx_current: FxRate | None = None
_fetch_lock = asyncio.Lock()

# Provenance of the current snapshot. Empty until the first successful fetch,
# which is how generate_snapshot() distinguishes "real feed" from "placeholder
# state" — without it the UI cannot tell a live price from a seeded constant.
_feed_meta: dict[str, Any] = {}


def is_market_open() -> bool:
    """Checks if Indonesia Stock Exchange (IDX / BEI) is currently open."""
    now = datetime.now(timezone.utc)
    # WIB = UTC+7 (09:00 - 16:00 WIB, Monday to Friday)
    wib_hour = (now.hour + 7) % 24
    wib_minute = now.minute
    weekday = now.weekday()  # 0=Monday, 6=Sunday

    if weekday >= 5:
        return False
    
    current_min = wib_hour * 60 + wib_minute
    open_min = 9 * 60        # 09:00 WIB
    close_min = 16 * 60      # 16:00 WIB
    break_start = 12 * 60    # 12:00 WIB
    break_end = 13 * 60 + 30 # 13:30 WIB (Session 2 starts)

    if current_min < open_min or current_min > close_min:
        return False
    if current_min >= break_start and current_min < break_end:
        return False

    return True


def _init_default_state() -> None:
    """Initialises state from metadata if not yet populated."""
    for sym, meta in _IDX_METADATA.items():
        price = float(meta["defaultPrice"])
        _history[sym] = [price] * 60
        _current_stocks[sym] = StockTick(
            symbol=sym,
            name=meta["name"],
            price=price,
            prevClose=price,
            open=price,
            high=price,
            low=price,
            change=0.0,
            changePct=0.0,
            volume=10_000_000,
            mktCap=meta["mktCap"],
            pe=meta["pe"],
            sector=meta["sector"],
            sectorEn=meta["sectorEn"],
            tier=meta["tier"],
            foreignNet=0.0,
            history=list(_history[sym]),
        )


async def fetch_yahoo_market_data() -> bool:
    """
    Refresh the in-memory snapshot from the configured market data provider.

    Replaces a direct httpx call to Yahoo's v7/quote endpoint that could not
    have worked: Yahoo fingerprints the TLS handshake and answers plain HTTP
    clients with 429 regardless of request rate. The provider layer uses a
    browser-impersonating client and handles the crumb token the endpoint now
    requires.

    Returns True when at least one quote was applied.
    """
    global _ihsg_current, _last_fetch_time, _feed_meta, _fx_current

    from ingestor.providers import MarketDataError, get_provider

    settings = get_settings()
    symbols = list(_IDX_METADATA.keys())

    try:
        provider = get_provider()
        batch = await provider.get_quotes(symbols + ["^JKSE", settings.usdidr_symbol])
    except MarketDataError as exc:
        logger.error("market feed unavailable: %s", exc)
        return False
    except Exception as exc:  # noqa: BLE001 — a feed fault must not kill the poller
        logger.error("market feed error: %s: %s", type(exc).__name__, exc)
        return False

    if not batch.quotes:
        logger.warning("market feed returned no quotes for any symbol")
        return False

    applied = 0

    # ── Index ─────────────────────────────────────────────────────────────────
    jkse = batch.quotes.get("^JKSE")
    if jkse:
        _ihsg_current = IhsgSnapshot(
            value=round(jkse.price, 2),
            prevClose=round(jkse.prev_close, 2),
            change=round(jkse.change, 2),
            changePct=round(jkse.change_pct, 2),
        )

    # ── USD/IDR ───────────────────────────────────────────────────────────────
    fx_quote = batch.quotes.get(settings.usdidr_symbol)
    if fx_quote:
        _fx_current = FxRate(
            pair="USD/IDR",
            rate=round(fx_quote.price, 2),
            prevClose=round(fx_quote.prev_close, 2),
            change=round(fx_quote.change, 2),
            changePct=round(fx_quote.change_pct, 2),
        )

    # ── Constituents ──────────────────────────────────────────────────────────
    for sym, meta in _IDX_METADATA.items():
        quote = batch.quotes.get(sym)
        if quote is None:
            # Keep the previous tick rather than substituting a placeholder:
            # a hardcoded default price would render as a real quote.
            continue

        hist = _history.setdefault(sym, [quote.price] * 60)
        hist.append(quote.price)
        if len(hist) > 60:
            hist.pop(0)

        _current_stocks[sym] = StockTick(
            symbol=sym,
            name=meta["name"],
            price=round(quote.price, 0),
            prevClose=round(quote.prev_close, 0),
            open=round(quote.open, 0),
            high=round(quote.day_high, 0),
            low=round(quote.day_low, 0),
            change=round(quote.change, 0),
            changePct=round(quote.change_pct, 2),
            volume=quote.volume,
            mktCap=meta["mktCap"],
            pe=meta["pe"],
            sector=meta["sector"],
            sectorEn=meta["sectorEn"],
            tier=meta["tier"],
            # IDX foreign flow is not published by this vendor. 0.0 here means
            # "not reported", and the UI must not read it as "zero net flow".
            foreignNet=0.0,
            history=list(hist),
        )
        applied += 1

    if applied == 0:
        logger.warning("market feed returned quotes but none matched the universe")
        return False

    _last_fetch_time = datetime.now(timezone.utc)

    sample = next(iter(batch.quotes.values()))
    _feed_meta = {
        "source": batch.provider,
        "as_of": batch.oldest_as_of,
        "delay_seconds": batch.delay_seconds,
        "market_state": batch.market_state,
        "source_label": sample.source_label,
    }

    if batch.missing:
        logger.warning("market feed missing %d symbol(s): %s",
                       len(batch.missing), ", ".join(batch.missing))

    stale = [s for s, q in batch.quotes.items() if q.is_stale(settings.market_stale_tolerance_sec)]
    if stale:
        logger.warning(
            "market feed stale for %d symbol(s) beyond the declared %ds delay: %s",
            len(stale), batch.delay_seconds, ", ".join(stale[:10]),
        )

    logger.info(
        "market feed refreshed: %d/%d symbols, delay=%ds, state=%s",
        applied, len(symbols), batch.delay_seconds, batch.market_state,
    )

    # Publish the fresh snapshot to Redis so out-of-process consumers see it.
    # Written last, after _feed_meta is set, so the published payload carries
    # the correct provenance rather than the previous poll's.
    await _publish_snapshot_to_redis()
    return True


async def _publish_snapshot_to_redis() -> None:
    """
    Mirror the in-memory snapshot to Redis after each successful poll.

    This is the fix for the disconnected data path: `tick_aggregator` was the
    only writer of these keys and it is not a service in the default stack, so
    the AI Advisor's `get_stock_price` tool (which reads the `market:snapshot`
    hash) always answered "Price data unavailable", and `risk_worker` (which
    reads `market:snapshot:json`) never saw a live portfolio value.

    Two keys, matching the shapes those consumers already expect:
      • `market:snapshot`       HASH   symbol → StockTick JSON (advisor tool)
      • `market:snapshot:json`  STRING full snapshot, TTL 10s (risk_worker)

    Redis is a cache, not the system of record (CON-07): the helpers here are
    fail-open, so a cache outage degrades to the previous behaviour rather than
    breaking the poll.
    """
    from api.core.redis_client import REDIS_KEYS, redis_hset, redis_set_json

    try:
        tick_hash = {
            sym: json.dumps(tick.model_dump(), default=str)
            for sym, tick in _current_stocks.items()
        }
        if tick_hash:
            await redis_hset(REDIS_KEYS["market_snapshot"], tick_hash)

        snapshot = generate_snapshot()
        await redis_set_json(
            "market:snapshot:json", snapshot.model_dump(), ttl=10
        )
    except Exception as exc:  # noqa: BLE001 — a cache write must never fail the poll
        logger.warning("failed to publish market snapshot to redis: %s", exc)


def generate_snapshot() -> MarketSnapshot:
    """
    Produces a MarketSnapshot object from the currently cached live real IDX data.
    """
    if not _current_stocks:
        _init_default_state()

    portfolio_value = 0.0
    for sym, stock in _current_stocks.items():
        meta = _IDX_METADATA.get(sym)
        if meta and meta.get("portfolioLots", 0) > 0:
            portfolio_value += stock.price * meta["portfolioLots"] * meta["lotSize"]

    if portfolio_value == 0:
        portfolio_value = 13_120_000_000.0  # Baseline portfolio ~13.1B IDR

    daily_pnl = portfolio_value - _portfolio_prev_close
    daily_pnl_pct = (daily_pnl / _portfolio_prev_close * 100) if _portfolio_prev_close else 0.0

    now_wib = datetime.now(timezone.utc)
    wib_h = (now_wib.hour + 7) % 24
    wib_m = now_wib.minute
    time_label = f"{wib_h:02d}:{wib_m:02d}"

    intraday_point = IntradayPoint(
        time=time_label,
        value=round(portfolio_value, 0),
        ihsg=round(_ihsg_current.value, 2),
    )
    _intraday.append(intraday_point.model_dump())
    if len(_intraday) > 420:
        _intraday.pop(0)

    # Provenance. `_feed_meta` is empty until a fetch succeeds, so an unreached
    # feed reports source="placeholder" rather than silently presenting the
    # seeded constants in _IDX_METADATA as live quotes.
    as_of: datetime | None = _feed_meta.get("as_of")
    age = (datetime.now(timezone.utc) - as_of).total_seconds() if as_of else None
    delay = int(_feed_meta.get("delay_seconds", 0))

    return MarketSnapshot(
        stocks=_current_stocks,
        intradayChart=[IntradayPoint(**p) for p in _intraday[-120:]],
        portfolioValue=round(portfolio_value, 0),
        portfolioPrevClose=_portfolio_prev_close,
        dailyPnL=round(daily_pnl, 0),
        dailyPnLPct=round(daily_pnl_pct, 2),
        ihsg=_ihsg_current,
        fx=_fx_current,
        isMarketOpen=is_market_open(),
        lastUpdated=_last_fetch_time or datetime.now(timezone.utc),
        dataSource=_feed_meta.get("source", "placeholder"),
        dataAsOf=as_of,
        dataAgeSeconds=round(age, 1) if age is not None else None,
        delaySeconds=delay,
        isDelayed=delay > 0,
        sourceLabel=_feed_meta.get("source_label", ""),
    )
