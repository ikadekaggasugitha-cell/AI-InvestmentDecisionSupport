/**
 * Shared financial formatting utilities.
 * Single source of truth — do not re-declare fmtIdr / fmtAmount in view files.
 */

/** Format an IDR value with compact Indonesian suffixes: T / M / Jt / Rb */
export function fmtIdr(n: number): string {
  if (n >= 1e12) return `Rp ${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `Rp ${(n / 1e9).toFixed(1)}M`;
  if (n >= 1e6)  return `Rp ${(n / 1e6).toFixed(0)}Jt`;
  if (n >= 1e3)  return `Rp ${(n / 1e3).toFixed(0)}Rb`;
  return `Rp ${n.toFixed(0)}`;
}

/**
 * Format an IDR amount, converting to USD when showUsd is true.
 * USD uses B / M / K compact suffixes.
 */
export function fmtAmount(n: number, showUsd: boolean, usdIdr: number): string {
  if (showUsd) {
    const u = n / usdIdr;
    if (u >= 1e9) return `$${(u / 1e9).toFixed(2)}B`;
    if (u >= 1e6) return `$${(u / 1e6).toFixed(2)}M`;
    if (u >= 1e3) return `$${(u / 1e3).toFixed(1)}K`;
    return `$${u.toFixed(0)}`;
  }
  return fmtIdr(n);
}
