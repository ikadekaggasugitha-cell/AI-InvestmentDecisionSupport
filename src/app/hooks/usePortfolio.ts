import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ENDPOINTS, apiFetch } from "../config/api";
import { LOT_MAX, PRICE_MAX } from "../constants";
import { IDX_STOCKS } from "../data/idxData";

/**
 * The caller's positions, from GET and PUT /v1/portfolio/positions.
 *
 * These used to live only in this browser's localStorage, seeded with ten IDX
 * positions belonging to nobody. That was not a cosmetic problem: the backend
 * computed the equity curve, VaR and allocation from `portfolios.lots_json`, so
 * the Portfolio page displayed a book the analytics had never heard of. Both
 * answers were rendered on the same screen.
 *
 * The server is now the only store for lots and cost basis. What stays local is
 * the transaction log, which records what the person did rather than what they
 * hold, and has no table to live in until billing exists (Fase 2).
 *
 * `sector` is derived from the bundled sector map rather than stored twice. It is
 * a property of the instrument, not of the position, and storing it on the
 * position would be a second place to update when IDX recategorises a company.
 */

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface PortfolioHolding {
  symbol: string;
  lots: number;
  /** Null when the person does not know their cost basis. Not zero: a zero cost
   *  basis would render as a position that cost nothing. */
  avgPrice: number | null;
  sector: string;
}

export interface Transaction {
  id: string;
  symbol: string;
  type: "BUY" | "SELL" | "DIV";
  lots: number;
  price: number;
  total: number;
  date: string;  // "DD Mon YYYY HH:MM"
  timeId: string;
  timeEn: string;
}

/* ── Transaction log (local) ─────────────────────────────────────────────── */

const STORAGE_TX = "aidss-transactions";

function isValidTransaction(v: unknown): v is Transaction {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id     === "string" &&
    typeof t.symbol === "string" && t.symbol.length > 0 &&
    (t.type === "BUY" || t.type === "SELL" || t.type === "DIV") &&
    typeof t.lots   === "number" && Number.isFinite(t.lots)  && t.lots  >= 0 &&
    typeof t.price  === "number" && Number.isFinite(t.price) && t.price >= 0 &&
    typeof t.total  === "number" && Number.isFinite(t.total) &&
    typeof t.date   === "string" && typeof t.timeId === "string" && typeof t.timeEn === "string"
  );
}

function readTransactions(): Transaction[] {
  try {
    const raw = localStorage.getItem(STORAGE_TX);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(isValidTransaction);
    }
  } catch { /* sandboxed iframe or corrupted data */ }
  return [];
}

function persistTx(txs: Transaction[]) {
  try { localStorage.setItem(STORAGE_TX, JSON.stringify(txs.slice(-50))); } catch { /* ignore */ }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function nowLabel(): { date: string; timeId: string; timeEn: string } {
  const now  = new Date();
  const wib  = new Date(now.getTime() + (7 * 60 - now.getTimezoneOffset()) * 60_000);
  const hh   = wib.getHours().toString().padStart(2, "0");
  const mm   = wib.getMinutes().toString().padStart(2, "0");
  const d    = wib.getDate();
  const mId  = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][wib.getMonth()];
  const mEn  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][wib.getMonth()];
  const yr   = wib.getFullYear();
  return {
    date:   `${d} ${mId} ${yr} ${hh}:${mm}`,
    timeId: `${d} ${mId} ${yr} · ${hh}:${mm} WIB`,
    timeEn: `${d} ${mEn}, ${yr} · ${hh}:${mm} WIB`,
  };
}

function genId(): string {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// Sector is a property of the instrument, not of the position, so it is looked up
// rather than stored on the holding. Derived, so it cannot disagree with the
// board when IDX recategorises a company.
const SECTOR_BY_SYMBOL: Record<string, string> = Object.fromEntries(
  IDX_STOCKS.map((s) => [s.symbol, s.sector]),
);

function sectorOf(symbol: string): string {
  return SECTOR_BY_SYMBOL[symbol] ?? "Lainnya";
}

/** What the client sends: symbol, lots, and a cost basis that may be unknown. */
function toPayload(holdings: PortfolioHolding[]) {
  return {
    positions: holdings.map((h) => ({
      symbol: h.symbol,
      lots: h.lots,
      avgPrice: h.avgPrice,
    })),
  };
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 && Number.isInteger(v);
}

/** Parse the response into holdings, skipping anything malformed. */
function fromResponse(body: unknown): PortfolioHolding[] {
  const rows = (body as { positions?: unknown })?.positions;
  if (!Array.isArray(rows)) return [];
  const out: PortfolioHolding[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    if (typeof r.symbol !== "string" || !isPositiveInt(r.lots)) continue;
    const avg = typeof r.avgPrice === "number" && Number.isFinite(r.avgPrice) && r.avgPrice > 0
      ? r.avgPrice
      : null;
    out.push({ symbol: r.symbol, lots: r.lots, avgPrice: avg, sector: sectorOf(r.symbol) });
  }
  return out;
}

/* ── Hook ────────────────────────────────────────────────────────────────── */

export interface UsePortfolioResult {
  holdings:     PortfolioHolding[];
  transactions: Transaction[];
  loading:      boolean;
  /** Set when the server could not be reached. Distinct from "no positions". */
  error:        string | null;
  /** True when the server answered, whatever it said. */
  loaded:       boolean;
  addHolding:    (h: PortfolioHolding) => void;
  updateHolding: (symbol: string, updates: Partial<Omit<PortfolioHolding, "symbol">>) => void;
  removeHolding: (symbol: string, price: number) => void;
  refetch:       () => void;
}

export function usePortfolio(): UsePortfolioResult {
  const [holdings,     setHoldings]     = useState<PortfolioHolding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>(readTransactions);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [loaded,       setLoaded]       = useState(false);

  // The in-flight write, if any. Positions are a whole-portfolio replace, so two
  // edits in quick succession would race and the slower response would win with
  // a list the person never asked for.
  const writeInFlight = useRef(false);
  const [reloadToken, setReloadToken] = useState(0);

  const fetchPositions = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await apiFetch(ENDPOINTS.positions, signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setHoldings(fromResponse(body));
      setError(null);
      setLoaded(true);
    } catch (err) {
      if (signal?.aborted) return;
      // An empty list here would be a lie: it would say "you hold nothing" when
      // the truth is "I could not ask". The view shows the difference.
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPositions(controller.signal);
    return () => controller.abort();
  }, [fetchPositions, reloadToken]);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  const appendTx = useCallback(
    (partial: Omit<Transaction, "id" | "date" | "timeId" | "timeEn">) => {
      setTransactions((prev) => {
        const { date, timeId, timeEn } = nowLabel();
        const next = [...prev, { ...partial, id: genId(), date, timeId, timeEn }].slice(-50);
        persistTx(next);
        return next;
      });
    },
    []
  );

  /** Persist a new list optimistically, then reconcile with the server's answer. */
  const commit = useCallback((next: PortfolioHolding[]) => {
    setHoldings(next);
    if (writeInFlight.current) return;

    writeInFlight.current = true;
    void (async () => {
      try {
        const res = await apiFetch(ENDPOINTS.positions, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(next)),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // The server is authoritative. Taking its response means a rejected or
        // clamped value is reflected rather than lingering on screen.
        setHoldings(fromResponse(await res.json()));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        writeInFlight.current = false;
      }
    })();
  }, []);

  const addHolding = useCallback(
    (h: PortfolioHolding) => {
      const safeLots  = Math.min(Math.max(1, Math.floor(h.lots)), LOT_MAX);
      const safePrice = Math.min(Math.max(1, h.avgPrice ?? 1), PRICE_MAX);
      const symbol    = h.symbol.toUpperCase();

      setHoldings((prev) => {
        const existing = prev.find((p) => p.symbol === symbol);
        let next: PortfolioHolding[];
        if (existing) {
          const totalLots = Math.min(existing.lots + safeLots, LOT_MAX);
          // Weighted average across the combined position, but only when both
          // sides know a price. Without one, the last stated price carries rather
          // than being averaged against a value that was never entered.
          const avgPrice = existing.avgPrice == null || h.avgPrice == null
            ? (existing.avgPrice ?? h.avgPrice)
            : Math.round(
                (existing.lots * existing.avgPrice + safeLots * safePrice) / totalLots
              );
          next = prev.map((p) =>
            p.symbol === symbol ? { ...p, lots: totalLots, avgPrice } : p
          );
        } else {
          next = [...prev, { symbol, lots: safeLots, avgPrice: h.avgPrice, sector: sectorOf(symbol) }];
        }

        commit(next);
        appendTx({
          symbol,
          type:   "BUY",
          lots:   safeLots,
          price:  safePrice,
          total:  safeLots * 100 * safePrice,
        });
        return next;
      });
    },
    [appendTx, commit]
  );

  const updateHolding = useCallback(
    (symbol: string, updates: Partial<Omit<PortfolioHolding, "symbol">>) => {
      const safeUpdates = { ...updates };
      if (safeUpdates.lots !== undefined) {
        safeUpdates.lots = Math.min(Math.max(1, Math.floor(safeUpdates.lots)), LOT_MAX);
      }
      if (safeUpdates.avgPrice !== undefined && safeUpdates.avgPrice !== null) {
        safeUpdates.avgPrice = Math.min(Math.max(1, safeUpdates.avgPrice), PRICE_MAX);
      }

      setHoldings((prev) => {
        const old  = prev.find((p) => p.symbol === symbol);
        const next = prev.map((p) => (p.symbol === symbol ? { ...p, ...safeUpdates } : p));

        commit(next);

        if (safeUpdates.lots !== undefined && old) {
          const diff  = safeUpdates.lots - old.lots;
          const price = safeUpdates.avgPrice ?? old.avgPrice ?? 0;
          if (diff !== 0) {
            appendTx({
              symbol,
              type:  diff > 0 ? "BUY" : "SELL",
              lots:  Math.abs(diff),
              price,
              total: Math.abs(diff) * 100 * price,
            });
          }
        }
        return next;
      });
    },
    [appendTx, commit]
  );

  const removeHolding = useCallback(
    (symbol: string, price: number) => {
      setHoldings((prev) => {
        const holding = prev.find((p) => p.symbol === symbol);
        if (holding) {
          appendTx({
            symbol,
            type:  "SELL",
            lots:  holding.lots,
            price,
            total: holding.lots * 100 * price,
          });
        }
        const next = prev.filter((p) => p.symbol !== symbol);
        // An empty list is not a no-op: it is how a position is deleted.
        commit(next);
        return next;
      });
    },
    [appendTx, commit]
  );

  return useMemo(
    () => ({
      holdings, transactions, loading, error, loaded,
      addHolding, updateHolding, removeHolding, refetch,
    }),
    [holdings, transactions, loading, error, loaded,
     addHolding, updateHolding, removeHolding, refetch]
  );
}