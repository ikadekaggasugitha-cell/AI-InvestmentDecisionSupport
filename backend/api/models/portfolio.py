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
