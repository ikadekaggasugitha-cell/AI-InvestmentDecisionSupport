"""Valid IDX symbols for advisor tool inputs (Phase 9B security).

The advisor analyses the WHOLE listed board (~960 securities), not the 15
UI-tracked names, so the allow-list is loaded from the `instruments` table and
cached. This is what lets a user ask about any IDX ticker — GOTO, AMRT, a
small-cap — instead of only the tracked handful. Falls back to
tracked_symbols when the DB is unreachable so the tool still guards inputs.
"""

import logging

from api.core.config import get_settings

logger = logging.getLogger(__name__)

_VALID_SYMBOLS_CACHE: set[str] = set()
_VALID_SYMBOLS_AT: float | None = None
_VALID_SYMBOLS_TTL = 1800  # refresh the universe every 30 min
async def _get_valid_symbols() -> set[str]:
    global _VALID_SYMBOLS_CACHE, _VALID_SYMBOLS_AT
    import time

    now = time.monotonic()
    if _VALID_SYMBOLS_CACHE and _VALID_SYMBOLS_AT and now - _VALID_SYMBOLS_AT < _VALID_SYMBOLS_TTL:
        return _VALID_SYMBOLS_CACHE
    try:
        from api.core.db import get_pool

        pool = await get_pool()
        rows = await pool.fetch("SELECT symbol FROM instruments WHERE is_active")
        syms = {r["symbol"].upper() for r in rows}
        if syms:
            _VALID_SYMBOLS_CACHE = syms
            _VALID_SYMBOLS_AT = now
            return syms
    except Exception as exc:  # noqa: BLE001 — degrade to the tracked list, never fail a tool
        logger.debug("advisor: universe load failed, using tracked list — %s", exc)
    return _VALID_SYMBOLS_CACHE or {s.upper() for s in get_settings().tracked_symbols}
