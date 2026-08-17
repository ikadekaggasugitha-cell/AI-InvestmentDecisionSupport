"""
.env.example must agree with Settings.

The template opens with "Every value here matches the default in
api/core/config.py". It did not: USE_MOCK_SIGNALS and USE_MOCK_RISK were both
`true` while the code had moved to `False`, so an operator running the
documented `cp .env.example .env` silently turned the trained LightGBM model
and the live GARCH computation back off — and got seeded numbers believing they
were real. Twenty other fields had no entry at all.

A comment cannot hold that invariant. These tests can.
"""

import re
from pathlib import Path

import pytest

from api.core.config import Settings

TEMPLATE = Path(__file__).parent.parent / ".env.example"


def _template_keys() -> dict[str, str]:
    keys: dict[str, str] = {}
    for line in TEMPLATE.read_text().splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            keys[m.group(1)] = m.group(2).strip()
    return keys


class TestTemplateCoverage:
    def test_template_exists(self):
        assert TEMPLATE.is_file(), ".env.example is the only committed setup doc"

    def test_every_setting_is_documented(self):
        keys = _template_keys()
        missing = sorted(n.upper() for n in Settings.model_fields if n.upper() not in keys)
        assert not missing, (
            f"{len(missing)} settings absent from .env.example: {missing}. "
            "An operator cannot configure what is not written down."
        )

    def test_no_orphan_keys(self):
        """A key for a removed setting misleads whoever reads the template."""
        fields = set(Settings.model_fields)
        orphans = sorted(k for k in _template_keys() if k.lower() not in fields)
        assert not orphans, f"template documents settings that no longer exist: {orphans}"


class TestTemplateAgreesWithDefaults:
    """
    The template is documentation of the defaults, so a divergence is either a
    stale doc or an undeclared intent. Both need to be visible.
    """

    @pytest.mark.parametrize("name", sorted(Settings.model_fields))
    def test_value_matches_the_default(self, name):
        keys = _template_keys()
        key = name.upper()
        if key not in keys:
            pytest.skip("covered by test_every_setting_is_documented")

        raw = keys[key]
        default = Settings.model_fields[name].default

        # Blank entries are deliberate: secrets and optional keys.
        if raw == "":
            assert default in ("", None, [],), (
                f"{key} is blank in the template but defaults to {default!r}"
            )
            return

        if isinstance(default, bool):
            assert raw.lower() in ("true", "false"), f"{key}={raw} is not a bool"
            assert (raw.lower() == "true") is default, (
                f"{key}={raw} contradicts the default {default}"
            )
        elif isinstance(default, (int, float)) and not isinstance(default, bool):
            assert type(default)(raw) == default, (
                f"{key}={raw} contradicts the default {default}"
            )
        elif isinstance(default, str):
            assert raw == default, f"{key}={raw!r} contradicts the default {default!r}"
        elif isinstance(default, list):
            parsed = [p.strip() for p in raw.split(",") if p.strip()]
            assert parsed == [str(d) for d in default], (
                f"{key} list contradicts the default"
            )


class TestMockFlagsDocumentedTruthfully:
    """
    These four decide whether the app shows real market data or generated
    numbers. Getting them wrong in the template is the highest-consequence
    documentation bug in the file.
    """

    @pytest.mark.parametrize(
        "key", ["USE_MOCK_MARKET", "USE_MOCK_SIGNALS", "USE_MOCK_RISK", "USE_MOCK_PORTFOLIO"]
    )
    def test_flag_matches_code(self, key):
        keys = _template_keys()
        assert key in keys, f"{key} must be documented — it controls data authenticity"
        default = Settings.model_fields[key.lower()].default
        assert (keys[key].lower() == "true") is default

    def test_real_data_flags_are_off_by_default(self):
        """
        Guards the direction: market/signals/risk serve real data.

        Asserts on the DECLARED default, not on `Settings()`. Instantiating
        reads the ambient environment — and conftest.py exports USE_MOCK_*=true
        for the suite — so an instance reflects the test harness rather than the
        code, and this test would have passed no matter what the code said.
        """
        for name in ("use_mock_market", "use_mock_signals", "use_mock_risk"):
            assert Settings.model_fields[name].default is False, (
                f"{name} should default to real data"
            )
        assert Settings.model_fields["use_mock_portfolio"].default is True, (
            "portfolio has no data source — it needs an input path"
        )
