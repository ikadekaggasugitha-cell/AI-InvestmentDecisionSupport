"""
IndoBERT Sentiment Fine-tuning — Phase 5

Fine-tunes IndoBERT (indobenchmark/indobert-base-p2) on a labelled dataset
of BEI company disclosures and Indonesian financial news articles.

Expected input CSV (data/sentiment_labels.csv):
    text, label (0=bearish, 1=neutral, 2=bullish), symbol (optional)

Usage:
    python -m ml.training.train_sentiment \
        --data-path data/sentiment_labels.csv \
        --output-dir models/indobert-sentiment \
        --epochs 5

Model is saved to models/indobert-sentiment/ and registered in MLflow.
"""

import argparse
import logging
from pathlib import Path

import mlflow
import numpy as np
import pandas as pd
import torch
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
    EarlyStoppingCallback,
)

from api.core.config import get_settings

logger = logging.getLogger(__name__)

MODEL_NAME = "indobenchmark/indobert-base-p2"
LABELS = ["bearish", "neutral", "bullish"]
NUM_LABELS = len(LABELS)
MAX_LENGTH = 256


class SentimentDataset(torch.utils.data.Dataset):
    def __init__(self, encodings, labels):
        self.encodings = encodings
        self.labels = labels

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        item = {k: torch.tensor(v[idx]) for k, v in self.encodings.items()}
        item["labels"] = torch.tensor(self.labels[idx])
        return item


def compute_metrics(eval_pred):
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    report = classification_report(labels, preds, target_names=LABELS, output_dict=True)
    return {
        "macro_f1":   report["macro avg"]["f1-score"],
        "accuracy":   report["accuracy"],
        "bullish_f1": report["bullish"]["f1-score"],
        "bearish_f1": report["bearish"]["f1-score"],
    }


def train(
    data_path: str,
    output_dir: str = "models/indobert-sentiment",
    epochs: int = 5,
    batch_size: int = 16,
    learning_rate: float = 2e-5,
) -> str:
    settings = get_settings()
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment("aidss-sentiment")

    # ── Load and validate data ────────────────────────────────────────────────
    df = pd.read_csv(data_path)
    required = {"text", "label"}
    if not required.issubset(df.columns):
        raise ValueError(f"CSV must contain columns: {required}")
    df = df.dropna(subset=["text", "label"])
    df["label"] = df["label"].astype(int).clip(0, 2)
    logger.info("Loaded %d samples (bearish=%d, neutral=%d, bullish=%d)",
                len(df),
                (df["label"] == 0).sum(),
                (df["label"] == 1).sum(),
                (df["label"] == 2).sum())

    # ── Tokenize ──────────────────────────────────────────────────────────────
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    train_texts, val_texts, train_labels, val_labels = train_test_split(
        df["text"].tolist(), df["label"].tolist(),
        test_size=0.15, stratify=df["label"], random_state=42,
    )

    train_enc = tokenizer(train_texts, truncation=True, padding=True, max_length=MAX_LENGTH)
    val_enc   = tokenizer(val_texts,   truncation=True, padding=True, max_length=MAX_LENGTH)

    train_dataset = SentimentDataset(train_enc, train_labels)
    val_dataset   = SentimentDataset(val_enc,   val_labels)

    # ── Model ─────────────────────────────────────────────────────────────────
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME, num_labels=NUM_LABELS
    )

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # ── Training ──────────────────────────────────────────────────────────────
    training_args = TrainingArguments(
        output_dir=str(output_path),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        learning_rate=learning_rate,
        warmup_ratio=0.1,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="macro_f1",
        fp16=torch.cuda.is_available(),
        logging_steps=50,
        report_to="none",  # MLflow logging done manually below
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )

    with mlflow.start_run(run_name="indobert-sentiment"):
        mlflow.log_params({
            "base_model": MODEL_NAME,
            "epochs": epochs,
            "batch_size": batch_size,
            "learning_rate": learning_rate,
            "n_train": len(train_texts),
            "n_val": len(val_texts),
        })

        trainer.train()
        metrics = trainer.evaluate()

        mlflow.log_metrics({k: v for k, v in metrics.items() if not k.startswith("_")})
        logger.info("Validation metrics: %s", metrics)

        # Save tokenizer + model
        tokenizer.save_pretrained(str(output_path))
        trainer.save_model(str(output_path))

        # Register in MLflow
        mlflow.transformers.log_model(
            {"model": model, "tokenizer": tokenizer},
            artifact_path="indobert-sentiment",
            task="text-classification",
        )
        model_uri = f"runs:/{mlflow.active_run().info.run_id}/indobert-sentiment"
        mlflow.register_model(model_uri, "aidss-indobert-sentiment")

    logger.info("Sentiment model saved: %s", output_path)
    return str(output_path)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Fine-tune IndoBERT for IDX sentiment")
    parser.add_argument("--data-path",   required=True)
    parser.add_argument("--output-dir",  default="models/indobert-sentiment")
    parser.add_argument("--epochs",      type=int, default=5)
    parser.add_argument("--batch-size",  type=int, default=16)
    parser.add_argument("--lr",          type=float, default=2e-5)
    args = parser.parse_args()
    train(args.data_path, args.output_dir, args.epochs, args.batch_size, args.lr)
