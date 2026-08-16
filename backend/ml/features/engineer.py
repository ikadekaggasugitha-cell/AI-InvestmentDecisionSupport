"""
Feature Engineering — Phase 3

Builds the feature matrix used by LightGBM for signal generation.
All features are cross-sectional (per stock, per day) except macro features
which are portfolio-wide.

Every feature here is computed with a backward-looking window, so the value on
a given row uses only data available on that row's date. Anything that cannot
meet that bar does not belong in FEATURE_COLUMNS — see the note beside
PHASE10_DISPLAY_FEATURES.

Designed to run on a pandas DataFrame with columns:
    symbol, date, open, high, low, close, volume, foreign_net

Returns a DataFrame with one row per (symbol, date) with all engineered features.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ── Technical indicators ──────────────────────────────────────────────────────

def add_rsi(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    delta = df["close"].diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.finfo(float).eps)
    df[f"rsi_{period}"] = 100 - 100 / (1 + rs)
    return df


def add_macd(df: pd.DataFrame) -> pd.DataFrame:
    ema12 = df["close"].ewm(span=12).mean()
    ema26 = df["close"].ewm(span=26).mean()
    df["macd"] = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=9).mean()
    df["macd_delta"] = df["macd"] - df["macd_signal"]
    return df


def add_bollinger(df: pd.DataFrame, period: int = 20) -> pd.DataFrame:
    sma = df["close"].rolling(period).mean()
    std = df["close"].rolling(period).std()
    df["bb_upper"] = sma + 2 * std
    df["bb_lower"] = sma - 2 * std
    df["bb_width"] = (df["bb_upper"] - df["bb_lower"]) / sma
    df["bb_position"] = (df["close"] - df["bb_lower"]) / (
        df["bb_upper"] - df["bb_lower"] + np.finfo(float).eps
    )
    return df


def add_momentum(df: pd.DataFrame) -> pd.DataFrame:
    for period in [5, 10, 20, 60]:
        df[f"ret_{period}d"] = df["close"].pct_change(period)
    df["vol_ratio_5_20"] = (
        df["volume"].rolling(5).mean() / df["volume"].rolling(20).mean()
    )
    return df


def add_foreign_flow(df: pd.DataFrame) -> pd.DataFrame:
    df["foreign_net_5d"]  = df["foreign_net"].rolling(5).sum()
    df["foreign_net_20d"] = df["foreign_net"].rolling(20).sum()
    df["foreign_flow_signal"] = np.sign(df["foreign_net_5d"]) * np.log1p(
        df["foreign_net_5d"].abs()
    )
    return df


def add_pe_percentile(df: pd.DataFrame, universe_df: pd.DataFrame) -> pd.DataFrame:
    """
    Cross-sectional P/E percentile rank vs sector peers.
    `universe_df` must have columns: date, symbol, sector, pe
    """
    sector_pe = (
        universe_df.groupby(["date", "sector"])["pe"]
        .rank(pct=True)
        .rename("pe_sector_pct")
    )
    return df.join(sector_pe, how="left")


# ── Macro features ────────────────────────────────────────────────────────────

def add_macro_features(df: pd.DataFrame, macro_df: pd.DataFrame) -> pd.DataFrame:
    """
    Merge macro features (BI rate change, IDR/USD 30d vol, inflation delta).
    `macro_df` must have columns: date, bi_rate, usdidr
    """
    macro = macro_df.copy()
    macro["bi_rate_change"] = macro["bi_rate"].diff()
    macro["usdidr_vol_30d"] = macro["usdidr"].pct_change().rolling(30).std() * np.sqrt(252)
    return df.merge(
        macro[["date", "bi_rate_change", "usdidr_vol_30d"]],
        on="date", how="left",
    )


# ── Master feature builder ────────────────────────────────────────────────────

FEATURE_COLUMNS = [
    # Phase 3 — Technical + Macro
    "rsi_14", "macd_delta", "bb_width", "bb_position",
    "ret_5d", "ret_10d", "ret_20d", "ret_60d",
    "vol_ratio_5_20", "foreign_net_5d", "foreign_net_20d", "foreign_flow_signal",
    "pe_sector_pct", "bi_rate_change", "usdidr_vol_30d",
]

# ── Why the Phase 10 features are NOT in FEATURE_COLUMNS ──────────────────────
#
# compute_broksum_features() and PriceActionAnalyzer.compute_features() each
# return ONE dict per symbol, derived from that symbol's entire history. The
# original integration assigned those scalars straight onto the frame
# (`g[feat_name] = feat_val`), which pandas broadcasts to every row. That is
# wrong twice over:
#
#   1. Look-ahead leakage. LABEL_COLUMN is close.shift(-5) > close, so a row
#      dated 2024 carried a feature computed from the last bar in the frame —
#      including gap `is_filled`, which scans the full future. Training scores
#      look excellent and live performance is noise.
#   2. Zero within-symbol variance. A constant per symbol is a symbol dummy. It
#      cannot time anything; it only lets the tree memorise each symbol's base
#      rate.
#
# Both modules remain in use — as POINT-IN-TIME display data, served at "now"
# through /v1/technicals and /v1/broksum, where computing from full history is
# correct rather than leaky.
#
# Re-adding them to the model needs a rolling, backward-looking recompute at
# every bar plus a walk-forward backtest to show they add signal. That is its
# own phase; the leaky version could never have told us whether they help.
PHASE10_DISPLAY_FEATURES = [
    "broksum_net_lot_5d", "broksum_net_lot_20d",
    "broksum_top3_consistency", "broksum_concentration",
    "trend_direction", "trend_strength",
    "sr_distance_support", "sr_distance_resistance",
    "candlestick_signal", "gap_unfilled_pct",
]

LABEL_COLUMN = "label_5d_up"  # 1 if close[+5d] > close[0d], else 0


def build_features(
    ohlcv: pd.DataFrame,
    universe: pd.DataFrame,
    macro: pd.DataFrame,
) -> pd.DataFrame:
    """
    End-to-end feature engineering pipeline.

    Args:
        ohlcv:      Daily OHLCV per symbol (columns: symbol, date, open, high, low, close, volume, foreign_net)
        universe:   Cross-sectional universe snapshot (columns: date, symbol, sector, pe)
        macro:      Daily macro data (columns: date, bi_rate, usdidr)

    Returns:
        DataFrame with FEATURE_COLUMNS + LABEL_COLUMN, indexed by (symbol, date).
        Rows with any NaN in a feature column are dropped.
    """
    results = []

    for symbol, group in ohlcv.groupby("symbol"):
        g = group.sort_values("date").copy()

        # Phase 3 — technical indicators
        g = add_rsi(g)
        g = add_macd(g)
        g = add_bollinger(g)
        g = add_momentum(g)
        g = add_foreign_flow(g)

        # 5-day forward label
        g[LABEL_COLUMN] = (g["close"].shift(-5) > g["close"]).astype(int)

        # Phase 10 broker-summary / price-action features are deliberately not
        # attached here — see the PHASE10_DISPLAY_FEATURES note above. They are
        # served point-in-time by api/services/{broksum,technicals}_service.py.

        results.append(g)

    df = pd.concat(results, ignore_index=True)
    df = add_pe_percentile(df, universe)
    df = add_macro_features(df, macro)

    # Phase 3 features are required; Phase 10 features default to 0
    phase3_cols = [
        "rsi_14", "macd_delta", "bb_width", "bb_position",
        "ret_5d", "ret_10d", "ret_20d", "ret_60d",
        "vol_ratio_5_20", "foreign_net_5d", "foreign_net_20d", "foreign_flow_signal",
        "pe_sector_pct", "bi_rate_change", "usdidr_vol_30d",
    ]
    df = df.dropna(subset=phase3_cols + [LABEL_COLUMN])
    return df.set_index(["symbol", "date"])
