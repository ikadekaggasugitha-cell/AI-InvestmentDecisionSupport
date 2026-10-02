"""
Alert API models — the /v1/alerts feed.

Alerts are DERIVED at read time from the same live data the rest of the app
shows (signals, market snapshot, foreign flow, risk, news), so the Peringatan
panel reflects current conditions instead of a frozen seed list. Each alert
carries a STABLE `key` so the frontend's read/dismiss state survives refetches:
the same condition (e.g. "BBRI is VERY_HIGH") keeps its key until it changes.
"""

from typing import Literal
from pydantic import BaseModel

AlertType = Literal["signal", "risk", "macro", "rebalance"]
AlertSeverity = Literal["high", "medium", "low"]


class AlertItem(BaseModel):
    id: int                      # display / React key (index within this batch)
    key: str                     # STABLE identity for read/dismiss persistence
    type: AlertType
    severity: AlertSeverity
    msgId: str                   # Indonesian message
    msgEn: str                   # English message
    timeId: str                  # relative time, Indonesian ("5 mnt lalu")
    timeEn: str                  # relative time, English ("5 min ago")
    symbol: str | None = None


class AlertsResponse(BaseModel):
    alerts: list[AlertItem]
    generatedAt: str
    source: Literal["live", "seed"] = "live"
