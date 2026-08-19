import { useState, useEffect } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";

/* ── Public types ────────────────────────────────────────────────────────── */

export type AccumulationBadgeData = {
  symbol: string;
  phase: "accumulation" | "distribution" | "neutral";
  phaseId: string;
  score: number;
  strength: number;
  consistencyDays: number;
};

export interface AccumulationMapResult {
  /** symbol → accumulation read. Empty until the batch resolves. */
  map: Map<string, AccumulationBadgeData>;
  loading: boolean;
  error: string | null;
}

/**
 * One request for the accumulation of a whole list of symbols.
 *
 * The MarketsView table has dozens of rows; fetching accumulation per row would
 * be a textbook N-request waterfall. This batches them into a single call to
 * `/v1/technicals/accumulation` and hands back a lookup map, so each row reads
 * O(1) from memory. Skips the network entirely when USE_LIVE_API is off.
 *
 * `symbols` is joined into the query, so keep the identity stable (pass a
 * memoised array) to avoid refetching on every render.
 */
export function useAccumulationMap(symbols: readonly string[]): AccumulationMapResult {
  const [map, setMap] = useState<Map<string, AccumulationBadgeData>>(new Map());
  const [loading, setLoading] = useState(USE_LIVE_API && symbols.length > 0);
  const [error, setError] = useState<string | null>(null);

  // Stable key so we refetch only when the actual set changes, not per render.
  const key = symbols.join(",");

  useEffect(() => {
    if (!USE_LIVE_API || symbols.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(ENDPOINTS.accumulation(symbols), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: AccumulationBadgeData[] = Array.isArray(data?.items) ? data.items : [];
        if (!cancelled) {
          setMap(new Map(items.map((it) => [it.symbol, it])));
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(timeout);
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { map, loading, error };
}
