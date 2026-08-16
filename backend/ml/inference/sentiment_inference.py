"""
IndoBERT Sentiment Inference — Phase 5

Batch-scores BEI disclosures and IDX news articles.
Results are cached in Redis per document hash (TTL 24h) and persisted
to TimescaleDB `sentiment_scores` for trend analysis.

Called by the sentiment Celery worker every 30 minutes.
"""

import hashlib
import logging
from typing import Sequence

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer, pipeline

logger = logging.getLogger(__name__)

LABELS = ["bearish", "neutral", "bullish"]
SCORE_MAP = {"bearish": -1.0, "neutral": 0.0, "bullish": 1.0}
CONFIDENCE_THRESHOLD = 0.70  # Below this → score is treated as neutral (OJK caution)
MAX_LENGTH = 256


class SentimentInference:
    """
    Wraps the fine-tuned IndoBERT model for batch inference.

    Usage:
        engine = SentimentInference.load("models/indobert-sentiment")
        results = engine.score(["BREN renewable energy contract...", ...])
    """

    def __init__(self, model_dir: str) -> None:
        self._pipe = pipeline(
            task="text-classification",
            model=model_dir,
            tokenizer=model_dir,
            device=0 if torch.cuda.is_available() else -1,
            truncation=True,
            max_length=MAX_LENGTH,
            top_k=None,  # return all class scores
        )
        logger.info("SentimentInference loaded from %s (device=%s)",
                    model_dir, "cuda" if torch.cuda.is_available() else "cpu")

    @classmethod
    def load(cls, model_dir: str) -> "SentimentInference":
        return cls(model_dir)

    def score(self, texts: Sequence[str]) -> list[dict]:
        """
        Score a batch of texts.

        Returns list of dicts:
            {
              "text": str,
              "score": float,       # -1.0 (bearish) to +1.0 (bullish)
              "label": str,         # "bearish" | "neutral" | "bullish"
              "confidence": float,  # softmax max
              "doc_hash": str,      # SHA256 for Redis/DB dedup
            }
        """
        results = []
        batch_output = self._pipe(list(texts))

        for text, preds in zip(texts, batch_output):
            doc_hash = hashlib.sha256(text.encode()).hexdigest()[:16]

            # preds: [{"label": "bullish", "score": 0.82}, ...]
            best = max(preds, key=lambda x: x["score"])
            label = best["label"].lower()
            confidence = best["score"]

            # Apply confidence threshold (OJK caution: low-confidence = neutral)
            if confidence < CONFIDENCE_THRESHOLD:
                label = "neutral"
                score = 0.0
            else:
                score = SCORE_MAP.get(label, 0.0)

            results.append({
                "text":       text[:200],  # truncate for storage
                "score":      score,
                "label":      label,
                "confidence": round(confidence, 4),
                "doc_hash":   doc_hash,
            })

        return results

    def rolling_sentiment_score(
        self,
        symbol: str,
        scores: list[float],
        window: int = 5,
    ) -> float:
        """
        Compute rolling mean sentiment score for a symbol over the last `window` days.
        Input `scores` should be sorted by date ascending.
        """
        if not scores:
            return 0.0
        window_scores = scores[-window:]
        return float(np.mean(window_scores))


def doc_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]
