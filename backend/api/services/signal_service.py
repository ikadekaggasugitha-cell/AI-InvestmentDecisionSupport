import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from api.core.config import get_settings
from api.core.redis_client import REDIS_KEYS, redis_get_json, redis_set_json
from api.models.signals import AISignal, SignalsResponse

logger = logging.getLogger(__name__)

_SEED_PATH = Path(__file__).parent.parent / "seed" / "signals.json"
_SEED_DATA: list[dict] | None = None

SIGNALS_TTL = 900  # 15 minutes


def _load_seed() -> list[dict]:
    global _SEED_DATA
    if _SEED_DATA is None:
        _SEED_DATA = json.loads(_SEED_PATH.read_text())
    return _SEED_DATA


async def get_signals() -> SignalsResponse:
    """
    Returns AI signals.

    Priority:
      1. Redis cache (always checked first — fastest path)
      2. Mock seed data (when USE_MOCK_SIGNALS=true)
      3. LightGBM inference (Phase 3 — when USE_MOCK_SIGNALS=false)
    """
    settings = get_settings()

    # 1. Try Redis cache
    cached = await redis_get_json(REDIS_KEYS["signals_latest"])
    if cached:
        logger.debug("signals: cache hit")
        return SignalsResponse(**cached)

    # 2. Mock mode — return seed data directly
    if settings.use_mock_signals:
        logger.debug("signals: serving mock seed data")
        raw = _load_seed()
        response = SignalsResponse(
            signals=[AISignal(**s) for s in raw],
            generatedAt=datetime.now(timezone.utc).isoformat(),
            modelVersion="seed-v1.0",
            source="mock",
        )
        # Cache the mock data so repeated requests stay fast
        await redis_set_json(
            REDIS_KEYS["signals_latest"],
            response.model_dump(),
            ttl=SIGNALS_TTL,
        )
        return response

    # 3. Live LightGBM inference on real bars
    try:
        response = await _compute_live_signals()
    except ModelUnavailable as exc:
        # A missing artefact is an operational gap, not a reason to serve
        # generated numbers as if they were model output. Seed data is returned
        # so the page still renders, and `source="mock"` says what it is.
        logger.error("signals: %s — falling back to labelled seed data", exc)
        raw = _load_seed()
        return SignalsResponse(
            signals=[AISignal(**s) for s in raw],
            generatedAt=datetime.now(timezone.utc).isoformat(),
            modelVersion="seed-v1.0",
            source="mock",
        )

    await redis_set_json(REDIS_KEYS["signals_latest"], response.model_dump(), ttl=SIGNALS_TTL)
    return response


class ModelUnavailable(RuntimeError):
    """The model cannot be served: no artefact, or no data to score with."""


async def _load_cross_section(days: int) -> "pd.DataFrame":
    """
    Daily bars for the whole board, in one query.

    The model's cross-sectional ranks only mean what they meant in training if
    they are computed over a comparable universe, so this deliberately does not
    filter to the tracked symbols. One query for ~950 instruments is far cheaper
    than 950 provider round trips, which is the other reason this path requires
    the database rather than falling back to per-symbol fetches.
    """
    import pandas as pd

    from api.core.config import get_settings

    settings = get_settings()

    try:
        import asyncpg

        conn = await asyncpg.connect(
            settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
        )
    except (ImportError, Exception) as exc:  # noqa: BLE001
        logger.warning("signals: cross-section unavailable — %s", exc)
        return pd.DataFrame()

    try:
        records = await conn.fetch(
            """
            SELECT time::date AS date, symbol, open, high, low, close, volume,
                   foreign_net, value_idr, listed_shares, frequency
            FROM ohlcv
            WHERE time > NOW() - ($1 || ' days')::INTERVAL
            ORDER BY symbol, time
            """,
            str(int(days * 1.6)),
        )
    finally:
        await conn.close()

    if not records:
        return pd.DataFrame()

    frame = pd.DataFrame([dict(r) for r in records])
    for col in ("open", "high", "low", "close", "foreign_net", "value_idr"):
        if col in frame:
            frame[col] = pd.to_numeric(frame[col], errors="coerce")
    return frame


async def _compute_live_signals() -> SignalsResponse:
    """
    Score the tracked universe with the trained model.

    Feature construction goes through build_point_in_time_features — the same
    function the model was trained on. Using a different builder at serving
    time is the classic way to ship a model that quietly underperforms its
    backtest, because every feature drifts a little from what it learned.

    Only the most recent row per symbol is scored: that is the only row whose
    features describe today.
    """
    import pandas as pd

    from api.services.market_service import _IDX_METADATA
    from api.services.technicals_service import analyse, load_ohlcv
    from ml.features.point_in_time import build_point_in_time_features
    from ml.inference.signal_inference import SignalInference

    settings = get_settings()

    try:
        engine = SignalInference.load()
    except FileNotFoundError as exc:
        raise ModelUnavailable(
            "no trained model in backend/models/ — run "
            "`python -m ml.training.train_signals_v2`"
        ) from exc

    display_symbols = settings.tracked_symbols
    lookback = max(settings.ta_gap_lookback_days, 120)

    # ── Features are built over the FULL cross-section, not just the 15 we show
    #
    # Two of the model's features — xs_ret_20d_rank and xs_turnover_rank — are
    # ranks within a trading date. In training those ranks were computed across
    # ~958 instruments. Computing them across only the 15 tracked names would
    # produce a completely different quantity: the tracked list is almost all
    # large caps, so their turnover rank among themselves spans 0..1 while
    # against the whole board it would sit near the top for every one of them.
    #
    # Serving a differently-scaled feature than the model trained on is
    # train/serve skew, and it shifts every prediction without erroring.
    cross_section = await _load_cross_section(lookback)
    if cross_section.empty:
        raise ModelUnavailable(
            "the `ohlcv` table is empty, so the cross-sectional features this "
            "model uses cannot be reproduced at serving time. Run "
            "workers.ohlcv_worker.backfill_ohlcv."
        )

    features = build_point_in_time_features(cross_section)
    if features.empty:
        raise ModelUnavailable("feature build produced no rows")

    universe_size = cross_section["symbol"].nunique()
    logger.info(
        "signals: cross-section of %d symbols, %d feature rows",
        universe_size, len(features),
    )

    # Price action and last price for the symbols actually displayed.
    market_prices: dict[str, float] = {}
    technicals: dict[str, dict] = {}
    for symbol in display_symbols:
        bars, source = await load_ohlcv(symbol, days=lookback)
        if bars.empty or source == "mock":
            logger.warning("signals: no real bars for %s (source=%s)", symbol, source)
            continue
        market_prices[symbol] = float(bars.sort_values("time")["close"].iloc[-1])
        # Display only — see PHASE10_DISPLAY_FEATURES; never a model input.
        technicals[symbol] = analyse(bars)

    if not market_prices:
        raise ModelUnavailable("no real bars available for any tracked symbol")

    # Score only what we display, but rank against the whole board.
    features = features[features["symbol"].isin(market_prices)]
    if features.empty:
        raise ModelUnavailable("no tracked symbol survived feature construction")

    # Latest row per symbol, indexed by symbol as SignalInference expects.
    latest = (
        features.sort_values("date")
        .groupby("symbol", as_index=False)
        .tail(1)
        .set_index("symbol")
    )

    response = engine.run(latest, market_prices, technicals=technicals)

    # Names come from the universe metadata; the model only knows tickers.
    for signal in response.signals:
        meta = _IDX_METADATA.get(signal.symbol)
        if meta:
            signal.name = meta["name"]

    logger.info(
        "signals: scored %d symbols with model %s",
        len(response.signals), engine.version,
    )
    return response
