"""
Symbol metadata, display names, and the old seed positions.

**PORTFOLIO_LOTS is not a portfolio.** It is no longer read by any request path.
Positions live in `portfolios.lots_json` and are read through
`api.services.portfolio_access.load_lots` (ADR-0005). What is left here is
`DISPLAY_NAMES`, which the optimiser legitimately needs as a candidate universe —
a proposal about what to hold next is not a claim about what is held.

The constant is kept rather than deleted for one reason: a test fixture and a
`--seed` path for a fresh install still refer to it, and deleting it would break
both without making anything more correct. It is a starting point, not a fact.

These three constants used to live in four modules and had already drifted apart:

  - ``market_service._PORTFOLIO_LOTS``   10 symbols, drove the dashboard total
  - ``risk_worker.PORTFOLIO_HOLDINGS``    7 symbols, different lot counts
  - ``portfolio_optimizer.IDX_NAMES``    10 symbols — but GOTO instead of ICBP,
                                         so the optimiser dropped ICBP from the
                                         price frame it optimises over, and the
                                         risk worker measured a different
                                         portfolio from the one on screen.
  - ``PORTFOLIO_CAPITAL_IDR`` / the ``12_480_000_000.0`` literal in risk_worker
    and ``_portfolio_prev_close`` in market_service

The numbers below are the ones market_service used, because those are the ones
that already drive the portfolio value the user sees. Aligning the others onto
them changes no displayed figure; it only stops the risk, optimisation and
dashboard paths from disagreeing about what the portfolio is.

No imports and no I/O: this module is read by the API process, the Celery
workers and the ML inference layer, and it must stay importable from all three
without pulling in pandas, asyncpg or settings.
"""

# symbol → lots. 1 lot = 100 shares on IDX.
#
# Seed positions for a new install, not a default. Nothing serves this to a user.
PORTFOLIO_LOTS: dict[str, int] = {
    "BBCA": 2000,
    "BBRI": 3500,
    "BMRI": 3000,
    "TLKM": 5000,
    "ASII": 2800,
    "BREN": 1200,
    "ADRO": 4000,
    "UNVR": 2200,
    "ICBP": 1500,
    "ANTM": 6000,
}

# symbol → display name.
#
# Deliberately a superset of PORTFOLIO_LOTS: the optimiser renders a name per
# column of the price frame, and that frame is built from a universe that can
# legitimately contain a symbol the operator does not currently hold. GOTO is
# the one such symbol today.
DISPLAY_NAMES: dict[str, str] = {
    "BBCA": "Bank Central Asia",
    "BBRI": "Bank Rakyat Indonesia",
    "BMRI": "Bank Mandiri",
    "TLKM": "Telkom Indonesia",
    "ASII": "Astra International",
    "ADRO": "Adaro Energy Indonesia",
    "BREN": "Barito Renewables Energy",
    "GOTO": "GoTo Gojek Tokopedia",
    "ANTM": "Aneka Tambang",
    "UNVR": "Unilever Indonesia",
    "ICBP": "Indofood CBP Sukses",
}

# Nominal portfolio value in IDR. A seeded constant, not a measured balance —
# the optimiser uses it to convert weights into lots, and the risk paths use it
# as a fallback when the live snapshot has not been published yet.
CAPITAL_IDR: float = 12_480_000_000.0
