import { useState, useEffect } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";
import { signalsResponseSchema, parseOrThrow } from "../config/schemas";
import { AI_RECOMMENDATIONS } from "../data/idxData";
import { SEED_ENRICHMENT } from "../data/seedPhase10";

/* ── Public type ─────────────────────────────────────────────────────────── */

/** Entry and stop loss derived from fractal S/R. Absent when no level qualifies. */
export type TradePlan = {
  entryPrice: number | null;
  stopLoss: number | null;
  /** Negative — % below entry. */
  stopLossPct: number | null;
  stopLossReason: string;
  stopLossReasonEn: string;
  riskRewardRatio: number | null;
};

export type TrendInfo = {
  trend: "uptrend" | "downtrend" | "sideways";
  trendId: string;
  strength: number;
  emaFast: number;
  emaSlow: number;
};

export type SRLevel = {
  type: "support" | "resistance";
  price: number;
  strength: number;
  touches: number;
  method: string;
};

export type GapInfo = {
  type: "gap_up" | "gap_down";
  date: string;
  gapPct: number;
  top: number;
  bottom: number;
  isFilled: boolean;
  fillProbability: number;
  avgFillDays: number | null;
};

export type BrokerActivity = {
  broker: string;
  netLot5d: number;
  netLot20d: number;
};

export type BrokerSummarySnapshot = {
  phase: "accumulation" | "distribution" | "neutral";
  phaseId: string;
  score: number;
  topBuyers: readonly BrokerActivity[];
  topSellers: readonly BrokerActivity[];
  netLot5d: number;
  netLot20d: number;
  consistencyDays: number;
  concentration: number;

  /* ── Volume-flow analysis (method="volume"): populated when the snapshot is
   * derived from OHLCV+volume rather than licensed per-broker flow. Optional so
   * broker-flow snapshots stay valid. ────────────────────────────────────── */
  method?: "broker" | "volume";
  strength?: number;
  obvTrend?: number;
  cmf?: number;
  mfi?: number;
  volumeRatio?: number;
  volumeLevel?: "high" | "normal" | "low";
  signals?: readonly string[];
  signalsEn?: readonly string[];
};

export type AISignal = {
  id: number;
  symbol: string;
  name: string;
  /**
   * Probability band, not a trade instruction. Replaces the former
   * "STRONG BUY" | "BUY" | "HOLD" | "SELL" labels, whose wording read as a
   * buy/sell command and conflicted with OJK rule CMP-01 (GAP-01). Human-facing
   * bilingual wording lives in the i18n layer, keyed off this token.
   */
  probabilityTier: "VERY_HIGH" | "HIGH" | "NEUTRAL" | "LOW";
  uprob: number;
  confidence: number;
  targetPrice: number;
  currentPrice: number;
  upside: number;
  horizon: string;
  horizonEn: string;
  risk: string;
  riskEn: string;
  thesis: string;
  thesisEn: string;
  catalysts: readonly string[];
  catalystsEn: readonly string[];
  modelScore: number;
  analystConsensus: string;
  analystConsensusEn: string;
  shap: readonly { factor: string; factorEn: string; value: number }[];

  /* ── Phase 10 — all optional ────────────────────────────────────────────
   * Seed data predates these fields and the backend omits them whenever the
   * underlying analysis is unavailable. Every consumer must guard rather than
   * assume presence: an unguarded read renders "Rp undefined" on screen.
   */
  tradePlan?: TradePlan | null;
  technicalNote?: string;
  technicalNoteEn?: string;
  trend?: TrendInfo | null;
  supportResistance?: readonly SRLevel[];
  activePatterns?: readonly string[];
  activePatternsEn?: readonly string[];
  openGaps?: readonly GapInfo[];
  brokerSummary?: BrokerSummarySnapshot | null;
};

export interface AISignalsResult {
  signals: AISignal[];
  loading: boolean;
  error: string | null;
  /** ISO timestamp of the last successful fetch */
  lastFetched: string | null;
}

/* ── Seed data (same shape, mutable copy of the const) ──────────────────── */

/**
 * Note the plain annotation rather than `as unknown as`.
 *
 * The previous double cast silenced the compiler entirely: adding a required
 * field to AISignal produced no error here, and the UI rendered `Rp undefined`
 * at runtime instead. Checked against the type, a future required field fails
 * the build — which is where that mistake should surface.
 *
 * Phase 10 enrichment is merged in from the pre-generated seed so the offline
 * demo shows a real trade plan and technical note instead of blanks. Symbols
 * with no seed entry simply keep the base fields, and every consumer guards.
 */
const SEED_SIGNALS: AISignal[] = AI_RECOMMENDATIONS.map((r) => {
  const extra = SEED_ENRICHMENT[r.symbol];
  return extra ? { ...r, ...extra } : { ...r };
});

/* ── Hook ────────────────────────────────────────────────────────────────── */

/**
 * Returns AI signal recommendations.
 *
 * When USE_LIVE_API is false the hook resolves immediately from seed data,
 * adding zero network latency.  When true it fetches from ENDPOINTS.signals
 * (FastAPI /v1/signals) and falls back to seed data on error, so the UI
 * always has something to render.
 *
 * Swap this hook for a WebSocket variant without touching any component.
 */
export function useAISignals(): AISignalsResult {
  const [signals, setSignals]         = useState<AISignal[]>(SEED_SIGNALS);
  const [loading, setLoading]         = useState(USE_LIVE_API);
  const [error, setError]             = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(
    USE_LIVE_API ? null : new Date().toISOString()
  );

  useEffect(() => {
    if (!USE_LIVE_API) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    async function fetchSignals() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(ENDPOINTS.signals, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Validate the core numeric fields before trusting the payload. A
        // malformed response throws here and lands in the seed fallback below,
        // rather than rendering `Rp undefined` on a signal card.
        const parsed = parseOrThrow(signalsResponseSchema, data, "signals");
        const signalList = (Array.isArray(parsed) ? parsed : parsed.signals) as AISignal[];
        if (!cancelled) {
          setSignals(signalList);
          setLastFetched(new Date().toISOString());
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setError(msg);
          setSignals(SEED_SIGNALS);
        }
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(timeout);
      }
    }

    fetchSignals();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);

  return { signals, loading, error, lastFetched };
}
