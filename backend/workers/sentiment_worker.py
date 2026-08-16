"""
Sentiment Worker — Phase 5

Celery task triggered by new BEI disclosures or news articles.
Batch-scores documents with IndoBERT, caches in Redis, and persists to TimescaleDB.
The rolling 5-day sentiment score per symbol is then used as a feature in LightGBM.
"""

import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path

from workers.celery_app import celery_app
from api.core.config import get_settings

logger = logging.getLogger(__name__)

SENTIMENT_MODEL_DIR = "models/indobert-sentiment"
SENTIMENT_TTL = 86_400  # 24 hours


@celery_app.task(
    name="workers.sentiment_worker.score_documents",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
)
def score_documents(self, documents: list[dict]) -> dict:
    """
    Score a batch of documents from BEI disclosures or news RSS.

    Args:
        documents: list of {"text": str, "symbol": str | None, "source": str}

    Returns:
        {"scored": int, "cached": int, "errors": int}
    """
    settings = get_settings()
    model_dir = Path(SENTIMENT_MODEL_DIR)
    if not model_dir.exists():
        logger.warning("sentiment_worker: model not found at %s — skipping", model_dir)
        return {"status": "skipped", "reason": "model_not_found"}

    try:
        import asyncio
        import asyncpg
        import redis as sync_redis
        from ml.inference.sentiment_inference import SentimentInference, doc_hash

        engine = SentimentInference.load(str(model_dir))
        r = sync_redis.from_url(settings.redis_url, decode_responses=True)

        # Skip already-cached documents
        to_score = []
        cached_count = 0
        for doc in documents:
            h = doc_hash(doc["text"])
            if r.exists(f"sentiment:{h}"):
                cached_count += 1
            else:
                to_score.append(doc)

        if not to_score:
            return {"status": "ok", "scored": 0, "cached": cached_count, "errors": 0}

        texts = [d["text"] for d in to_score]
        results = engine.score(texts)

        # Cache each result in Redis and persist to TimescaleDB
        async def _persist(scored: list[dict]) -> None:
            conn = await asyncpg.connect(
                settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
            )
            for res, doc in zip(scored, to_score):
                r.setex(f"sentiment:{res['doc_hash']}", SENTIMENT_TTL, str(res["score"]))
                await conn.execute(
                    """
                    INSERT INTO sentiment_scores
                        (scored_at, doc_hash, symbol, source, score, confidence, raw_text)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (doc_hash) DO NOTHING
                    """,
                    datetime.now(timezone.utc),
                    res["doc_hash"],
                    doc.get("symbol"),
                    doc.get("source", "unknown"),
                    res["score"],
                    res["confidence"],
                    res["text"],
                )
            await conn.close()

        asyncio.run(_persist(results))

        logger.info(
            "sentiment_worker: scored=%d cached=%d",
            len(results), cached_count,
        )
        return {"status": "ok", "scored": len(results), "cached": cached_count, "errors": 0}

    except Exception as exc:
        logger.exception("sentiment_worker: failed — %s", exc)
        raise self.retry(exc=exc)


@celery_app.task(name="workers.sentiment_worker.fetch_bei_disclosures")
def fetch_bei_disclosures() -> None:
    """
    Fetch new BEI company disclosures from IDX website RSS feed,
    queue scoring for each unseen document.
    """
    import httpx

    BEI_RSS_URL = "https://www.idx.co.id/umbraco/Surface/Home/GetAnnouncement?start=0&length=20"

    try:
        with httpx.Client(timeout=10) as client:
            res = client.get(BEI_RSS_URL)
            res.raise_for_status()
            data = res.json()

        docs = []
        for item in data.get("data", []):
            text = f"{item.get('title', '')} {item.get('description', '')}".strip()
            if text:
                docs.append({
                    "text":   text,
                    "symbol": item.get("emiten_code"),
                    "source": "bei_disclosure",
                })

        if docs:
            score_documents.delay(docs)
            _store_news_headlines(docs)
            logger.info("bei_disclosure: queued %d documents for scoring", len(docs))

    except Exception as exc:
        logger.error("fetch_bei_disclosures: failed — %s", exc)


def _store_news_headlines(docs: list[dict]) -> None:
    """
    Phase 9A: Persist latest BEI disclosure headlines to the advisor RAG news ZSET.
    Key: news:idx:latest (ZSET, score=Unix timestamp, max 100 items).
    This makes BEI news available to the AI Advisor without a vector database.
    """
    import time
    import json as _json
    import redis as sync_redis

    settings = get_settings()
    try:
        r = sync_redis.from_url(settings.redis_url, decode_responses=True)
        ts = time.time()
        pipe = r.pipeline()
        for doc in docs:
            text = doc.get("text", "")
            headline = text[:200]  # Truncate to headline length
            item = _json.dumps({
                "headline": headline,
                "symbol": doc.get("symbol"),
                "source": doc.get("source", "bei_disclosure"),
                "ts": int(ts),
            })
            pipe.zadd("news:idx:latest", {item: ts})
            ts += 0.001  # microsecond offset to preserve insertion order within same second

        # Keep only the 100 most recent items
        pipe.zremrangebyrank("news:idx:latest", 0, -101)
        pipe.execute()
    except Exception as exc:
        logger.warning("_store_news_headlines: failed to write to Redis — %s", exc)
