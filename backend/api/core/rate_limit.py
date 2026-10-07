"""
Request rate limiting.

**Replaces slowapi, which did not work.** slowapi 0.1.9 and 0.1.10 both locate a
route's handler by walking `app.routes` for a flat object with an `.endpoint`
attribute. FastAPI 0.141 stopped flattening routers — `include_router()` wraps each
one in `_IncludedRouter` — so nothing matches, the handler resolves to `None`, and
slowapi's own `_should_exempt(None)` returns `True`. Every route in the application
was silently exempt. The limiter was enabled, mounted, and holding a 5/minute budget,
and twelve requests to `/v1/news` all returned 200.

It went unnoticed because `conftest.py` turned rate limiting off for the entire suite
on the grounds that dedicated tests existed. They did not.

Going from 0.1.9 to 0.1.10 does not help: `_find_route_handler` is byte-identical
between the two. The alternative of downgrading FastAPI trades away unrelated fixes,
and patching slowapi would bind us to `_IncludedRouter`, a private name that will
change again. So the ~80 lines below are the whole dependency.

## Design

**Sliding window over a deque of timestamps.** Kept in process memory. That is
correct for one API process, which is what this is today; `rate_limit.py` in
`api/core/` documented the same trade-off. Multiple instances would each enforce the
budget independently, and that is a decision to make when there is more than one.

**The limiter fails open.** If the counter itself raises, the request proceeds. The
alternative — refusing — would let a bug in this file become an outage, and a limiter
that takes the API down when it breaks is a liability rather than a safeguard. Note
this is the opposite of the paywall, which fails closed on purpose: paid data must not
be served to someone we cannot check, whereas a rate limit that stops working only
means the budget is not enforced.

**Exemptions are by path prefix, on an explicit list.** Slowapi's decorator-based
exemptions could not be read off this file at all, which is part of why its failure
was invisible.

**One counter per (limit, client address).** Client address is the key, which is
`X-Forwarded-For`'s first hop when the app is behind a trusted proxy — see
`client_address` for what that assumes.
"""

from __future__ import annotations

import re
import time
from collections import deque
from dataclasses import dataclass
from threading import Lock

from api.core.config import get_settings

# Paths that are never throttled.
#
# /health because an orchestrator that receives 429 there concludes the instance is
# unhealthy and replaces it — so a busy application would be scaled down exactly when
# it needs to scale up. /metrics for the same reason: the scraper is not a user and
# cannot slow down.
EXEMPT_PREFIXES: tuple[str, ...] = ("/health", "/metrics")

_PERIOD = re.compile(r"^\s*(\d+)\s*/\s*(second|minute|hour|day)s?\s*$", re.IGNORECASE)
_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


@dataclass(frozen=True)
class Limit:
    """A parsed budget: how many requests, over what window."""

    count: int
    period: int

    def expires_in(self, remaining_deque: deque) -> int:
        """Seconds until this client can make another request.

        Zero when the window is already empty. When it is not, the wait is until the
        oldest request falls out of the window — counting from the oldest is what makes
        the window slide rather than jump.
        """
        if not remaining_deque:
            return 0
        return max(1, int(self.period - (time.monotonic() - remaining_deque[0])))


def parse_limit(raw: str) -> Limit | None:
    """Parse "120/minute" into a Limit. Returns None for anything unparseable.

    None rather than a permissive default: a malformed budget must not silently
    become "no limit", which is the same class of bug this module was written to
    replace. The caller logs it and falls back to the configured default.
    """
    match = _PERIOD.match(raw or "")
    if not match:
        return None
    # Group 1 is the count, group 2 the unit — "5/minute" is two tokens, not three.
    unit = match.group(2).lower()
    return Limit(count=int(match.group(1)), period=_SECONDS[unit])


# Per-route overrides. A route may only ever be *tighter* than the default —
# enforced in `limit_for_path`.
#
# The values are Settings attribute names, not env var names, because this module
# reads through pydantic. Getting that wrong is silent: getattr on a missing name
# returns the "" default, parse_limit("") returns None, and the override quietly
# does nothing — which is how a limiter can look configured and enforce nothing.
#
# None of these numbers is a measurement. They are starting points, and
# `docs/status.md` records that they have not been measured under real load.
ROUTE_LIMITS: tuple[tuple[str, str], ...] = (
    # Each advisor call fans out to the Claude API, so the cost per request is orders
    # of magnitude above anything else here.
    ("/v1/advisor/chat", "rate_limit_advisor"),
    # 400 sessions of candles, and a wide frame built from them.
    ("/v1/technicals/ohlcv", "rate_limit_heavy"),
    # Up to 1000 trading days of portfolio value, re-read and re-computed.
    ("/v1/portfolio/equity", "rate_limit_heavy"),
    # Up to 2000 instruments per page.
    ("/v1/symbols", "rate_limit_heavy"),
)


def limit_for_path(path: str) -> Limit | None:
    """The budget that applies to `path`, or None if none could be resolved.

    None means "no limit applies", which is different from "no limit is configured".
    Callers must treat it as unlimited rather than as an error.
    """
    settings = get_settings()

    default = parse_limit(settings.rate_limit_default)
    if default is None:
        default = Limit(count=120, period=60)

    for prefix, setting_name in ROUTE_LIMITS:
        if path.startswith(prefix):
            override = parse_limit(getattr(settings, setting_name, ""))
            # Only a genuinely tighter budget overrides. A wider one would let an
            # expensive route buy itself a larger allowance than a cheap one, which
            # is the opposite of the point.
            if override is not None and override.count < default.count:
                return override
    return default


def client_address(request) -> str:
    """Identify the caller for budgeting.

    Prefers `X-Forwarded-For`'s first hop, because behind a reverse proxy every
    request otherwise arrives from the proxy's own address and one client could
    exhaust everyone's budget — or, worse, everyone could share one bucket.

    That header is trivially spoofed unless the proxy overwrites it, so this trusts it
    only because the deployment is same-origin behind a trusted proxy (ADR-0006). A
    deployment that is directly exposed must either strip the header at the edge or
    set `RATE_LIMIT_TRUST_PROXY=false`, which makes this fall back to the socket
    address and accept that every caller then shares a budget.
    """
    settings = get_settings()
    if settings.rate_limit_trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class _Windows:
    """Sliding-window counters, one deque per (limit, client) pair.

    A plain dict rather than a TTL cache: entries are dropped when their window
    empties, which is checked on access. An entry that is never touched again would
    linger, so `_sweep` also runs on a timer inside `_record` — cheap because it only
    walks when something has been touched since the last sweep.
    """

    def __init__(self) -> None:
        self._deques: dict[tuple[int, int, str], deque] = {}
        self._lock = Lock()
        self._last_sweep = time.monotonic()

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < 60:
            return
        self._last_sweep = now
        for key, hits in list(self._deques.items()):
            while hits and hits[0] <= now - key[1]:
                hits.popleft()
            if not hits:
                del self._deques[key]

    def hit(self, limit: Limit, client: str, now: float) -> tuple[bool, int]:
        """Record a request. Returns (allowed, retry_after_seconds)."""
        key = (limit.count, limit.period, client)
        with self._lock:
            self._sweep(now)
            hits = self._deques.get(key)
            if hits is None:
                hits = deque()
                self._deques[key] = hits

            cutoff = now - limit.period
            while hits and hits[0] <= cutoff:
                hits.popleft()

            if len(hits) >= limit.count:
                return False, limit.expires_in(hits)

            hits.append(now)
            return True, 0

    def clear(self) -> None:
        with self._lock:
            self._deques.clear()


_windows = _Windows()


def check_request(path: str, client: str) -> tuple[bool, int, Limit]:
    """Whether `path` may be served to `client`.

    Returns (allowed, retry_after_seconds, limit). `retry_after_seconds` is only
    meaningful when `allowed` is False.
    """
    if any(path.startswith(prefix) for prefix in EXEMPT_PREFIXES):
        return True, 0, Limit(count=0, period=0)

    settings = get_settings()
    if not settings.rate_limit_enabled:
        return True, 0, Limit(count=0, period=0)

    limit = limit_for_path(path)
    # The suite raises the default ceiling rather than switching the limiter off, so
    # the limiter stays on the request path while tests run. Overrides apply to the
    # default only — a route that is tighter than the default is already cheap.
    test_budget = parse_limit(settings.rate_limit_test_budget)
    if test_budget is not None and limit.count < test_budget.count:
        limit = test_budget

    try:
        allowed, retry_after = _windows.hit(limit, client, time.monotonic())
    except Exception:  # noqa: BLE001
        # Fail open. This file must never be the reason the API is down; see the
        # module docstring for why this differs from the paywall's fail-closed.
        return True, 0, limit
    return allowed, retry_after, limit


def reset_windows() -> None:
    """Clear all counters. For tests, and for an operator who needs it mid-incident."""
    _windows.clear()


def advisor_limit() -> str:
    """Kept for callers that want the configured value as written."""
    return get_settings().rate_limit_advisor