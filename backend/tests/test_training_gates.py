"""
Release gates for the signal model.

The gates are the difference between "we trained a model" and "we have evidence
the model is worth serving". They must fail closed: a run that cannot show
out-of-sample lift produces no artefact, rather than an artefact nobody
questions later.
"""

import pytest

from ml.training.train_signals_v2 import (
    MIN_AUC,
    MIN_FOLDS_POSITIVE,
    MIN_DECILE_LIFT,
    check_gates,
)


def _report(**kw) -> dict:
    base = {
        "usable": True,
        "mean_auc": 0.58,
        "mean_decile_lift": 0.06,
        "folds_above_chance": 1.0,
    }
    base.update(kw)
    return base


class TestGates:
    def test_a_good_model_passes(self):
        passed, failures = check_gates(_report())
        assert passed
        assert failures == []

    def test_auc_at_chance_fails(self):
        """AUC 0.50 is a coin flip however good the accuracy looks."""
        passed, failures = check_gates(_report(mean_auc=0.50))
        assert not passed
        assert any("AUC" in f for f in failures)

    def test_no_lift_over_base_rate_fails(self):
        """
        If the model's top-ranked decile rises no more often than a random name,
        the ranking carries no information — whatever the AUC says.
        """
        passed, failures = check_gates(_report(mean_decile_lift=0.0))
        assert not passed
        assert any("base rate" in f for f in failures)

    def test_negative_lift_fails(self):
        passed, _ = check_gates(_report(mean_decile_lift=-0.02))
        assert not passed

    def test_one_lucky_fold_does_not_carry_the_model(self):
        passed, failures = check_gates(_report(folds_above_chance=0.25))
        assert not passed
        assert any("folds" in f for f in failures)

    def test_no_usable_folds_fails(self):
        passed, failures = check_gates({"usable": False})
        assert not passed
        assert any("history" in f for f in failures)

    def test_every_failure_is_reported_not_just_the_first(self):
        """An operator should see all the reasons in one run."""
        passed, failures = check_gates(
            _report(mean_auc=0.49, mean_decile_lift=-0.01, folds_above_chance=0.0)
        )
        assert not passed
        assert len(failures) == 3

    @pytest.mark.parametrize(
        "field,value",
        [("mean_auc", MIN_AUC), ("mean_decile_lift", MIN_DECILE_LIFT),
         ("folds_above_chance", MIN_FOLDS_POSITIVE)],
    )
    def test_thresholds_are_inclusive(self, field, value):
        """Exactly meeting a threshold passes; the gate is >=, not >."""
        passed, failures = check_gates(_report(**{field: value}))
        assert passed, failures


class TestGateConstants:
    def test_thresholds_are_not_trivially_satisfiable(self):
        """
        A guard against the gates being quietly relaxed until a run passes.
        AUC 0.5 is chance and zero lift is the baseline; neither may be the bar.
        """
        assert MIN_AUC > 0.5
        assert MIN_DECILE_LIFT > 0
        assert MIN_FOLDS_POSITIVE >= 0.5
