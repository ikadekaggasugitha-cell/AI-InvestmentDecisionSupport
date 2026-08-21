import { useState, useEffect, useCallback } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";
import { riskResponseSchema, parseOrThrow } from "../config/schemas";
import { RISK_DATA, STRESS_TESTS, SECTOR_EXPOSURE } from "../data/idxData";

/* ── Public types ────────────────────────────────────────────────────────── */

export interface RiskMetrics {
  overallRisk: number;
  marketRisk: number;
  concentrationRisk: number;
  liquidityRisk: number;
  currencyRisk: number;
  creditRisk: number;
  var95: number;
  cvar95: number;
  volatility: number;
  maxDrawdown: number;
  beta: number;
  sharpe: number;
  sortino: number;
  alpha: number;
  informationRatio: number;
}

export interface StressTest {
  scenario: string;
  scenarioEn: string;
  impact: number;
  probability: number;
}

export interface SectorExposureItem {
  sector: string;
  sectorEn: string;
  weight: number;
  benchmark: number;
  overUnder: number;
}

export interface RiskMetricsResult {
  risk: RiskMetrics;
  stressTests: StressTest[];
  sectorExposure: SectorExposureItem[];
  loading: boolean;
  error: string | null;
  /** True when the metrics came from the live backend, false for seed. */
  isLive: boolean;
  /** Trigger an immediate re-fetch (manual "Refresh" button). */
  refetch: () => void;
}

/** How often live risk metrics are re-polled, in ms. */
const REFRESH_MS = 60_000;

/* ── Seed data ───────────────────────────────────────────────────────────── */

const SEED_RISK: RiskMetrics    = { ...RISK_DATA };
const SEED_STRESS: StressTest[] = (STRESS_TESTS as unknown as StressTest[]).map((s) => ({ ...s }));
const SEED_EXPOSURE: SectorExposureItem[] = (SECTOR_EXPOSURE as unknown as SectorExposureItem[]).map((s) => ({ ...s }));

/* ── Hook ────────────────────────────────────────────────────────────────── */

/**
 * Returns portfolio risk metrics, stress tests, and sector exposure data.
 *
 * When USE_LIVE_API is false the hook resolves immediately from seed data.
 * When true it fetches from ENDPOINTS.riskMetrics (FastAPI /v1/risk/portfolio)
 * and falls back to seed data on error.
 *
 * Expected API response shape:
 *   { risk: RiskMetrics; stressTests: StressTest[]; sectorExposure: SectorExposureItem[] }
 */
export function useRiskMetrics(): RiskMetricsResult {
  const [risk, setRisk]                   = useState<RiskMetrics>(SEED_RISK);
  const [stressTests, setStressTests]     = useState<StressTest[]>(SEED_STRESS);
  const [sectorExposure, setSectorExposure] = useState<SectorExposureItem[]>(SEED_EXPOSURE);
  const [loading, setLoading]             = useState(USE_LIVE_API);
  const [error, setError]                 = useState<string | null>(null);
  const [isLive, setIsLive]               = useState(false);
  const [refreshTick, setRefreshTick]     = useState(0);
  const refetch = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!USE_LIVE_API) return;

    let cancelled = false;

    async function fetchRisk(isFirst: boolean) {
      if (isFirst) setLoading(true);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await apiFetch(ENDPOINTS.riskMetrics, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Validate before use: a malformed metric would otherwise render as
        // `undefined` in the risk tiles. On failure this throws and the seed
        // values already in state stand.
        const parsed = parseOrThrow(riskResponseSchema, data, "risk");
        if (!cancelled) {
          setRisk(parsed.risk as RiskMetrics);
          setStressTests(parsed.stressTests as StressTest[]);
          setSectorExposure(parsed.sectorExposure as SectorExposureItem[]);
          setIsLive(true);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setError(msg);
          setIsLive(false);
          // Seed values already in state stand — the view renders them with an
          // offline badge instead of a blank error page, and the next poll
          // recovers once the backend is reachable again.
        }
      } finally {
        if (!cancelled && isFirst) setLoading(false);
        clearTimeout(timeout);
      }
    }

    fetchRisk(true);
    const interval = setInterval(() => fetchRisk(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // refreshTick bump forces an immediate re-fetch for the manual Refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  return { risk, stressTests, sectorExposure, loading, error, isLive, refetch };
}
