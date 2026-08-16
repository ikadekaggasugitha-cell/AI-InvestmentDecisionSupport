import { useState, useCallback } from "react";
import { PORTFOLIO_HOLDINGS } from "../data/idxData";
import { LOT_MAX, PRICE_MAX } from "../constants";

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface PortfolioHolding {
  symbol: string;
  lots: number;
  avgPrice: number;
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

/* ── Storage ─────────────────────────────────────────────────────────────── */

const STORAGE_HOLDINGS = "aidss-portfolio";
const STORAGE_TX       = "aidss-transactions";

function isValidHolding(v: unknown): v is PortfolioHolding {
  if (!v || typeof v !== "object") return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.symbol   === "string" && h.symbol.length > 0 &&
    typeof h.lots     === "number" && Number.isFinite(h.lots)     && h.lots     >= 1 && h.lots     <= LOT_MAX   &&
    typeof h.avgPrice === "number" && Number.isFinite(h.avgPrice) && h.avgPrice >= 1 && h.avgPrice <= PRICE_MAX &&
    typeof h.sector   === "string"
  );
}

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

function readHoldings(): PortfolioHolding[] {
  try {
    const raw = localStorage.getItem(STORAGE_HOLDINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(isValidHolding);
        if (valid.length > 0) return valid;
      }
    }
  } catch { /* sandboxed iframe or corrupted data */ }
  return PORTFOLIO_HOLDINGS.map((h) => ({
    symbol:   h.symbol,
    lots:     h.lots,
    avgPrice: h.avgPrice,
    sector:   h.sector,
  }));
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

function persistHoldings(h: PortfolioHolding[]) {
  try { localStorage.setItem(STORAGE_HOLDINGS, JSON.stringify(h)); } catch { /* ignore */ }
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
    timeEn: `${mEn} ${d}, ${yr} · ${hh}:${mm} WIB`,
  };
}

function genId(): string {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ── Hook ────────────────────────────────────────────────────────────────── */

export interface UsePortfolioResult {
  holdings:     PortfolioHolding[];
  transactions: Transaction[];
  addHolding:    (h: PortfolioHolding) => void;
  updateHolding: (symbol: string, updates: Partial<Omit<PortfolioHolding, "symbol">>) => void;
  removeHolding: (symbol: string, price: number) => void;
}

export function usePortfolio(): UsePortfolioResult {
  const [holdings,     setHoldings]     = useState<PortfolioHolding[]>(readHoldings);
  const [transactions, setTransactions] = useState<Transaction[]>(readTransactions);

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

  const addHolding = useCallback(
    (h: PortfolioHolding) => {
      const safeLots  = Math.min(Math.max(1, Math.floor(h.lots)),     LOT_MAX);
      const safePrice = Math.min(Math.max(1, h.avgPrice),             PRICE_MAX);
      const safeH     = { ...h, lots: safeLots, avgPrice: safePrice };

      setHoldings((prev) => {
        const existing = prev.find((p) => p.symbol === safeH.symbol);
        let next: PortfolioHolding[];
        if (existing) {
          const totalLots = Math.min(existing.lots + safeH.lots, LOT_MAX);
          const avgPrice  = Math.round(
            (existing.lots * existing.avgPrice + safeH.lots * safeH.avgPrice) / totalLots
          );
          next = prev.map((p) =>
            p.symbol === safeH.symbol ? { ...p, lots: totalLots, avgPrice } : p
          );
        } else {
          next = [...prev, safeH];
        }
        persistHoldings(next);
        return next;
      });
      appendTx({
        symbol: safeH.symbol,
        type:   "BUY",
        lots:   safeH.lots,
        price:  safeH.avgPrice,
        total:  safeH.lots * 100 * safeH.avgPrice,
      });
    },
    [appendTx]
  );

  const updateHolding = useCallback(
    (symbol: string, updates: Partial<Omit<PortfolioHolding, "symbol">>) => {
      const safeUpdates = { ...updates };
      if (safeUpdates.lots     !== undefined) safeUpdates.lots     = Math.min(Math.max(1, Math.floor(safeUpdates.lots)),     LOT_MAX);
      if (safeUpdates.avgPrice !== undefined) safeUpdates.avgPrice = Math.min(Math.max(1, safeUpdates.avgPrice),             PRICE_MAX);

      setHoldings((prev) => {
        const old  = prev.find((p) => p.symbol === symbol);
        const next = prev.map((p) => (p.symbol === symbol ? { ...p, ...safeUpdates } : p));
        persistHoldings(next);

        // Log BUY/SELL for lot change
        if (safeUpdates.lots !== undefined && old) {
          const diff = safeUpdates.lots - old.lots;
          const price = safeUpdates.avgPrice ?? old.avgPrice;
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
    [appendTx]
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
        persistHoldings(next);
        return next;
      });
    },
    [appendTx]
  );

  return { holdings, transactions, addHolding, updateHolding, removeHolding };
}
