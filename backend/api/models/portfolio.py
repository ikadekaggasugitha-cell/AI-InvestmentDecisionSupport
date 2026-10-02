from typing import Literal
from pydantic import BaseModel, Field


class AllocationWeight(BaseModel):
    symbol: str
    name: str
    weight: float = Field(..., ge=0, le=1, description="Portfolio weight 0–1")
    weightPct: float = Field(..., ge=0, le=100)
    expectedReturn: float      # Annualised expected return %
    currentValue: float        # IDR value at current prices
    lots: int                  # Recommended lot count


class OptimisationMetrics(BaseModel):
    expectedReturn: float      # Annualised portfolio return %
    expectedVolatility: float  # Annualised portfolio volatility %
    sharpeRatio: float
    diversificationRatio: float
    method: Literal["black-litterman", "hrp", "equal-weight"]


class PortfolioOptimisationResponse(BaseModel):
    """
    Returned by GET /v1/portfolio/optimise.
    Provides optimal weights blending LightGBM signal views with CAPM equilibrium.
    """
    weights: list[AllocationWeight]
    metrics: OptimisationMetrics
    blView: dict[str, float]    # Black-Litterman posterior views per symbol
    computedAt: str
    source: Literal["live", "mock"] = "mock"
    disclaimer: str = (
        "Alokasi ini adalah output model kuantitatif — bukan saran investasi OJK. "
        "Keputusan investasi sepenuhnya tanggung jawab pengguna."
    )


class EquityPoint(BaseModel):
    """One session on the equity curve."""
    date: str                      # yyyy-mm-dd
    value: float                   # portfolio value in IDR at that close
    benchmark: float | None = None  # IHSG rebased to the portfolio's starting value
    ret: float | None = None       # day-over-day change, fraction (0.012 = +1.2%)


class EquityCurveResponse(BaseModel):
    """
    Returned by GET /v1/portfolio/equity.

    The realised value of the caller's positions over time, built from actual
    closes times actual lots. `benchmark` is the composite index rebased to the
    portfolio's first value so the two lines are directly comparable — a raw
    index level next to a rupiah total would share an axis but mean nothing.

    `benchmark` is null when the index series could not be fetched. It is
    omitted rather than zero-filled: a benchmark at 0 would draw a line to the
    floor and read as a catastrophic loss.
    """
    points: list[EquityPoint] = []
    days: int = 252
    startValue: float | None = None
    endValue: float | None = None
    totalReturn: float | None = None
    computedAt: str
    source: Literal["live", "mock"] = "mock"
    benchmarkSource: str | None = None
