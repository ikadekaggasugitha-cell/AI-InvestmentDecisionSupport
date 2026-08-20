import { useState, useEffect } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";
import { portfolioResponseSchema, parseOrThrow } from "../config/schemas";

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

/** How often the live allocation is re-polled, in ms. Heavier than the other
 * endpoints (Black-Litterman + HRP), so polled less aggressively. */
const REFRESH_MS = 120_000;

export function usePortfolioOptimisation(uid = "default"): PortfolioOptimisationResult {
  const [state, setState] = useState<PortfolioOptimisationResult>(EMPTY);

  useEffect(() => {
    if (!USE_LIVE_API) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;

    async function load(isFirst: boolean) {
      // Only the first load shows the spinner; a background refresh keeps the
      // current allocation on screen rather than flashing an empty panel.
      if (isFirst) setState((s) => ({ ...s, loading: true, error: null }));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await apiFetch(ENDPOINTS.portfolio(uid), { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        // Validate the weights and metrics before showing an allocation the
        // user might act on. A malformed payload throws into the catch below
        // and the view shows the empty/error state, not a broken weight.
        const parsed = parseOrThrow(portfolioResponseSchema, data, "portfolio");
        setState({
          weights: parsed.weights as AllocationWeight[],
          metrics: (parsed.metrics ?? null) as OptimisationMetrics | null,
          source: parsed.source ?? null,
          disclaimer: parsed.disclaimer ?? "",
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Keep the last good allocation if we have one; only fall to the empty
        // error state when nothing has loaded yet. The next poll recovers.
        setState((prev) =>
          prev.weights.length
            ? { ...prev, loading: false, error: err instanceof Error ? err.message : "Unknown error" }
            : { ...EMPTY, error: err instanceof Error ? err.message : "Unknown error" },
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    load(true);
    const interval = setInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [uid]);

  return state;
}
