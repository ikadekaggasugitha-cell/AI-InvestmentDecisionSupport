"""
Trade Plan & Technical Narrative — Phase 10

Pure derivation of entry, stop loss and technical commentary from price-action
output. Deliberately free of any ML dependency: none of this needs LightGBM,
SHAP or joblib, and keeping it separate means the API layer and the test suite
can use it without loading a 400MB inference stack.

`signal_inference` imports from here; nothing here imports from it.
"""

from typing import Any

from api.models.signals import TradePlan


def _compute_trade_plan(
    current_price: float,
    target_price: float,
    sr_levels: list[dict[str, Any]],
    max_stop_pct: float = 8.0,
    min_stop_pct: float = 1.5,
) -> TradePlan | None:
    """
    Derive entry and stop loss from fractal S/R levels.

    Entry is the current price — deliberately not a breakout level above it.
    "Enter on break of resistance" tells the reader to buy after the move has
    already happened, at a price the model never scored.

    Stop loss is the nearest support strictly below entry, and it must sit
    between `min_stop_pct` and `max_stop_pct` away. Too far and it is not risk
    control; too close and ordinary intraday noise takes it out before the
    thesis has a chance to be wrong. Outside those bounds — or with no support
    below price at all — this returns None and the card shows no stop rather
    than one that cannot do its job.

    Risk/reward is computed against the caller's existing `target_price`, never
    against a second target of our own — one number per card.
    """
    if current_price <= 0 or target_price <= 0:
        return None

    supports_below = [
        lvl for lvl in sr_levels
        if lvl.get("type") == "support" and 0 < float(lvl["price"]) < current_price
    ]
    if not supports_below:
        return None

    # Nearest usable support: walk outward from price and take the first level
    # that clears the minimum distance, rather than taking the closest level and
    # rejecting the whole plan when it happens to be too tight.
    candidates = sorted(
        (lvl for lvl in supports_below
         if abs((float(lvl["price"]) - current_price) / current_price * 100) >= min_stop_pct),
        key=lambda lvl: float(lvl["price"]),
        reverse=True,
    )
    if not candidates:
        return None

    nearest = candidates[0]
    stop_loss = float(nearest["price"])
    stop_pct = (stop_loss - current_price) / current_price * 100

    if abs(stop_pct) > max_stop_pct:
        # Support is real but too far away to function as a stop.
        return None

    risk = current_price - stop_loss
    reward = target_price - current_price
    rr = round(reward / risk, 2) if risk > 0 and reward > 0 else None

    touches = int(nearest.get("touches", 0))
    return TradePlan(
        entryPrice=round(current_price, 2),
        stopLoss=round(stop_loss, 2),
        stopLossPct=round(stop_pct, 2),
        stopLossReason=f"Support fraktal terdekat ({touches}× tersentuh)",
        stopLossReasonEn=f"Nearest fractal support ({touches} touches)",
        riskRewardRatio=rr,
    )


def _format_idr(value: float) -> str:
    """Indonesian thousands separator, e.g. 9850 -> '9.850'."""
    return f"{int(round(value)):,}".replace(",", ".")


def _build_technical_note(
    trend: dict[str, Any] | None,
    plan: TradePlan | None,
    patterns: list[dict[str, Any]],
    gaps: list[dict[str, Any]],
    accumulation: dict[str, Any] | None,
) -> tuple[str, str]:
    """
    Compose a technical commentary string from whatever data is present.

    Returns ("", "") when there is nothing concrete to say. Each clause is
    appended only if its source data exists, so the note never contains a
    placeholder or an unfilled template slot.
    """
    id_parts: list[str] = []
    en_parts: list[str] = []

    if trend and trend.get("trend") and trend["trend"] != "sideways":
        trend_id = {"uptrend": "uptrend", "downtrend": "downtrend"}[trend["trend"]]
        strength = trend.get("strength", 0)
        id_parts.append(f"Tren {trend_id} (kekuatan {strength}/100)")
        en_parts.append(f"{trend_id.capitalize()} (strength {strength}/100)")

    if plan and plan.stopLoss is not None:
        id_parts.append(
            f"Stop loss Rp {_format_idr(plan.stopLoss)} ({plan.stopLossPct:.1f}%) "
            f"berdasarkan {plan.stopLossReason.lower()}"
        )
        en_parts.append(
            f"Stop loss Rp {_format_idr(plan.stopLoss)} ({plan.stopLossPct:.1f}%) "
            f"based on {plan.stopLossReasonEn.lower()}"
        )

    if patterns:
        recent = patterns[-1]
        id_parts.append(f"Pola {recent.get('patternId', recent.get('pattern', ''))} terdeteksi")
        en_parts.append(f"{recent.get('pattern', '').replace('_', ' ').title()} pattern detected")

    unfilled = [g for g in gaps if not g.get("is_filled")]
    if unfilled:
        g = unfilled[0]
        prob_pct = round(float(g.get("fill_probability", 0)) * 100)
        kind_id = "gap up" if g.get("type") == "gap_up" else "gap down"
        id_parts.append(
            f"{kind_id.capitalize()} {g.get('gap_pct')}% belum tertutup "
            f"(probabilitas penutupan historis {prob_pct}%)"
        )
        en_parts.append(
            f"Unfilled {kind_id} of {g.get('gap_pct')}% "
            f"(historical fill probability {prob_pct}%)"
        )

    if accumulation and accumulation.get("phase") in ("accumulation", "distribution"):
        phase = accumulation["phase"]
        phase_id = accumulation.get("phaseId", "")
        # Foreign flow is the "who" — quote it when available, since a named net
        # foreign figure is far more concrete than a generic accumulation label.
        if accumulation.get("foreignAvailable") and accumulation.get("foreignPhase") in (
            "accumulation", "distribution",
        ):
            net5 = int(accumulation.get("netForeign5d", 0))
            days = int(accumulation.get("foreignConsistencyDays", 0))
            arah_en = "buy" if net5 > 0 else "sell"
            clause_id = f"{phase_id}: asing net {net5:+,} lot dalam 5 hari".replace(",", ".")
            clause_en = f"{phase.capitalize()}: foreign net {arah_en} {net5:+,} lots over 5 sessions"
            if days >= 3:
                clause_id += f" ({days} hari beruntun)"
                clause_en += f" ({days} sessions running)"
            id_parts.append(clause_id)
            en_parts.append(clause_en)
        else:
            days = int(accumulation.get("consistencyDays", 0))
            id_parts.append(
                f"{phase_id} volume" + (f" konsisten {days} hari" if days else "")
            )
            en_parts.append(
                f"Volume {phase}" + (f" consistent for {days} sessions" if days else "")
            )

    if not id_parts:
        return "", ""

    return ". ".join(id_parts) + ".", ". ".join(en_parts) + "."


