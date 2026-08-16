"""
Data Drift Detection — Phase 5

Monitors feature distribution drift using Population Stability Index (PSI).
Triggers model retraining when PSI > 0.2 on any feature.

PSI interpretation:
  < 0.10  — stable (no action)
  0.10–0.20 — minor drift (alert)
  > 0.20  — significant drift (trigger retraining)
"""

import logging
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

PSI_THRESHOLD_ALERT   = 0.10
PSI_THRESHOLD_RETRAIN = 0.20
N_BINS = 10


def compute_psi(expected: np.ndarray, actual: np.ndarray, n_bins: int = N_BINS) -> float:
    """
    Compute Population Stability Index between expected (training) and
    actual (current) distributions.

    Args:
        expected: 1D array of expected (reference) values
        actual:   1D array of actual (current) values
        n_bins:   Number of quantile buckets

    Returns:
        PSI score (float). Higher = more drift.
    """
    eps = 1e-6
    bins = np.percentile(expected, np.linspace(0, 100, n_bins + 1))
    bins[0] = -np.inf
    bins[-1] = np.inf

    def _bin_pct(arr: np.ndarray) -> np.ndarray:
        counts, _ = np.histogram(arr, bins=bins)
        return (counts + eps) / (len(arr) + eps * n_bins)

    expected_pct = _bin_pct(expected)
    actual_pct   = _bin_pct(actual)

    return float(np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct)))


def check_feature_drift(
    reference_df: pd.DataFrame,
    current_df: pd.DataFrame,
    feature_columns: list[str],
) -> dict[str, Any]:
    """
    Check all features for drift.

    Returns:
        {
            "psi": {feature: score, ...},
            "drifted_features": [feature, ...],  # PSI > 0.10
            "needs_retraining": bool,             # any PSI > 0.20
            "max_psi": float,
            "checked_at": str (ISO),
        }
    """
    psi_scores: dict[str, float] = {}

    for col in feature_columns:
        if col not in reference_df.columns or col not in current_df.columns:
            continue
        ref = reference_df[col].dropna().values
        cur = current_df[col].dropna().values
        if len(ref) < 50 or len(cur) < 10:
            continue
        psi_scores[col] = compute_psi(ref, cur)

    drifted = [f for f, s in psi_scores.items() if s > PSI_THRESHOLD_ALERT]
    needs_retraining = any(s > PSI_THRESHOLD_RETRAIN for s in psi_scores.values())
    max_psi = max(psi_scores.values(), default=0.0)

    result = {
        "psi": psi_scores,
        "drifted_features": drifted,
        "needs_retraining": needs_retraining,
        "max_psi": round(max_psi, 4),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }

    if needs_retraining:
        logger.warning(
            "drift_detector: RETRAINING REQUIRED — max_psi=%.4f drifted=%s",
            max_psi, drifted,
        )
    elif drifted:
        logger.info("drift_detector: minor drift — features=%s", drifted)
    else:
        logger.debug("drift_detector: stable — max_psi=%.4f", max_psi)

    return result
