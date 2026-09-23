import { useState, useEffect } from "react";
import { ENDPOINTS, USE_LIVE_API, apiFetch, FETCH_TIMEOUT_MS } from "../config/api";
import { IDX_STOCKS } from "../data/idxData";

/**
 * The full listed IDX board, fetched once from `/v1/symbols`.
 *
 * This is what makes the app's stock coverage the whole exchange (~960
 * securities) rather than the 15 bundled in idxData.ts. Components that need to
 * validate an arbitrary ticker or offer a symbol picker read from here.
 *
 * Fallback: when the API is off (USE_LIVE_API=false) or unreachable, it degrades
 * to the bundled IDX_STOCKS seed so pickers and validation still work offline —
 * the same fallback philosophy the rest of the app uses.
 */

export interface UniverseEntry {
  symbol: string;
  name: string | null;
  sector: string | null;
  sectorEn: string | null;
  board: string | null;
  lastClose: number | null;
}

export interface UniverseData {
  /** All instruments, keyed by symbol for O(1) metadata lookup. */
  bySymbol: Record<string, UniverseEntry>;
  /** All symbols, sorted as the API returned them (market cap desc). */
  symbols: string[];
  loading: boolean;
  /** True when serving the bundled seed rather than the live board. */
  isFallback: boolean;
}

function seedFromStatic(): UniverseData {
  const bySymbol: Record<string, UniverseEntry> = {};
  for (const s of IDX_STOCKS) {
    bySymbol[s.symbol] = {
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      sectorEn: s.sectorEn,
      board: null,
      lastClose: s.basePrice,
    };
  }
  return {
    bySymbol,
    symbols: IDX_STOCKS.map((s) => s.symbol),
    loading: false,
    isFallback: true,
  };
}

// Module-level cache: the board is large and changes daily, so fetch it once per
// session and share it across every hook consumer rather than per-mount.
let _cache: UniverseData | null = null;
const _subscribers = new Set<(d: UniverseData) => void>();

async function loadUniverse(): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await apiFetch(ENDPOINTS.symbols({ limit: 2000 }), {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list: UniverseEntry[] = (json.symbols ?? []).map((s: Record<string, unknown>) => ({
      symbol: String(s.symbol),
      name: (s.name as string) ?? null,
      sector: (s.sector as string) ?? null,
      sectorEn: (s.sectorEn as string) ?? null,
      board: (s.board as string) ?? null,
      lastClose: (s.lastClose as number) ?? null,
    }));
    if (!list.length) throw new Error("empty universe");

    const bySymbol: Record<string, UniverseEntry> = {};
    for (const e of list) bySymbol[e.symbol] = e;
    _cache = {
      bySymbol,
      symbols: list.map((e) => e.symbol),
      loading: false,
      isFallback: false,
    };
  } catch {
    // Keep any existing cache; otherwise fall back to the bundled seed.
    _cache = _cache ?? seedFromStatic();
  }
  _subscribers.forEach((fn) => _cache && fn(_cache));
}

export function useUniverse(): UniverseData {
  const [data, setData] = useState<UniverseData>(
    () => _cache ?? { bySymbol: {}, symbols: [], loading: true, isFallback: false }
  );

  useEffect(() => {
    if (_cache) {
      setData(_cache);
      return;
    }
    if (!USE_LIVE_API) {
      _cache = seedFromStatic();
      setData(_cache);
      return;
    }
    _subscribers.add(setData);
    // Only the first consumer triggers the fetch; the rest await via the cache.
    if (_subscribers.size === 1) void loadUniverse();
    return () => {
      _subscribers.delete(setData);
    };
  }, []);

  return data;
}
