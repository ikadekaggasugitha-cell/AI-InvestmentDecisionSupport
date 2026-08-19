"""
Volume-based accumulation / distribution detection — Phase 11

Detects whether a stock is being ACCUMULATED (smart money quietly buying) or
DISTRIBUTED (quietly selling) using only OHLCV + volume. This is the honest
substitute for IDX broker-summary "bandarmology": IDX's per-broker flow is a
gated, licensed dataset (its public endpoint now returns HTTP 404), but the same
question — "is there persistent buying pressure under this price?" — is answerable
from volume behaviour, which we DO have as real daily data.

The signal blends four classic volume indicators so no single one dominates:

  • OBV  (On-Balance Volume)      — cumulative volume signed by daily direction.
                                    A rising OBV under a flat/rising price is the
                                    textbook accumulation footprint.
  • ADL  (Accumulation/Dist Line) — volume weighted by where the close sits in
                                    the day's range (close near high = buying).
  • CMF  (Chaikin Money Flow, 20) — ADL money-flow normalised by volume; > 0 is
                                    net buying pressure, < 0 net selling.
  • MFI  (Money Flow Index, 14)   — volume-weighted RSI; > 50 buying, < 50 selling.

Each is reduced to a −100..+100 vote; the weighted average is the accumulation
`score`, and the sign+magnitude give the `phase` and `strength`. `consistencyDays`
counts how many recent sessions the OBV has advanced — persistence is what
separates real accumulation from a one-day volume spike.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

# Weights for the four indicator votes. OBV/CMF carry the accumulation signal
# most directly; MFI is a lighter confirmation.
_W_OBV, _W_CMF, _W_ADL, _W_MFI = 0.35, 0.30, 0.20, 0.15

_ACC_THRESHOLD = 15.0   # |score| below this is "neutral" — avoid over-calling
_CMF_WINDOW = 20
_MFI_WINDOW = 14
_VOL_SHORT = 5          # recent volume window
_VOL_LONG = 20          # baseline volume window


def _slope_pct(series: pd.Series, window: int) -> float:
    """Linear-regression slope over the last `window` points, as % of the mean."""
    y = series.tail(window).to_numpy(dtype=float)
    if len(y) < 3 or not np.isfinite(y).all():
        return 0.0
    x = np.arange(len(y), dtype=float)
    slope = np.polyfit(x, y, 1)[0]
    mean = np.mean(np.abs(y)) or 1.0
    return float(slope / mean * 100.0)


def _obv(df: pd.DataFrame) -> pd.Series:
    direction = np.sign(df["close"].diff().fillna(0.0))
    return (direction * df["volume"]).cumsum()


def _adl(df: pd.DataFrame) -> pd.Series:
    high, low, close, vol = df["high"], df["low"], df["close"], df["volume"]
    span = (high - low).replace(0, np.nan)
    # Money-flow multiplier: +1 close at high, −1 close at low.
    mfm = ((close - low) - (high - close)) / span
    mfm = mfm.fillna(0.0)
    return (mfm * vol).cumsum()


def _cmf(df: pd.DataFrame, window: int = _CMF_WINDOW) -> float:
    high, low, close, vol = df["high"], df["low"], df["close"], df["volume"]
    span = (high - low).replace(0, np.nan)
    mfm = (((close - low) - (high - close)) / span).fillna(0.0)
    mfv = mfm * vol
    vsum = vol.tail(window).sum()
    if vsum <= 0:
        return 0.0
    return float(mfv.tail(window).sum() / vsum)


def _mfi(df: pd.DataFrame, window: int = _MFI_WINDOW) -> float:
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    rmf = tp * df["volume"]
    delta = tp.diff()
    pos = rmf.where(delta > 0, 0.0).tail(window).sum()
    neg = rmf.where(delta < 0, 0.0).tail(window).sum()
    if neg <= 0:
        return 100.0 if pos > 0 else 50.0
    ratio = pos / neg
    return float(100.0 - (100.0 / (1.0 + ratio)))


def _obv_consistency_days(obv: pd.Series) -> int:
    """Consecutive most-recent sessions the OBV rose (persistence of buying)."""
    diffs = obv.diff().dropna().to_numpy()
    days = 0
    for d in reversed(diffs):
        if d > 0:
            days += 1
        else:
            break
    return days


def _clip(v: float) -> float:
    return float(max(-100.0, min(100.0, v)))


def analyse_accumulation(ohlcv: pd.DataFrame) -> dict[str, Any]:
    """
    Full accumulation/distribution read for one symbol.

    `ohlcv` needs columns [open, high, low, close, volume] in ascending time.
    Returns a dict with the phase, a −100..+100 score, the component indicators,
    a volume-level read, and bilingual human-readable signals. Degrades to a
    neutral, honestly-empty result when there are too few bars to be meaningful.
    """
    empty = {
        "phase": "neutral", "phaseId": "Netral", "score": 0.0, "strength": 0,
        "obvTrend": 0.0, "adlTrend": 0.0, "cmf": 0.0, "mfi": 50.0,
        "volumeRatio": 1.0, "volumeLevel": "normal", "consistencyDays": 0,
        "signals": [], "signalsEn": [], "method": "volume",
    }
    if ohlcv is None or len(ohlcv) < _CMF_WINDOW + 2:
        return empty

    df = ohlcv.copy()
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["close", "volume"])
    if len(df) < _CMF_WINDOW + 2:
        return empty

    obv = _obv(df)
    adl = _adl(df)
    obv_trend = _slope_pct(obv, _VOL_LONG)
    adl_trend = _slope_pct(adl, _VOL_LONG)
    cmf = _cmf(df)
    mfi = _mfi(df)

    # Volume level: recent activity vs its own baseline. > 1 = heavier trade.
    vol_short = df["volume"].tail(_VOL_SHORT).mean()
    vol_long = df["volume"].tail(_VOL_LONG).mean() or 1.0
    vol_ratio = float(vol_short / vol_long)
    if vol_ratio >= 1.5:
        vol_level = "high"
    elif vol_ratio <= 0.6:
        vol_level = "low"
    else:
        vol_level = "normal"

    # Reduce each indicator to a −100..+100 vote.
    v_obv = _clip(obv_trend * 8.0)          # slope% → vote
    v_adl = _clip(adl_trend * 8.0)
    v_cmf = _clip(cmf * 400.0)              # CMF ~±0.25 typical → ±100
    v_mfi = _clip((mfi - 50.0) * 2.0)

    score = _clip(_W_OBV * v_obv + _W_CMF * v_cmf + _W_ADL * v_adl + _W_MFI * v_mfi)
    consistency = _obv_consistency_days(obv)

    if score >= _ACC_THRESHOLD:
        phase, phase_id = "accumulation", "Akumulasi"
    elif score <= -_ACC_THRESHOLD:
        phase, phase_id = "distribution", "Distribusi"
    else:
        phase, phase_id = "neutral", "Netral"

    strength = int(round(abs(score)))

    signals, signals_en = _describe(
        phase, obv_trend, cmf, mfi, vol_ratio, vol_level, consistency, df
    )

    return {
        "phase": phase,
        "phaseId": phase_id,
        "score": round(score, 1),
        "strength": strength,
        "obvTrend": round(obv_trend, 2),
        "adlTrend": round(adl_trend, 2),
        "cmf": round(cmf, 4),
        "mfi": round(mfi, 1),
        "volumeRatio": round(vol_ratio, 2),
        "volumeLevel": vol_level,
        "consistencyDays": consistency,
        "signals": signals,
        "signalsEn": signals_en,
        "method": "volume",
    }


def _describe(
    phase: str,
    obv_trend: float,
    cmf: float,
    mfi: float,
    vol_ratio: float,
    vol_level: str,
    consistency: int,
    df: pd.DataFrame,
) -> tuple[list[str], list[str]]:
    """Bilingual, plain-language reasons behind the accumulation read."""
    id_parts: list[str] = []
    en_parts: list[str] = []

    if phase == "accumulation":
        id_parts.append("Tekanan beli dominan — indikasi akumulasi")
        en_parts.append("Net buying pressure — accumulation")
    elif phase == "distribution":
        id_parts.append("Tekanan jual dominan — indikasi distribusi")
        en_parts.append("Net selling pressure — distribution")
    else:
        id_parts.append("Aliran dana seimbang — belum ada dominasi")
        en_parts.append("Balanced money flow — no dominant side")

    if obv_trend > 0 and consistency >= 3:
        id_parts.append(f"OBV naik {consistency} hari beruntun (pembelian persisten)")
        en_parts.append(f"OBV up {consistency} sessions running (persistent buying)")
    elif obv_trend < 0:
        id_parts.append("OBV menurun (volume condong ke sisi jual)")
        en_parts.append("OBV declining (volume skewed to selling)")

    if abs(cmf) >= 0.05:
        arah = "positif" if cmf > 0 else "negatif"
        id_parts.append(f"Chaikin Money Flow {arah} ({cmf:+.2f})")
        en_parts.append(f"Chaikin Money Flow {'positive' if cmf > 0 else 'negative'} ({cmf:+.2f})")

    if vol_level == "high":
        id_parts.append(f"Volume ramai ({vol_ratio:.1f}× rata-rata 20 hari)")
        en_parts.append(f"Heavy volume ({vol_ratio:.1f}× 20-day average)")
    elif vol_level == "low":
        id_parts.append(f"Volume sepi ({vol_ratio:.1f}× rata-rata 20 hari)")
        en_parts.append(f"Thin volume ({vol_ratio:.1f}× 20-day average)")

    # Price/volume divergence — accumulation into a flat/soft price is the
    # highest-conviction footprint.
    price_chg = _slope_pct(df["close"], _VOL_LONG)
    if phase == "accumulation" and price_chg <= 0.5:
        id_parts.append("Akumulasi saat harga masih tertekan (divergensi bullish)")
        en_parts.append("Accumulation while price is still soft (bullish divergence)")

    return id_parts, en_parts


def accumulation_history(ohlcv: pd.DataFrame, days: int = 30) -> list[dict[str, Any]]:
    """
    Per-day accumulation score for the last `days` sessions.

    Rolls the CMF and OBV-direction forward one bar at a time so the caller can
    plot how buying/selling pressure built up — the "history that detects
    accumulation" the product needs. Cheap: O(n) over a windowed frame.
    """
    if ohlcv is None or len(ohlcv) < _CMF_WINDOW + 2:
        return []

    df = ohlcv.copy()
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["close", "volume"]).reset_index(drop=True)

    high, low, close, vol = df["high"], df["low"], df["close"], df["volume"]
    span = (high - low).replace(0, np.nan)
    mfm = (((close - low) - (high - close)) / span).fillna(0.0)
    mfv = mfm * vol
    # Rolling CMF as the per-day accumulation proxy (−1..+1 → −100..+100).
    cmf_series = (mfv.rolling(_CMF_WINDOW).sum() / vol.rolling(_CMF_WINDOW).sum()).fillna(0.0)

    times = df["time"] if "time" in df.columns else df.index
    out: list[dict[str, Any]] = []
    tail = min(days, len(df))
    for i in range(len(df) - tail, len(df)):
        raw_score = _clip(float(cmf_series.iloc[i]) * 400.0)
        t = times.iloc[i] if hasattr(times, "iloc") else times[i]
        date_str = str(t)[:10]
        out.append({
            "date": date_str,
            "score": round(raw_score, 1),
            "phase": (
                "accumulation" if raw_score >= _ACC_THRESHOLD
                else "distribution" if raw_score <= -_ACC_THRESHOLD
                else "neutral"
            ),
            "volume": int(vol.iloc[i]) if np.isfinite(vol.iloc[i]) else 0,
            "close": round(float(close.iloc[i]), 2),
        })
    return out
