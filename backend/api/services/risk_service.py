import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS, redis_get_json, redis_set_json
from api.models.risk import RiskMetrics, RiskMetricsResponse, SectorExposureItem, StressTest

if TYPE_CHECKING:  # pandas is heavy; only needed for annotations here
    import pandas as pd

logger = logging.getLogger(__name__)


def _sector_for(symbol: str) -> str:
    """
    Indonesian sector name for a symbol, matching the keys in
    risk_engine.IHSG_SECTOR_WEIGHTS so the benchmark comparison lines up.

    Falls back to "Lainnya" for anything outside the tracked universe, which is
    honest: an unclassified holding genuinely is "other", and the fallback now
    applies to individual symbols rather than swallowing the entire portfolio.
    """
    from api.services.market_service import _IDX_METADATA

    meta = _IDX_METADATA.get(symbol.upper())
    return meta["sector"] if meta else "Lainnya"


class RiskDataUnavailable(RuntimeError):
    """
    Raised when real price history is missing.

    Deliberately not caught and replaced with seed data. Risk numbers derived
    from simulated prices are worse than an error: they carry the same
    authority as real ones and measure nothing. The endpoint should fail
    loudly so the cause gets fixed.
    """

_SEED_PATH = Path(__file__).parent.parent / "seed" / "risk.json"
_SEED_DATA: dict | None = None

RISK_TTL = 3600  # 1 hour


def _load_seed() -> dict:
    global _SEED_DATA
    if _SEED_DATA is None:
        _SEED_DATA = json.loads(_SEED_PATH.read_text())
    return _SEED_DATA


def _redis_risk_key(portfolio_id: str = "default") -> str:
    return REDIS_KEYS["risk_portfolio"].format(uid=portfolio_id)


async def get_risk_metrics(portfolio_id: str = "default") -> RiskMetricsResponse:
    """
    Returns portfolio risk metrics.

    Priority:
      1. Redis cache
      2. Mock seed data (when USE_MOCK_RISK=true)
      3. GARCH + CVaR computation (Phase 4 — when USE_MOCK_RISK=false)
    """
    settings = get_settings()
    cache_key = _redis_risk_key(portfolio_id)

    # 1. Try Redis cache
    cached = await redis_get_json(cache_key)
    if cached:
        logger.debug("risk: cache hit for portfolio %s", portfolio_id)
        return RiskMetricsResponse(**cached)

    # 2. Mock mode
    if settings.use_mock_risk:
        logger.debug("risk: serving mock seed data")
        raw = _load_seed()
        response = RiskMetricsResponse(
            risk=RiskMetrics(**raw["risk"]),
            stressTests=[StressTest(**s) for s in raw["stressTests"]],
            sectorExposure=[SectorExposureItem(**s) for s in raw["sectorExposure"]],
            computedAt=datetime.now(timezone.utc).isoformat(),
            source="mock",
        )
        await redis_set_json(cache_key, response.model_dump(), ttl=RISK_TTL)
        return response

    # 3. Live computation on real market returns
    response = await _compute_live_risk(portfolio_id)
    await redis_set_json(cache_key, response.model_dump(), ttl=RISK_TTL)
    return response


async def _load_returns_history(symbols: list[str], days: int) -> "pd.DataFrame":
    """
    Daily bars for the holdings plus the index, as the RiskEngine expects them.

    Reads TimescaleDB first and falls back to a direct provider fetch, so risk
    is computable on a fresh deployment before the backfill has run. Both paths
    return real market prices; neither substitutes synthetic data, because a
    VaR computed from invented returns is worse than no VaR — it looks
    authoritative and measures nothing.
    """
    import pandas as pd

    from api.services.technicals_service import load_ohlcv

    frames = []
    for symbol in symbols:
        frame, source = await load_ohlcv(symbol, days=days)
        if frame.empty:
            logger.warning("risk: no bars for %s — excluded from the portfolio", symbol)
            continue
        if source == "mock":
            raise RiskDataUnavailable(
                f"Only simulated bars are available for {symbol}. Risk metrics "
                "computed on generated prices would be meaningless; run "
                "workers.ohlcv_worker.backfill_ohlcv or check the market feed."
            )
        sub = frame[["time", "close"]].copy()
        sub["symbol"] = symbol
        # RiskEngine reads `sector` off this frame to build sector exposure. Omit
        # it and every holding falls to the "Lainnya" default, collapsing the
        # breakdown to a single 100% bucket that looks computed but says nothing.
        sub["sector"] = _sector_for(symbol)
        sub = sub.rename(columns={"time": "date"})
        frames.append(sub)

    if not frames:
        raise RiskDataUnavailable("No price history available for any holding.")

    return pd.concat(frames, ignore_index=True)


async def _compute_live_risk(portfolio_id: str) -> RiskMetricsResponse:
    """
    Run GARCH, historical VaR/CVaR and beta over real IDX returns.

    A note on what "live" means here. The RETURNS are real market data. The
    HOLDINGS — which symbols and how many lots — still come from the seeded
    portfolio until real positions are entered. Volatility, beta, correlation
    and drawdown are therefore genuine; the IDR amounts are scaled by a
    portfolio that is not yet yours. `source` reports "live" for the market
    data, and the portfolio caveat belongs in the UI next to the rupiah figures.
    """
    import pandas as pd

    from api.services.market_service import _IDX_METADATA
    from ml.inference.risk_engine import RiskEngine

    settings = get_settings()

    holdings = {
        sym: int(meta["portfolioLots"])
        for sym, meta in _IDX_METADATA.items()
        if meta.get("portfolioLots", 0) > 0
    }
    if not holdings:
        raise RiskDataUnavailable("Portfolio holds no positions.")

    lookback = max(settings.ta_gap_lookback_days, 252)
    ohlcv = await _load_returns_history(sorted(holdings), lookback)

    # Index returns for beta. Without them beta is undefined, and a fabricated
    # 1.0 would read as "moves exactly with the market".
    ihsg_returns = pd.Series(dtype=float)
    try:
        from ingestor.providers import get_provider

        # Shared instance — do not close it here; the session and crumb are
        # reused across every caller and closed once at shutdown.
        bars = await get_provider().get_daily_bars("^JKSE", lookback)
        if bars:
            closes = pd.Series(
                [b.close for b in bars],
                index=pd.to_datetime([b.date for b in bars]),
            )
            ihsg_returns = closes.pct_change().dropna()
    except Exception as exc:  # noqa: BLE001 — beta degrades, risk still computes
        logger.warning("risk: IHSG history unavailable, beta will be unreliable — %s", exc)

    latest_close = ohlcv.sort_values("date").groupby("symbol")["close"].last()
    portfolio_value = float(
        sum(latest_close.get(sym, 0.0) * lots * 100 for sym, lots in holdings.items())
    )

    engine = RiskEngine(
        ohlcv=ohlcv,
        holdings=holdings,
        portfolio_value=portfolio_value,
        ihsg_returns=ihsg_returns,
    )
    response = engine.compute()
    response.source = "live"
    logger.info(
        "risk: computed on %d symbols, %d sessions, portfolio Rp %.0f",
        len(holdings), ohlcv["date"].nunique(), portfolio_value,
    )
    return response
