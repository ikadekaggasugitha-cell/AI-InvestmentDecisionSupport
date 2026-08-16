"""
Point-in-time feature construction.

Every value on a row must be computable from data available on that row's own
date. This module exists because the previous integration was not: it computed
one scalar per symbol from the whole history and broadcast it across every row,
so a 2024 observation carried information from 2026 and the model learned to
predict a future it had already been shown.

Three rules, enforced by tests in tests/test_point_in_time.py:

  1. Rolling windows only, always backward-looking.
  2. Anything derived from a cross-section (a rank, a percentile) is computed
     within a single date, never pooled across dates.
  3. The label is the only forward-looking column, and it is dropped from the
     feature matrix before training.

The cheapest way to violate all three is a `.mean()` without a `groupby`, so
the helpers below take the grouping explicitly rather than defaulting to it.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Horizon for the prediction target, in trading sessions.
LABEL_HORIZON = 5

FEATURE_COLUMNS = [
    # Momentum — returns over trailing windows
    "ret_1d", "ret_5d", "ret_20d", "ret_60d",
    # Mean reversion / trend
    "rsi_14", "ema_ratio_9_21", "dist_from_high_60d", "dist_from_low_60d",
    # Volatility
    "vol_20d", "vol_ratio_5_20",
    # Liquidity
    "turnover_ratio_20d", "volume_ratio_5_20", "frequency_ratio_5_20",
    # Foreign participation — first-party IDX data, unavailable from Yahoo
    "foreign_net_ratio_1d", "foreign_net_ratio_5d", "foreign_net_ratio_20d",
    # Cross-sectional: where this name sits among all names ON THAT DATE
    "xs_ret_20d_rank", "xs_turnover_rank",
]

LABEL_COLUMN = "label_up_5d"


def _rolling_returns(g: pd.DataFrame) -> pd.DataFrame:
    close = g["close"]
    g["ret_1d"] = close.pct_change(1)
    g["ret_5d"] = close.pct_change(5)
    g["ret_20d"] = close.pct_change(20)
    g["ret_60d"] = close.pct_change(60)
    return g


def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _trend_and_position(g: pd.DataFrame) -> pd.DataFrame:
    close = g["close"]
    g["rsi_14"] = _rsi(close, 14)

    ema_fast = close.ewm(span=9, adjust=False).mean()
    ema_slow = close.ewm(span=21, adjust=False).mean()
    g["ema_ratio_9_21"] = (ema_fast / ema_slow) - 1

    # Distance from the trailing extreme. `.rolling(60)` includes the current
    # bar, which is correct — today's high is known today.
    high_60 = g["high"].rolling(60).max()
    low_60 = g["low"].rolling(60).min()
    g["dist_from_high_60d"] = (close / high_60) - 1
    g["dist_from_low_60d"] = (close / low_60) - 1
    return g


def _volatility(g: pd.DataFrame) -> pd.DataFrame:
    r1 = g["close"].pct_change(1)
    g["vol_20d"] = r1.rolling(20).std()
    vol_5 = r1.rolling(5).std()
    g["vol_ratio_5_20"] = vol_5 / g["vol_20d"].replace(0, np.nan)
    return g


def _liquidity(g: pd.DataFrame) -> pd.DataFrame:
    # Turnover normalises traded value by market cap, making a small cap and a
    # blue chip comparable. Raw value would just re-encode company size.
    if "value_idr" in g and "listed_shares" in g:
        mcap = g["listed_shares"] * g["close"]
        turnover = g["value_idr"] / mcap.replace(0, np.nan)
        g["turnover_ratio_20d"] = turnover.rolling(20).mean()
    else:
        g["turnover_ratio_20d"] = np.nan

    vol_5 = g["volume"].rolling(5).mean()
    vol_20 = g["volume"].rolling(20).mean()
    g["volume_ratio_5_20"] = vol_5 / vol_20.replace(0, np.nan)

    if "frequency" in g:
        f5 = g["frequency"].rolling(5).mean()
        f20 = g["frequency"].rolling(20).mean()
        g["frequency_ratio_5_20"] = f5 / f20.replace(0, np.nan)
    else:
        g["frequency_ratio_5_20"] = np.nan
    return g


def _foreign_flow(g: pd.DataFrame) -> pd.DataFrame:
    """
    Foreign participation, scaled by the session's own volume.

    Absolute net flow is dominated by company size; as a share of volume it
    reads as pressure. NaN stays NaN — a session IDX did not report is not a
    session with zero foreign interest, and LightGBM handles NaN natively.
    """
    if "foreign_net" not in g:
        for c in ("foreign_net_ratio_1d", "foreign_net_ratio_5d", "foreign_net_ratio_20d"):
            g[c] = np.nan
        return g

    volume = g["volume"].replace(0, np.nan)
    ratio = g["foreign_net"] / volume
    g["foreign_net_ratio_1d"] = ratio
    g["foreign_net_ratio_5d"] = ratio.rolling(5).mean()
    g["foreign_net_ratio_20d"] = ratio.rolling(20).mean()
    return g


def _label(g: pd.DataFrame) -> pd.DataFrame:
    """
    1 when the close LABEL_HORIZON sessions ahead exceeds today's.

    This is the only forward-looking column in the frame, and it is dropped
    from X before training. The final LABEL_HORIZON rows of each symbol get NaN
    and are removed — scoring them would require a future that has not happened.
    """
    future = g["close"].shift(-LABEL_HORIZON)
    g[LABEL_COLUMN] = (future > g["close"]).astype("float")
    g.loc[future.isna(), LABEL_COLUMN] = np.nan
    return g


def build_point_in_time_features(ohlcv: pd.DataFrame) -> pd.DataFrame:
    """
    Build the training matrix from daily bars.

    Expects columns: symbol, date, open, high, low, close, volume, and
    optionally foreign_net, value_idr, listed_shares, frequency.

    Returns one row per (symbol, date) carrying FEATURE_COLUMNS + LABEL_COLUMN.
    """
    if ohlcv.empty:
        return pd.DataFrame(columns=["symbol", "date", *FEATURE_COLUMNS, LABEL_COLUMN])

    df = ohlcv.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["symbol", "date"])

    # ── Per-symbol time-series features ───────────────────────────────────────
    out: list[pd.DataFrame] = []
    for _, g in df.groupby("symbol", sort=False):
        g = g.copy()
        g = _rolling_returns(g)
        g = _trend_and_position(g)
        g = _volatility(g)
        g = _liquidity(g)
        g = _foreign_flow(g)
        g = _label(g)
        out.append(g)

    df = pd.concat(out, ignore_index=True)

    # ── Cross-sectional ranks, computed WITHIN each date ──────────────────────
    # Grouping by date is what keeps these point-in-time. Ranking the pooled
    # column instead would compare today's move against next year's, which is
    # the subtlest form of the leak this module exists to prevent.
    df["xs_ret_20d_rank"] = (
        df.groupby("date")["ret_20d"].rank(pct=True, na_option="keep")
    )
    df["xs_turnover_rank"] = (
        df.groupby("date")["turnover_ratio_20d"].rank(pct=True, na_option="keep")
    )

    df = df.dropna(subset=[LABEL_COLUMN])
    df[LABEL_COLUMN] = df[LABEL_COLUMN].astype(int)

    keep = ["symbol", "date", *FEATURE_COLUMNS, LABEL_COLUMN]
    return df[keep].reset_index(drop=True)


def walk_forward_splits(
    df: pd.DataFrame,
    n_splits: int = 4,
    embargo_days: int = LABEL_HORIZON,
) -> list[tuple[pd.DataFrame, pd.DataFrame]]:
    """
    Expanding-window splits ordered in time, with an embargo gap.

    A random split leaks badly on time-series data: the same date appears in
    both train and test through other symbols, and the label spans
    LABEL_HORIZON sessions, so rows near the boundary overlap the test window.
    The embargo drops that overlap.

    Yields (train, test) oldest to newest.
    """
    if df.empty:
        return []

    dates = np.sort(df["date"].unique())
    if len(dates) < (n_splits + 1) * (embargo_days + 5):
        logger.warning(
            "walk_forward: %d dates is thin for %d splits", len(dates), n_splits
        )

    splits: list[tuple[pd.DataFrame, pd.DataFrame]] = []
    fold = len(dates) // (n_splits + 1)
    if fold == 0:
        return []

    for i in range(1, n_splits + 1):
        train_end_idx = fold * i
        test_end_idx = min(fold * (i + 1), len(dates))

        train_end = dates[train_end_idx - 1]
        # Embargo: no training row may sit within `embargo_days` of the test
        # window, because its label reaches into it.
        embargo_cut = dates[max(0, train_end_idx - 1 - embargo_days)]
        test_start = dates[train_end_idx]
        test_end = dates[test_end_idx - 1]

        train = df[df["date"] <= embargo_cut]
        test = df[(df["date"] >= test_start) & (df["date"] <= test_end)]

        if not train.empty and not test.empty:
            splits.append((train, test))
        else:
            logger.debug("walk_forward: skipping empty fold %d (train_end=%s)", i, train_end)

    return splits
