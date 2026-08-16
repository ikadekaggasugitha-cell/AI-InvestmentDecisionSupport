"""
Tick Aggregator — Phase 2

Consumes raw ticks from Kafka topic `idx.ticks.raw`, builds StockTick objects,
and writes the complete market snapshot to Redis `market:snapshot` every 2 seconds.

The FastAPI WebSocket endpoint reads from Redis — this process is the single
writer. All WebSocket clients read the same Redis state, enabling horizontal
scaling of the API tier.

Run with:
    python -m ingestor.tick_aggregator
"""

import asyncio
import json
import logging
import math
import random
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis
from confluent_kafka import Consumer, KafkaError

from api.core.config import get_settings
from api.core.redis_client import get_redis_pool

logger = logging.getLogger(__name__)

# ── IDX reference data (name, sector, tier, mktCap) ─────────────────────────
# In production, load from TimescaleDB `idx_universe` table.
IDX_REF: dict[str, dict] = {
    "BBCA":  {"name": "Bank Central Asia",        "sector": "Perbankan",      "sectorEn": "Banking",       "tier": 1, "mktCap": "Rp 1.208T", "pe": 24.1},
    "BBRI":  {"name": "Bank Rakyat Indonesia",    "sector": "Perbankan",      "sectorEn": "Banking",       "tier": 1, "mktCap": "Rp 638T",   "pe": 13.8},
    "BMRI":  {"name": "Bank Mandiri",             "sector": "Perbankan",      "sectorEn": "Banking",       "tier": 1, "mktCap": "Rp 532T",   "pe": 11.2},
    "TLKM":  {"name": "Telkom Indonesia",         "sector": "Telekomunikasi", "sectorEn": "Telecom",       "tier": 1, "mktCap": "Rp 292T",   "pe": 14.3},
    "ASII":  {"name": "Astra International",      "sector": "Konglomerasi",   "sectorEn": "Conglomerate",  "tier": 1, "mktCap": "Rp 195T",   "pe": 9.4},
    "ADRO":  {"name": "Adaro Energy Indonesia",   "sector": "Energi",         "sectorEn": "Energy",        "tier": 1, "mktCap": "Rp 81T",    "pe": 5.1},
    "BREN":  {"name": "Barito Renewables Energy", "sector": "Energi",         "sectorEn": "Energy",        "tier": 1, "mktCap": "Rp 892T",   "pe": 48.2},
    "GOTO":  {"name": "GoTo Gojek Tokopedia",     "sector": "Teknologi",      "sectorEn": "Technology",    "tier": 2, "mktCap": "Rp 71T",    "pe": None},
    "ANTM":  {"name": "Aneka Tambang",            "sector": "Material",       "sectorEn": "Materials",     "tier": 2, "mktCap": "Rp 43T",    "pe": 12.4},
    "UNVR":  {"name": "Unilever Indonesia",       "sector": "Konsumer",       "sectorEn": "Consumer",      "tier": 1, "mktCap": "Rp 91T",    "pe": 19.8},
}

PORTFOLIO_LOTS: dict[str, int] = {
    "BBCA": 1000, "BBRI": 2000, "BMRI": 500, "ADRO": 500,
    "BREN": 200,  "ANTM": 1000, "TLKM": 500,
}


class TickAggregator:
    """
    Consumes Kafka ticks, aggregates to 2s snapshots, writes to Redis.
    """

    def __init__(self) -> None:
        self.settings = get_settings()
        self._ticks: dict[str, dict] = {}    # symbol → latest raw tick
        self._history: dict[str, list[float]] = {}
        self._prev_close: dict[str, float] = {}
        self._open: dict[str, float] = {}
        self._intraday: list[dict] = []
        self._redis = aioredis.Redis(connection_pool=get_redis_pool())

    def _make_consumer(self) -> Consumer:
        return Consumer({
            "bootstrap.servers": self.settings.kafka_bootstrap_servers,
            "group.id": self.settings.kafka_group_id,
            "auto.offset.reset": "latest",
            "enable.auto.commit": True,
        })

    def _process_tick(self, raw: dict) -> None:
        sym = raw.get("symbol")
        if not sym or sym not in IDX_REF:
            return
        price = float(raw.get("price", 0))
        if price <= 0:
            return

        self._ticks[sym] = raw

        if sym not in self._prev_close:
            self._prev_close[sym] = price
            self._open[sym] = price
        if sym not in self._history:
            self._history[sym] = [price] * 60
        else:
            h = self._history[sym]
            h.append(price)
            if len(h) > 60:
                h.pop(0)

    async def _build_snapshot(self) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        stocks: dict[str, Any] = {}
        portfolio_value = 0.0

        for sym, ref in IDX_REF.items():
            tick = self._ticks.get(sym)
            price = float(tick["price"]) if tick else self._prev_close.get(sym, 0)
            if price == 0:
                continue

            hist = self._history.get(sym, [price] * 60)
            prev = self._prev_close.get(sym, price)
            open_ = self._open.get(sym, price)

            stocks[sym] = {
                "symbol":     sym,
                "name":       ref["name"],
                "price":      price,
                "prevClose":  prev,
                "open":       open_,
                "high":       max(hist[-20:]),
                "low":        min(hist[-20:]),
                "change":     round(price - prev, 2),
                "changePct":  round((price - prev) / prev * 100, 2) if prev else 0,
                "volume":     int(tick.get("volume", 0)) if tick else 0,
                "mktCap":     ref["mktCap"],
                "pe":         ref["pe"],
                "sector":     ref["sector"],
                "sectorEn":   ref["sectorEn"],
                "tier":       ref["tier"],
                "foreignNet": float(tick.get("foreignNet", 0)) if tick else 0,
                "history":    hist[-60:],
            }

            lots = PORTFOLIO_LOTS.get(sym, 0)
            portfolio_value += price * lots * 100  # 1 lot = 100 shares

        ihsg_price = float(self._ticks.get("IHSG", {}).get("price", 7284.5))
        portfolio_prev = sum(
            self._prev_close.get(sym, 0) * lots * 100
            for sym, lots in PORTFOLIO_LOTS.items()
        )
        daily_pnl = portfolio_value - portfolio_prev

        intraday_pt = {
            "time": now.strftime("%H:%M"),
            "value": round(portfolio_value, 0),
            "ihsg": round(ihsg_price, 2),
        }
        self._intraday.append(intraday_pt)
        if len(self._intraday) > 420:
            self._intraday.pop(0)

        return {
            "stocks": stocks,
            "intradayChart": self._intraday[-120:],
            "portfolioValue": round(portfolio_value, 0),
            "portfolioPrevClose": portfolio_prev,
            "dailyPnL": round(daily_pnl, 0),
            "dailyPnLPct": round(daily_pnl / portfolio_prev * 100, 2) if portfolio_prev else 0,
            "ihsg": {
                "value": round(ihsg_price, 2),
                "prevClose": 7284.5,
                "change": round(ihsg_price - 7284.5, 2),
                "changePct": round((ihsg_price - 7284.5) / 7284.5 * 100, 2),
            },
            "isMarketOpen": self._is_market_open(),
            "lastUpdated": now.isoformat(),
        }

    def _is_market_open(self) -> bool:
        now = datetime.now(timezone.utc)
        wib_hour = (now.hour + 7) % 24
        wib_minute = now.minute
        if now.weekday() >= 5:
            return False
        if wib_hour < 9 or wib_hour > 16:
            return False
        if wib_hour == 16 and wib_minute > 15:
            return False
        return True

    async def _write_to_redis(self, snapshot: dict) -> None:
        pipe = self._redis.pipeline()
        pipe.set("market:snapshot:json", json.dumps(snapshot, default=str))
        pipe.expire("market:snapshot:json", 10)  # TTL = 10s (5 missed ticks)
        for sym, tick in snapshot["stocks"].items():
            pipe.hset("market:snapshot", sym, json.dumps(tick))
        await pipe.execute()

    async def _consume_loop(self, consumer: Consumer) -> None:
        """Non-blocking Kafka poll loop running in executor."""
        loop = asyncio.get_event_loop()

        def _poll():
            msg = consumer.poll(timeout=0.1)
            if msg is None or msg.error():
                return None
            return json.loads(msg.value().decode())

        while True:
            tick = await loop.run_in_executor(None, _poll)
            if tick:
                self._process_tick(tick)

    async def run(self) -> None:
        consumer = self._make_consumer()
        consumer.subscribe([self.settings.kafka_tick_topic])
        logger.info("tick_aggregator: subscribed to %s", self.settings.kafka_tick_topic)

        # Run Kafka consumption and Redis writes concurrently
        async def _write_loop():
            while True:
                snapshot = await self._build_snapshot()
                await self._write_to_redis(snapshot)
                await asyncio.sleep(2.0)

        await asyncio.gather(
            self._consume_loop(consumer),
            _write_loop(),
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    aggregator = TickAggregator()
    asyncio.run(aggregator.run())
