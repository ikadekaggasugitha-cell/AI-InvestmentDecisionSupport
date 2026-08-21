"""
Price Action Analyzer — Phase 10

Comprehensive technical analysis engine for OHLCV data:
    • EMA-based trend detection (EMA9 × EMA21 cross)
    • Williams fractal Support/Resistance level detection
    • Candlestick pattern recognition (12 patterns)
    • Gap detection with historical fill probability

Features produced for LightGBM:
    trend_direction        — Encoded: uptrend=1, sideways=0, downtrend=-1
    trend_strength         — 0-100
    sr_distance_support    — % distance to nearest support
    sr_distance_resistance — % distance to nearest resistance
    candlestick_signal     — Encoded pattern strength (-3 to +3)
    gap_unfilled_pct       — Total unfilled gap % still open
"""

import logging
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class PriceActionAnalyzer:
    """Stateless technical analysis engine operating on OHLCV DataFrames."""

    # ── Trend Detection ───────────────────────────────────────────────────────

    def detect_trend(
        self,
        ohlcv: pd.DataFrame,
        fast_period: int = 9,
        slow_period: int = 21,
    ) -> dict[str, Any]:
        """
        Detect trend direction using EMA cross + higher-high / lower-low.

        Args:
            ohlcv: DataFrame with columns [time, open, high, low, close, volume].
            fast_period: Fast EMA period (default 9).
            slow_period: Slow EMA period (default 21).

        Returns:
            {
                "trend": "uptrend" | "downtrend" | "sideways",
                "trendId": Indonesian translation,
                "strength": 0-100,
                "ema_fast": float,
                "ema_slow": float,
                "higher_highs": int (consecutive),
                "lower_lows": int (consecutive),
            }
        """
        if len(ohlcv) < slow_period + 5:
            return {
                "trend": "sideways", "trendId": "Sideways",
                "strength": 0, "ema_fast": 0, "ema_slow": 0,
                "higher_highs": 0, "lower_lows": 0,
            }

        df = ohlcv.copy().sort_values("time").reset_index(drop=True)
        close = df["close"].astype(float)

        ema_fast = close.ewm(span=fast_period, adjust=False).mean()
        ema_slow = close.ewm(span=slow_period, adjust=False).mean()

        last_ema_fast = float(ema_fast.iloc[-1])
        last_ema_slow = float(ema_slow.iloc[-1])

        # EMA delta as % of price
        ema_delta_pct = (last_ema_fast - last_ema_slow) / last_ema_slow * 100

        # Higher highs / lower lows analysis (last 10 bars)
        highs = df["high"].astype(float).values[-10:]
        lows = df["low"].astype(float).values[-10:]

        higher_highs = _count_consecutive_direction(highs, direction="up")
        lower_lows = _count_consecutive_direction(lows, direction="down")

        # Determine trend
        if ema_delta_pct > 0.3 and higher_highs >= 2:
            trend = "uptrend"
            trend_id = "Uptrend"
            strength = min(100, int(abs(ema_delta_pct) * 15 + higher_highs * 10))
        elif ema_delta_pct < -0.3 and lower_lows >= 2:
            trend = "downtrend"
            trend_id = "Downtrend"
            strength = min(100, int(abs(ema_delta_pct) * 15 + lower_lows * 10))
        else:
            trend = "sideways"
            trend_id = "Sideways"
            strength = max(0, 50 - int(abs(ema_delta_pct) * 10))

        return {
            "trend": trend,
            "trendId": trend_id,
            "strength": strength,
            "ema_fast": round(last_ema_fast, 2),
            "ema_slow": round(last_ema_slow, 2),
            "higher_highs": higher_highs,
            "lower_lows": lower_lows,
        }

    # ── Support & Resistance ──────────────────────────────────────────────────

    # A support/resistance "level" is really a zone. At IDX tick sizes the old
    # 0.5% tolerance was about two ticks wide (one tick is 25 at a price of
    # 9850, i.e. 0.25%), so pivots almost never clustered and most symbols
    # returned no levels at all — which in turn meant no stop loss could ever be
    # derived. 1.5% is a realistic zone width for daily bars.
    SR_CLUSTER_TOLERANCE_PCT = 1.5
    # 60 bars yields too few fractal pivots to find repeat touches; 120 covers
    # roughly six months of sessions while staying recent enough to be relevant.
    SR_LOOKBACK_BARS = 120

    def find_support_resistance(
        self,
        ohlcv: pd.DataFrame,
        method: str = "fractal",
        lookback: int | None = None,
        min_touches: int = 2,
    ) -> list[dict[str, Any]]:
        """
        Detect support and resistance levels using Williams fractals.

        A fractal high: high[i] > high[i-1], high[i] > high[i-2],
                        high[i] > high[i+1], high[i] > high[i+2]
        A fractal low:  low[i]  < low[i-1],  low[i]  < low[i-2],
                        low[i]  < low[i+1],  low[i]  < low[i+2]

        Levels are clustered within 0.5% tolerance and ranked by touches.

        Returns:
            [{"type": "support"|"resistance", "price": float,
              "strength": 1-5, "touches": int, "method": str}]
        """
        if len(ohlcv) < 10:
            return []

        lookback = lookback or self.SR_LOOKBACK_BARS
        df = ohlcv.copy().sort_values("time").reset_index(drop=True).tail(lookback)
        highs = df["high"].astype(float).values
        lows = df["low"].astype(float).values

        fractal_highs: list[float] = []
        fractal_lows: list[float] = []

        for i in range(2, len(highs) - 2):
            # Fractal high (resistance candidate)
            if (highs[i] > highs[i - 1] and highs[i] > highs[i - 2]
                    and highs[i] > highs[i + 1] and highs[i] > highs[i + 2]):
                fractal_highs.append(highs[i])

            # Fractal low (support candidate)
            if (lows[i] < lows[i - 1] and lows[i] < lows[i - 2]
                    and lows[i] < lows[i + 1] and lows[i] < lows[i + 2]):
                fractal_lows.append(lows[i])

        resistance_levels = _cluster_levels(
            fractal_highs, tolerance_pct=self.SR_CLUSTER_TOLERANCE_PCT
        )
        support_levels = _cluster_levels(
            fractal_lows, tolerance_pct=self.SR_CLUSTER_TOLERANCE_PCT
        )

        # Build result with strength scoring
        current_price = float(df["close"].iloc[-1])
        levels: list[dict[str, Any]] = []

        for price, touches in resistance_levels:
            if touches < min_touches:
                continue
            strength = min(5, touches)
            # Only include levels above current price
            if price > current_price * 0.98:
                levels.append({
                    "type": "resistance",
                    "price": round(price, 2),
                    "strength": strength,
                    "touches": touches,
                    "method": method,
                })

        for price, touches in support_levels:
            if touches < min_touches:
                continue
            strength = min(5, touches)
            # Only include levels below current price
            if price < current_price * 1.02:
                levels.append({
                    "type": "support",
                    "price": round(price, 2),
                    "strength": strength,
                    "touches": touches,
                    "method": method,
                })

        # Sort by proximity to current price
        levels.sort(key=lambda l: abs(l["price"] - current_price))
        return levels[:10]  # Top 10 closest levels

    # ── Candlestick Patterns ──────────────────────────────────────────────────

    def detect_candlestick_patterns(
        self,
        ohlcv: pd.DataFrame,
        lookback: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Detect common candlestick patterns in the most recent bars.

        Supported patterns:
            Bullish: doji, hammer, bullish_engulfing, morning_star,
                     three_white_soldiers, inverted_hammer
            Bearish: doji, hanging_man, bearish_engulfing, evening_star,
                     three_black_crows, shooting_star

        Returns:
            [{"pattern": str, "patternId": str, "date": str,
              "significance": "high"|"medium"|"low", "signal": int (-3..+3)}]
        """
        if len(ohlcv) < 3:
            return []

        df = ohlcv.copy().sort_values("time").reset_index(drop=True).tail(lookback + 3)
        patterns: list[dict[str, Any]] = []

        for i in range(2, len(df)):
            o, h, l, c = (
                float(df["open"].iloc[i]),
                float(df["high"].iloc[i]),
                float(df["low"].iloc[i]),
                float(df["close"].iloc[i]),
            )
            body = abs(c - o)
            total_range = h - l
            if total_range == 0:
                continue

            date_str = str(pd.to_datetime(df["time"].iloc[i]).date())

            # Previous candle
            po, _, _, pc = (
                float(df["open"].iloc[i - 1]),
                float(df["high"].iloc[i - 1]),
                float(df["low"].iloc[i - 1]),
                float(df["close"].iloc[i - 1]),
            )
            prev_body = abs(pc - po)

            # ── Doji ─────────────────────────────────────────────────────
            if body / total_range < 0.1:
                patterns.append({
                    "pattern": "doji", "patternId": "Doji",
                    "date": date_str, "significance": "medium", "signal": 0,
                })
                continue

            # ── Hammer (bullish) ─────────────────────────────────────────
            lower_shadow = min(o, c) - l
            upper_shadow = h - max(o, c)
            if (lower_shadow > body * 2 and upper_shadow < body * 0.3
                    and c > o):
                patterns.append({
                    "pattern": "hammer", "patternId": "Hammer",
                    "date": date_str, "significance": "high", "signal": 2,
                })
                continue

            # ── Inverted Hammer (bullish) ─────────────────────────────────
            if (upper_shadow > body * 2 and lower_shadow < body * 0.3
                    and c > o):
                patterns.append({
                    "pattern": "inverted_hammer", "patternId": "Inverted Hammer",
                    "date": date_str, "significance": "medium", "signal": 1,
                })
                continue

            # ── Shooting Star (bearish) ──────────────────────────────────
            if (upper_shadow > body * 2 and lower_shadow < body * 0.3
                    and c < o):
                patterns.append({
                    "pattern": "shooting_star", "patternId": "Shooting Star",
                    "date": date_str, "significance": "high", "signal": -2,
                })
                continue

            # ── Hanging Man (bearish) ────────────────────────────────────
            if (lower_shadow > body * 2 and upper_shadow < body * 0.3
                    and c < o):
                patterns.append({
                    "pattern": "hanging_man", "patternId": "Hanging Man",
                    "date": date_str, "significance": "medium", "signal": -1,
                })
                continue

            # ── Bullish Engulfing ────────────────────────────────────────
            if (c > o and pc < po  # Current bullish, previous bearish
                    and body > prev_body * 1.2
                    and o <= pc and c >= po):
                patterns.append({
                    "pattern": "bullish_engulfing", "patternId": "Bullish Engulfing",
                    "date": date_str, "significance": "high", "signal": 3,
                })
                continue

            # ── Bearish Engulfing ────────────────────────────────────────
            if (c < o and pc > po  # Current bearish, previous bullish
                    and body > prev_body * 1.2
                    and o >= pc and c <= po):
                patterns.append({
                    "pattern": "bearish_engulfing", "patternId": "Bearish Engulfing",
                    "date": date_str, "significance": "high", "signal": -3,
                })
                continue

        # Three White Soldiers / Three Black Crows (check last 3 bars)
        if len(df) >= 3:
            last3 = df.tail(3)
            bodies = [float(last3["close"].iloc[j]) - float(last3["open"].iloc[j]) for j in range(3)]
            if all(b > 0 for b in bodies):
                closes = [float(last3["close"].iloc[j]) for j in range(3)]
                if closes[2] > closes[1] > closes[0]:
                    patterns.append({
                        "pattern": "three_white_soldiers",
                        "patternId": "Three White Soldiers",
                        "date": str(pd.to_datetime(last3["time"].iloc[-1]).date()),
                        "significance": "high", "signal": 3,
                    })
            elif all(b < 0 for b in bodies):
                closes = [float(last3["close"].iloc[j]) for j in range(3)]
                if closes[2] < closes[1] < closes[0]:
                    patterns.append({
                        "pattern": "three_black_crows",
                        "patternId": "Three Black Crows",
                        "date": str(pd.to_datetime(last3["time"].iloc[-1]).date()),
                        "significance": "high", "signal": -3,
                    })

        return patterns

    # ── Gap Detection ─────────────────────────────────────────────────────────

    def detect_gaps(
        self,
        ohlcv: pd.DataFrame,
        threshold_pct: float = 1.0,
    ) -> list[dict[str, Any]]:
        """
        Detect price gaps (gap up / gap down) above threshold.

        Gap up:   open[i] > high[i-1]
        Gap down: open[i] < low[i-1]

        Returns:
            [{"type": "gap_up"|"gap_down", "date": str,
              "gap_pct": float, "top": float, "bottom": float,
              "is_filled": bool, "fill_probability": float,
              "avg_fill_days": int|None}]
        """
        if len(ohlcv) < 2:
            return []

        df = ohlcv.copy().sort_values("time").reset_index(drop=True)
        gaps: list[dict[str, Any]] = []

        for i in range(1, len(df)):
            curr_open = float(df["open"].iloc[i])
            prev_high = float(df["high"].iloc[i - 1])
            prev_low = float(df["low"].iloc[i - 1])
            prev_close = float(df["close"].iloc[i - 1])

            # Gap up
            if curr_open > prev_high:
                gap_pct = (curr_open - prev_high) / prev_close * 100
                if gap_pct >= threshold_pct:
                    gap_top = curr_open
                    gap_bottom = prev_high
                    is_filled = self._check_gap_filled(df, i, gap_bottom, "gap_up")
                    fill_prob = self._compute_fill_probability(df, i, gap_pct, "gap_up")

                    gaps.append({
                        "type": "gap_up",
                        "date": str(pd.to_datetime(df["time"].iloc[i]).date()),
                        "gap_pct": round(gap_pct, 2),
                        "top": round(gap_top, 2),
                        "bottom": round(gap_bottom, 2),
                        "is_filled": is_filled,
                        "fill_probability": round(fill_prob, 4),
                        "avg_fill_days": self._avg_fill_days(df, i, gap_bottom, "gap_up"),
                    })

            # Gap down
            if curr_open < prev_low:
                gap_pct = (prev_low - curr_open) / prev_close * 100
                if gap_pct >= threshold_pct:
                    gap_top = prev_low
                    gap_bottom = curr_open
                    is_filled = self._check_gap_filled(df, i, gap_top, "gap_down")
                    fill_prob = self._compute_fill_probability(df, i, gap_pct, "gap_down")

                    gaps.append({
                        "type": "gap_down",
                        "date": str(pd.to_datetime(df["time"].iloc[i]).date()),
                        "gap_pct": round(gap_pct, 2),
                        "top": round(gap_top, 2),
                        "bottom": round(gap_bottom, 2),
                        "is_filled": is_filled,
                        "fill_probability": round(fill_prob, 4),
                        "avg_fill_days": self._avg_fill_days(df, i, gap_top, "gap_down"),
                    })

        # Only return unfilled gaps + most recent filled for context
        unfilled = [g for g in gaps if not g["is_filled"]]
        recent_filled = [g for g in gaps if g["is_filled"]][-2:]  # Last 2 filled
        return unfilled + recent_filled

    def _check_gap_filled(
        self, df: pd.DataFrame, gap_idx: int, target_price: float, gap_type: str,
    ) -> bool:
        """Check if gap has been filled by subsequent price action."""
        for j in range(gap_idx + 1, len(df)):
            if gap_type == "gap_up" and float(df["low"].iloc[j]) <= target_price:
                return True
            if gap_type == "gap_down" and float(df["high"].iloc[j]) >= target_price:
                return True
        return False

    # Bars a historical gap must be given to fill before it counts as a
    # resolved sample. Gaps younger than this are censored — excluded from the
    # denominator rather than scored as failures.
    FILL_OBSERVATION_BARS = 20

    def _compute_fill_probability(
        self, df: pd.DataFrame, gap_idx: int, gap_pct: float, gap_type: str,
    ) -> float:
        """
        Compute historical probability that gaps of similar size get filled.

        Only gaps that have had a full FILL_OBSERVATION_BARS window to resolve
        are counted. Scanning each prior gap's future up to `gap_idx` — the
        obvious implementation — biases the estimate downward, because a gap
        that opened two bars before the reference gap gets two bars to fill and
        is otherwise recorded as "never filled". The bias grows the closer a
        sample sits to the reference, which is precisely where the samples
        cluster. Censoring removes it.
        """
        if gap_idx < 10:
            return 0.75  # Default assumption: 75% of gaps fill

        prior_gaps = 0
        filled_gaps = 0

        for i in range(1, gap_idx):
            curr_open = float(df["open"].iloc[i])
            prev_high = float(df["high"].iloc[i - 1])
            prev_low = float(df["low"].iloc[i - 1])
            prev_close = float(df["close"].iloc[i - 1])

            if gap_type == "gap_up" and curr_open > prev_high:
                this_pct = (curr_open - prev_high) / prev_close * 100
            elif gap_type == "gap_down" and curr_open < prev_low:
                this_pct = (prev_low - curr_open) / prev_close * 100
            else:
                continue

            # Similar-size threshold: within 50% of reference gap size
            if abs(this_pct - gap_pct) / max(gap_pct, 0.01) > 0.5:
                continue

            # Right-censoring: skip samples without a full observation window.
            observation_end = i + self.FILL_OBSERVATION_BARS
            if observation_end > gap_idx:
                continue

            prior_gaps += 1
            target = prev_high if gap_type == "gap_up" else prev_low
            for j in range(i + 1, observation_end):
                if gap_type == "gap_up" and float(df["low"].iloc[j]) <= target:
                    filled_gaps += 1
                    break
                if gap_type == "gap_down" and float(df["high"].iloc[j]) >= target:
                    filled_gaps += 1
                    break

        if prior_gaps < 3:
            return 0.75  # Insufficient sample

        # Laplace (add-one) smoothing. The raw ratio reports 3-of-3 as a flat
        # 100%, and this number is rendered to users as "historical fill
        # probability" — a claim of certainty from three observations. Smoothing
        # pulls thin samples toward even odds (3/3 → 80%) while converging on
        # the empirical rate as evidence accumulates (20/20 → 95%).
        return (filled_gaps + 1) / (prior_gaps + 2)

    def _avg_fill_days(
        self, df: pd.DataFrame, gap_idx: int, target_price: float, gap_type: str,
    ) -> int | None:
        """Compute average number of days to fill a gap (None if unfilled)."""
        for j in range(gap_idx + 1, len(df)):
            if gap_type == "gap_up" and float(df["low"].iloc[j]) <= target_price:
                return j - gap_idx
            if gap_type == "gap_down" and float(df["high"].iloc[j]) >= target_price:
                return j - gap_idx
        return None

    # ── Volatility (ATR) & Situational Context ────────────────────────────────

    # ATR is the dynamic ruler for every proximity test below. A fixed 2% zone
    # means "strong resistance" for a bluechip like BBCA but mere noise for a
    # volatile third-liner; ATR self-scales the zone to each stock's own range.
    ATR_PERIOD = 14
    # A close within 0.5·ATR of a level is "testing" it.
    SITUATION_ZONE_ATR = 0.5
    # A bounce must close at least this many ATR above support to count as a real
    # rejection of the level rather than a marginal, still-vulnerable recovery.
    BOUNCE_MARGIN_ATR = 0.1
    # Volatility squeeze (VCP): current ATR% sitting in the bottom quintile of its
    # own recent range signals extreme compression — a coil before expansion.
    SQUEEZE_LOOKBACK_BARS = 60
    SQUEEZE_QUANTILE = 0.20

    def _atr_series(self, ohlcv: pd.DataFrame, period: int = ATR_PERIOD) -> pd.Series | None:
        """Wilder True Range rolling mean. None when history is too short."""
        if len(ohlcv) < period + 1:
            return None
        df = ohlcv.copy().sort_values("time").reset_index(drop=True)
        high = df["high"].astype(float)
        low = df["low"].astype(float)
        prev_close = df["close"].astype(float).shift(1)
        true_range = pd.concat(
            [(high - low), (high - prev_close).abs(), (low - prev_close).abs()],
            axis=1,
        ).max(axis=1)
        return true_range.rolling(period).mean()

    def compute_atr(self, ohlcv: pd.DataFrame, period: int = ATR_PERIOD) -> float:
        """Average True Range in absolute price units (0.0 when unavailable)."""
        series = self._atr_series(ohlcv, period)
        if series is None or series.empty or pd.isna(series.iloc[-1]):
            return 0.0
        return float(series.iloc[-1])

    def _is_squeeze(self, ohlcv: pd.DataFrame) -> bool:
        """
        True when volatility is compressing hard — current ATR%, normalised by
        price, sits in the bottom quintile of its own recent history. Comparing
        ATR% (not raw ATR) keeps the test scale-free across price levels.
        """
        series = self._atr_series(ohlcv)
        if series is None:
            return False
        df = ohlcv.copy().sort_values("time").reset_index(drop=True)
        atr_pct = (series / df["close"].astype(float) * 100).tail(
            self.SQUEEZE_LOOKBACK_BARS
        ).dropna()
        if len(atr_pct) < 20:
            return False
        return float(atr_pct.iloc[-1]) <= float(atr_pct.quantile(self.SQUEEZE_QUANTILE))

    def classify_situation(
        self,
        ohlcv: pd.DataFrame,
        sr_levels: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Read WHERE the last bar sits relative to structure, using ATR-scaled
        zones. Returns one primary situation label plus the volatility context
        the AI advisor narrates from. Fully deterministic — the LLM reasons over
        the label, it never detects it.

        Labels: uji_resistance, tembus_resistance, gagal_breakout, mantul_support,
        gagal_breakdown, tembus_support, volatility_squeeze, konsolidasi_lebar.
        """
        empty = {
            "situation": "konsolidasi_lebar", "situationId": "Konsolidasi Lebar",
            "note": "Data belum cukup untuk membaca struktur harga.",
            "noteEn": "Not enough data to read price structure.",
            "atr": 0.0, "atrPct": 0.0, "squeeze": False,
            "nearestSupport": None, "nearestResistance": None,
            "distSupportPct": None, "distResistancePct": None,
        }
        if len(ohlcv) < self.ATR_PERIOD + 5:
            return empty

        df = ohlcv.copy().sort_values("time").reset_index(drop=True)
        atr = self.compute_atr(df)
        c = float(df["close"].iloc[-1])
        if atr <= 0 or c <= 0:
            return empty

        h = float(df["high"].iloc[-1])
        l = float(df["low"].iloc[-1])

        if sr_levels is None:
            sr_levels = self.find_support_resistance(df)
        resistances = [float(x["price"]) for x in sr_levels if x.get("type") == "resistance"]
        supports = [float(x["price"]) for x in sr_levels if x.get("type") == "support"]
        # Logic levels: the level closest to price on either side. Event detection
        # needs these — a fresh breakout leaves the broken resistance just BELOW
        # the close, and the abs-nearest pick captures it.
        R = min(resistances, key=lambda p: abs(p - c)) if resistances else None
        S = min(supports, key=lambda p: abs(p - c)) if supports else None

        zone = self.SITUATION_ZONE_ATR * atr
        margin = self.BOUNCE_MARGIN_ATR * atr
        atr_pct = round(atr / c * 100, 2)
        squeeze = self._is_squeeze(df)

        # Display levels: the nearest support BELOW and resistance ABOVE the close,
        # so the reported distances read as "x% down to support / y% up to
        # resistance" and never go negative. Distinct from the logic levels above.
        sup_below = [s for s in supports if s <= c]
        res_above = [r for r in resistances if r >= c]
        disp_S = max(sup_below) if sup_below else None
        disp_R = min(res_above) if res_above else None
        dist_res = round((disp_R - c) / c * 100, 2) if disp_R is not None else None
        dist_sup = round((c - disp_S) / c * 100, 2) if disp_S is not None else None

        # A squeeze only reads as "at a level" when the close is within one ATR of
        # one. But measure that with the BASELINE (median) ATR, not the spot ATR:
        # during a squeeze the spot ATR collapses, so a spot-ATR test would become
        # absurdly strict exactly when the label matters. The baseline reflects the
        # stock's normal range. A wide mid-range bar still fails this, keeping it
        # out of the squeeze bucket and in konsolidasi_lebar.
        atr_series = self._atr_series(df)
        atr_baseline = atr
        if atr_series is not None:
            recent = atr_series.tail(self.SQUEEZE_LOOKBACK_BARS).dropna()
            if len(recent):
                atr_baseline = float(recent.median()) or atr
        near_level = (
            (R is not None and abs(c - R) <= atr_baseline)
            or (S is not None and abs(c - S) <= atr_baseline)
        )

        def _rp(v: float) -> str:  # Indonesian thousands separator
            return f"Rp{v:,.0f}".replace(",", ".")

        # Priority ladder: decisive breaks first, then false breaks and bounces,
        # then a plain test, then the coil, then choppy mid-range.
        if R is not None and c > R:
            label, label_id = "tembus_resistance", "Tembus Resistance"
            note = f"Harga menembus resistance {_rp(R)} (breakout). Momentum bullish terkonfirmasi bila didukung volume."
            note_en = f"Price closed above resistance {_rp(R)} (breakout). Bullish momentum confirmed if volume backs it."
        elif S is not None and c < S:
            label, label_id = "tembus_support", "Tembus Support"
            note = f"Harga jebol di bawah support {_rp(S)} (breakdown). Struktur tren rusak — waspada cut loss."
            note_en = f"Price closed below support {_rp(S)} (breakdown). Trend structure broken — cut-loss risk."
        elif R is not None and h > R and c <= R:
            label, label_id = "gagal_breakout", "Gagal Breakout"
            note = f"High menembus resistance {_rp(R)} tetapi ditutup di bawahnya (false break) — tekanan jual/distribusi kuat di atap."
            note_en = f"High pierced resistance {_rp(R)} but closed back below (false break) — strong selling/distribution at the ceiling."
        elif S is not None and l < S and c >= S:
            if c > S + margin:
                label, label_id = "mantul_support", "Mantul dari Support"
                note = f"Harga sempat disapu ke bawah support {_rp(S)} lalu ditutup menguat — pantulan valid (buyer mempertahankan lantai)."
                note_en = f"Price swept below support {_rp(S)} then closed strongly back up — valid bounce (buyers defending the floor)."
            else:
                label, label_id = "gagal_breakdown", "Gagal Breakdown (Spring)"
                note = f"Low menembus support {_rp(S)} lalu ditutup tipis di atasnya (spring / bear trap) — kemungkinan penyapuan stop loss ritel."
                note_en = f"Low pierced support {_rp(S)} then closed just above it (spring / bear trap) — likely retail stop-loss sweep."
        elif S is not None and l <= S + margin and c > S + margin:
            label, label_id = "mantul_support", "Mantul dari Support"
            note = f"Harga menguji support {_rp(S)} dan ditutup menguat — support bertahan."
            note_en = f"Price tested support {_rp(S)} and closed higher — support holding."
        elif R is not None and (R - zone) <= c <= R:
            label, label_id = "uji_resistance", "Uji Resistance"
            note = f"Harga bersiap menguji resistance {_rp(R)} (jarak {dist_res:.1f}%). Waspada penolakan; butuh close di atasnya untuk breakout."
            note_en = f"Price is testing resistance {_rp(R)} ({dist_res:.1f}% away). Watch for rejection; needs a close above to break out."
        elif squeeze and near_level:
            label, label_id = "volatility_squeeze", "Volatility Squeeze"
            note = "Volatilitas mengompresi secara ekstrem (ATR menyempit) di dekat level kunci — potensi pergerakan eksplosif; arah belum terkonfirmasi hingga ada breakout."
            note_en = "Volatility is compressing hard (ATR contracting) near a key level — potential explosive move; direction unconfirmed until a breakout close."
        else:
            label, label_id = "konsolidasi_lebar", "Konsolidasi Lebar"
            note = "Harga mengayun di tengah antara support dan resistance tanpa arah jelas (choppy) — risiko tinggi, reward rendah."
            note_en = "Price is chopping mid-range between support and resistance with no clear direction — high risk, low reward."

        return {
            "situation": label, "situationId": label_id,
            "note": note, "noteEn": note_en,
            "atr": round(atr, 2), "atrPct": atr_pct, "squeeze": squeeze,
            "nearestSupport": round(disp_S, 2) if disp_S is not None else None,
            "nearestResistance": round(disp_R, 2) if disp_R is not None else None,
            "distSupportPct": dist_sup, "distResistancePct": dist_res,
        }

    # ── Combined Feature Extraction ───────────────────────────────────────────

    def compute_features(
        self,
        ohlcv: pd.DataFrame,
        current_price: float | None = None,
    ) -> dict[str, float]:
        """
        Compute all price action features for LightGBM integration.

        Returns dict with keys:
            trend_direction, trend_strength,
            sr_distance_support, sr_distance_resistance,
            candlestick_signal, gap_unfilled_pct
        """
        if current_price is None and len(ohlcv) > 0:
            current_price = float(ohlcv.sort_values("time")["close"].iloc[-1])
        elif current_price is None:
            return _empty_features()

        # Trend
        trend = self.detect_trend(ohlcv)
        trend_direction_encoded = {"uptrend": 1, "sideways": 0, "downtrend": -1}[trend["trend"]]

        # S/R
        sr_levels = self.find_support_resistance(ohlcv)
        supports = [l["price"] for l in sr_levels if l["type"] == "support"]
        resistances = [l["price"] for l in sr_levels if l["type"] == "resistance"]

        # Both distances are non-negative by construction: "% below price to the
        # nearest support" and "% above price to the nearest resistance". When no
        # level exists on the correct side the feature is 0.0 (absent), NOT the
        # distance to a level on the wrong side — a negative "distance to
        # support" silently means the opposite of what the feature name claims,
        # and the model has no way to tell the two cases apart.
        supports_below = [s for s in supports if s <= current_price]
        sr_dist_support = 0.0
        if supports_below:
            nearest_support = max(supports_below)
            sr_dist_support = (current_price - nearest_support) / current_price * 100

        resistances_above = [r for r in resistances if r >= current_price]
        sr_dist_resistance = 0.0
        if resistances_above:
            nearest_resistance = min(resistances_above)
            sr_dist_resistance = (nearest_resistance - current_price) / current_price * 100

        # Candlestick patterns
        patterns = self.detect_candlestick_patterns(ohlcv)
        candlestick_signal = 0.0
        if patterns:
            # Use the strongest recent signal
            candlestick_signal = float(max(patterns, key=lambda p: abs(p["signal"]))["signal"])

        # Gaps
        gaps = self.detect_gaps(ohlcv)
        unfilled_gaps = [g for g in gaps if not g["is_filled"]]
        gap_unfilled_pct = sum(g["gap_pct"] for g in unfilled_gaps)

        return {
            "trend_direction": float(trend_direction_encoded),
            "trend_strength": float(trend["strength"]),
            "sr_distance_support": round(sr_dist_support, 4),
            "sr_distance_resistance": round(sr_dist_resistance, 4),
            "candlestick_signal": candlestick_signal,
            "gap_unfilled_pct": round(gap_unfilled_pct, 4),
        }


# ── Module-level helpers ──────────────────────────────────────────────────────

def _count_consecutive_direction(values: np.ndarray, direction: str) -> int:
    """Count consecutive higher highs (up) or lower lows (down) from end."""
    if len(values) < 2:
        return 0
    count = 0
    for i in range(len(values) - 1, 0, -1):
        if direction == "up" and values[i] > values[i - 1]:
            count += 1
        elif direction == "down" and values[i] < values[i - 1]:
            count += 1
        else:
            break
    return count


def _cluster_levels(
    prices: list[float],
    tolerance_pct: float = 0.5,
) -> list[tuple[float, int]]:
    """
    Cluster nearby price levels and count touches.
    Returns list of (average_price, touch_count) sorted by touches descending.
    """
    if not prices:
        return []

    sorted_prices = sorted(prices)
    clusters: list[list[float]] = [[sorted_prices[0]]]

    for price in sorted_prices[1:]:
        # Measure against the cluster's anchor (its lowest member), not its
        # running mean. Against a moving mean each new price drags the centre
        # upward, so a long chain of individually-close prices can span far more
        # than `tolerance_pct` end to end and merge genuinely distinct levels.
        anchor = clusters[-1][0]
        if abs(price - anchor) / anchor * 100 <= tolerance_pct:
            clusters[-1].append(price)
        else:
            clusters.append([price])

    result = [(round(float(np.mean(c)), 2), len(c)) for c in clusters]
    result.sort(key=lambda x: x[1], reverse=True)
    return result


def _empty_features() -> dict[str, float]:
    return {
        "trend_direction": 0.0,
        "trend_strength": 0.0,
        "sr_distance_support": 0.0,
        "sr_distance_resistance": 0.0,
        "candlestick_signal": 0.0,
        "gap_unfilled_pct": 0.0,
    }
