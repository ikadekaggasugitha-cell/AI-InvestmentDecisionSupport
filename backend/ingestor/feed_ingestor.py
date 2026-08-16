"""
Feed Ingestor — Phase 2

Connects to an IDX data vendor WebSocket (or Yahoo Finance fallback),
normalises each tick into a StockTick dict, and publishes it to the
Kafka topic `idx.ticks.raw`.

Run with:
    python -m ingestor.feed_ingestor

Supported vendors (set IDX_FEED_VENDOR in .env):
  yahoo    — yfinance streaming via websocket-client (free, 15-min delayed)
  stockbit — Stockbit Streaming API (real-time, requires subscription)
  custom   — Set IDX_FEED_WS_URL to any WebSocket endpoint
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone

import websockets
from confluent_kafka import Producer

from api.core.config import get_settings

logger = logging.getLogger(__name__)

# ── IDX LQ45 + IDX30 universe ─────────────────────────────────────────────────

IDX_SYMBOLS: list[str] = [
    "BBCA.JK", "BBRI.JK", "BMRI.JK", "TLKM.JK", "ASII.JK",
    "ADRO.JK", "BREN.JK", "GOTO.JK", "ANTM.JK", "UNVR.JK",
    "ICBP.JK", "INDF.JK", "KLBF.JK", "PGAS.JK", "PTBA.JK",
    "SMGR.JK", "TBIG.JK", "EXCL.JK", "HMSP.JK", "GGRM.JK",
    # ... full 80-stock universe loaded from db/idx_universe.json in production
]


def _make_kafka_producer(settings) -> Producer:
    return Producer(
        {
            "bootstrap.servers": settings.kafka_bootstrap_servers,
            "acks": "all",
            "retries": 5,
            "retry.backoff.ms": 500,
        }
    )


def _delivery_report(err, msg) -> None:
    if err:
        logger.error("kafka: delivery failed — %s", err)


def _normalise_yahoo_tick(raw: dict) -> dict | None:
    """
    Normalise a Yahoo Finance WebSocket tick to the StockTick-compatible dict.
    Yahoo sends protobuf-encoded messages; this assumes the decoded form.
    """
    try:
        symbol = raw.get("id", "").replace(".JK", "")
        return {
            "symbol": symbol,
            "price": raw.get("price"),
            "prevClose": raw.get("prevClose", raw.get("price")),
            "volume": raw.get("dayVolume", 0),
            "foreignNet": 0.0,  # Yahoo doesn't provide foreign flow — fill from JATS API
            "ts": datetime.now(timezone.utc).isoformat(),
            "source": "yahoo",
        }
    except Exception as exc:
        logger.warning("normalise: failed — %s", exc)
        return None


class FeedIngestor:
    """
    Vendor-agnostic feed ingestor.

    Implement _connect_<vendor>() for each supported feed.
    The base class handles Kafka publishing and reconnection logic.
    """

    def __init__(self) -> None:
        self.settings = get_settings()
        self.producer = _make_kafka_producer(self.settings)
        self._running = False

    def _publish(self, tick: dict) -> None:
        key = tick.get("symbol", "UNKNOWN")
        self.producer.produce(
            self.settings.kafka_tick_topic,
            key=key,
            value=json.dumps(tick),
            callback=_delivery_report,
        )
        self.producer.poll(0)

    async def _connect_yahoo(self) -> None:
        """
        Yahoo Finance WebSocket streaming feed (delayed, free tier).
        Replace with stockbit/xtradein for real-time data.
        """
        url = "wss://streamer.finance.yahoo.com"
        subscribe_msg = json.dumps({
            "subscribe": [s for s in IDX_SYMBOLS]
        })

        async with websockets.connect(url) as ws:
            await ws.send(subscribe_msg)
            logger.info("yahoo_feed: subscribed to %d symbols", len(IDX_SYMBOLS))

            while self._running:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
                    # Yahoo sends binary protobuf — decode as needed
                    # For now treat as JSON for non-production testing
                    data = json.loads(raw) if isinstance(raw, str) else {}
                    tick = _normalise_yahoo_tick(data)
                    if tick:
                        self._publish(tick)
                except asyncio.TimeoutError:
                    await ws.ping()  # keep-alive
                except Exception as exc:
                    logger.error("yahoo_feed: recv error — %s", exc)
                    break

    async def _connect_custom(self) -> None:
        """Generic WebSocket connector for custom vendor URLs."""
        url = self.settings.idx_feed_ws_url
        if not url:
            raise ValueError("IDX_FEED_WS_URL must be set for vendor=custom")

        async with websockets.connect(url) as ws:
            while self._running:
                raw = await ws.recv()
                tick = json.loads(raw)
                self._publish(tick)

    async def run(self) -> None:
        self._running = True
        vendor = self.settings.idx_feed_vendor

        while self._running:
            try:
                if vendor == "yahoo":
                    await self._connect_yahoo()
                elif vendor == "custom":
                    await self._connect_custom()
                else:
                    raise ValueError(f"Unsupported IDX_FEED_VENDOR: {vendor}")
            except Exception as exc:
                logger.error("ingestor: connection error — %s — reconnecting in 5s", exc)
                await asyncio.sleep(5)

        self.producer.flush()

    def stop(self) -> None:
        self._running = False


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ingestor = FeedIngestor()
    try:
        asyncio.run(ingestor.run())
    except KeyboardInterrupt:
        ingestor.stop()
