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

    `source` distinguishes "mock" (a seed answer, price history unavailable) from
    "empty" (this portfolio holds nothing, so there is no history to have). Those
    were one value until positions became per-account: an empty portfolio and a
    broken price query both returned "mock", which told the caller nothing about
    whether anything had been measured.
    """
    points: list[EquityPoint] = []
    days: int = 252
    startValue: float | None = None
    endValue: float | None = None
    totalReturn: float | None = None
    computedAt: str
    source: Literal["live", "mock", "empty"] = "mock"
    benchmarkSource: str | None = None


class PositionInput(BaseModel):
    """One position as the client states it.

    `lots` is a whole number of 1-lot units and is required: a position with no
    lot count is not a position. `avgPrice` is optional and stays null when the
    person does not know it, which is a real state — a cost basis substituted from
    today's close would make every unrealised P&L figure wrong while looking
    correct.
    """
    symbol: str = Field(
        ...,
        min_length=1,
        max_length=10,
        description="IDX ticker, e.g. BBCA",
        examples=["BBCA"],
    )
    lots: int = Field(..., ge=1, le=10_000_000, description="1 lot = 100 shares")
    avgPrice: float | None = Field(
        None, gt=0, le=1_000_000_000, description="Purchase price per share, IDR"
    )


class PositionOutput(BaseModel):
    symbol: str
    lots: int
    avgPrice: float | None = None
    # The lot count times 100, so a client computing market value does not have to
    # remember the IDX lot convention and get it wrong by a factor of 100.
    shares: int


class PositionsResponse(BaseModel):
    positions: list[PositionOutput] = []
    computedAt: str
    # Null on a portfolio with no positions, and deliberately not 0: a cost basis
    # of zero would mean "this cost nothing".
    totalCostBasis: float | None = None


class PositionsUpdate(BaseModel):
    """A whole-portfolio replace.

    Replace rather than a delta because the client's screen is the authority on
    what the portfolio now holds. A position deleted there must disappear here,
    and an additive API cannot express a deletion — it would leave the row behind
    and the two would disagree until someone noticed.
    """
    positions: list[PositionInput] = Field(..., max_length=500)
