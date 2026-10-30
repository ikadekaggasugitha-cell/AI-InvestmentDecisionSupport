import { useState, useCallback } from "react";

/** USD/IDR as published by the market feed. */
export interface LiveFxRate {
  pair: string;
  rate: number;
  prevClose: number;
  change: number;
  changePct: number;
}

export interface ExchangeRateData {
  usdIdr: number;
  /** False when showing the placeholder rather than a feed value. */
  isLive: boolean;
  prevClose: number;
  change: number;
  changePct: number;
  showUsd: boolean;
  toggleCurrency: () => void;
  toUsd: (idr: number) => number;
  formatIdr: (idr: number, compact?: boolean) => string;
  formatUsd: (idr: number, compact?: boolean) => string;
  formatAmount: (idr: number, compact?: boolean) => string;
}

/**
 * Used only until the first market snapshot arrives, and only so the layout has
 * a number to size itself against.
 *
 * This module previously invented the rate outright: a hardcoded 15,847 walked
 * by a GBM step every eight seconds. The real rate is ~17,820 — an 11% error,
 * ticking on fabricated movement, driving every IDR→USD conversion on screen.
 * The live value now comes from the market feed via `useLiveMarket`.
 */
const PLACEHOLDER_RATE = 17_820;

function fmtIdr(idr: number, compact: boolean): string {
  if (compact) {
    if (idr >= 1e12) return `Rp ${(idr / 1e12).toFixed(2)}T`;
    if (idr >= 1e9)  return `Rp ${(idr / 1e9).toFixed(2)}M`;  // miliar
    if (idr >= 1e6)  return `Rp ${(idr / 1e6).toFixed(1)}Jt`; // juta
    if (idr >= 1e3)  return `Rp ${(idr / 1e3).toFixed(0)}Rb`; // ribu
    return `Rp ${idr.toLocaleString("id-ID")}`;
  }
  return `Rp ${idr.toLocaleString("id-ID")}`;
}

function fmtUsd(usd: number, compact: boolean): string {
  if (compact) {
    if (usd >= 1e9)  return `$${(usd / 1e9).toFixed(2)}B`;
    if (usd >= 1e6)  return `$${(usd / 1e6).toFixed(2)}M`;
    if (usd >= 1e3)  return `$${(usd / 1e3).toFixed(1)}K`;
    return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STORAGE_CURRENCY = "aidss-currency";

function readShowUsd(): boolean {
  try { return localStorage.getItem(STORAGE_CURRENCY) === "usd"; } catch { return false; }
}

/**
 * Currency display and conversion.
 *
 * Pass the `fx` block from the market snapshot to convert at the real rate.
 * Without it the hook falls back to a static placeholder and reports
 * `isLive: false`, so a caller can tell a real rate from a stand-in — the old
 * version made that impossible by animating the fake one.
 */
export function useExchangeRate(live?: LiveFxRate | null): ExchangeRateData {
  const [showUsd, setShowUsd] = useState<boolean>(readShowUsd);

  const rate = live?.rate && live.rate > 0 ? live.rate : PLACEHOLDER_RATE;
  const prevClose = live?.prevClose && live.prevClose > 0 ? live.prevClose : rate;
  const isLive = Boolean(live?.rate && live.rate > 0);

  const toggleCurrency = useCallback(() => {
    setShowUsd((v) => {
      const next = !v;
      try { localStorage.setItem(STORAGE_CURRENCY, next ? "usd" : "idr"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const toUsd          = useCallback((idr: number) => idr / rate, [rate]);

  const formatIdr    = useCallback((idr: number, compact = false) => fmtIdr(idr, compact), []);
  const formatUsd    = useCallback((idr: number, compact = false) => fmtUsd(idr / rate, compact), [rate]);
  const formatAmount = useCallback(
    (idr: number, compact = false) =>
      showUsd ? fmtUsd(idr / rate, compact) : fmtIdr(idr, compact),
    [showUsd, rate]
  );

  return {
    usdIdr:    rate,
    isLive,
    prevClose,
    change:    live?.change ?? +(rate - prevClose).toFixed(0),
    changePct: live?.changePct ?? +((rate - prevClose) / prevClose * 100).toFixed(3),
    showUsd,
    toggleCurrency,
    toUsd,
    formatIdr,
    formatUsd,
    formatAmount,
  };
}
