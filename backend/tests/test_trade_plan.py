"""
Trade plan derivation tests — Phase 10.

The governing rule: a stop loss that cannot do its job must not be emitted at
all. A fabricated or unusable level is worse than an absent one, because the
reader cannot tell the difference.
"""

from ml.inference.trade_plan import _build_technical_note, _compute_trade_plan


def _support(price: float, touches: int = 3) -> dict:
    return {"type": "support", "price": price, "strength": 3, "touches": touches}


def _resistance(price: float) -> dict:
    return {"type": "resistance", "price": price, "strength": 3, "touches": 2}


class TestStopLossBounds:
    def test_support_within_bounds_produces_a_plan(self):
        plan = _compute_trade_plan(
            current_price=10_000, target_price=11_000, sr_levels=[_support(9_600)]
        )
        assert plan is not None
        assert plan.entryPrice == 10_000
        assert plan.stopLoss == 9_600
        assert plan.stopLossPct == -4.0

    def test_support_too_far_yields_no_plan(self):
        """Beyond the max, it is not risk control."""
        plan = _compute_trade_plan(
            current_price=10_000, target_price=11_000,
            sr_levels=[_support(8_000)],  # -20%
            max_stop_pct=8.0,
        )
        assert plan is None

    def test_support_too_close_yields_no_plan(self):
        """Inside daily noise, it is taken out before the thesis can fail."""
        plan = _compute_trade_plan(
            current_price=10_000, target_price=11_000,
            sr_levels=[_support(9_950)],  # -0.5%
            min_stop_pct=1.5,
        )
        assert plan is None

    def test_skips_a_too_tight_level_for_a_usable_one(self):
        """
        A noise-level support should not veto the whole plan when a genuine
        level sits just beyond it.
        """
        plan = _compute_trade_plan(
            current_price=10_000, target_price=11_000,
            sr_levels=[_support(9_950), _support(9_500)],
        )
        assert plan is not None
        assert plan.stopLoss == 9_500

    def test_no_support_below_price_yields_no_plan(self):
        plan = _compute_trade_plan(
            current_price=10_000, target_price=11_000,
            sr_levels=[_resistance(10_500), _support(10_200)],
        )
        assert plan is None

    def test_empty_levels_yield_no_plan(self):
        assert _compute_trade_plan(10_000, 11_000, []) is None


class TestEntryAndRiskReward:
    def test_entry_is_current_price_not_a_breakout_level(self):
        """
        Entry above the current price would tell the reader to buy after the
        move, at a price the model never scored.
        """
        plan = _compute_trade_plan(
            current_price=10_000, target_price=12_000,
            sr_levels=[_support(9_500), _resistance(10_800)],
        )
        assert plan.entryPrice == 10_000

    def test_risk_reward_derives_from_the_given_target(self):
        """
        RR must come from the signal's existing targetPrice. Computing a second
        target here would put two disagreeing numbers on one card.
        """
        plan = _compute_trade_plan(
            current_price=10_000, target_price=11_500, sr_levels=[_support(9_500)]
        )
        # reward 1500 / risk 500
        assert plan.riskRewardRatio == 3.0

    def test_no_risk_reward_when_target_is_below_entry(self):
        plan = _compute_trade_plan(
            current_price=10_000, target_price=9_800, sr_levels=[_support(9_500)]
        )
        assert plan is not None
        assert plan.riskRewardRatio is None

    def test_reason_is_bilingual_and_cites_touches(self):
        plan = _compute_trade_plan(
            current_price=10_000, target_price=11_000,
            sr_levels=[_support(9_500, touches=4)],
        )
        assert "4" in plan.stopLossReason
        assert "4" in plan.stopLossReasonEn
        assert plan.stopLossReason != plan.stopLossReasonEn


class TestDegenerateInputs:
    def test_zero_price(self):
        assert _compute_trade_plan(0, 11_000, [_support(9_500)]) is None

    def test_zero_target(self):
        assert _compute_trade_plan(10_000, 0, [_support(9_500)]) is None

    def test_negative_support_ignored(self):
        assert _compute_trade_plan(10_000, 11_000, [_support(-500)]) is None


class TestTechnicalNoteForeignFlow:
    """The technical note must cite foreign flow (the free bandarmology) when it
    is available, and fall back to the volume phrasing when it is not."""

    def _acc(self, foreign_available: bool) -> dict:
        return {
            "phase": "accumulation", "phaseId": "Akumulasi",
            "foreignAvailable": foreign_available,
            "foreignPhase": "accumulation" if foreign_available else "neutral",
            "netForeign5d": 7_500, "foreignConsistencyDays": 6,
            "consistencyDays": 4,
        }

    def test_note_cites_foreign_when_available(self):
        note_id, note_en = _build_technical_note(
            None, None, [], [], self._acc(foreign_available=True)
        )
        assert "asing net +7.500 lot" in note_id
        assert "6 hari beruntun" in note_id
        assert "foreign net" in note_en.lower()

    def test_note_falls_back_to_volume_when_no_foreign(self):
        note_id, note_en = _build_technical_note(
            None, None, [], [], self._acc(foreign_available=False)
        )
        assert "asing" not in note_id.lower()
        assert "volume" in note_id.lower()

    def test_empty_when_no_accumulation(self):
        assert _build_technical_note(None, None, [], [], None) == ("", "")
