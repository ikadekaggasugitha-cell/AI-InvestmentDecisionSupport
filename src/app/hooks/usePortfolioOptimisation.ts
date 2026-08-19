import { useState, useEffect } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";

/**
 * Black-Litterman + HRP allocation weights from the backend.
 *
 * Distinct from `usePortfolio`, which is the user's own holdings ledger. This
 * asks a different question: given the model's views, what *should* the weights
 * be? The endpoint has existed since Phase 6 with no caller.
 */

export interface AllocationWeight {
  symbol: string;
  name: string;
  weight: number;      // 0–1
  weightPct: number;   // 0–100
  expectedReturn: number;
  currentValue: number;
  lots: number;
}

export interface OptimisationMetrics {
  expectedReturn: number;
  expectedVolatility: number;
  sharpeRatio: number;
  diversificationRatio: number;
  method: "black-litterman" | "hrp" | "equal-weight";
}

export interface PortfolioOptimisationResult {
  weights: AllocationWeight[];
  metrics: OptimisationMetrics | null;
  /** "live" once computed from real inputs; "mock" while seeded. */
  source: "live" | "mock" | null;
  disclaimer: string;
  loading: boolean;
  error: string | null;
}

const EMPTY: PortfolioOptimisationResult = {
  weights: [],
  metrics: null,
  source: null,
  disclaimer: "",
  loading: false,
  error: null,
};

export function usePortfolioOptimisation(uid = "default"): PortfolioOptimisationResult {
  const [state, setState] = useState<PortfolioOptimisationResult>(EMPTY);

  useEffect(() => {
    if (!USE_LIVE_API) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await apiFetch(ENDPOINTS.portfolio(uid), { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        setState({
          weights: Array.isArray(data?.weights) ? data.weights : [],
          metrics: data?.metrics ?? null,
          source: data?.source ?? null,
          disclaimer: data?.disclaimer ?? "",
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          ...EMPTY,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [uid]);

  return state;
}
