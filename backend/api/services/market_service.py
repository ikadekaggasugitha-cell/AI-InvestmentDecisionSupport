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
import random
from datetime import datetime, timezone
from typing import Any

from api.core.config import get_settings
from api.models.market import (
    FxRate, IhsgSnapshot, IntradayPoint, MarketSnapshot, StockTick,
)

logger = logging.getLogger(__name__)

# ── IDX universe metadata ───────────────────────────────────────────────────
#
# The universe is loaded from the `instruments` table at runtime (see
# _load_universe), so the live snapshot covers the WHOLE listed board (~960
# securities), not a hardcoded handful. `_FALLBACK_METADATA` below is only the
# LAST-RESORT SEED: it lets the API boot and serve something sane if the DB is
# unreachable before the first universe load. Once _load_universe succeeds,
# `_IDX_METADATA` is replaced wholesale by the DB-backed dict.

from api.services.symbols_service import SECTOR_EN

_FALLBACK_METADATA: dict[str, dict[str, Any]] = {
    "BBCA": {"name": "Bank Central Asia",        "sector": "Keuangan",        "sectorEn": "Financials",    "tier": 1, "mktCap": "Rp 1.212T", "pe": 21.4, "lotSize": 100, "defaultPrice": 6350},
    "BBRI": {"name": "Bank Rakyat Indonesia",    "sector": "Keuangan",        "sectorEn": "Financials",    "tier": 1, "mktCap": "Rp 664T",   "pe": 13.8, "lotSize": 100, "defaultPrice": 3120},
    "BMRI": {"name": "Bank Mandiri",             "sector": "Keuangan",        "sectorEn": "Financials",    "tier": 1, "mktCap": "Rp 538T",   "pe": 12.1, "lotSize": 100, "defaultPrice": 4170},
    "TLKM": {"name": "Telkom Indonesia",         "sector": "Telekomunikasi",  "sectorEn": "Telecom",       "tier": 1, "mktCap": "Rp 291T",   "pe": 17.2, "lotSize": 100, "defaultPrice": 2620},
    "ASII": {"name": "Astra International",      "sector": "Konglomerasi",    "sectorEn": "Conglomerate",  "tier": 1, "mktCap": "Rp 191T",   "pe": 11.3, "lotSize": 100, "defaultPrice": 4780},
    "GOTO": {"name": "GoTo Gojek Tokopedia",     "sector": "Teknologi",       "sectorEn": "Technology",    "tier": 1, "mktCap": "Rp 73T",    "pe": None, "lotSize": 100, "defaultPrice": 50},
    "BREN": {"name": "Barito Renewables Energy", "sector": "Energi",          "sectorEn": "Energy",        "tier": 1, "mktCap": "Rp 208T",   "pe": 48.2, "lotSize": 100, "defaultPrice": 3570},
    "ADRO": {"name": "Adaro Energy Indonesia",   "sector": "Energi",          "sectorEn": "Energy",        "tier": 1, "mktCap": "Rp 80T",    "pe": 7.8,  "lotSize": 100, "defaultPrice": 2530},
    "UNVR": {"name": "Unilever Indonesia",       "sector": "Konsumer",        "sectorEn": "Consumer",      "tier": 2, "mktCap": "Rp 117T",   "pe": 23.5, "lotSize": 100, "defaultPrice": 1775},
    "ICBP": {"name": "Indofood CBP Sukses",     "sector": "Konsumer",        "sectorEn": "Consumer",      "tier": 2, "mktCap": "Rp 112T",   "pe": 18.9, "lotSize": 100, "defaultPrice": 7600},
    "ANTM": {"name": "Aneka Tambang",           "sector": "Material",        "sectorEn": "Materials",     "tier": 2, "mktCap": "Rp 44T",    "pe": 14.6, "lotSize": 100, "defaultPrice": 3070},
    "PTBA": {"name": "Bukit Asam",              "sector": "Energi",          "sectorEn": "Energy",        "tier": 2, "mktCap": "Rp 32T",    "pe": 6.4,  "lotSize": 100, "defaultPrice": 2360},
    "KLBF": {"name": "Kalbe Farma",             "sector": "Kesehatan",       "sectorEn": "Healthcare",    "tier": 2, "mktCap": "Rp 76T",    "pe": 22.1, "lotSize": 100, "defaultPrice": 800},
    "SMGR": {"name": "Semen Indonesia",         "sector": "Material",        "sectorEn": "Materials",     "tier": 3, "mktCap": "Rp 25T",    "pe": 15.3, "lotSize": 100, "defaultPrice": 1580},
    "EMTK": {"name": "Elang Mahkota Teknologi", "sector": "Telekomunikasi", "sectorEn": "Telecom",       "tier": 3, "mktCap": "Rp 19T",    "pe": None, "lotSize": 100, "defaultPrice": 505},
}

# Portfolio holdings → lots, kept separate from the universe: these are the
# operator's positions, legitimately fixed, and drive the portfolio-value line.
# The universe itself carries no per-symbol lots (a 960-stock board has none).
_PORTFOLIO_LOTS: dict[str, int] = {
    "BBCA": 2000, "BBRI": 3500, "TLKM": 5000, "ASII": 2800, "BREN": 1200,
    "ADRO": 4000, "BMRI": 3000, "UNVR": 2200, "ICBP": 1500, "ANTM": 6000,
}

# The live universe metadata, replaced by _load_universe from the DB. Starts as
# the fallback so the service is usable before the first load.
_IDX_METADATA: dict[str, dict[str, Any]] = dict(_FALLBACK_METADATA)
_universe_loaded_at: datetime | None = None
_UNIVERSE_TTL_SEC = 1800  # reload the board every 30 min; it changes slowly


def _format_mktcap(cap: float | None) -> str:
    """Indonesian-convention market-cap label. 1e12 IDR = 1 triliun."""
    if not cap or cap <= 0:
        return "—"
    if cap >= 1e12:
        return f"Rp {cap / 1e12:,.1f}T"
    if cap >= 1e9:
        return f"Rp {cap / 1e9:,.1f}M"   # miliar
    return f"Rp {cap / 1e6:,.0f}Jt"      # juta


async def _load_universe(force: bool = False) -> None:
    """
    Populate `_IDX_METADATA` from the `instruments` table joined with the last
    daily close, so the live snapshot spans the whole listed board.

    Tier is derived from market-cap rank (top 45 → 1, next 100 → 2, rest → 3),
    matching the existing tier semantics (1 = large/liquid). Cached for
    `_UNIVERSE_TTL_SEC`; a DB fault leaves the previous universe in place rather
    than shrinking the board mid-session.
    """
    global _IDX_METADATA, _universe_loaded_at

    now = datetime.now(timezone.utc)
    if (
        not force
        and _universe_loaded_at is not None
        and (now - _universe_loaded_at).total_seconds() < _UNIVERSE_TTL_SEC
    ):
        return

    settings = get_settings()
    if settings.use_mock_market:
        return

    try:
        import asyncpg

        conn = await asyncpg.connect(
            settings.database_url.replace("postgresql+asyncpg://", "postgresql://"),
            timeout=8,
        )
        try:
            rows = await conn.fetch(
                """
                WITH latest AS (
                    SELECT DISTINCT ON (symbol) symbol, close
                    FROM ohlcv_daily ORDER BY symbol, bucket DESC
                )
                SELECT i.symbol, i.name, i.sector, i.listed_shares,
                       l.close AS last_close
                FROM instruments i
                LEFT JOIN latest l ON l.symbol = i.symbol
                WHERE i.is_active
                """
            )
        finally:
            await conn.close()
    except Exception as exc:  # noqa: BLE001 — keep the previous universe on fault
        logger.warning("market_service: universe load skipped — %s", exc)
        return

    if not rows:
        logger.warning("market_service: instruments table empty — keeping fallback universe")
        return

    def _cap(r: Any) -> float:
        c = float(r["last_close"]) if r["last_close"] is not None else 0.0
        s = int(r["listed_shares"]) if r["listed_shares"] is not None else 0
        return c * s

    ranked = sorted(rows, key=_cap, reverse=True)
    meta: dict[str, dict[str, Any]] = {}
    for rank, r in enumerate(ranked):
        sym = r["symbol"]
        close = float(r["last_close"]) if r["last_close"] is not None else 0.0
        sector = r["sector"] or "—"
        tier = 1 if rank < 45 else (2 if rank < 145 else 3)
        meta[sym] = {
            "name": r["name"] or sym,
            "sector": sector,
            "sectorEn": SECTOR_EN.get(sector, sector),
            "tier": tier,
            "mktCap": _format_mktcap(_cap(r)),
            "pe": None,
            "lotSize": 100,
            # Seed price: the real last close. 0 means never traded / no bar yet;
            # such symbols are seeded at a nominal price and carry no live quote.
            "defaultPrice": close if close > 0 else 50.0,
        }

    if meta:
        _IDX_METADATA = meta
        _universe_loaded_at = now
        logger.info("market_service: universe loaded — %d instruments", len(meta))

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

# ── Intraday tick simulation ──────────────────────────────────────────────────
# The Yahoo feed is delayed ~10 min and only re-polled once a minute, so between
# polls every price is frozen. To give the board a live "running" feel (like
# Stockbit) WITHOUT misrepresenting the data, we let prices breathe with a small
# bounded random walk between real polls — but ONLY during market hours, always
# anchored to the last REAL price, and re-synced to reality on every poll. The
# movement between polls is an ESTIMATE, and the snapshot flags it
# (`isIntradaySimulated`) so the UI can label it honestly.
_anchor: dict[str, dict[str, float]] = {}   # symbol → real values at last poll
_ihsg_anchor: dict[str, float] | None = None
_intraday_simulated: bool = False           # True while the walk is driving prices


def _idx_tick_size(price: float) -> int:
    """IDX fraksi harga (post-2023 bands). Simulated prices snap to valid ticks
    so the board moves in real order-book increments, not arbitrary fractions."""
    if price < 200:
        return 1
    if price < 500:
        return 2
    if price < 2000:
        return 5
    if price < 5000:
        return 10
    return 25


def simulate_intraday_tick() -> None:
    """
    Advance every stock (and IHSG) one small step around its real anchor.

    Called ~every 2s by the intraday tick loop. A no-op outside market hours or
    before the first real poll, so closed-market prices stay exactly at their
    real EOD close. Mean-reverting toward the anchor and clamped to ±1.2% so the
    estimate never wanders far from the last real print before the next re-sync.
    """
    global _intraday_simulated

    if not is_market_open() or not _current_stocks:
        _intraday_simulated = False
        return

    settings = get_settings()
    if not getattr(settings, "market_simulate_intraday", True):
        _intraday_simulated = False
        return

    for sym, tick in list(_current_stocks.items()):
        anchor = _anchor.get(sym)
        base = anchor["price"] if anchor else tick.price
        if base <= 0:
            continue
        tick_size = _idx_tick_size(base)

        # Random walk in ticks, pulled back toward the anchor.
        revert = (base - tick.price) / tick_size * 0.2
        move_ticks = round(revert + random.gauss(0.0, 0.9))
        # Keep the whole board lively: when the draw would leave a stock flat,
        # still nudge it one tick most of the time (biased toward the anchor), so
        # nearly every name moves each cycle instead of ~half sitting still.
        if move_ticks == 0 and random.random() < 0.75:
            bias = 0.5 + max(-0.4, min(0.4, revert))
            move_ticks = 1 if random.random() < bias else -1
        move_ticks = max(-3, min(3, move_ticks))
        new_price = tick.price + move_ticks * tick_size
        # Clamp near the anchor so the estimate stays honest — but never tighter
        # than ±2 ticks, or sub-100 "gocap" stocks (where one tick already
        # exceeds 1.2%) could never move at all and would sit frozen.
        band = max(base * 0.012, tick_size * 2)
        new_price = max(base - band, min(base + band, new_price))
        if new_price <= 0 or new_price == tick.price:
            continue

        prev_close = tick.prevClose or base
        change = new_price - prev_close
        change_pct = (change / prev_close * 100.0) if prev_close else 0.0

        hist = _history.setdefault(sym, [new_price] * 60)
        hist.append(new_price)
        if len(hist) > 60:
            hist.pop(0)

        _current_stocks[sym] = tick.model_copy(update={
            "price": round(new_price, 0),
            "change": round(change, 0),
            "changePct": round(change_pct, 2),
            "high": round(max(tick.high, new_price), 0),
            "low": round(min(tick.low, new_price) if tick.low > 0 else new_price, 0),
            "history": list(hist),
        })

    # IHSG breathes too, anchored to its real value.
    global _ihsg_current
    if _ihsg_anchor:
        base = _ihsg_anchor["value"]
        prev = _ihsg_anchor["prevClose"]
        step = random.gauss(0.0, base * 0.0002)          # ~0.02% per tick
        revert = (base - _ihsg_current.value) * 0.2
        val = _ihsg_current.value + step + revert
        val = max(base * 0.99, min(base * 1.01, val))
        change = val - prev
        _ihsg_current = IhsgSnapshot(
            value=round(val, 2),
            prevClose=round(prev, 2),
            change=round(change, 2),
            changePct=round((change / prev * 100.0) if prev else 0.0, 2),
        )

    _intraday_simulated = True


def _reanchor() -> None:
    """Snapshot the current REAL prices as the anchors the tick walk reverts to.
    Called at the end of every successful real poll, so simulation always starts
    from — and returns to — reality."""
    global _ihsg_anchor
    for sym, tick in _current_stocks.items():
        _anchor[sym] = {
            "price": float(tick.price),
            "prevClose": float(tick.prevClose or tick.price),
        }
    _ihsg_anchor = {"value": float(_ihsg_current.value), "prevClose": float(_ihsg_current.prevClose)}


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
    """
    Seed a StockTick for every universe symbol that does not yet have one.

    Non-destructive: symbols already carrying a (possibly live) tick are left
    untouched, so this can run after every universe load to bring newly-added
    board members in at their real last close without clobbering live quotes.
    """
    for sym, meta in _IDX_METADATA.items():
        if sym in _current_stocks:
            continue
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


async def _fetch_latest_foreign_net(symbols: list[str]) -> dict[str, float]:
    """
    Latest end-of-day net foreign flow, in SHARES, per symbol from `ohlcv`.

    One `DISTINCT ON` query returns each symbol's most recent non-null
    `foreign_net`. Returns {} on any DB fault or when mock market data is on, so
    the caller degrades to foreignNet=0.0 rather than failing the market poll.
    """
    settings = get_settings()
    if settings.use_mock_market or not symbols:
        return {}

    try:
        import asyncpg

        conn = await asyncpg.connect(
            settings.database_url.replace("postgresql+asyncpg://", "postgresql://"),
            timeout=4,
        )
        try:
            rows = await conn.fetch(
                """
                SELECT DISTINCT ON (symbol) symbol, foreign_net
                FROM ohlcv
                WHERE symbol = ANY($1::text[]) AND foreign_net IS NOT NULL
                ORDER BY symbol, time DESC
                """,
                symbols,
            )
        finally:
            await conn.close()
    except Exception as exc:  # noqa: BLE001 — foreign flow is a display bonus, never fatal
        logger.debug("market_service: foreign flow lookup skipped — %s", exc)
        return {}

    return {r["symbol"]: float(r["foreign_net"]) for r in rows if r["foreign_net"] is not None}


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

    # Load the full listed board from the DB (cached; refreshes every 30 min) so
    # the snapshot spans ~960 securities, not the fallback handful. Seed any
    # symbol that has no tick yet at its real last close, so the whole board is
    # present even for names the live quote feed does not return.
    await _load_universe()
    _init_default_state()

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

    # IDX foreign flow — the realtime vendor (Yahoo) does not carry it, so pull
    # the latest END-OF-DAY net foreign shares per symbol from `ohlcv` (the free
    # IDX feed) and value it at the current price. This is the same real foreign
    # participation the accumulation panel uses, surfaced on the market table's
    # "Foreign Net" column instead of a hardcoded 0.0. EOD, not intraday — but a
    # real net-flow read beats a fabricated zero.
    foreign_shares = await _fetch_latest_foreign_net(symbols)

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
            # Net foreign VALUE in IDR billions: latest EOD net foreign shares
            # (from `ohlcv`) valued at the current price. 0.0 only when no
            # foreign flow has been ingested yet for this symbol.
            foreignNet=round(foreign_shares.get(sym, 0.0) * quote.price / 1e9, 2),
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

    # Re-anchor the intraday walk to these fresh REAL prices, so any simulated
    # ticks between now and the next poll revert toward reality, not toward a
    # previous estimate.
    _reanchor()

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
    for sym, lots in _PORTFOLIO_LOTS.items():
        stock = _current_stocks.get(sym)
        if stock and lots > 0:
            portfolio_value += stock.price * lots * 100

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
        # True when prices are currently breathing via the intraday walk between
        # real polls. The UI uses this to label movement as estimated.
        isIntradaySimulated=_intraday_simulated,
    )
