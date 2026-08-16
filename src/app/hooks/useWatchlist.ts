import { useState, useCallback } from "react";
import { IDX_STOCKS } from "../data/idxData";

const STORAGE_KEY = "aidss-watchlist";
// Widened to Set<string> on purpose: IDX_STOCKS is a const array, so inference
// narrows the members to a literal union and `has()` then rejects any runtime
// string — including the ones read back from localStorage, which is the whole
// reason this set exists.
const VALID_SYMBOLS: Set<string> = new Set(IDX_STOCKS.map((s) => s.symbol));

function readWatchlist(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((s): s is string => typeof s === "string" && VALID_SYMBOLS.has(s));
        return new Set(valid);
      }
    }
  } catch { /* sandboxed iframe or corrupted data */ }
  return new Set();
}

export interface UseWatchlistResult {
  watchlist: Set<string>;
  toggle:    (symbol: string) => void;
  has:       (symbol: string) => boolean;
  count:     number;
}

export function useWatchlist(): UseWatchlistResult {
  const [watchlist, setWatchlist] = useState<Set<string>>(readWatchlist);

  const toggle = useCallback((symbol: string) => {
    if (!VALID_SYMBOLS.has(symbol)) return;
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const has = useCallback((symbol: string) => watchlist.has(symbol), [watchlist]);

  return { watchlist, toggle, has, count: watchlist.size };
}
