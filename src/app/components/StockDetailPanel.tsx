import { Suspense, lazy, useEffect, useState } from "react";
import { X, ChevronUp, ChevronDown, Star } from "lucide-react";
import type { StockTick } from "../hooks/useLiveMarket";
import type { UniverseEntry } from "../hooks/useUniverse";
import type { AISignal } from "../hooks/useAISignals";
import { useTechnicals } from "../hooks/useTechnicals";
import { ENDPOINTS, USE_LIVE_API, apiFetch, FETCH_TIMEOUT_MS } from "../config/api";
import { EntrySignalCard } from "./EntrySignalCard";

const CandlestickChart = lazy(() =>
  import("./CandlestickChart").then((m) => ({ default: m.CandlestickChart })),
);

/** Probability-tier presentation: colour + bilingual label. */
const TIER_UI: Record<AISignal["probabilityTier"], { color: string; id: string; en: string }> = {
  VERY_HIGH: { color: "var(--gain)",    id: "Probabilitas Sangat Tinggi", en: "Very High Probability" },
  HIGH:      { color: "var(--gain)",    id: "Probabilitas Tinggi",        en: "High Probability" },
  NEUTRAL:   { color: "var(--neutral)", id: "Probabilitas Netral",        en: "Neutral Probability" },
  LOW:       { color: "var(--loss)",    id: "Probabilitas Rendah",        en: "Low Probability" },
};

interface Props {
  stock: StockTick;
  meta?: UniverseEntry;
  isId: boolean;
  isWatched: boolean;
  onToggleWatchlist: (symbol: string) => void;
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
export function StockDetailPanel({ stock, meta, isId, isWatched, onToggleWatchlist, onClose }: Props) {
  const tech = useTechnicals(stock.symbol, 120, true);
  const pos = stock.changePct >= 0;
  const foreignPos = stock.foreignNet >= 0;

  // AI signal for this one symbol — fetched lazily so opening the panel does not
  // pull the whole ~960-entry signals list.
  const [signal, setSignal] = useState<AISignal | null>(null);
  useEffect(() => {
    if (!USE_LIVE_API) return;
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    apiFetch(ENDPOINTS.signalFor(stock.symbol), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setSignal(d); })
      .catch(() => { if (alive) setSignal(null); })
      .finally(() => clearTimeout(timer));
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [stock.symbol]);

  // Day-range position: where the last price sits between the session low & high.
  const range = Math.max(0, stock.high - stock.low);
  const rangePct = range > 0 ? Math.min(100, Math.max(0, ((stock.price - stock.low) / range) * 100)) : 50;

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
              onClick={() => onToggleWatchlist(stock.symbol)}
              aria-label={isWatched
                ? (isId ? "Hapus dari pantauan" : "Remove from watchlist")
                : (isId ? "Tambah ke pantauan" : "Add to watchlist")}
              title={isId ? "Pantauan" : "Watchlist"}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, lineHeight: 0, color: isWatched ? "#f59e0b" : "var(--muted-foreground)" }}
            >
              <Star size={17} fill={isWatched ? "#f59e0b" : "none"} />
            </button>
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

          {/* AI signal — model uprob, tier, confidence, upside */}
          {signal && (
            <div style={{ background: "var(--muted)", borderRadius: 6, padding: 12, border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {isId ? "Sinyal AI" : "AI Signal"}
                </span>
                <span
                  style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                    color: TIER_UI[signal.probabilityTier].color,
                    background: `color-mix(in srgb, ${TIER_UI[signal.probabilityTier].color} 12%, transparent)`,
                    border: `1px solid ${TIER_UI[signal.probabilityTier].color}`,
                  }}
                >
                  {isId ? TIER_UI[signal.probabilityTier].id : TIER_UI[signal.probabilityTier].en}
                </span>
              </div>
              <div className="flex items-end gap-5">
                <div>
                  <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-mono)", color: TIER_UI[signal.probabilityTier].color, lineHeight: 1 }}>
                    {signal.uprob}%
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 2 }}>
                    {isId ? "Probabilitas Naik" : "Upward Prob."}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}>{signal.confidence}%</div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 2 }}>{isId ? "Keyakinan" : "Confidence"}</div>
                </div>
                {signal.upside !== 0 && (
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "var(--font-mono)", color: signal.upside >= 0 ? "var(--gain)" : "var(--loss)" }}>
                      {signal.upside >= 0 ? "+" : ""}{signal.upside.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 2 }}>{isId ? "Potensi" : "Upside"}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Day range: low ──●── high */}
          {range > 0 && (
            <div>
              <div className="flex items-center justify-between" style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 4 }}>
                <span>{isId ? "Rentang Hari" : "Day Range"}</span>
              </div>
              <div style={{ position: "relative", height: 6, background: "var(--muted)", borderRadius: 3 }}>
                <div style={{ position: "absolute", top: "50%", left: `${rangePct}%`, width: 10, height: 10, borderRadius: "50%", background: pos ? "var(--gain)" : "var(--loss)", transform: "translate(-50%, -50%)", border: "2px solid var(--background)" }} />
              </div>
              <div className="flex items-center justify-between" style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--foreground)", marginTop: 4 }}>
                <span>{stock.low.toLocaleString("id-ID")}</span>
                <span>{stock.high.toLocaleString("id-ID")}</span>
              </div>
            </div>
          )}

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
