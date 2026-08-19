"""
Shared request rate limiter (slowapi).

A single Limiter instance, imported by both the app factory (to register the
middleware + error handler) and the advisor router (for a tighter per-route
limit). Kept in its own module so those two importers do not create a cycle
through api.main.

Design notes:
  • Keyed by client IP (get_remote_address). There is no user store yet
    (GAP-04), so a stable per-user key is not available; behind a proxy this
    is the proxy's address and should move to X-Forwarded-For once a trusted
    proxy terminates TLS.
  • Storage is in-process (memory://). Redis is a soft dependency here
    (CON-07); routing rate-limit state through it would let a cache outage
    start rejecting traffic. The trade-off is that limits bound one API
    process — a multi-instance deployment needs shared storage to enforce a
    global budget.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

from api.core.config import get_settings

_settings = get_settings()

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[_settings.rate_limit_default],
    storage_uri="memory://",
    enabled=_settings.rate_limit_enabled,
    headers_enabled=True,
)


def advisor_limit() -> str:
    """Per-request lookup so the advisor limit tracks settings, not import time."""
    return get_settings().rate_limit_advisor
