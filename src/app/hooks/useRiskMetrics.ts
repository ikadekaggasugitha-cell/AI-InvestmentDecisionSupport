import { useState, useEffect } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";
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
}

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

  useEffect(() => {
    if (!USE_LIVE_API) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    async function fetchRisk() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(ENDPOINTS.riskMetrics, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled && data) {
          if (data.risk) setRisk(data.risk);
          if (Array.isArray(data.stressTests)) setStressTests(data.stressTests);
          if (Array.isArray(data.sectorExposure)) setSectorExposure(data.sectorExposure);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(timeout);
      }
    }

    fetchRisk();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);

  return { risk, stressTests, sectorExposure, loading, error };
}
