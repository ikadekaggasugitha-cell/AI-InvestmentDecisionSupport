import { useState } from "react";
import { Scale, FlaskConical, ArrowRight, X } from "lucide-react";
import { usePortfolioOptimisation } from "../hooks/usePortfolioOptimisation";
import type { PortfolioHolding } from "../hooks/usePortfolio";

/**
 * Recommended allocation against what is actually held.
 *
 * The optimiser endpoint has existed since Phase 6 and nothing called it. A
 * bare list of target weights would not be actionable, so each row shows the
 * current weight beside the target and the gap between them — the gap is the
 * only part anyone acts on.
 */

export interface AllocationPanelProps {
  holdings: readonly PortfolioHolding[];
  prices: Record<string, number>;
  locale?: "id" | "en";
}

export function AllocationPanel({ holdings, prices, locale = "id" }: AllocationPanelProps) {
  const isId = locale === "id";
  const { weights, metrics, source, loading, error } = usePortfolioOptimisation();
  const [showRebalance, setShowRebalance] = useState(false);

  // Current weights from live prices, so "current vs target" compares like
  // with like rather than target-at-market against cost basis.
  const currentValues = holdings.map((h) => ({
    symbol: h.symbol,
    value: h.lots * 100 * (prices[h.symbol] ?? h.avgPrice),
  }));
  const totalValue = currentValues.reduce((s, h) => s + h.value, 0) || 1;
  const currentPct: Record<string, number> = Object.fromEntries(
    currentValues.map((h) => [h.symbol, (h.value / totalValue) * 100]),
  );

  if (loading) {
    return (
      <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
          {isId ? "Menghitung alokasi optimal…" : "Computing optimal allocation…"}
        </div>
      </div>
    );
  }

  if (error || weights.length === 0) {
    return (
      <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 mb-1">
          <Scale size={14} style={{ color: "var(--muted-foreground)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
            {isId ? "Alokasi Optimal" : "Optimal Allocation"}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
          {error
            ? (isId ? `Tidak tersedia — ${error}` : `Unavailable — ${error}`)
            : (isId ? "Backend tidak terjangkau." : "Backend unreachable.")}
        </div>
      </div>
    );
  }

  const ranked = [...weights].sort((a, b) => b.weightPct - a.weightPct);

  return (
    <div className="rounded p-5 flex flex-col gap-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <Scale size={14} style={{ color: "var(--primary)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
            {isId ? "Alokasi Optimal" : "Optimal Allocation"}
          </span>
          {metrics && (
            <span
              className="rounded px-2 py-0.5"
              style={{ background: "var(--muted)", border: "1px solid var(--border)", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}
            >
              {metrics.method}
            </span>
          )}
          {source === "mock" && (
            <span className="flex items-center gap-1 rounded px-2 py-0.5" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <FlaskConical size={9} style={{ color: "var(--warning)" }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: "var(--warning)", fontFamily: "var(--font-mono)" }}>
                {isId ? "SIMULASI" : "SIMULATED"}
              </span>
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 3 }}>
          {isId
            ? "Bobot target vs posisi Anda saat ini — bukan instruksi transaksi"
            : "Target weights vs your current positions — not a trade instruction"}
        </div>
        <button
          onClick={() => setShowRebalance(true)}
          className="flex items-center gap-1.5 rounded mt-2 px-2.5 py-1"
          style={{ background: "var(--primary-bg, var(--muted))", border: "1px solid var(--primary)", color: "var(--primary)", fontSize: 11, cursor: "pointer", width: "fit-content" }}
        >
          <Scale size={12} />
          {isId ? "Lihat Saran Rebalance" : "View Rebalance Suggestions"}
        </button>
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
          {[
            { l: isId ? "Return Ekspektasi" : "Expected Return", v: `${metrics.expectedReturn.toFixed(1)}%`, c: metrics.expectedReturn >= 0 ? "var(--gain)" : "var(--loss)" },
            { l: isId ? "Volatilitas" : "Volatility", v: `${metrics.expectedVolatility.toFixed(1)}%`, c: "var(--warning)" },
            { l: "Sharpe", v: metrics.sharpeRatio.toFixed(2), c: "var(--foreground)" },
            { l: isId ? "Diversifikasi" : "Diversification", v: metrics.diversificationRatio.toFixed(2), c: "var(--neutral)" },
          ].map((m) => (
            <div key={m.l}>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{m.l}</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: m.c, fontFamily: "var(--font-mono)" }}>{m.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Current → target, with the gap */}
      <div className="flex flex-col gap-2">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: "64px 1fr 58px 16px 58px 62px", fontSize: 9, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--font-mono)" }}
        >
          <span>{isId ? "Kode" : "Symbol"}</span>
          <span />
          <span style={{ textAlign: "right" }}>{isId ? "Kini" : "Now"}</span>
          <span />
          <span style={{ textAlign: "right" }}>{isId ? "Target" : "Target"}</span>
          <span style={{ textAlign: "right" }}>{isId ? "Selisih" : "Gap"}</span>
        </div>

        {ranked.map((w) => {
          const now = currentPct[w.symbol] ?? 0;
          const gap = w.weightPct - now;
          const gapColor = Math.abs(gap) < 1 ? "var(--muted-foreground)" : gap > 0 ? "var(--gain)" : "var(--loss)";
          return (
            <div
              key={w.symbol}
              className="grid gap-2 items-center"
              style={{ gridTemplateColumns: "64px 1fr 58px 16px 58px 62px" }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                {w.symbol}
              </span>
              {/* Target weight bar */}
              <div style={{ height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, w.weightPct)}%`, height: "100%", background: "var(--primary)", borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 11, textAlign: "right", color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                {now.toFixed(1)}%
              </span>
              <ArrowRight size={10} style={{ color: "var(--muted-foreground)" }} />
              <span style={{ fontSize: 11, textAlign: "right", color: "var(--foreground)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                {w.weightPct.toFixed(1)}%
              </span>
              <span style={{ fontSize: 11, textAlign: "right", color: gapColor, fontFamily: "var(--font-mono)" }}>
                {gap >= 0 ? "+" : ""}{gap.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      {showRebalance && (
        <div
          onClick={() => setShowRebalance(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded flex flex-col"
            style={{ background: "var(--card)", border: "1px solid var(--border)", width: "min(520px, 100%)", maxHeight: "80vh" }}
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
                  {isId ? "Saran Rebalance" : "Rebalance Suggestions"}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2 }}>
                  {isId ? "Perkiraan transaksi untuk menutup selisih — bukan eksekusi order." : "Estimated trades to close the gap — not order execution."}
                </div>
              </div>
              <button onClick={() => setShowRebalance(false)} aria-label="Close"
                className="flex items-center justify-center rounded"
                style={{ width: 28, height: 28, background: "transparent", border: "none", color: "var(--muted-foreground)", cursor: "pointer" }}>
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {(() => {
                const suggestions = ranked
                  .map((w) => {
                    const now = currentPct[w.symbol] ?? 0;
                    const gap = w.weightPct - now;
                    const price = prices[w.symbol] ?? 0;
                    const deltaIdr = (gap / 100) * totalValue;
                    const lots = price > 0 ? Math.round(deltaIdr / (price * 100)) : 0;
                    return { symbol: w.symbol, gap, deltaIdr, lots };
                  })
                  .filter((s) => Math.abs(s.gap) >= 1 && s.lots !== 0)
                  .sort((a, b) => Math.abs(b.deltaIdr) - Math.abs(a.deltaIdr));

                if (suggestions.length === 0) {
                  return (
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "8px 0" }}>
                      {isId ? "Portofolio sudah mendekati alokasi target — tak ada aksi berarti." : "Portfolio is already close to target — no meaningful action."}
                    </div>
                  );
                }
                return suggestions.map((s) => {
                  const buy = s.lots > 0;
                  const color = buy ? "var(--gain)" : "var(--loss)";
                  return (
                    <div key={s.symbol} className="flex items-center justify-between rounded px-3 py-2"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", color, background: "var(--card)", border: `1px solid ${color}`, borderRadius: 3, padding: "1px 6px" }}>
                          {buy ? (isId ? "BELI" : "BUY") : (isId ? "JUAL" : "SELL")}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{s.symbol}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color, fontFamily: "var(--font-mono)" }}>
                          {Math.abs(s.lots).toLocaleString("id-ID")} {isId ? "lot" : "lots"}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                          {s.gap >= 0 ? "+" : ""}{s.gap.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
