"""
Broker Summary Mock Data Generator — Phase 10

Generates realistic broker summary data when USE_MOCK_BROKSUM=true.
Simulates accumulation/distribution patterns with consistent broker codes
used by Indonesian securities firms.

Usage:
    from ingestor.broksum_mock import generate_mock_broksum
    rows = generate_mock_broksum("BBCA")
"""

import random
from datetime import datetime, timezone, timedelta
from typing import Any

# ── Known broker codes (Indonesian securities firms) ──────────────────────────
# Each broker has a characteristic profile that influences mock behaviour

BROKER_PROFILES: dict[str, dict[str, Any]] = {
    "YP": {"name": "Mirae Asset Sekuritas",   "type": "institutional", "avg_size": "large"},
    "CC": {"name": "Mandiri Sekuritas",        "type": "institutional", "avg_size": "large"},
    "GX": {"name": "Bahana Sekuritas",         "type": "institutional", "avg_size": "medium"},
    "DB": {"name": "Deutsche Securities",      "type": "foreign",      "avg_size": "large"},
    "ML": {"name": "Merrill Lynch",            "type": "foreign",      "avg_size": "large"},
    "KZ": {"name": "BCA Sekuritas",            "type": "institutional", "avg_size": "large"},
    "RX": {"name": "Macquarie Sekuritas",      "type": "foreign",      "avg_size": "medium"},
    "AK": {"name": "PT Indo Premier Sekuritas","type": "retail",       "avg_size": "medium"},
    "YU": {"name": "CGS-CIMB Sekuritas",       "type": "institutional", "avg_size": "medium"},
    "PD": {"name": "Sinarmas Sekuritas",       "type": "retail",       "avg_size": "small"},
    "NI": {"name": "BNI Sekuritas",            "type": "institutional", "avg_size": "medium"},
    "TP": {"name": "Trimegah Sekuritas",       "type": "institutional", "avg_size": "medium"},
    "DX": {"name": "Panin Sekuritas",          "type": "retail",       "avg_size": "small"},
    "ZP": {"name": "JP Morgan Securities",     "type": "foreign",      "avg_size": "large"},
    "KI": {"name": "UBS Securities",           "type": "foreign",      "avg_size": "large"},
    "OD": {"name": "Citigroup Securities",     "type": "foreign",      "avg_size": "large"},
    "LG": {"name": "Samsung Sekuritas",        "type": "foreign",      "avg_size": "medium"},
    "FZ": {"name": "Valbury Sekuritas",        "type": "retail",       "avg_size": "small"},
    "AF": {"name": "Ajaib Sekuritas",          "type": "retail",       "avg_size": "small"},
    "IF": {"name": "Stockbit Sekuritas",       "type": "retail",       "avg_size": "small"},
}

ALL_BROKER_CODES = list(BROKER_PROFILES.keys())

# ── Stock-level accumulation biases (for consistent mock patterns) ────────────
# Positive bias = tends toward accumulation, negative = distribution
_STOCK_BIAS: dict[str, float] = {
    "BBCA":  0.30,   # Strong accumulation
    "BBRI":  0.20,
    "BMRI":  0.15,
    "TLKM": -0.10,   # Mild distribution
    "ASII":  0.05,
    "GOTO": -0.25,   # Distribution pressure
    "BREN":  0.40,   # Heavy accumulation
    "ADRO":  0.10,
    "UNVR": -0.15,
    "ICBP":  0.00,
    "ANTM":  0.20,
    "PTBA":  0.05,
    "KLBF": -0.05,
    "SMGR":  0.00,
    "EMTK": -0.20,
}

# ── Price references for lot-value calculations ───────────────────────────────
# Anchored to real IDX closes so simulated lot VALUES are the right order of
# magnitude. Kept in step with ingestor/ohlcv_mock.py._PRICE_REF.
_PRICE_REF: dict[str, float] = {
    "BBCA": 6350, "BBRI": 3120, "BMRI": 4170, "TLKM": 2620,
    "ASII": 4780, "GOTO": 50,   "BREN": 3570, "ADRO": 2530,
    "UNVR": 1775, "ICBP": 7600, "ANTM": 3070, "PTBA": 2360,
    "KLBF": 800,  "SMGR": 1580, "EMTK": 505,
}


def _lot_scale(broker_code: str) -> float:
    """Returns a multiplier based on broker size profile."""
    profile = BROKER_PROFILES.get(broker_code, {})
    size = profile.get("avg_size", "medium")
    return {"large": 3.0, "medium": 1.5, "small": 0.6}.get(size, 1.0)


def generate_mock_broksum(
    symbol: str,
    num_brokers: int = 12,
    date: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    Generate mock broker summary rows for a single symbol on a given date.

    Returns list of dicts matching broker_summary table schema:
        {time, symbol, broker_code, buy_lot, sell_lot, buy_val, sell_val,
         net_lot, net_val, avg_buy_price, avg_sell_price}
    """
    if date is None:
        date = datetime.now(timezone.utc)

    bias = _STOCK_BIAS.get(symbol, 0.0)
    price = _PRICE_REF.get(symbol, 5000)
    selected = random.sample(ALL_BROKER_CODES, min(num_brokers, len(ALL_BROKER_CODES)))

    rows: list[dict[str, Any]] = []
    for code in selected:
        scale = _lot_scale(code)
        base_lots = int(random.gauss(500, 200) * scale)
        base_lots = max(10, base_lots)

        # Apply accumulation/distribution bias
        # Positive bias → more buy lots, negative → more sell lots
        buy_skew = 1.0 + bias + random.gauss(0, 0.15)
        sell_skew = 1.0 - bias + random.gauss(0, 0.15)

        buy_lot = max(0, int(base_lots * buy_skew))
        sell_lot = max(0, int(base_lots * sell_skew))
        net_lot = buy_lot - sell_lot

        # Price with small spread
        spread = random.uniform(0.001, 0.005)
        avg_buy_price = round(price * (1 + spread / 2), 2)
        avg_sell_price = round(price * (1 - spread / 2), 2)

        buy_val = round(buy_lot * 100 * avg_buy_price, 2)   # 1 lot = 100 shares
        sell_val = round(sell_lot * 100 * avg_sell_price, 2)
        net_val = round(buy_val - sell_val, 2)

        rows.append({
            "time": date,
            "symbol": symbol,
            "broker_code": code,
            "buy_lot": buy_lot,
            "sell_lot": sell_lot,
            "buy_val": buy_val,
            "sell_val": sell_val,
            "net_lot": net_lot,
            "net_val": net_val,
            "avg_buy_price": avg_buy_price,
            "avg_sell_price": avg_sell_price,
        })

    # Sort by absolute net_lot descending (most active brokers first)
    rows.sort(key=lambda r: abs(r["net_lot"]), reverse=True)
    return rows


def generate_mock_broksum_history(
    symbol: str,
    days: int = 20,
    num_brokers: int = 12,
) -> list[dict[str, Any]]:
    """
    Generate N days of mock broker summary history for a symbol.
    Maintains persistent broker selection per symbol for consistency.
    """
    now = datetime.now(timezone.utc)
    all_rows: list[dict[str, Any]] = []

    # Use symbol as seed for consistent broker selection
    rng = random.Random(hash(symbol) % (2**31))
    persistent_brokers = rng.sample(ALL_BROKER_CODES, min(num_brokers, len(ALL_BROKER_CODES)))

    for day_offset in range(days):
        date = now - timedelta(days=day_offset)
        # Skip weekends
        if date.weekday() >= 5:
            continue

        # Use day-specific seed for reproducibility within a session
        random.seed(hash(f"{symbol}:{date.date()}") % (2**31))
        rows = generate_mock_broksum(symbol, num_brokers=num_brokers, date=date)
        all_rows.extend(rows)

    # Reset random seed
    random.seed()
    return all_rows


def generate_all_mock_broksum(
    symbols: list[str] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Generate mock broksum for all symbols (single day, latest)."""
    if symbols is None:
        symbols = list(_STOCK_BIAS.keys())

    return {sym: generate_mock_broksum(sym) for sym in symbols}
