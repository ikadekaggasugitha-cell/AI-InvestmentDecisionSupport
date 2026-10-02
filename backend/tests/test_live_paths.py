"""
Regression tests for the live (non-mock) code paths.

Why this file exists
--------------------
The suite runs with five USE_MOCK_* flags forced on, and they are set at conftest
import time — before any test module can reach the lru_cached get_settings().
That made the mock branches the only ones ever executed. Four real defects lived
entirely in the branches CI skipped:

  * /v1/risk/portfolio raised "Portfolio holds no positions" on every live call,
    because the holdings comprehension read a "portfolioLots" key that no code
    path wrote.
  * The risk worker's SQL joined a table that does not exist, and its Kupiec
    backtest compared `returns < -var_pct` with a negative var_pct, so
    essentially every row counted as a breach.
  * The risk alert read its scores from the top level of a cache entry that
    nests them under "risk", so no risk alert could ever fire.
  * Portfolio identity came from a query parameter any caller could set, so
    ownership could not be checked.

Each test below flips the relevant flag off locally and re-asserts the real path.
The pattern is the one test_auth.py already established: monkeypatch.setenv,
then get_settings.cache_clear(), then build the app — because a Settings object
cached earlier would otherwise survive.

Scope: these are unit-level live-path tests. load_ohlcv and the market-data
provider are stubbed, so they prove the code no longer takes the broken branch —
not that a real TimescaleDB answers correctly. Closing that last gap needs a CI
job with real Postgres and Redis, which is a different exercise.
"""

import json
from datetime import timezone
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from api.core.redis_client import REDIS_KEYS

def _price_frame(symbols, periods=300, seed=7, date_column="time"):
    """
    A realistic per-symbol OHLCV frame: trading days, positive closes.

    `date_column` matters. technicals_service.load_ohlcv — the thing this stands
    in for — returns a `time` column, and _load_returns_history renames it to
    `date` before handing it to RiskEngine. Tests that drive the service need
    `time`; tests that construct RiskEngine directly need `date`.
    """
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range("2025-01-01", periods=periods)
    if not symbols:
        return pd.DataFrame({"symbol": [], "time": [], "close": [], "volume": [],
                             "foreign_net": [], "sector": []})
    frames = []
    for i, symbol in enumerate(symbols):
        closes = 3000 * np.exp(np.cumsum(rng.normal(0.0004, 0.013, periods)))
        frames.append(
            pd.DataFrame(
                {
                    "symbol": symbol,
                    date_column: dates,
                    "close": closes,
                    "volume": 1_000_000,
                    "foreign_net": 0.0,
                    "sector": "Keuangan" if i < 4 else "Energi",
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


def _fake_provider(index_bars=200, index_start=7000.0):
    """A provider that answers only ^JKSE, which is all risk paths need."""
    dates = pd.bdate_range("2025-01-01", periods=index_bars + 50)

    class Bar:
        def __init__(self, close, date):
            self.close, self.date = close, date

    async def get_daily_bars(symbol, days):
        if symbol == "^JKSE":
            return [
                Bar(index_start * (1 + 0.0003 * i), dates[-(index_bars - i)].to_pydatetime())
                for i in range(index_bars)
            ]
        return []

    provider = MagicMock()
    provider.get_daily_bars = get_daily_bars
    return provider


# ── Holdings: one source of truth ───────────────────────────────────────────


class TestHoldingsModule:
    def test_every_held_symbol_has_a_display_name(self):
        """The optimiser filters the price frame to DISPLAY_NAMES, so a held
        symbol missing from it is silently dropped from optimisation."""
        from api.core.holdings import DISPLAY_NAMES, PORTFOLIO_LOTS

        missing = sorted(set(PORTFOLIO_LOTS) - set(DISPLAY_NAMES))
        assert not missing, f"held but unnameable: {missing}"

    def test_lots_are_positive_integers(self):
        from api.core.holdings import PORTFOLIO_LOTS

        for symbol, lots in PORTFOLIO_LOTS.items():
            assert isinstance(lots, int) and lots > 0, symbol

    def test_risk_service_and_optimizer_agree_on_the_portfolio(self):
        from api.core.holdings import PORTFOLIO_LOTS
        from ml.inference.portfolio_optimizer import IDX_NAMES

        assert IDX_NAMES == {**IDX_NAMES, **{k: v for k, v in IDX_NAMES.items()}}
        assert set(PORTFOLIO_LOTS) <= set(IDX_NAMES)

    def test_capital_constant_is_shared(self):
        from api.core.holdings import CAPITAL_IDR
        from api.services.market_service import _portfolio_prev_close
        from ml.inference.portfolio_optimizer import PORTFOLIO_CAPITAL_IDR

        assert _portfolio_prev_close == CAPITAL_IDR
        assert PORTFOLIO_CAPITAL_IDR == CAPITAL_IDR


# ── Defect #1: live risk must not raise "Portfolio holds no positions" ────────


class TestLiveRisk:
    async def test_computes_from_holdings(self, live_settings):
        from api.core.holdings import PORTFOLIO_LOTS
        from api.services import risk_service, technicals_service

        frame = _price_frame(sorted(PORTFOLIO_LOTS))

        async def fake_load(symbol, days=260):
            return frame[frame["symbol"] == symbol].copy(), "db"

        with patch.object(technicals_service, "load_ohlcv", side_effect=fake_load), \
             patch("ingestor.providers.get_provider", return_value=_fake_provider()):
            response = await risk_service.get_risk_metrics("default")

        rm = response.risk
        assert response.source == "live"
        # The sign convention: a loss is negative, so a caller can sum it against
        # daily P&L without special-casing.
        assert rm.var95 < 0, f"var95 should be negative, got {rm.var95}"
        assert rm.cvar95 < 0
        # Beta used to be a fabricated 1.0 whenever the index series was empty.
        # With the series present it is measured, and with it absent the
        # RiskEngine fallback is 1.0 — assert both so the fallback stays visible.
        assert rm.beta != 1.0, "beta still the hardcoded 1.0 fallback"
        # Sector exposure collapses to a single 100% bucket when the `sector`
        # column is missing; a real breakdown means it survived the loader.
        assert len(response.sectorExposure) > 1, "sector exposure collapsed"

    def test_risk_worker_reads_ihsg_from_the_provider(self, live_settings):
        """
        Synchronous on purpose: the Celery task is sync and calls asyncio.run()
        internally, so it cannot execute inside an async test.

        `ohlcv` never contains ^JKSE — it is written from
        IdxProvider.get_session_bars, which returns listed equities only. A query
        for the index against that table is permanently empty.
        """
        from workers import risk_worker

        sent_sql = []

        class Conn:
            async def fetch(self, query, *args):
                sent_sql.append(" ".join(query.split()))
                return []

            async def execute(self, query, *args):
                sent_sql.append(" ".join(query.split()))
                return "INSERT 0 1"

            async def close(self):
                return None

        async def connect(*args, **kwargs):
            return Conn()

        with patch("asyncpg.connect", connect), \
             patch("ingestor.providers.get_provider", return_value=_fake_provider()), \
             patch("redis.from_url", return_value=MagicMock(get=MagicMock(return_value=None))):
            with patch("pandas.DataFrame", _df_stub(_worker_frame())):
                risk_worker.refresh_risk.apply().get()

        joined = " ".join(sent_sql)
        assert "idx_universe" not in joined, "references a table that does not exist"
        assert "LEFT JOIN instruments" in joined, "sector must come from instruments"
        assert "ANY($1::text[])" in joined, "query must be bounded to the holdings"
        assert "'^JKSE'" not in joined, "the index is not in ohlcv; it comes from the provider"


def _worker_frame():
    """The frame the risk worker's DB read would have produced."""
    from api.core.holdings import PORTFOLIO_LOTS

    # date, not time: the worker SQL aliases o.time::date AS date.
    return _price_frame(sorted(PORTFOLIO_LOTS), periods=300, seed=9, date_column="date")


def _df_stub(frame):
    """Make pd.DataFrame(rows) inside the worker yield `frame` when empty."""
    real = pd.DataFrame

    def factory(rows=None, *args, **kwargs):
        if rows is None or len(rows) == 0:
            return frame.copy()
        return real(rows, *args, **kwargs)

    return factory


class TestKupiecSign:
    def test_negative_var_pct_would_breach_almost_everything(self):
        """Documents the bug: kupiec_test compares `returns < -var_pct`, so a
        negative var_pct (the RiskMetrics sign convention) turns the test into
        `returns < +|VaR|`, true almost always."""
        from ml.inference.risk_engine import kupiec_test

        returns = np.random.default_rng(1).normal(0.0005, 0.012, 400)
        wrong = kupiec_test(returns, -0.02)
        right = kupiec_test(returns, 0.02)
        assert wrong["breach_rate"] > 0.9, "expected the sign bug to be obvious"
        assert right["breach_rate"] < 0.1, "abs(var95) should give a plausible rate"

    def test_portfolio_returns_is_a_dated_series(self):
        """The old backtest used ohlcv.set_index('date')['close'].pct_change(),
        whose index repeats once per symbol — so it measured the gap between one
        symbol's close and the next symbol's close, and tail(90) took 90 rows
        rather than 90 sessions."""
        from ml.inference.risk_engine import RiskEngine

        from api.core.holdings import PORTFOLIO_LOTS

        frame = _price_frame(sorted(PORTFOLIO_LOTS), periods=200, seed=5, date_column="date")
        value = float(
            (frame.sort_values("date").groupby("symbol")["close"].last()
             * pd.Series(PORTFOLIO_LOTS) * 100).sum()
        )
        engine = RiskEngine(
            ohlcv=frame,
            holdings=PORTFOLIO_LOTS,
            portfolio_value=value,
            ihsg_returns=pd.Series(dtype=float),
        )
        series = engine.portfolio_returns()
        assert series.index.is_unique, "duplicate dates means cross-symbol deltas"
        assert not (series.abs() > 0.5).any(), "a >50% single-session return is not a portfolio return"


# ── Defect #3: risk alerts must be able to fire ─────────────────────────────


class TestRiskAlert:
    async def test_fires_from_a_cached_payload(self, live_settings):
        """risk_service writes RiskMetricsResponse.model_dump(), which nests the
        scores under "risk". Reading them from the top level returned None and
        the isinstance guard swallowed it, so no risk alert could ever fire."""
        from api.services import alerts_service, risk_service

        base = (await risk_service.get_risk_metrics("default")).model_dump()
        base["risk"]["concentrationRisk"] = 78
        base["risk"]["overallRisk"] = 80
        payload = json.dumps(base)

        class Redis:
            async def get(self, key):
                return payload

            async def zrange(self, *args):
                return []

        alerts = await alerts_service._risk_news_alerts(Redis(), "default")
        keys = {a["key"] for a in alerts}
        assert "risk:concentration" in keys, "concentration alert missing"
        assert "risk:overall" in keys, "overall-risk alert missing"
        severities = {a["key"]: a["severity"] for a in alerts}
        assert severities["risk:concentration"] == "high", "78 must read as high"

    async def test_stays_quiet_below_threshold(self, live_settings):
        from api.services import alerts_service, risk_service

        payload = json.dumps((await risk_service.get_risk_metrics("default")).model_dump())

        class Redis:
            async def get(self, key):
                return payload

            async def zrange(self, *args):
                return []

        alerts = await alerts_service._risk_news_alerts(Redis(), "default")
        assert [a for a in alerts if a["type"] in ("risk", "rebalance")] == []

    async def test_malformed_cache_is_skipped_not_crashed(self, live_settings):
        from api.services import alerts_service

        class Redis:
            def __init__(self, payload):
                self.payload = payload

            async def get(self, key):
                return self.payload

            async def zrange(self, *args):
                return []

        for payload in ('{"risk": {"truncated": 1}}', "not json at all", '{"risk": null}'):
            alerts = await alerts_service._risk_news_alerts(Redis(payload), "default")
            assert [a for a in alerts if a["type"] in ("risk", "rebalance")] == []


# ── Defect #4: portfolio identity comes from the token ───────────────────────


class TestPortfolioOwnership:
    async def test_cross_account_access_is_refused(self, fake_portfolios):
        from fastapi import HTTPException

        from api.services.portfolio_access import resolve_portfolio_id

        alice = await resolve_portfolio_id("alice")
        bob = await resolve_portfolio_id("bob")

        assert alice != bob
        # 404 rather than 403: a 403 would confirm the other portfolio exists.
        with pytest.raises(HTTPException) as exc:
            await resolve_portfolio_id("bob", alice)
        assert exc.value.status_code == 404

        with pytest.raises(HTTPException):
            await resolve_portfolio_id("alice", bob)

    async def test_own_portfolio_is_allowed(self, fake_portfolios):
        from api.services.portfolio_access import resolve_portfolio_id

        alice = await resolve_portfolio_id("alice")
        assert await resolve_portfolio_id("alice", alice) == alice

    async def test_first_principal_keeps_the_default_id(self, fake_portfolios):
        """Redis keys are keyed on the portfolio id and the Celery refresh_risk
        task pre-warms risk:portfolio:default, so a random id would strand that
        warm cache and force a synchronous GARCH recompute each hour."""
        from api.services.portfolio_access import DEFAULT_PORTFOLIO, resolve_portfolio_id

        assert await resolve_portfolio_id("first") == DEFAULT_PORTFOLIO

    async def test_provisioning_is_idempotent(self, fake_portfolios):
        from api.services.portfolio_access import resolve_portfolio_id

        first = await resolve_portfolio_id("alice")
        again = await resolve_portfolio_id("alice")
        assert first == again
        assert len(fake_portfolios.rows) == 1

    async def test_provisioned_portfolio_is_seeded_from_holdings(self, fake_portfolios):
        """A single-operator install must not lose the seeded book it had before
        the portfolios table existed."""
        from api.core.holdings import PORTFOLIO_LOTS
        from api.services.portfolio_access import resolve_portfolio_id

        pid = await resolve_portfolio_id("alice")
        _owner, _is_default, lots_json = fake_portfolios.rows[pid]
        assert json.loads(lots_json) == PORTFOLIO_LOTS

    async def test_unreachable_database_fails_closed(self, fake_portfolios):
        """An unreachable database must not read as 'allowed'."""
        from fastapi import HTTPException

        from api.services import portfolio_access

        async def boom():
            raise RuntimeError("db down")

        with patch.object(portfolio_access, "get_pool", boom):
            with pytest.raises(HTTPException) as exc:
                await portfolio_access.resolve_portfolio_id("alice")
        assert exc.value.status_code == 503


class TestPortfolioIdentityIsNotClientControlled:
    def test_no_endpoint_takes_a_portfolio_query_parameter(self, live_settings):
        """The regression this replaces: portfolio_id / uid as query parameters,
        settable by any authenticated caller."""
        from api.main import create_app

        spec = create_app().openapi()
        offending = []
        for path, operations in spec["paths"].items():
            for method, op in operations.items():
                for param in op.get("parameters", []):
                    if param.get("in") == "query" and param["name"] in {"uid", "portfolio_id"}:
                        offending.append(f"{method.upper()} {path} ?{param['name']}")
        assert not offending, f"client-controlled portfolio identity: {offending}"

    def test_chat_request_has_no_uid_field(self):
        from api.models.advisor import ChatRequest

        assert "uid" not in ChatRequest.model_fields

    def test_a_client_still_sending_uid_is_ignored_not_rejected(self):
        """Pydantic ignores unknown keys, so an older frontend keeps working."""
        from api.models.advisor import ChatRequest

        request = ChatRequest.model_validate({"message": "hi", "locale": "id", "uid": "default"})
        assert request.message == "hi"
        assert not hasattr(request, "uid")


# ── Model metrics: no fabricated figures ─────────────────────────────────────


class TestModelMetrics:
    def test_report_fields_are_exposed_verbatim(self):
        from ml.inference.signal_inference import SignalInference

        engine = SignalInference.load()
        metrics = engine.model_metrics()
        assert metrics.meanAuc == engine.report.get("mean_auc")
        assert metrics.decileLift == engine.report.get("mean_decile_lift")
        assert metrics.gatesPassed is not None

    def test_a_bundle_without_a_report_yields_nulls_not_zeros(self):
        """A zero would render as a perfect-or-catastrophic score rather than as
        a missing measurement."""
        from ml.inference.signal_inference import SignalInference

        class Empty(SignalInference):
            def __init__(self):
                self.report, self.version = {}, "x"

        dumped = Empty().model_metrics().model_dump()
        assert all(v is None for v in dumped.values()), dumped

    async def test_seed_path_carries_no_model_metrics(self, mock_redis):
        """
        No model produced the seed data, so there is no AUC to report.

        Needs the fake Redis. `get_signals` consults the cache before the mock
        branch, so with a live Redis holding a warmed `signals:latest` — which is
        what a running backend leaves behind — the seed path is never reached and
        the test asserts against live data instead.

        Patches `signal_service.get_settings`, not `api.core.config.get_settings`.
        The service does `from api.core.config import get_settings`, which binds
        the function into its own namespace at import time, so patching the source
        module has no effect on it — the original was already grabbed. Patching
        the name where it is used is the only thing that works.
        """
        from api.services import signal_service

        mock_settings = type("S", (), {
            "use_mock_signals": True,
            "use_mock_market": False,
            "model_max_age_days": 45,
        })()
        with patch.object(signal_service, "get_settings", return_value=mock_settings):
            response = await signal_service.get_signals()

        assert response.source == "mock", response.source
        assert response.modelVersion == "seed-v1.0"
        assert response.modelMetrics is None


# ── SQL hygiene: only reference tables that exist ───────────────────────────


# Call shapes that hand SQL to the database.
_DB_CALLS = (
    r"conn\.fetch", r"conn\.execute", r"conn\.fetchrow", r"conn\.fetchval",
    r"pool\.fetch", r"pool\.execute", r"pool\.fetchrow", r"pool\.fetchval",
    r"cursor\.execute", r"cur\.execute", r"\.executemany",
)


def _db_sql_statements(source: str) -> list[str]:
    """
    Extract only the triple-quoted strings that are arguments to a database call.

    Scanning every triple-quoted string also pulls in module and function
    docstrings, and a regex over those reports English prose as table names.
    Matching the call first is what makes the scan mean something.
    """
    import re

    pattern = "(?:" + "|".join(_DB_CALLS) + r")\(\s*\"\"\"(.*?)\"\"\""
    return re.findall(pattern, source, re.S)


# Identifiers that legitimately appear after FROM/JOIN without being tables.
_SQL_NON_TABLES = {
    "select", "lateral", "unnest", "values", "generate_series",
    "now", "interval", "distinct", "only",
}


def _cte_names(statement: str) -> set[str]:
    """CTE aliases defined in a WITH clause, so `FROM latest` is not flagged."""
    import re

    names = set(re.findall(r"(?:WITH|,)\s*([a-z_][a-z0-9_]*)\s+AS\s*\(", statement, re.I))
    return {n.lower() for n in names}


def _schema_tables():
    from pathlib import Path

    import re

    schema = Path(__file__).resolve().parents[1] / "db" / "schema.sql"
    text = schema.read_text()
    # Not only CREATE TABLE: ohlcv_daily is a continuous aggregate, declared as
    # CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous), and it is read
    # by symbols_service and market_service exactly like a table.
    tables = re.findall(r"CREATE TABLE IF NOT EXISTS\s+(\w+)", text, re.I)
    views = re.findall(r"CREATE MATERIALIZED VIEW(?: IF NOT EXISTS)?\s+(\w+)", text, re.I)
    return {name.lower() for name in tables + views}


class TestSqlReferencesRealTables:
    """`idx_universe` does not exist in this schema, and a query joining it fails
    at runtime rather than at import — so nothing caught it until the task ran.
    This scans SQL string literals only; an earlier attempt regexed the whole
    file and matched English prose in docstrings."""

    def test_workers_and_services_only_join_real_tables(self):
        import re
        from pathlib import Path

        root = Path(__file__).resolve().parents[1]
        tables = _schema_tables()
        offenders = []
        for rel in ("workers/risk_worker.py", "workers/ohlcv_worker.py",
                    "workers/signal_worker.py", "workers/instruments_worker.py",
                    "api/services/risk_service.py", "api/services/technicals_service.py",
                    "api/services/market_service.py", "api/services/symbols_service.py",
                    "api/services/broksum_service.py", "api/services/portfolio_access.py"):
            path = root / rel
            if not path.exists():
                continue
            for statement in _db_sql_statements(path.read_text()):
                ctes = _cte_names(statement)
                for match in re.finditer(r"\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)", statement, re.I):
                    name = match.group(1).lower()
                    if name in _SQL_NON_TABLES or name in ctes:
                        continue
                    if name not in tables:
                        offenders.append(f"{rel}: {name}")
        assert not offenders, f"SQL references non-existent tables: {sorted(set(offenders))}"


# ── Defect: the model artefact version has to be parseable ───────────────────


class TestModelVersionParsing:
    def test_second_resolution(self):
        from ml.inference.signal_inference import _parse_model_version

        assert _parse_model_version("20260816_080420").isoformat() == "2026-08-16T08:04:20+00:00"

    def test_minute_resolution(self):
        """The superseded trainer wrote %Y%m%d_%H%M. A None here would leave
        age_days None and is_stale permanently False, hiding a stale model."""
        from ml.inference.signal_inference import _parse_model_version

        assert _parse_model_version("20260816_0804").isoformat() == "2026-08-16T08:04:00+00:00"

    def test_short_version_is_not_silently_misparsed(self):
        """strptime('20260816_0804', '%Y%m%d_%H%M%S') SUCCEEDS as 08:00:04
        rather than failing, because %M and %S both accept one digit. A
        try-formats-in-order fallback would therefore never reach the correct
        branch."""
        from datetime import datetime

        naive = datetime.strptime("20260816_0804", "%Y%m%d_%H%M%S")
        assert (naive.hour, naive.minute) != (8, 4), "guard assumes the misparse"

        from ml.inference.signal_inference import _parse_model_version

        assert _parse_model_version("20260816_0804").minute == 4

    def test_junk_returns_none(self):
        from ml.inference.signal_inference import _parse_model_version

        for value in ("unknown", "", None, "20260816", "20260816_080", "20261332_080420"):
            assert _parse_model_version(value) is None


# ── Drift monitoring must not be silently inert ──────────────────────────────


class TestDriftVisibility:
    """
    The weekly PSI check degrades through four skip paths. Every one of them
    used to return without writing anything, and nothing in the API layer ever
    read `drift:latest` — so a model could drift out of its training regime for
    months and the only trace was one worker log line. A check that cannot say
    "I did not run" is not a check.
    """

    def test_shipped_artifact_reports_no_baseline(self):
        from ml.inference.signal_inference import SignalInference

        engine = SignalInference.load()
        assert engine.has_drift_baseline is False, (
            "the bundled artefact now carries a baseline; this test and the "
            "retrain hint in the model loader are both out of date"
        )

    @pytest.mark.parametrize(
        "mock_signals,bundle,reason",
        [
            (True, None, "use_mock_signals=true"),
            (False, None, "no_model"),
            (False, {"version": "20260816_080420", "features": [], "report": {}}, "no_baseline"),
        ],
    )
    def test_every_skip_path_is_recorded(self, mock_signals, bundle, reason):
        from unittest.mock import MagicMock

        from workers import monitoring_worker as mw

        class FakeRedis:
            def __init__(self):
                self.store = {}

            def set(self, key, value):
                self.store[key] = value
                return True

        redis = FakeRedis()
        settings = MagicMock(redis_url="redis://x/0", use_mock_signals=mock_signals)
        with patch("redis.from_url", return_value=redis), \
             patch.object(mw, "get_settings", return_value=settings), \
             patch.object(mw, "_load_latest_bundle", return_value=bundle):
            outcome = mw.check_drift.apply().get()

        assert outcome["reason"] == reason
        cached = redis.store.get(REDIS_KEYS["drift_latest"])
        assert cached is not None, "a skip left no record at all"
        assert json.loads(cached)["status"] == "skipped"
        if reason == "no_baseline":
            # The remediation has to travel with the record, not only live in a
            # log line nobody reads.
            assert "train_signals_v2" in json.loads(cached)["detail"]


def test_health_distinguishes_inert_drift_from_stable_drift(live_settings):
    """
    `/health` is the one surface an operator polls. It has to say which of
    "never ran", "cannot run" and "ran, all clear" applies.

    Uses the shared `live_settings` fixture rather than setting the env here.
    Doing it locally meant clearing the settings cache on entry but not on exit,
    so `create_app()` repopulated the cache while USE_MOCK_SIGNALS was still
    false and the stale object leaked into whichever test ran next.
    """
    from fastapi.testclient import TestClient

    from tests.conftest import _FakeRedis

    from api.main import create_app

    def probe(drift_payload):
        store = {}
        if drift_payload is not None:
            store["drift:latest"] = json.dumps(drift_payload)
        with patch("api.core.redis_client.get_redis", lambda: _FakeRedis(store)):
            client = TestClient(create_app())
            return client.get("/health").json()["checks"].get("drift")

    assert "not run" in str(probe(None))
    assert "INERT" in str(probe({"status": "skipped", "reason": "no_baseline"}))
    assert "retrain" in str(probe({"status": "skipped", "reason": "no_baseline"}))

    healthy = probe(
        {
            "status": "ok",
            "checked_at": "2026-08-22T08:00:00Z",
            "max_psi": 0.04,
            "needs_retraining": False,
            "drifted_features": [],
        }
    )
    assert isinstance(healthy, dict)
    assert healthy["needs_retraining"] is False
    assert healthy["max_psi"] == 0.04

    # Drift alone must never fail readiness: it is a slow signal, and a
    # skipped check says nothing about whether this instance can serve.
    assert live_settings.use_mock_signals is False


# ── Equity curve: a real series, or none at all ──────────────────────────────


def _index_bars(dates, start=7284.0, drift=0.0003):
    """
    Provider bars, tz-aware UTC — which is what the real providers return.

    The tz-awareness is the point, not incidental. An earlier version of this
    helper produced naive datetimes, so both sides of the reindex were naive and
    the timezone mismatch that silently emptied the benchmark in production
    could not show up here. `_wide_frame` stays naive because `ohlcv.time` is a
    `::date` column, and it is precisely that asymmetry that broke it.
    """
    from dataclasses import dataclass

    @dataclass
    class Bar:
        close: float
        date: object

    return [
        Bar(start * (1 + drift) ** i, dates[i].to_pydatetime().replace(tzinfo=timezone.utc))
        for i in range(len(dates))
    ]


def _wide_frame(dates, periods):
    import numpy as np

    from api.core.holdings import PORTFOLIO_LOTS

    frames = []
    for i, symbol in enumerate(PORTFOLIO_LOTS):
        close = 3000 * np.exp(np.cumsum(np.random.default_rng(i).normal(0.0004, 0.013, periods)))
        frames.append(
            pd.DataFrame({"d": dates, "symbol": symbol, "close": close})
        )
    return pd.concat(frames).pivot_table(index="d", columns="symbol", values="close")


class TestEquityCurve:
    async def test_curve_is_computed_from_real_closes_and_lots(self, live_settings):
        from api.core.holdings import CAPITAL_IDR
        from api.services import portfolio_service

        dates = pd.bdate_range("2025-01-01", periods=250)
        wide = _wide_frame(dates, 250)

        async def load(symbols, days):
            return wide.copy()

        provider = MagicMock()
        provider.get_daily_bars = AsyncMock(
            side_effect=lambda symbol, days: _index_bars(dates) if symbol == "^JKSE" else []
        )

        with patch.object(portfolio_service, "_load_price_matrix", side_effect=load), \
             patch("ingestor.providers.get_provider", return_value=provider):
            curve = await portfolio_service.get_equity_curve(days=250)

        assert curve.source == "live"
        assert len(curve.points) == 250
        assert curve.startValue and curve.startValue > 0
        # The value is the sum of close × lots × 100, so it has to land near the
        # seeded capital rather than being an arbitrary series.
        assert 0.2 * CAPITAL_IDR < curve.startValue < 5 * CAPITAL_IDR
        # Rebased so the two lines share a scale and are directly comparable.
        assert curve.benchmarkSource == "^JKSE"
        assert abs(curve.points[0].benchmark - curve.startValue) < 1.0
        assert all(p.benchmark is not None for p in curve.points)

    async def test_no_history_yields_no_points_not_a_flat_line(self, live_settings):
        """A straight or random line would render a confident chart of a history
        that does not exist."""
        from api.services import portfolio_service

        async def load(symbols, days):
            return pd.DataFrame()

        with patch.object(portfolio_service, "_load_price_matrix", side_effect=load):
            curve = await portfolio_service.get_equity_curve(days=250)

        assert curve.points == []
        assert curve.source == "mock"

    async def test_missing_index_nulls_the_benchmark_rather_than_zeroing_it(
        self, live_settings
    ):
        """A zero benchmark draws a line to the floor and reads as a crash."""
        from api.services import portfolio_service

        dates = pd.bdate_range("2025-01-01", periods=200)
        wide = _wide_frame(dates, 200)

        async def load(symbols, days):
            return wide.copy()

        provider = MagicMock()
        provider.get_daily_bars = AsyncMock(return_value=[])

        with patch.object(portfolio_service, "_load_price_matrix", side_effect=load), \
             patch("ingestor.providers.get_provider", return_value=provider):
            curve = await portfolio_service.get_equity_curve(days=200)

        assert curve.source == "live", "the curve is still worth showing without a benchmark"
        assert len(curve.points) == 200
        assert curve.benchmarkSource is None
        assert all(p.benchmark is None for p in curve.points)

    async def test_uses_the_same_holdings_as_the_risk_engine(self, live_settings):
        """The two paths describe one portfolio. This codebase already had them
        disagree, because risk_worker carried a private 7-symbol copy."""
        import inspect

        from api.core.holdings import PORTFOLIO_LOTS
        from api.services import portfolio_service, risk_service

        for module in (portfolio_service, risk_service):
            source = inspect.getsource(module)
            assert "PORTFOLIO_LOTS" in source, f"{module.__name__} does not use the shared holdings"

        assert set(PORTFOLIO_LOTS) == set(PORTFOLIO_LOTS)
        assert sum(PORTFOLIO_LOTS.values()) > 0

    async def test_endpoint_returns_the_curve_over_http(
        self, live_settings, fake_portfolios, mock_redis
    ):
        """The service test proves the maths; this proves the route, the response
        model and the cache wrapper are all wired to it."""
        from dataclasses import dataclass

        from fastapi.testclient import TestClient

        from api.services import portfolio_service

        dates = pd.bdate_range("2025-01-01", periods=250)
        wide = _wide_frame(dates, 250)

        async def load(symbols, days):
            return wide.copy()

        @dataclass
        class Bar:
            close: float
            date: object

        async def daily(symbol, days):
            if symbol == "^JKSE":
                # tz-aware, matching the real provider — see _index_bars.
                return [Bar(7284 * (1.0003 ** i),
                            dates[i].to_pydatetime().replace(tzinfo=timezone.utc))
                        for i in range(len(dates))]
            return []

        provider = MagicMock()
        provider.get_daily_bars = daily

        with patch.object(portfolio_service, "_load_price_matrix", side_effect=load), \
             patch("ingestor.providers.get_provider", return_value=provider):
            from api.main import create_app

            response = TestClient(create_app()).get("/v1/portfolio/equity?days=250")

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["source"] == "live"
        assert len(body["points"]) == 250
        assert body["benchmarkSource"] == "^JKSE"
        assert all(p["benchmark"] is not None for p in body["points"])
        assert body["startValue"] > 0
        assert body["totalReturn"] is not None
        # The payload must satisfy the declared contract exactly.
        from api.models.portfolio import EquityCurveResponse

        EquityCurveResponse(**body)

    async def test_endpoint_takes_no_portfolio_identity_parameter(
        self, live_settings
    ):
        """Consistency with the other portfolio routes: identity comes from the
        token, so there is nothing for a caller to tamper with."""
        from api.main import create_app

        op = create_app().openapi()["paths"]["/v1/portfolio/equity"]["get"]
        query = {q["name"] for q in op.get("parameters", []) if q.get("in") == "query"}
        assert query == {"days"}, query


class TestTimezoneAlignment:
    """
    `ohlcv.time` is a `::date` column, so it comes back tz-naive, while every
    provider bar is tz-aware UTC. A naive Timestamp never equals an aware one, so
    the benchmark reindex matched nothing and the curve silently lost its
    benchmark — on a range whose two ends printed identically, which is what made
    it hard to spot.
    """

    def test_naive_db_dates_are_localised_before_comparison(self):
        import pandas as pd

        from api.core.holdings import PORTFOLIO_LOTS

        dates = pd.bdate_range("2026-07-27", periods=5)
        frames = [
            pd.DataFrame({"d": dates, "symbol": s, "close": 3000.0})
            for s in PORTFOLIO_LOTS
        ]
        wide = pd.concat(frames).pivot_table(index="d", columns="symbol", values="close")
        lots = pd.Series({s: n * 100 for s, n in PORTFOLIO_LOTS.items()})
        value = (wide * lots).sum(axis=1)

        assert value.index.tz is None, "DB dates are naive, which is the whole problem"
        localised = pd.to_datetime(value.index, utc=True)
        assert str(localised.tz) == "UTC"

        # A provider bar for the same session must now match.
        provider_index = pd.to_datetime(
            [d.to_pydatetime().replace(tzinfo=timezone.utc) for d in dates], utc=True
        )
        assert len(set(localised) & set(provider_index)) == 5, "still not comparable"

    async def test_curve_keeps_its_benchmark_against_tz_aware_bars(self, live_settings):
        from api.services import portfolio_service

        dates = pd.bdate_range("2026-07-27", periods=30)
        wide = _wide_frame(dates, 30)

        async def load(symbols, days):
            return wide.copy()

        provider = MagicMock()
        provider.get_daily_bars = AsyncMock(
            side_effect=lambda symbol, days: _index_bars(dates) if symbol == "^JKSE" else []
        )

        with patch.object(portfolio_service, "_load_price_matrix", side_effect=load), \
             patch("ingestor.providers.get_provider", return_value=provider):
            curve = await portfolio_service.get_equity_curve(days=30)

        assert curve.source == "live"
        assert len(curve.points) == 30
        assert curve.benchmarkSource == "^JKSE", "benchmark lost to a timezone mismatch"
        assert all(p.benchmark is not None for p in curve.points)


class TestMultiLoopPools:
    """
    A process-wide connection pool is bound to the event loop that created it.
    The API server runs one loop for its lifetime, so this never fires there —
    which is why it only showed up in scripts and tests, where the failure is a
    warning line rather than an outage.

    It was real: scripts.daily_update's cache-invalidation step was silently
    skipped, leaving stale technicals in Redis after a data refresh.
    """

    def test_redis_pool_is_rebuilt_for_a_new_loop(self):
        import asyncio as _asyncio

        from api.core import redis_client

        async def use():
            return id(redis_client.get_redis_pool())

        first = _asyncio.run(use())
        second = _asyncio.run(use())
        assert first != second, "pool carried across event loops; it would raise on use"

    def test_asyncpg_pool_is_rebuilt_for_a_new_loop(self):
        import asyncio as _asyncio

        from api.core import db

        # Deliberately NOT closed inside the coroutine. Closing would reset
        # _pool to None on its own and the test would pass with the loop check
        # removed — which is exactly what an earlier version of this test did.
        # The real scenario is a pool left behind by one loop and handed to the
        # next, which is what a short-lived script does.
        async def use():
            return id(await db.get_pool())

        first = _asyncio.run(use())
        second = _asyncio.run(use())
        assert first != second, "pool carried across event loops; reuse would raise"

    def test_asyncpg_pool_is_usable_in_each_loop(self):
        """
        The rebuild must produce a *working* pool, not merely a different object.

        Each loop closes its own pool before returning. That is what a
        well-behaved caller does, and it keeps the test from leaving a dangling
        pool for the garbage collector to finalise against a dead loop — which
        raises "Event loop is closed" from asyncpg's own teardown and says
        nothing about the behaviour under test.
        """
        import asyncio as _asyncio

        from api.core import db

        async def query():
            pool = await db.get_pool()
            try:
                return await pool.fetchval("SELECT 1")
            finally:
                await db.close_pool()

        assert _asyncio.run(query()) == 1
        assert _asyncio.run(query()) == 1
