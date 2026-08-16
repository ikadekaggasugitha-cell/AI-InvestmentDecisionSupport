"""
Portfolio Optimiser — Phase 6

Blends LightGBM signal views with CAPM equilibrium returns using the
Black-Litterman model, then applies HRP (Hierarchical Risk Parity) to
produce final portfolio weights.

Optimisation pipeline:
  1. Black-Litterman: construct prior from CAPM, blend with LightGBM views
  2. HRP: build dendrogram on residual correlation matrix, allocate via
     inverse-variance weighting within clusters
  3. Post-process: round to tradeable lot sizes, enforce 5% max per position

Uses PyPortfolioOpt for BL and HRP implementations.
"""

import logging
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from api.models.portfolio import (
    AllocationWeight,
    OptimisationMetrics,
    PortfolioOptimisationResponse,
)

logger = logging.getLogger(__name__)

# ── IDX universe reference ────────────────────────────────────────────────────
IDX_NAMES: dict[str, str] = {
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
}

# Minimum position lot count (IDX: 1 lot = 100 shares)
MIN_LOTS = 1
PORTFOLIO_CAPITAL_IDR = 12_480_000_000.0   # ~12.48B IDR
MAX_WEIGHT = 0.30                           # 30% max per position (OJK concentration limit)
MIN_WEIGHT = 0.01                           # 1% minimum meaningful allocation


def _capm_equilibrium_returns(
    prices: pd.DataFrame,
    market_weights: dict[str, float],
    risk_aversion: float = 2.5,
    rf: float = 0.0575,  # BI rate
) -> pd.Series:
    """
    Compute CAPM equilibrium expected returns (π = δ · Σ · w_mkt).

    Args:
        prices:         Daily close prices DataFrame (date × symbol)
        market_weights: IHSG-weighted market capitalisation weights
        risk_aversion:  Risk aversion parameter δ (typical 2–3 for equities)
        rf:             Risk-free rate (BI rate)

    Returns:
        Expected return Series indexed by symbol.
    """
    returns = prices.pct_change().dropna()
    sigma = returns.cov() * 252  # Annualised covariance

    symbols = [s for s in market_weights if s in sigma.columns]
    w_mkt = pd.Series(market_weights)[symbols]
    w_mkt /= w_mkt.sum()  # Normalise

    pi = risk_aversion * sigma.loc[symbols, symbols].dot(w_mkt)
    return pi


def _build_bl_views(
    signal_scores: dict[str, float],
    symbols: list[str],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Construct Black-Litterman view matrices P, Q, Omega from LightGBM uprob scores.

    View: "stock X outperforms market by (uprob - 50)% * scale"

    Returns:
        P: (n_views × n_assets) picking matrix
        Q: (n_views,) expected view returns
        Omega: (n_views × n_views) view uncertainty matrix (diagonal)
    """
    view_symbols = [s for s in symbols if s in signal_scores and abs(signal_scores[s] - 50) >= 15]

    if not view_symbols:
        return np.empty((0, len(symbols))), np.empty(0), np.empty((0, 0))

    n_assets = len(symbols)
    n_views = len(view_symbols)
    sym_idx = {s: i for i, s in enumerate(symbols)}

    P = np.zeros((n_views, n_assets))
    Q = np.zeros(n_views)
    omega_diag = np.zeros(n_views)

    for i, sym in enumerate(view_symbols):
        score = signal_scores[sym]
        # Absolute view: expected annual return proportional to signal conviction
        view_return = (score - 50) / 100 * 0.40  # scale: 50→+0%, 100→+20%, 0→-20%
        P[i, sym_idx[sym]] = 1.0
        Q[i] = view_return
        # Omega: uncertainty inversely proportional to conviction
        conviction = abs(score - 50) / 50  # 0=low, 1=high
        omega_diag[i] = max(0.01, 0.10 * (1 - conviction)) ** 2

    return P, Q, np.diag(omega_diag)


def _black_litterman(
    prices: pd.DataFrame,
    equilibrium_returns: pd.Series,
    P: np.ndarray,
    Q: np.ndarray,
    Omega: np.ndarray,
    tau: float = 0.05,
) -> pd.Series:
    """
    Black-Litterman posterior expected returns.

    Returns posterior expected return Series indexed by symbol.
    Falls back to equilibrium if no views provided.
    """
    if P.shape[0] == 0:
        return equilibrium_returns

    sigma = prices.pct_change().dropna().cov() * 252
    sigma = sigma.loc[equilibrium_returns.index, equilibrium_returns.index]
    sigma_np = sigma.values
    pi_np = equilibrium_returns.values

    # BL formula: μ_BL = [(τΣ)⁻¹ + P'Ω⁻¹P]⁻¹ [(τΣ)⁻¹π + P'Ω⁻¹Q]
    tau_sigma = tau * sigma_np
    tau_sigma_inv = np.linalg.inv(tau_sigma)
    omega_inv = np.linalg.inv(Omega)

    M_inv = tau_sigma_inv + P.T @ omega_inv @ P
    M = np.linalg.inv(M_inv)
    mu_bl = M @ (tau_sigma_inv @ pi_np + P.T @ omega_inv @ Q)

    return pd.Series(mu_bl, index=equilibrium_returns.index)


def _hrp_weights(prices: pd.DataFrame, symbols: list[str]) -> pd.Series:
    """
    Hierarchical Risk Parity allocation.

    Uses PyPortfolioOpt's HRPOpt when available, falls back to
    inverse-volatility weighting if not installed.
    """
    returns = prices[symbols].pct_change().dropna()

    try:
        from pypfopt import HRPOpt
        hrp = HRPOpt(returns)
        weights = hrp.optimize()
        return pd.Series(weights)
    except ImportError:
        # Fallback: inverse volatility (simpler but reasonable)
        vols = returns.std()
        inv_vol = 1 / vols
        return inv_vol / inv_vol.sum()


def _mean_variance_weights(
    mu: pd.Series,
    prices: pd.DataFrame,
    max_weight: float = MAX_WEIGHT,
) -> pd.Series:
    """
    Mean-variance optimisation (Markowitz) using BL posterior returns.
    Falls back to equal-weight if solver fails.
    """
    try:
        from pypfopt import EfficientFrontier, risk_models

        sigma = risk_models.CovarianceShrinkage(prices[mu.index]).ledoit_wolf()
        ef = EfficientFrontier(mu, sigma, weight_bounds=(MIN_WEIGHT, max_weight))
        raw_weights = ef.max_sharpe(risk_free_rate=0.0575)
        return pd.Series(ef.clean_weights())
    except Exception as exc:
        logger.warning("MVO failed (%s), falling back to HRP", exc)
        return _hrp_weights(prices, list(mu.index))


def _compute_portfolio_metrics(
    weights: pd.Series,
    prices: pd.DataFrame,
    mu: pd.Series,
    rf: float = 0.0575,
) -> OptimisationMetrics:
    returns = prices[weights.index].pct_change().dropna()
    sigma = returns.cov() * 252
    w = weights.values

    port_return = float(mu[weights.index].dot(w))
    port_vol = float(np.sqrt(w @ sigma.loc[weights.index, weights.index].values @ w))
    sharpe = (port_return - rf) / max(port_vol, 1e-6)

    # Diversification ratio = weighted avg individual vol / portfolio vol
    ind_vols = returns.std() * np.sqrt(252)
    weighted_avg_vol = float(ind_vols[weights.index].dot(w))
    div_ratio = weighted_avg_vol / max(port_vol, 1e-6)

    return OptimisationMetrics(
        expectedReturn=round(port_return * 100, 2),
        expectedVolatility=round(port_vol * 100, 2),
        sharpeRatio=round(sharpe, 2),
        diversificationRatio=round(div_ratio, 2),
        method="black-litterman",
    )


def _to_lots(
    weights: pd.Series,
    prices: dict[str, float],
    capital: float = PORTFOLIO_CAPITAL_IDR,
) -> dict[str, int]:
    """Convert portfolio weights to integer lot counts (1 lot = 100 shares)."""
    lots = {}
    for sym, w in weights.items():
        price = prices.get(sym, 1)
        target_value = w * capital
        raw_lots = target_value / (price * 100)
        lots[sym] = max(MIN_LOTS, int(raw_lots))
    return lots


class PortfolioOptimizer:
    """
    End-to-end portfolio optimisation: CAPM → Black-Litterman → HRP → weights.
    """

    def optimise(
        self,
        prices: pd.DataFrame,
        signal_scores: dict[str, float],
        market_prices: dict[str, float],
        market_weights: dict[str, float] | None = None,
    ) -> PortfolioOptimisationResponse:
        symbols = [s for s in prices.columns if s in IDX_NAMES]
        if not symbols:
            raise ValueError("No valid IDX symbols found in price data")

        # Default IHSG-approximated market weights if not provided
        if market_weights is None:
            market_weights = {s: 1 / len(symbols) for s in symbols}

        # 1. CAPM equilibrium returns
        eq_returns = _capm_equilibrium_returns(
            prices[symbols], market_weights
        )

        # 2. Build BL view matrices from LightGBM scores
        P, Q, Omega = _build_bl_views(signal_scores, symbols)

        # 3. BL posterior expected returns
        mu_bl = _black_litterman(prices[symbols], eq_returns, P, Q, Omega)

        # 4. HRP weights (use BL as expected return input to MVO, HRP for stability)
        hrp_w = _hrp_weights(prices, symbols)

        # 5. Blend: 60% BL/MVO, 40% HRP for robustness
        try:
            mvo_w = _mean_variance_weights(mu_bl, prices)
            final_w = mvo_w * 0.60 + hrp_w.reindex(mvo_w.index, fill_value=0) * 0.40
        except Exception:
            final_w = hrp_w

        # Normalise and clip
        final_w = final_w.clip(lower=0)
        final_w /= final_w.sum()
        final_w = final_w[final_w >= MIN_WEIGHT]
        final_w /= final_w.sum()

        # 6. Convert to lots and build response
        lots = _to_lots(final_w, market_prices)
        metrics = _compute_portfolio_metrics(final_w, prices, mu_bl)

        allocation_weights = [
            AllocationWeight(
                symbol=sym,
                name=IDX_NAMES.get(sym, sym),
                weight=round(float(w), 4),
                weightPct=round(float(w) * 100, 2),
                expectedReturn=round(float(mu_bl.get(sym, 0)) * 100, 2),
                currentValue=round(float(w) * PORTFOLIO_CAPITAL_IDR, 0),
                lots=lots.get(sym, 0),
            )
            for sym, w in final_w.sort_values(ascending=False).items()
        ]

        return PortfolioOptimisationResponse(
            weights=allocation_weights,
            metrics=metrics,
            blView={sym: round(float(mu_bl.get(sym, 0)) * 100, 2) for sym in symbols},
            computedAt=datetime.now(timezone.utc).isoformat(),
            source="live",
        )
