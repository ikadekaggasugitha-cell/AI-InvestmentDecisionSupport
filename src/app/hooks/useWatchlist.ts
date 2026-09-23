import { useState, useCallback } from "react";

const STORAGE_KEY = "aidss-watchlist";
// The watchlist now spans the whole listed board (~960 securities), not the 15
// bundled in idxData.ts, so validation can no longer be a hardcoded membership
// set. An IDX ticker is 3–5 uppercase letters; this shape check is enough to
// reject corrupted localStorage entries (the only reason validation exists here)
// while accepting any real symbol on the exchange.
const SYMBOL_RE = /^[A-Z]{3,5}$/;

function isValidSymbol(s: string): boolean {
  return SYMBOL_RE.test(s);
}

function readWatchlist(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((s): s is string => typeof s === "string" && isValidSymbol(s));
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
    if (!isValidSymbol(symbol)) return;
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
