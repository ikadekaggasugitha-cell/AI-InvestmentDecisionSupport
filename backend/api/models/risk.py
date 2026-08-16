from typing import Literal
from pydantic import BaseModel


class RiskMetrics(BaseModel):
    """
    Matches frontend RiskMetrics interface in src/app/hooks/useRiskMetrics.ts.
    All scores 0–100 unless otherwise noted.
    """
    overallRisk: int
    marketRisk: int
    concentrationRisk: int
    liquidityRisk: int
    currencyRisk: int
    creditRisk: int
    # ── Sign convention ───────────────────────────────────────────────────
    # Losses are NEGATIVE, consistently with dailyPnL and every other monetary
    # field in the API. A caller can therefore sum, compare and threshold risk
    # figures against P&L without special-casing which fields carry an implied
    # minus. The UI takes the absolute value at render time — a risk tile reads
    # "Rp 384.720.000", not "-Rp 384.720.000".
    #
    # The alternative — storing a positive loss magnitude — was the source of a
    # long-standing test failure, because it makes `var95 < 0` false while the
    # field still means a loss.
    var95: float          # IDR at risk at 95% confidence, negative
    cvar95: float         # Conditional VaR / expected shortfall, negative
    volatility: float     # Annualised portfolio volatility %
    maxDrawdown: float    # Peak-to-trough % (negative)
    beta: float           # Portfolio beta vs IHSG
    sharpe: float
    sortino: float
    alpha: float          # Annualised alpha vs IHSG %
    informationRatio: float


class StressTest(BaseModel):
    scenario: str        # Indonesian label
    scenarioEn: str      # English label
    impact: float        # Portfolio return % (negative = loss)
    probability: float   # Estimated probability % over 1 year


class SectorExposureItem(BaseModel):
    sector: str          # Indonesian  e.g. "Keuangan"
    sectorEn: str        # English     e.g. "Financials"
    weight: float        # Portfolio weight %
    benchmark: float     # IHSG sector weight %
    overUnder: float     # Relative over/underweight


class RiskMetricsResponse(BaseModel):
    """Envelope returned by GET /v1/risk/portfolio"""
    risk: RiskMetrics
    stressTests: list[StressTest]
    sectorExposure: list[SectorExposureItem]
    computedAt: str      # ISO timestamp
    source: Literal["live", "mock"] = "mock"
