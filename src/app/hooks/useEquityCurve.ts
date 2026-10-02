import { useCallback, useEffect, useState } from "react";

import { ENDPOINTS, FETCH_TIMEOUT_MS, USE_LIVE_API, apiFetch } from "../config/api";

/**
 * Realised portfolio value over time, from GET /v1/portfolio/equity.
 *
 * The Portfolio page previously drew `PORTFOLIO_HISTORY`, a bundled 12-month
 * sample, with no provenance marker — a chart of a portfolio history that never
 * happened, beside a live allocation table.
 *
 * Degradation mirrors the backend contract: when there is not enough price
 * history the server returns `source: "mock"` with an empty `points` list, and
 * the view shows an empty state. This hook deliberately does not substitute the
 * sample curve as a fallback — that would reintroduce exactly the fiction the
 * endpoint removed, and a viewer could not tell which curve they were looking
 * at.
 */

export interface EquityPoint {
  /** yyyy-mm-dd */
  date: string;
  /** Portfolio value in IDR at that close. */
  value: number;
  /**
   * IHSG rebased to the portfolio's first value so both lines share a scale.
   * null for sessions where the index level was unavailable — the server omits
   * it rather than zero-filling, because a zero draws a line to the floor and
   * reads as a catastrophic loss.
   */
  benchmark: number | null;
  /** Day-over-day change as a fraction. null on the first point. */
  ret: number | null;
}

export interface EquityCurveResult {
  points: EquityPoint[];
  loading: boolean;
  error: string | null;
  isLive: boolean;
  startValue: number | null;
  endValue: number | null;
  totalReturn: number | null;
  benchmarkSource: string | null;
  refetch: () => void;
}

const EMPTY: EquityCurveResult = {
  points: [],
  loading: false,
  error: null,
  isLive: false,
  startValue: null,
  endValue: null,
  totalReturn: null,
  benchmarkSource: null,
  refetch: () => {},
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Keep only points that carry a usable value.
 *
 * The backend already validates the shape, but this mirrors the other hooks'
 * tolerance: one malformed row must not blank the whole chart. A point with a
 * missing benchmark is kept, with the benchmark omitted from the series rather
 * than zeroed.
 */
function parsePoints(raw: unknown): EquityPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: EquityPoint[] = [];
  for (const row of raw as Record<string, unknown>[]) {
    if (!row || typeof row.date !== "string" || !isFiniteNumber(row.value)) continue;
    out.push({
      date: row.date,
      value: row.value,
      benchmark: isFiniteNumber(row.benchmark) ? row.benchmark : null,
      ret: isFiniteNumber(row.ret) ? row.ret : null,
    });
  }
  return out;
}

export function useEquityCurve(days = 252): EquityCurveResult {
  const [state, setState] = useState<EquityCurveResult>({ ...EMPTY, loading: USE_LIVE_API });
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    // Offline build: no endpoint, and no sample curve to stand in for it. The
    // view renders its empty state rather than a chart of invented history.
    if (!USE_LIVE_API) {
      setState({ ...EMPTY, loading: false });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    (async () => {
      try {
        const res = await apiFetch(ENDPOINTS.portfolioEquity(days), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const points = parsePoints(data?.points);
        setState({
          points,
          loading: false,
          error: null,
          isLive: data?.source === "live" && points.length > 0,
          startValue: isFiniteNumber(data?.startValue) ? data.startValue : null,
          endValue: isFiniteNumber(data?.endValue) ? data.endValue : null,
          totalReturn: isFiniteNumber(data?.totalReturn) ? data.totalReturn : null,
          benchmarkSource: typeof data?.benchmarkSource === "string" ? data.benchmarkSource : null,
          refetch,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          ...EMPTY,
          refetch,
          // A failed fetch and an empty-but-successful response are different
          // things: one is a problem, the other means there is not enough price
          // history yet. Reporting them identically would hide an outage behind
          // a "no history yet" message.
          error: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [days, tick, refetch]);

  return state;
}
