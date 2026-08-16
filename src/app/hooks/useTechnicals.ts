import { useState, useEffect } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS } from "../config/api";
import { SEED_ENRICHMENT } from "../data/seedPhase10";
import type { GapInfo, SRLevel, TrendInfo } from "./useAISignals";

/* ── Public types ────────────────────────────────────────────────────────── */

export type OHLCVCandle = {
  /** `yyyy-mm-dd` — the format Lightweight Charts expects for a daily series. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CandlestickPattern = {
  pattern: string;
  patternId: string;
  date: string;
  significance: "high" | "medium" | "low";
  signal: number;
};

export interface TechnicalsResult {
  ohlcv: OHLCVCandle[];
  trend: TrendInfo | null;
  supportResistance: SRLevel[];
  patterns: CandlestickPattern[];
  gaps: GapInfo[];
  loading: boolean;
  error: string | null;
}

const EMPTY: TechnicalsResult = {
  ohlcv: [],
  trend: null,
  supportResistance: [],
  patterns: [],
  gaps: [],
  loading: false,
  error: null,
};

/* ── Hook ────────────────────────────────────────────────────────────────── */

/**
 * Fetches price action and candles for one symbol.
 *
 * Pass `enabled: false` to skip the request entirely — the AI Advisor cards
 * only need this once a card is expanded, and firing one request per collapsed
 * card would mean a dozen round trips nobody reads.
 *
 * When USE_LIVE_API is false this serves the pre-generated seed in
 * `data/seedPhase10.ts` rather than computing levels in the browser. That seed
 * comes from the same backend generators the API uses, so the candles, the S/R
 * levels and the stop loss all describe one consistent series. Symbols outside
 * the seed resolve to empty and the panels render their unavailable state.
 */
export function useTechnicals(
  symbol: string,
  days = 120,
  enabled = true,
): TechnicalsResult {
  const [state, setState] = useState<TechnicalsResult>(EMPTY);

  useEffect(() => {
    if (!enabled || !symbol) {
      setState(EMPTY);
      return;
    }

    if (!USE_LIVE_API) {
      const seed = SEED_ENRICHMENT[symbol];
      if (!seed) {
        setState(EMPTY);
        return;
      }

      // Levels resolve immediately; candles arrive with the split chunk, in
      // step with the lazily-loaded chart that consumes them.
      const base: TechnicalsResult = {
        ohlcv: [],
        trend: seed.trend,
        supportResistance: seed.supportResistance,
        patterns: [],
        gaps: seed.openGaps,
        loading: true,
        error: null,
      };
      setState(base);

      let stale = false;
      import("../data/seedOhlcv")
        .then(({ SEED_OHLCV }) => {
          if (stale) return;
          setState({
            ...base,
            ohlcv: (SEED_OHLCV[symbol] ?? []).slice(-days),
            loading: false,
          });
        })
        .catch(() => {
          if (!stale) setState({ ...base, loading: false });
        });

      return () => {
        stale = true;
      };
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const [taRes, ohlcvRes] = await Promise.all([
          fetch(ENDPOINTS.technicals(symbol), { signal: controller.signal }),
          fetch(ENDPOINTS.ohlcv(symbol, days), { signal: controller.signal }),
        ]);
        if (!taRes.ok) throw new Error(`technicals HTTP ${taRes.status}`);
        if (!ohlcvRes.ok) throw new Error(`ohlcv HTTP ${ohlcvRes.status}`);

        const ta = await taRes.json();
        const candles = await ohlcvRes.json();

        if (cancelled) return;
        setState({
          ohlcv: Array.isArray(candles?.candles) ? candles.candles : [],
          trend: ta?.trend ?? null,
          supportResistance: Array.isArray(ta?.supportResistance) ? ta.supportResistance : [],
          patterns: Array.isArray(ta?.patterns) ? ta.patterns : [],
          gaps: Array.isArray(ta?.gaps) ? ta.gaps : [],
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
  }, [symbol, days, enabled]);

  return state;
}
