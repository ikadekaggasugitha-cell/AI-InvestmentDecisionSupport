import { useState, useEffect } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";
import { SEED_ENRICHMENT } from "../data/seedPhase10";
import type { BrokerSummarySnapshot } from "./useAISignals";

/* ── Public types ────────────────────────────────────────────────────────── */

export type BrokerRow = {
  brokerCode: string;
  buyLot: number;
  sellLot: number;
  buyVal: number;
  sellVal: number;
  netLot: number;
  netVal: number;
  avgBuyPrice: number;
  avgSellPrice: number;
};

export type BrokerSummaryDay = {
  date: string;
  netLot: number;
  netVal: number;
  topBuyer: string;
  topSeller: string;
  /** Volume-flow history (source="volume"): per-day accumulation score. */
  score?: number;
  phase?: "accumulation" | "distribution" | "neutral";
  volume?: number;
  close?: number;
};

export interface BrokerSummaryResult {
  snapshot: BrokerSummarySnapshot | null;
  brokers: BrokerRow[];
  history: BrokerSummaryDay[];
  /**
   * "mock" means the broker codes and lots are simulated.
   *
   * The codes name real Indonesian securities firms, so the UI must be able to
   * label simulated flow as such. Presenting invented activity as observed
   * would misrepresent those firms' actual trading.
   */
  source: "live" | "mock" | "volume" | "volume+foreign" | "foreign" | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: BrokerSummaryResult = {
  snapshot: null,
  brokers: [],
  history: [],
  source: null,
  loading: false,
  error: null,
};

/* ── Hook ────────────────────────────────────────────────────────────────── */

/**
 * Fetches broker summary and net-lot history for one symbol.
 *
 * Pass `enabled: false` to skip the request — only expanded cards need it.
 */
export function useBrokerSummary(
  symbol: string,
  historyDays = 20,
  enabled = true,
): BrokerSummaryResult {
  const [state, setState] = useState<BrokerSummaryResult>(EMPTY);

  useEffect(() => {
    if (!enabled || !symbol) {
      setState(EMPTY);
      return;
    }

    if (!USE_LIVE_API) {
      const seed = SEED_ENRICHMENT[symbol];
      // `source: "mock"` is what drives the simulated-data notice in
      // BrokerSummaryPanel. Seed flow must never render unlabelled.
      setState(
        seed
          ? { ...EMPTY, snapshot: seed.brokerSummary, source: "mock" }
          : EMPTY,
      );
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const [summaryRes, historyRes] = await Promise.all([
          apiFetch(ENDPOINTS.broksum(symbol), { signal: controller.signal }),
          apiFetch(ENDPOINTS.broksumHistory(symbol, historyDays), { signal: controller.signal }),
        ]);
        if (!summaryRes.ok) throw new Error(`broksum HTTP ${summaryRes.status}`);
        if (!historyRes.ok) throw new Error(`broksum history HTTP ${historyRes.status}`);

        const summary = await summaryRes.json();
        const history = await historyRes.json();

        if (cancelled) return;
        setState({
          snapshot: summary?.snapshot ?? null,
          brokers: Array.isArray(summary?.brokers) ? summary.brokers : [],
          history: Array.isArray(history?.history) ? history.history : [],
          source: summary?.source ?? null,
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
  }, [symbol, historyDays, enabled]);

  return state;
}
