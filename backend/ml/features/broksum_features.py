"""
Broker Summary Feature Engineering — Phase 10

Analyses broker summary data to detect accumulation vs distribution phases,
identify dominant brokers, and compute features for LightGBM signal model.

Features produced:
    broksum_net_lot_5d       — Net lot sum rolling 5 trading days
    broksum_net_lot_20d      — Net lot sum rolling 20 trading days
    broksum_top3_consistency — Consecutive days top 3 buyers are net-positive
    broksum_concentration    — Herfindahl index of broker activity concentration
"""

import logging
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def compute_accumulation_score(
    broksum_df: pd.DataFrame,
    symbol: str,
) -> dict[str, Any]:
    """
    Analyse broker summary data for a symbol and determine accumulation/distribution phase.

    Args:
        broksum_df: DataFrame with columns [time, symbol, broker_code, buy_lot, sell_lot,
                    net_lot, net_val, avg_buy_price, avg_sell_price].
                    Should contain multiple days of data for the given symbol.
        symbol: Stock symbol to analyse.

    Returns:
        {
            "phase": "accumulation" | "distribution" | "neutral",
            "phaseId": "Akumulasi" | "Distribusi" | "Netral",
            "score": float (-100 to +100),
            "topBuyers": [{"broker": "YP", "netLot5d": 15000, "netLot20d": 42000}, ...],
            "topSellers": [{"broker": "CC", "netLot5d": -12000, "netLot20d": -35000}, ...],
            "consistencyDays": int,
            "netLot5d": int,
            "netLot20d": int,
            "concentration": float (0-1, Herfindahl index),
        }
    """
    sym_df = broksum_df[broksum_df["symbol"] == symbol].copy()

    if sym_df.empty:
        return _empty_result()

    # Ensure time-sorted
    sym_df["date"] = pd.to_datetime(sym_df["time"]).dt.date
    sym_df = sym_df.sort_values("time")

    # ── Per-broker aggregates ─────────────────────────────────────────────────
    daily_net = sym_df.groupby(["date", "broker_code"])["net_lot"].sum().reset_index()

    # Get unique dates (most recent first)
    dates = sorted(sym_df["date"].unique(), reverse=True)
    last_5_dates = dates[:5]
    last_20_dates = dates[:20]

    # ── Rolling net lots ──────────────────────────────────────────────────────
    net_lot_5d = int(
        daily_net[daily_net["date"].isin(last_5_dates)]["net_lot"].sum()
    )
    net_lot_20d = int(
        daily_net[daily_net["date"].isin(last_20_dates)]["net_lot"].sum()
    )

    # ── Top buyers and sellers (by 5d net lot) ────────────────────────────────
    broker_5d = (
        daily_net[daily_net["date"].isin(last_5_dates)]
        .groupby("broker_code")["net_lot"]
        .sum()
    )
    broker_20d = (
        daily_net[daily_net["date"].isin(last_20_dates)]
        .groupby("broker_code")["net_lot"]
        .sum()
    )

    top_buyers = (
        broker_5d.nlargest(3)
        .reset_index()
        .rename(columns={"broker_code": "broker", "net_lot": "netLot5d"})
    )
    top_buyers["netLot20d"] = top_buyers["broker"].map(
        broker_20d.to_dict()
    ).fillna(0).astype(int)

    top_sellers = (
        broker_5d.nsmallest(3)
        .reset_index()
        .rename(columns={"broker_code": "broker", "net_lot": "netLot5d"})
    )
    top_sellers["netLot20d"] = top_sellers["broker"].map(
        broker_20d.to_dict()
    ).fillna(0).astype(int)

    # ── Consistency: consecutive days top 3 brokers are net-positive ──────────
    consistency_days = _compute_consistency(daily_net, dates)

    # ── Herfindahl concentration index ────────────────────────────────────────
    concentration = _compute_herfindahl(
        daily_net[daily_net["date"].isin(last_5_dates)]
    )

    # ── Phase determination ───────────────────────────────────────────────────
    # Score: weighted combination of net lot signals
    score_5d = _sigmoid_score(net_lot_5d, scale=5000)    # range -100..+100
    score_20d = _sigmoid_score(net_lot_20d, scale=20000)
    score_consistency = min(consistency_days, 5) / 5 * 100 * (1 if net_lot_5d > 0 else -1)
    score_concentration = concentration * 50 * (1 if net_lot_5d > 0 else -1)

    raw_score = (
        score_5d * 0.35
        + score_20d * 0.30
        + score_consistency * 0.20
        + score_concentration * 0.15
    )
    score = round(max(-100, min(100, raw_score)), 1)

    if score >= 25:
        phase = "accumulation"
        phase_id = "Akumulasi"
    elif score <= -25:
        phase = "distribution"
        phase_id = "Distribusi"
    else:
        phase = "neutral"
        phase_id = "Netral"

    return {
        "phase": phase,
        "phaseId": phase_id,
        "score": score,
        "topBuyers": top_buyers.to_dict("records"),
        "topSellers": top_sellers.to_dict("records"),
        "consistencyDays": consistency_days,
        "netLot5d": net_lot_5d,
        "netLot20d": net_lot_20d,
        "concentration": round(concentration, 4),
    }


def compute_broksum_features(
    broksum_df: pd.DataFrame,
    symbol: str,
) -> dict[str, float]:
    """
    Compute numerical features from broker summary for LightGBM integration.

    Returns dict with keys matching FEATURE_COLUMNS additions:
        broksum_net_lot_5d, broksum_net_lot_20d,
        broksum_top3_consistency, broksum_concentration
    """
    result = compute_accumulation_score(broksum_df, symbol)

    return {
        "broksum_net_lot_5d": float(result["netLot5d"]),
        "broksum_net_lot_20d": float(result["netLot20d"]),
        "broksum_top3_consistency": float(result["consistencyDays"]),
        "broksum_concentration": result["concentration"],
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _empty_result() -> dict[str, Any]:
    return {
        "phase": "neutral",
        "phaseId": "Netral",
        "score": 0.0,
        "topBuyers": [],
        "topSellers": [],
        "consistencyDays": 0,
        "netLot5d": 0,
        "netLot20d": 0,
        "concentration": 0.0,
    }


def _sigmoid_score(value: float, scale: float = 5000) -> float:
    """Map a raw value to -100..+100 via sigmoid-like transformation."""
    normalised = value / scale
    return 100 * (2 / (1 + np.exp(-normalised)) - 1)


def _compute_consistency(daily_net: pd.DataFrame, dates: list) -> int:
    """
    Count consecutive recent days where net aggregate is positive (or negative).
    Returns positive number for buy-consistent, capped at len(dates).
    """
    if not dates:
        return 0

    direction = None
    count = 0

    for date in dates:  # dates are sorted most-recent-first
        day_net = daily_net[daily_net["date"] == date]["net_lot"].sum()
        if day_net == 0:
            break

        current_direction = "buy" if day_net > 0 else "sell"
        if direction is None:
            direction = current_direction

        if current_direction == direction:
            count += 1
        else:
            break

    return count


def _compute_herfindahl(daily_net_df: pd.DataFrame) -> float:
    """
    Herfindahl-Hirschman Index of broker net-lot concentration.
    High concentration (close to 1) = one broker dominates.
    Low concentration (close to 0) = distributed across many brokers.
    """
    if daily_net_df.empty:
        return 0.0

    broker_abs = daily_net_df.groupby("broker_code")["net_lot"].sum().abs()
    total = broker_abs.sum()

    if total == 0:
        return 0.0

    shares = broker_abs / total
    hhi = float((shares ** 2).sum())
    return hhi
