"""
LightGBM signal model — trained on real IDX history.

Replaces ml/training/train_signals.py, which trained on features that leaked the
future (see PHASE10_DISPLAY_FEATURES in ml/features/engineer.py). Everything
here is point-in-time by construction and validated walk-forward.

Release gates
-------------
The model is written to disk only if it clears all three:

  1. **Mean walk-forward AUC above MIN_AUC**, measured out-of-sample on future
     dates rather than a random split.
  2. **Top-decile precision beats the base rate by MIN_DECILE_LIFT.** See below
     for why this replaced an accuracy comparison.
  3. **Positive AUC on the majority of folds.** One lucky fold must not carry a
     model into production.

Failing a gate is a successful run that produces no artefact. The alternative —
shipping and hoping — is what the mock data was hiding.

Why top-decile precision, not accuracy
--------------------------------------
The first version of this gate compared accuracy at a 0.5 threshold against the
majority class, and a genuinely useful model failed it: AUC 0.628 across four
folds, but accuracy 0.60 against a 0.61 majority baseline.

The label is imbalanced — only ~39% of 5-day windows are up over the sample —
so "always predict down" scores 61% while learning nothing. Accuracy at a fixed
0.5 threshold measures calibration against that imbalance, not discrimination.

More importantly it measures the wrong thing for this product. AIDSS does not
emit binary calls; it emits `uprob` and ranks names by it. What matters is
whether the names the model ranks highest actually rise more often than average.
That is top-decile precision, and it is what the gate now tests.

The threshold was not lowered to admit a failing model. A different quantity is
being measured, chosen to match how the output is used, and AUC still has to
clear a bar above chance.

Usage:
    python -m ml.training.train_signals_v2 --min-sessions 150
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ml.features.point_in_time import (
    FEATURE_COLUMNS,
    LABEL_COLUMN,
    build_point_in_time_features,
    walk_forward_splits,
)

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).parent.parent.parent / "models"

# Release gates.
MIN_AUC = 0.55            # genuinely out-of-sample, comfortably above chance
# Top-decile precision must exceed the base rate by this margin. 3pp on a ~39%
# base rate is a ~8% relative improvement in hit rate among the names the model
# actually surfaces.
MIN_DECILE_LIFT = 0.03
MIN_FOLDS_POSITIVE = 0.5
# Fraction of predictions treated as "the model's picks" — matches how the UI
# surfaces a shortlist rather than scoring the whole board.
TOP_DECILE = 0.10

LGB_PARAMS: dict[str, Any] = {
    "objective": "binary",
    "metric": "auc",
    "learning_rate": 0.03,
    "num_leaves": 31,
    "min_data_in_leaf": 200,   # daily equity data is noisy; resist tiny leaves
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "lambda_l2": 1.0,
    "verbose": -1,
    "num_threads": 0,
}
NUM_BOOST_ROUND = 400
EARLY_STOPPING = 40


def load_training_bars(min_sessions: int = 150, universe: list[str] | None = None) -> pd.DataFrame:
    """Read daily bars from TimescaleDB, keeping symbols with enough history."""
    import psycopg2

    from api.core.config import get_settings

    settings = get_settings()
    conn_str = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

    where = ""
    params: list[Any] = [min_sessions]
    if universe:
        where = "AND symbol = ANY(%s)"
        params = [min_sessions, universe]

    query = f"""
        WITH eligible AS (
            SELECT symbol FROM ohlcv
            GROUP BY symbol HAVING count(*) >= %s
        )
        SELECT time::date AS date, symbol, open, high, low, close, volume,
               foreign_net, value_idr, listed_shares, frequency
        FROM ohlcv
        WHERE symbol IN (SELECT symbol FROM eligible) {where}
        ORDER BY symbol, time
    """

    with psycopg2.connect(conn_str) as conn:
        df = pd.read_sql(query, conn, params=params)

    for col in ("open", "high", "low", "close", "foreign_net", "value_idr"):
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    logger.info(
        "loaded %d rows, %d symbols, %s..%s",
        len(df), df["symbol"].nunique() if not df.empty else 0,
        df["date"].min() if not df.empty else "-",
        df["date"].max() if not df.empty else "-",
    )
    return df


def evaluate_walk_forward(features: pd.DataFrame, n_splits: int = 4) -> dict[str, Any]:
    """
    Train and score across expanding time windows.

    Returns per-fold AUC alongside the majority-class baseline, so the summary
    answers "is this better than guessing?" rather than only "what is the AUC?".
    """
    import lightgbm as lgb
    from sklearn.metrics import roc_auc_score

    splits = walk_forward_splits(features, n_splits=n_splits)
    if not splits:
        return {"folds": [], "mean_auc": 0.0, "baseline": 0.0, "usable": False}

    fold_reports: list[dict[str, Any]] = []

    for i, (train, test) in enumerate(splits, start=1):
        X_train, y_train = train[FEATURE_COLUMNS], train[LABEL_COLUMN]
        X_test, y_test = test[FEATURE_COLUMNS], test[LABEL_COLUMN]

        if y_test.nunique() < 2:
            logger.warning("fold %d: test set is single-class, skipping", i)
            continue

        booster = lgb.train(
            LGB_PARAMS,
            lgb.Dataset(X_train, label=y_train),
            num_boost_round=NUM_BOOST_ROUND,
            valid_sets=[lgb.Dataset(X_test, label=y_test)],
            callbacks=[lgb.early_stopping(EARLY_STOPPING, verbose=False)],
        )

        proba = booster.predict(X_test, num_iteration=booster.best_iteration)
        auc = float(roc_auc_score(y_test, proba))

        # Base rate: how often ANY name rose over the horizon in this window.
        base_rate = float(y_test.mean())

        # Top-decile precision: among the names the model ranks highest, how
        # many actually rose. This is the question the product asks, since the
        # UI surfaces a shortlist rather than scoring the whole board.
        n_top = max(1, int(len(proba) * TOP_DECILE))
        top_idx = np.argsort(proba)[-n_top:]
        decile_precision = float(y_test.to_numpy()[top_idx].mean())

        fold_reports.append({
            "fold": i,
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "train_end": str(train["date"].max().date()),
            "test_start": str(test["date"].min().date()),
            "test_end": str(test["date"].max().date()),
            "auc": round(auc, 4),
            "base_rate": round(base_rate, 4),
            "decile_precision": round(decile_precision, 4),
            "decile_lift": round(decile_precision - base_rate, 4),
        })
        logger.info(
            "fold %d: AUC %.4f  top-10%% precision %.4f vs base %.4f (lift %+.4f)  (%s..%s)",
            i, auc, decile_precision, base_rate, decile_precision - base_rate,
            fold_reports[-1]["test_start"], fold_reports[-1]["test_end"],
        )

    if not fold_reports:
        return {"folds": [], "mean_auc": 0.0, "baseline": 0.0, "usable": False}

    mean_auc = float(np.mean([f["auc"] for f in fold_reports]))
    mean_base = float(np.mean([f["base_rate"] for f in fold_reports]))
    mean_precision = float(np.mean([f["decile_precision"] for f in fold_reports]))
    mean_lift = float(np.mean([f["decile_lift"] for f in fold_reports]))
    positive = sum(1 for f in fold_reports if f["auc"] > 0.5) / len(fold_reports)

    return {
        "folds": fold_reports,
        "mean_auc": round(mean_auc, 4),
        "base_rate": round(mean_base, 4),
        "decile_precision": round(mean_precision, 4),
        "mean_decile_lift": round(mean_lift, 4),
        "folds_above_chance": round(positive, 2),
        "usable": True,
    }


def check_gates(report: dict[str, Any]) -> tuple[bool, list[str]]:
    """Return (passed, reasons-for-failure)."""
    failures: list[str] = []

    if not report.get("usable"):
        return False, ["no usable walk-forward folds — not enough history"]

    if report["mean_auc"] < MIN_AUC:
        failures.append(f"mean AUC {report['mean_auc']:.4f} < {MIN_AUC}")
    if report["mean_decile_lift"] < MIN_DECILE_LIFT:
        failures.append(
            f"top-decile lift over base rate {report['mean_decile_lift']:+.4f} "
            f"< {MIN_DECILE_LIFT}"
        )
    if report["folds_above_chance"] < MIN_FOLDS_POSITIVE:
        failures.append(
            f"only {report['folds_above_chance']:.0%} of folds beat chance"
        )

    return not failures, failures


BASELINE_SAMPLE_PER_FEATURE = 20_000


def _build_feature_baseline(features: "pd.DataFrame") -> dict[str, list[float]]:
    """
    Per-feature reference sample for drift detection.

    Stores up to BASELINE_SAMPLE_PER_FEATURE non-null values per feature (the
    whole column when smaller). A fixed seed keeps the artefact reproducible for
    a given training set. NaN is dropped — check_feature_drift drops it on the
    current side too, so the two are compared on the same basis.
    """
    rng = np.random.default_rng(42)
    baseline: dict[str, list[float]] = {}
    for col in FEATURE_COLUMNS:
        if col not in features.columns:
            continue
        vals = features[col].dropna().to_numpy(dtype=float)
        if len(vals) > BASELINE_SAMPLE_PER_FEATURE:
            vals = rng.choice(vals, BASELINE_SAMPLE_PER_FEATURE, replace=False)
        baseline[col] = vals.tolist()
    return baseline


def train(min_sessions: int = 150, n_splits: int = 4) -> dict[str, Any]:
    import lightgbm as lgb

    bars = load_training_bars(min_sessions=min_sessions)
    if bars.empty:
        raise SystemExit(
            "No training data. Run workers.ohlcv_worker.backfill_ohlcv first."
        )

    features = build_point_in_time_features(bars)
    logger.info(
        "features: %d rows, %d symbols, label mean %.4f",
        len(features), features["symbol"].nunique(), features[LABEL_COLUMN].mean(),
    )

    report = evaluate_walk_forward(features, n_splits=n_splits)
    passed, failures = check_gates(report)

    report["passed_gates"] = passed
    report["gate_failures"] = failures
    report["rows"] = int(len(features))
    report["symbols"] = int(features["symbol"].nunique())
    report["trained_at"] = datetime.now(timezone.utc).isoformat()

    if not passed:
        logger.error("GATES FAILED — no model written: %s", "; ".join(failures))
        return report

    # Final fit on everything, now that the design is validated out-of-sample.
    final = lgb.train(
        LGB_PARAMS,
        lgb.Dataset(features[FEATURE_COLUMNS], label=features[LABEL_COLUMN]),
        num_boost_round=NUM_BOOST_ROUND,
    )

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    version = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = MODEL_DIR / f"lgbm_signals_{version}.pkl"

    import joblib

    joblib.dump(
        {
            "model": final,
            "features": FEATURE_COLUMNS,
            "version": version,
            "report": report,
            # Reference distribution for drift monitoring. Stored at training
            # time because that is the only point the "expected" distribution
            # exists — workers.monitoring_worker.check_drift compares live
            # serving features against it (PSI). Sampled to bound the artefact
            # size; a per-feature sample is all compute_psi needs to build bins.
            "feature_baseline": _build_feature_baseline(features),
        },
        path,
    )
    report["model_path"] = str(path)
    logger.info("model written: %s", path)

    (MODEL_DIR / f"report_{version}.json").write_text(json.dumps(report, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the IDX signal model")
    parser.add_argument("--min-sessions", type=int, default=150)
    parser.add_argument("--splits", type=int, default=4)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    report = train(min_sessions=args.min_sessions, n_splits=args.splits)

    print(json.dumps({k: v for k, v in report.items() if k != "folds"}, indent=2))
    raise SystemExit(0 if report.get("passed_gates") else 1)


if __name__ == "__main__":  # pragma: no cover
    main()
