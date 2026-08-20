"""
Foreign-flow accumulation / distribution detection — Phase 12

The free, legal substitute for gated IDX broker-summary "bandarmology".

IDX's per-broker buy/sell flow is a licensed dataset (its public endpoint now
returns HTTP 404), so we cannot say *which broker* is accumulating. But IDX's
own free `GetStockSummary` publication carries `ForeignBuy` / `ForeignSell` per
instrument, and `ingestor/providers/idx.py` already ingests it into
`ohlcv.foreign_net`. Foreign participants are the dominant institutional force
on IDX, so persistent net foreign buying under a stock is the closest honest
answer to "is smart money accumulating this?" — using data we actually have,
for free, without scraping anything gated.

This module reduces the foreign-net series to the same shape as
`volume_accumulation.analyse_accumulation`, so the two can be blended into one
combined read:

  • netForeign5d / netForeign20d — rolling net foreign flow, in LOTS (IDX shares
                                   ÷ 100), the unit Indonesian retail reads.
  • foreignRatio                 — net foreign as a fraction of traded volume,
                                   a scale-free number comparable across BBCA
                                   (huge turnover) and a small cap alike.
  • consistencyDays              — consecutive recent sessions foreign flow kept
                                   the same sign; persistence separates real
                                   accumulation from a one-day block trade.
  • score                        — −100..+100, sign+magnitude → phase+strength.

Degrades honestly: when `foreign_net` is absent or entirely null (e.g. a
Yahoo-only bootstrap that carries no foreign flow), it returns a neutral result
with `available=False` so callers can fall back to the volume-only read rather
than present a fabricated zero as a finding.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

_SHARES_PER_LOT = 100

_ACC_THRESHOLD = 20.0     # |score| below this is "neutral" — avoid over-calling
_NET_SHORT = 5            # recent window (sessions)
_NET_LONG = 20            # baseline window (sessions)
_MIN_BARS = _NET_LONG + 2

# Component weights: the recent net flow carries the signal most directly, the
# 20-day leg confirms it is a trend not a spike, and persistence adds conviction.
_W_FLOW5, _W_FLOW20, _W_CONSISTENCY = 0.45, 0.30, 0.25

# ratio → vote scaling. A net foreign flow of ~40% of turnover over the window
# is an extreme, full-conviction reading; scale so that maps to ±100.
_RATIO_TO_VOTE = 250.0


def _clip(v: float) -> float:
    return float(max(-100.0, min(100.0, v)))


def _foreign_series(df: pd.DataFrame) -> pd.Series | None:
    """Coerce the foreign_net column to numeric, or None when unusable."""
    if df is None or "foreign_net" not in df.columns:
        return None
    fn = pd.to_numeric(df["foreign_net"], errors="coerce")
    if fn.notna().sum() == 0:
        return None
    return fn


def _consistency_days(net: pd.Series) -> int:
    """Consecutive most-recent sessions foreign flow kept one sign."""
    vals = net.dropna().to_numpy()
    days = 0
    direction = 0
    for v in reversed(vals):
        sign = 1 if v > 0 else -1 if v < 0 else 0
        if sign == 0:
            break
        if direction == 0:
            direction = sign
        if sign == direction:
            days += 1
        else:
            break
    return days


def _empty(available: bool = False) -> dict[str, Any]:
    return {
        "phase": "neutral", "phaseId": "Netral", "score": 0.0, "strength": 0,
        "netForeign5d": 0, "netForeign20d": 0, "foreignRatio": 0.0,
        "consistencyDays": 0, "signals": [], "signalsEn": [],
        "method": "foreign", "available": available,
    }


def analyse_foreign_flow(ohlcv: pd.DataFrame) -> dict[str, Any]:
    """
    Foreign-flow accumulation/distribution read for one symbol.

    `ohlcv` needs a `foreign_net` column (shares) plus `volume`, in ascending
    time. Returns the same-shaped dict as `analyse_accumulation` so a caller can
    blend the two. When foreign flow is missing, returns a neutral result with
    `available=False`.
    """
    net = _foreign_series(ohlcv)
    if net is None:
        return _empty(available=False)

    df = ohlcv.copy()
    df["foreign_net"] = net.fillna(0.0)
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0.0)
    if len(df) < _MIN_BARS:
        return _empty(available=True)

    net_series = df["foreign_net"]
    vol_series = df["volume"]

    net5_shares = float(net_series.tail(_NET_SHORT).sum())
    net20_shares = float(net_series.tail(_NET_LONG).sum())
    vol5 = float(vol_series.tail(_NET_SHORT).sum()) or 1.0
    vol20 = float(vol_series.tail(_NET_LONG).sum()) or 1.0

    ratio5 = net5_shares / vol5      # net foreign as fraction of 5-day turnover
    ratio20 = net20_shares / vol20

    consistency = _consistency_days(net_series)

    v_flow5 = _clip(ratio5 * _RATIO_TO_VOTE)
    v_flow20 = _clip(ratio20 * _RATIO_TO_VOTE)
    v_consistency = min(consistency, 5) / 5 * 100 * (1 if net5_shares > 0 else -1 if net5_shares < 0 else 0)

    score = _clip(_W_FLOW5 * v_flow5 + _W_FLOW20 * v_flow20 + _W_CONSISTENCY * v_consistency)

    if score >= _ACC_THRESHOLD:
        phase, phase_id = "accumulation", "Akumulasi"
    elif score <= -_ACC_THRESHOLD:
        phase, phase_id = "distribution", "Distribusi"
    else:
        phase, phase_id = "neutral", "Netral"

    net5_lots = int(round(net5_shares / _SHARES_PER_LOT))
    net20_lots = int(round(net20_shares / _SHARES_PER_LOT))

    signals, signals_en = _describe(phase, net5_lots, net20_lots, ratio5, consistency)

    return {
        "phase": phase,
        "phaseId": phase_id,
        "score": round(score, 1),
        "strength": int(round(abs(score))),
        "netForeign5d": net5_lots,
        "netForeign20d": net20_lots,
        "foreignRatio": round(ratio5, 4),
        "consistencyDays": consistency,
        "signals": signals,
        "signalsEn": signals_en,
        "method": "foreign",
        "available": True,
    }


def _fmt_lot(lots: int) -> str:
    """Indonesian thousands separator with explicit sign, e.g. +1.250 / -900."""
    return f"{lots:+,}".replace(",", ".")


def _describe(
    phase: str,
    net5_lots: int,
    net20_lots: int,
    ratio5: float,
    consistency: int,
) -> tuple[list[str], list[str]]:
    """Bilingual, plain-language reasons behind the foreign-flow read."""
    id_parts: list[str] = []
    en_parts: list[str] = []

    if phase == "accumulation":
        id_parts.append("Asing net beli — indikasi akumulasi institusi")
        en_parts.append("Foreign net buy — institutional accumulation")
    elif phase == "distribution":
        id_parts.append("Asing net jual — indikasi distribusi institusi")
        en_parts.append("Foreign net sell — institutional distribution")
    else:
        id_parts.append("Aliran dana asing seimbang — belum ada dominasi")
        en_parts.append("Balanced foreign flow — no dominant side")

    id_parts.append(f"Net asing {_fmt_lot(net5_lots)} lot (5 hari)")
    en_parts.append(f"Foreign net {_fmt_lot(net5_lots)} lots (5 sessions)")

    if abs(net20_lots) >= abs(net5_lots) and net20_lots != 0:
        id_parts.append(f"tren 20 hari {_fmt_lot(net20_lots)} lot")
        en_parts.append(f"20-session trend {_fmt_lot(net20_lots)} lots")

    if consistency >= 3:
        arah = "beli" if net5_lots > 0 else "jual"
        arah_en = "buying" if net5_lots > 0 else "selling"
        id_parts.append(f"asing net {arah} {consistency} hari beruntun (persisten)")
        en_parts.append(f"foreign net {arah_en} {consistency} sessions running (persistent)")

    if abs(ratio5) >= 0.10:
        id_parts.append(f"{abs(ratio5) * 100:.0f}% dari volume digerakkan asing")
        en_parts.append(f"{abs(ratio5) * 100:.0f}% of volume driven by foreign flow")

    return id_parts, en_parts


def foreign_flow_history(ohlcv: pd.DataFrame, days: int = 30) -> list[dict[str, Any]]:
    """
    Per-day foreign-flow read for the last `days` sessions — the pullable
    accumulation history the product needs.

    Each row carries the day's net foreign flow (lots), the running cumulative
    net (lots), and a phase derived from the rolling 5-day net as a fraction of
    volume. Returns [] when foreign flow is unavailable or the series is too
    short to roll a window over.
    """
    net = _foreign_series(ohlcv)
    if net is None or len(ohlcv) < _NET_SHORT + 1:
        return []

    df = ohlcv.copy().reset_index(drop=True)
    df["foreign_net"] = net.fillna(0.0)
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0.0)

    roll_net = df["foreign_net"].rolling(_NET_SHORT, min_periods=1).sum()
    roll_vol = df["volume"].rolling(_NET_SHORT, min_periods=1).sum().replace(0, np.nan)
    ratio = (roll_net / roll_vol).fillna(0.0)
    cumulative = df["foreign_net"].cumsum()

    times = df["time"] if "time" in df.columns else df.index
    out: list[dict[str, Any]] = []
    tail = min(days, len(df))
    for i in range(len(df) - tail, len(df)):
        raw_score = _clip(float(ratio.iloc[i]) * _RATIO_TO_VOTE)
        t = times.iloc[i] if hasattr(times, "iloc") else times[i]
        out.append({
            "date": str(t)[:10],
            "netForeign": int(round(float(df["foreign_net"].iloc[i]) / _SHARES_PER_LOT)),
            "cumulativeNet": int(round(float(cumulative.iloc[i]) / _SHARES_PER_LOT)),
            "score": round(raw_score, 1),
            "phase": (
                "accumulation" if raw_score >= _ACC_THRESHOLD
                else "distribution" if raw_score <= -_ACC_THRESHOLD
                else "neutral"
            ),
            "close": round(float(pd.to_numeric(df["close"].iloc[i], errors="coerce")), 2)
            if "close" in df.columns else 0.0,
        })
    return out
