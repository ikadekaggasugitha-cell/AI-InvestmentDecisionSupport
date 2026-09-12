import type { OHLCVCandle } from "../hooks/useTechnicals";

/**
 * Pure helpers for pulsing the live *forming* candle. Kept out of
 * CandlestickChart.tsx so the component file exports only components (React
 * Fast Refresh) and so this logic is unit-testable without the canvas library.
 */

/** Today's date as `yyyy-mm-dd` in WIB (UTC+7) — the IDX trading day. */
export function wibDateString(now: Date = new Date()): string {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const wib = new Date(utcMs + 7 * 3_600_000);
  const y = wib.getFullYear();
  const m = String(wib.getMonth() + 1).padStart(2, "0");
  const d = String(wib.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Fold a live price into the forming daily candle.
 *
 * Returns the updated bar only when `lastBar` is *today's* bar (WIB) — a live
 * price arriving while the latest backend bar is a prior session must not
 * mutate that closed bar, so this returns null and the caller leaves the chart
 * untouched until the next history refetch rolls the day forward.
 */
export function mergeLiveBar(
  lastBar: OHLCVCandle | undefined,
  price: number,
  todayWIB: string,
): OHLCVCandle | null {
  if (!lastBar || !Number.isFinite(price) || price <= 0) return null;
  if (lastBar.time !== todayWIB) return null;
  return {
    ...lastBar,
    high: Math.max(lastBar.high, price),
    low: Math.min(lastBar.low, price),
    close: price,
  };
}
