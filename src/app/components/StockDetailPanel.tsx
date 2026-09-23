import { Suspense, lazy, useEffect } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import type { StockTick } from "../hooks/useLiveMarket";
import type { UniverseEntry } from "../hooks/useUniverse";
import { useTechnicals } from "../hooks/useTechnicals";
import { EntrySignalCard } from "./EntrySignalCard";

const CandlestickChart = lazy(() =>
  import("./CandlestickChart").then((m) => ({ default: m.CandlestickChart })),
);

interface Props {
  stock: StockTick;
  meta?: UniverseEntry;
  isId: boolean;
  onClose: () => void;
}

/**
 * Slide-over detail for one stock — the Stockbit "open a stock" view.
 *
 * Reuses the same price-action pipeline the AI Advisor renders: candles + S/R +
 * gaps from `useTechnicals`, and the actionable entry/stop/R:R read from
 * `EntrySignalCard`. The header stats come from the live tick so the number here
 * matches the table row that opened it.
 */
export function StockDetailPanel({ stock, meta, isId, onClose }: Props) {
  const tech = useTechnicals(stock.symbol, 120, true);
  const pos = stock.changePct >= 0;
  const foreignPos = stock.foreignNet >= 0;

  // Close on Escape — a drawer that traps the user is worse than no drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stat = (label: string, value: string, color?: string) => (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)", color: color ?? "var(--foreground)" }}>
        {value}
      </div>
    </div>
  );

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />

      {/* Drawer */}
      <div
        style={{
          position: "relative", width: 560, maxWidth: "calc(100vw - 24px)", height: "100%",
          background: "var(--background)", borderLeft: "1px solid var(--border)",
          boxShadow: "-24px 0 64px rgba(0,0,0,0.4)", overflowY: "auto",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            position: "sticky", top: 0, zIndex: 1, background: "var(--card)",
            borderBottom: "1px solid var(--border)", padding: "14px 18px",
            display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          }}
        >
          <div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}>
                {stock.symbol}
              </span>
              {meta?.board && (
                <span style={{
                  fontSize: 9, fontWeight: 600, color: "var(--muted-foreground)",
                  background: "var(--muted)", borderRadius: 3, padding: "2px 6px",
                  border: "1px solid var(--border)",
                }}>
                  {meta.board}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
              {stock.name}{stock.sector ? ` · ${isId ? stock.sector : stock.sectorEn}` : ""}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}>
                {stock.price.toLocaleString("id-ID")}
              </div>
              <div className="flex items-center justify-end gap-0.5" style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: pos ? "var(--gain)" : "var(--loss)" }}>
                {pos ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {Math.abs(stock.changePct).toFixed(2)}% ({stock.change >= 0 ? "+" : ""}{stock.change.toLocaleString("id-ID")})
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label={isId ? "Tutup" : "Close"}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Chart */}
          <Suspense
            fallback={
              <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--muted-foreground)", background: "var(--muted)", borderRadius: 4 }}>
                {isId ? "Memuat grafik…" : "Loading chart…"}
              </div>
            }
          >
            <CandlestickChart
              ohlcv={tech.ohlcv}
              supportResistance={tech.supportResistance}
              entryPrice={tech.tradePlan?.entryPrice ?? null}
              stopLoss={tech.tradePlan?.stopLoss ?? null}
              gaps={tech.gaps}
              situation={tech.situation}
              height={280}
              locale={isId ? "id" : "en"}
              livePrice={stock.price}
            />
          </Suspense>

          {/* Key stats */}
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            {stat(isId ? "Volume" : "Volume", `${(stock.volume / 1e6).toFixed(1)}M`)}
            {stat(isId ? "Kapitalisasi" : "Market Cap", stock.mktCap)}
            {stat("P/E", stock.pe !== null ? stock.pe.toFixed(1) : "—")}
            {stat(isId ? "Tertinggi" : "High", stock.high.toLocaleString("id-ID"))}
            {stat(isId ? "Terendah" : "Low", stock.low.toLocaleString("id-ID"))}
            {stat(isId ? "Buka" : "Open", stock.open.toLocaleString("id-ID"))}
            {stat(
              isId ? "Net Asing" : "Foreign Net",
              `${foreignPos ? "+" : ""}${stock.foreignNet.toFixed(1)}B`,
              foreignPos ? "var(--gain)" : "var(--loss)",
            )}
            {stat(isId ? "Prev Close" : "Prev Close", stock.prevClose.toLocaleString("id-ID"))}
            {meta?.board && stat(isId ? "Papan" : "Board", meta.board)}
          </div>

          {/* Actionable technical read: entry / stop / R:R */}
          <EntrySignalCard entry={tech.entrySignal} plan={tech.tradePlan} locale={isId ? "id" : "en"} />

          {/* Trend + generated note */}
          {tech.trend && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {isId ? "Tren" : "Trend"}
              </div>
              <div style={{ fontSize: 12, color: "var(--foreground)" }}>
                {isId ? tech.trend.trendId : tech.trend.trend} · {isId ? "Kekuatan" : "Strength"} {tech.trend.strength}%
              </div>
            </div>
          )}
          {(isId ? tech.technicalNote : tech.technicalNoteEn) && (
            <p style={{ fontSize: 12, color: "var(--foreground)", lineHeight: 1.6, background: "var(--muted)", borderRadius: 4, padding: 10 }}>
              {isId ? tech.technicalNote : tech.technicalNoteEn}
            </p>
          )}
          {tech.error && (
            <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              {isId ? "Data teknikal tidak tersedia untuk saham ini." : "Technical data unavailable for this stock."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
