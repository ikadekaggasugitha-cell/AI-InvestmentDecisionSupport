"""
LightGBM Signal Model Training — Phase 3

Walk-forward cross-validation on 3-year IDX daily data.
Logs experiments to MLflow and registers the best model.

Usage:
    python -m ml.training.train_signals \
        --start-date 2021-01-01 \
        --end-date   2024-12-31 \
        --n-folds    5

The trained model artifact is saved to:
    models/lgbm_signals_<version>.pkl
"""

import argparse
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import lightgbm as lgb
import mlflow
import mlflow.lightgbm
import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score, precision_score

from api.core.config import get_settings
from ml.features.engineer import FEATURE_COLUMNS, LABEL_COLUMN, build_features

logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).parent.parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


LGB_PARAMS: dict[str, Any] = {
    "objective":        "binary",
    "metric":           "auc",
    "boosting_type":    "gbdt",
    "num_leaves":       63,
    "max_depth":        -1,
    "min_child_samples": 30,
    "learning_rate":    0.05,
    "n_estimators":     500,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq":     5,
    "reg_alpha":        0.1,
    "reg_lambda":       0.1,
    "class_weight":     "balanced",
    "random_state":     42,
    "n_jobs":           -1,
    "verbose":          -1,
}


def load_training_data(
    start_date: str,
    end_date: str,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Load OHLCV, universe, and macro data from TimescaleDB.

    Returns: (ohlcv_df, universe_df, macro_df)

    NOTE: In production connect via asyncpg/SQLAlchemy.
    For standalone training use psycopg2 or pandas read_sql.
    """
    import psycopg2
    settings = get_settings()
    # Convert asyncpg URL to psycopg2 format
    conn_str = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

    with psycopg2.connect(conn_str) as conn:
        ohlcv = pd.read_sql(
            """
            SELECT symbol, time::date as date, open, high, low, close, volume, foreign_net
            FROM ohlcv
            WHERE time >= %(start)s AND time < %(end)s
            ORDER BY symbol, time
            """,
            conn,
            params={"start": start_date, "end": end_date},
        )

        # Placeholder queries for universe and macro
        # In production: join with idx_universe and macro_data tables
        universe = ohlcv[["date", "symbol"]].copy()
        universe["sector"] = "Unknown"
        universe["pe"] = np.nan

        macro = pd.DataFrame({
            "date":    pd.date_range(start_date, end_date, freq="B"),
            "bi_rate": 5.75,
            "usdidr":  16_200.0,
        })

    return ohlcv, universe, macro


def train(
    start_date: str = "2021-01-01",
    end_date: str = "2024-12-31",
    n_folds: int = 5,
) -> str:
    """Run walk-forward CV, log to MLflow, save best model. Returns model path."""
    settings = get_settings()
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)

    logger.info("Loading training data %s → %s", start_date, end_date)
    ohlcv, universe, macro = load_training_data(start_date, end_date)
    df = build_features(ohlcv, universe, macro)

    X = df[FEATURE_COLUMNS]
    y = df[LABEL_COLUMN]

    tscv = TimeSeriesSplit(n_splits=n_folds, gap=5)  # 5-day forward gap prevents leakage
    fold_aucs: list[float] = []

    with mlflow.start_run(run_name=f"lgbm_signals_{datetime.now().strftime('%Y%m%d_%H%M')}"):
        mlflow.log_params(LGB_PARAMS)
        mlflow.log_param("start_date", start_date)
        mlflow.log_param("end_date", end_date)
        mlflow.log_param("n_folds", n_folds)
        mlflow.log_param("n_features", len(FEATURE_COLUMNS))
        mlflow.log_param("n_samples", len(X))

        best_model: lgb.LGBMClassifier | None = None
        best_auc = 0.0

        for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
            X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
            y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]

            model = lgb.LGBMClassifier(**LGB_PARAMS)
            model.fit(
                X_tr, y_tr,
                eval_set=[(X_val, y_val)],
                callbacks=[lgb.early_stopping(50, verbose=False)],
            )

            proba = model.predict_proba(X_val)[:, 1]
            auc = roc_auc_score(y_val, proba)
            prec = precision_score(y_val, (proba >= 0.70).astype(int), zero_division=0)

            fold_aucs.append(auc)
            logger.info("Fold %d: AUC=%.4f  Prec@70=%.4f", fold + 1, auc, prec)
            mlflow.log_metric("fold_auc", auc, step=fold)
            mlflow.log_metric("fold_prec_at_70", prec, step=fold)

            if auc > best_auc:
                best_auc = auc
                best_model = model

        mean_auc = float(np.mean(fold_aucs))
        mlflow.log_metric("mean_cv_auc", mean_auc)
        logger.info("Walk-forward mean AUC: %.4f", mean_auc)

        # Save and register best model
        version = datetime.now().strftime("%Y%m%d_%H%M")
        model_path = MODELS_DIR / f"lgbm_signals_{version}.pkl"
        joblib.dump({"model": best_model, "features": FEATURE_COLUMNS, "version": version}, model_path)
        mlflow.lightgbm.log_model(best_model, artifact_path="model")
        mlflow.log_artifact(str(model_path))

        # Register in MLflow model registry
        model_uri = f"runs:/{mlflow.active_run().info.run_id}/model"
        mlflow.register_model(model_uri, "aidss-lgbm-signals")

        logger.info("Model saved: %s (AUC=%.4f)", model_path, best_auc)
        return str(model_path)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Train AIDSS LightGBM signal model")
    parser.add_argument("--start-date", default="2021-01-01")
    parser.add_argument("--end-date",   default="2024-12-31")
    parser.add_argument("--n-folds",    type=int, default=5)
    args = parser.parse_args()
    train(args.start_date, args.end_date, args.n_folds)
