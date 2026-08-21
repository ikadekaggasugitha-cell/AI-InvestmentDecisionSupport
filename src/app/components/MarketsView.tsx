import { useState, useMemo, useCallback, useRef, useEffect, memo, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, ChevronUp, ChevronDown, TrendingUp, TrendingDown, Star } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";
import type { LiveMarketData, StockTick } from "../hooks/useLiveMarket";
import type { ExchangeRateData } from "../hooks/useExchangeRate";
import { useAccumulationMap, type AccumulationBadgeData } from "../hooks/useAccumulationMap";
import { AccumulationBadge } from "./AccumulationBadge";

interface Props {
  market:            LiveMarketData;
  fx:                ExchangeRateData;
  watchlist:         Set<string>;
  onToggleWatchlist: (symbol: string) => void;
  /** When set (from a Dashboard row / Header search), pre-filter to this symbol. */
  focusSymbol?:      string | null;
  /** Bumped on each selection so re-selecting the same symbol re-applies. */
  focusNonce?:       number;
}

type SortKey = "symbol" | "price" | "changePct" | "volume" | "mktCap" | "pe" | "foreignNet" | "tier" | "sector" | "trend";
type SortDir = "asc" | "desc";

/* ── Module-level constants ───────────────────────────────────────────────── */

const TIER_CONFIG: Record<number, { label: string; color: string; bg: string; title: string }> = {
  1: { label: "T1", color: "#00d4aa", bg: "rgba(0,212,170,0.1)", title: "LQ45 · Real-time" },
  2: { label: "T2", color: "#4da6ff", bg: "rgba(77,166,255,0.1)", title: "Kompas100 · EOD" },
  3: { label: "T3", color: "#8b9cb0", bg: "rgba(139,156,176,0.1)", title: "Small-Cap · On-Demand" },
};
const TIER_FALLBACK = { label: "T?", color: "#8b9cb0", bg: "transparent", title: "" };

const thBase: CSSProperties = {
  fontSize: 11, color: "var(--muted-foreground)", fontWeight: 500,
  padding: "8px 12px", textAlign: "left" as const,
  background: "var(--muted)", borderBottom: "1px solid var(--border)",
  userSelect: "none" as const, cursor: "pointer", whiteSpace: "nowrap" as const,
  position: "sticky" as const, top: 0, zIndex: 1,
};
const thRight: CSSProperties  = { ...thBase, textAlign: "right"  as const };
const thCenter: CSSProperties = { ...thBase, textAlign: "center" as const, cursor: "default" };

/* ── Memoized sparkline ───────────────────────────────────────────────────── */

const MiniSparkline = memo(
  function MiniSparkline({ history, positive }: { history: number[]; positive: boolean }) {
    const data = useMemo(() => history.map((v, i) => ({ v, i })), [history]);
    return (
      <ResponsiveContainer width={64} height={28}>
        <LineChart data={data}>
          <Line type="monotone" dataKey="v"
            stroke={positive ? "var(--gain)" : "var(--loss)"}
            strokeWidth={1.2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  },
  (prev, next) =>
    prev.positive === next.positive &&
    prev.history.length === next.history.length &&
    prev.history[prev.history.length - 1] === next.history[next.history.length - 1]
);

/* ── Memoized table row ───────────────────────────────────────────────────── */

interface MarketRowProps {
  stock:     StockTick;
  fx:        ExchangeRateData;
  isId:      boolean;
  isEven:    boolean;
  isWatched: boolean;
  onToggle:  (symbol: string) => void;
  accum?:    AccumulationBadgeData;
  accumLoading?: boolean;
}

const MarketRow = memo(
  function MarketRow({ stock, fx, isId, isEven, isWatched, onToggle, accum, accumLoading }: MarketRowProps) {
    const pos        = stock.changePct >= 0;
    const foreignPos = stock.foreignNet >= 0;
    const tierCfg    = TIER_CONFIG[stock.tier] ?? TIER_FALLBACK;

    return (
      <tr style={{ borderBottom: "1px solid var(--border)", background: isEven ? "transparent" : "var(--muted)" }}>
        <td style={{ padding: "0 4px 0 12px", width: 28, textAlign: "center" }}>
          <button
            onClick={() => onToggle(stock.symbol)}
            aria-label={isWatched
              ? (isId ? `Hapus ${stock.symbol} dari pantauan` : `Remove ${stock.symbol} from watchlist`)
              : (isId ? `Tambah ${stock.symbol} ke pantauan`  : `Add ${stock.symbol} to watchlist`)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "4px", borderRadius: 3, lineHeight: 0,
              color: isWatched ? "#f59e0b" : "var(--muted-foreground)",
              transition: "color 0.15s",
            }}
          >
            <Star size={12} fill={isWatched ? "#f59e0b" : "none"} />
          </button>
        </td>
        <td style={{ padding: "10px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
            {stock.symbol}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 1, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {stock.name}
          </div>
        </td>
        <td style={{ padding: "10px 12px", textAlign: "right" }}>
          <span style={{ fontSize: 13, color: "var(--foreground)", fontFamily: "var(--font-mono)", fontWeight: 500 }}>
            {fx.showUsd ? `$${(stock.price / fx.usdIdr).toFixed(2)}` : stock.price.toLocaleString("id-ID")}
          </span>
        </td>
        <td style={{ padding: "10px 12px", textAlign: "right" }}>
          <div className="flex items-center justify-end gap-0.5" style={{ color: pos ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            {pos ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {Math.abs(stock.changePct).toFixed(2)}%
          </div>
          <div style={{ fontSize: 10, color: pos ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)", textAlign: "right" }}>
            {stock.change >= 0 ? "+" : ""}{stock.change.toLocaleString("id-ID")}
          </div>
        </td>
        <td style={{ padding: "4px 12px" }}>
          <MiniSparkline history={stock.history} positive={pos} />
        </td>
        <td style={{ padding: "10px 12px", textAlign: "right" }}>
          <span style={{ fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
            {(stock.volume / 1e6).toFixed(1)}M
          </span>
        </td>
        <td style={{ padding: "10px 12px", textAlign: "center" }}>
          <AccumulationBadge data={accum} locale={isId ? "id" : "en"} loading={accumLoading} />
        </td>
        <td style={{ padding: "10px 12px", textAlign: "right" }}>
          <span style={{ fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
            {stock.mktCap}
          </span>
        </td>
        <td style={{ padding: "10px 12px", textAlign: "right" }}>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
            {stock.pe !== null ? stock.pe.toFixed(1) : "—"}
          </span>
        </td>
        <td style={{ padding: "10px 12px" }}>
          <span
            title={tierCfg.title}
            style={{
              fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700,
              color: tierCfg.color, background: tierCfg.bg,
              borderRadius: 3, padding: "2px 5px", letterSpacing: "0.04em",
              border: `1px solid ${tierCfg.color}30`, whiteSpace: "nowrap",
            }}
          >
            {tierCfg.label}
          </span>
          <div style={{ fontSize: 9, color: "var(--muted-foreground)", marginTop: 2 }}>{tierCfg.title}</div>
        </td>
        <td style={{ padding: "10px 12px", textAlign: "right" }}>
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: foreignPos ? "var(--gain)" : "var(--loss)", fontWeight: 500 }}>
            {foreignPos ? "+" : ""}{stock.foreignNet.toFixed(1)}B
          </span>
        </td>
        <td style={{ padding: "10px 12px" }}>
          <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
            {isId ? stock.sector : stock.sectorEn}
          </span>
        </td>
      </tr>
    );
  },
  (prev, next) =>
    prev.stock.price          === next.stock.price          &&
    prev.stock.changePct      === next.stock.changePct      &&
    prev.stock.change         === next.stock.change         &&
    prev.stock.volume         === next.stock.volume         &&
    prev.stock.foreignNet     === next.stock.foreignNet     &&
    prev.stock.history.length === next.stock.history.length &&
    prev.stock.history[prev.stock.history.length - 1] === next.stock.history[next.stock.history.length - 1] &&
    prev.fx.showUsd           === next.fx.showUsd           &&
    prev.fx.usdIdr            === next.fx.usdIdr            &&
    prev.isId                 === next.isId                 &&
    prev.isEven               === next.isEven               &&
    prev.isWatched            === next.isWatched            &&
    prev.accumLoading         === next.accumLoading         &&
    prev.accum?.phase         === next.accum?.phase         &&
    prev.accum?.score         === next.accum?.score
);

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function parseMktCap(s: string): number {
  if (s.endsWith("T")) return parseFloat(s) * 1e12;
  if (s.endsWith("B")) return parseFloat(s) * 1e9;
  if (s.endsWith("M")) return parseFloat(s) * 1e6;
  return parseFloat(s);
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span style={{ opacity: 0.25, fontSize: 10 }}>↕</span>;
  return dir === "asc"
    ? <ChevronUp  size={10} style={{ color: "var(--primary)" }} />
    : <ChevronDown size={10} style={{ color: "var(--primary)" }} />;
}

/* ── Main view ────────────────────────────────────────────────────────────── */

const COL_COUNT = 12;
const ROW_HEIGHT = 48;

export function MarketsView({ market, fx, watchlist, onToggleWatchlist, focusSymbol = null, focusNonce = 0 }: Props) {
  const { locale } = useApp();
  const { t } = useTranslation(locale);
  const isId = locale === "id";

  const [search,  setSearch]  = useState("");
  // Apply an incoming focus (Dashboard row / Header search) as a search filter.
  useEffect(() => {
    if (focusSymbol) { setSearch(focusSymbol); setSector("all"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSymbol, focusNonce]);
  const [sector,  setSector]  = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("mktCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const tableContainerRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(
    (sym: string) => onToggleWatchlist(sym),
    [onToggleWatchlist]
  );

  const stocks = useMemo(() => Object.values(market.stocks), [market.stocks]);

  // One batched accumulation request for the whole board (capped server-side).
  // Keyed by the joined symbol string inside the hook, so live price ticks that
  // rebuild `stocks` do not trigger a refetch.
  const accumSymbols = useMemo(
    () => stocks.map((s) => s.symbol).sort().slice(0, 60),
    [stocks],
  );
  const accumulation = useAccumulationMap(accumSymbols);

  const sectors = useMemo(() => {
    const seen = new Set<string>();
    stocks.forEach((s) => seen.add(isId ? s.sector : s.sectorEn));
    return ["all", "watchlist", ...Array.from(seen)];
  }, [stocks, isId]);

  const filtered = useMemo(() => {
    return stocks
      .filter((s) => {
        const q = search.toLowerCase();
        const matchSearch = s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
        const matchSector =
          sector === "all"       ? true :
          sector === "watchlist" ? watchlist.has(s.symbol) :
          (isId ? s.sector : s.sectorEn) === sector;
        return matchSearch && matchSector;
      })
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        if (sortKey === "mktCap") {
          return dir * (parseMktCap(a.mktCap) - parseMktCap(b.mktCap));
        }
        // String columns → locale-aware compare.
        if (sortKey === "symbol" || sortKey === "tier" || sortKey === "sector") {
          const av = sortKey === "sector" ? (isId ? a.sector : a.sectorEn) : (a[sortKey] as string);
          const bv = sortKey === "sector" ? (isId ? b.sector : b.sectorEn) : (b[sortKey] as string);
          return dir * av.localeCompare(bv);
        }
        // Trend has no discrete field: sort by the 7-day move implied by the
        // sparkline history (last vs first), so uptrends group together.
        if (sortKey === "trend") {
          const move = (s: typeof a) => {
            const h = s.history;
            return h && h.length > 1 && h[0] ? (h[h.length - 1] - h[0]) / h[0] : 0;
          };
          return dir * (move(a) - move(b));
        }
        // Numeric columns: price, changePct, volume, pe, foreignNet.
        const av = (a[sortKey] as number) ?? 0, bv = (b[sortKey] as number) ?? 0;
        return dir * (av - bv);
      });
  }, [stocks, search, sector, sortKey, sortDir, isId, watchlist]);

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  const virtualItems  = rowVirtualizer.getVirtualItems();
  const totalSize     = rowVirtualizer.getTotalSize();
  const paddingTop    = virtualItems.length > 0 ? (virtualItems[0].start ?? 0) : 0;
  const paddingBottom = virtualItems.length > 0
    ? totalSize - (virtualItems[virtualItems.length - 1].end ?? 0)
    : 0;

  const { gainers, losers } = useMemo(() => ({
    gainers: stocks.filter((s) => s.changePct > 0).length,
    losers:  stocks.filter((s) => s.changePct < 0).length,
  }), [stocks]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const showWatchlistEmpty = sector === "watchlist" && filtered.length === 0 && !search;

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

      {/* Summary bar */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {[
          { label: t("mkt_advancing"), value: gainers,       color: "var(--gain)",    icon: TrendingUp   },
          { label: t("mkt_declining"), value: losers,        color: "var(--loss)",    icon: TrendingDown },
          { label: t("mkt_tracked"),   value: stocks.length, color: "var(--neutral)", icon: Search       },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded p-4 flex items-center gap-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 4, background: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={16} style={{ color: card.color }} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: card.color, fontFamily: "var(--font-mono)" }}>{card.value}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{card.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div
          className="flex items-center gap-2 rounded px-3"
          style={{ background: "var(--card)", border: "1px solid var(--border)", height: 36, width: 280 }}
        >
          <Search size={13} style={{ color: "var(--muted-foreground)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("mkt_search")}
            style={{ background: "transparent", border: "none", outline: "none", fontSize: 12, color: "var(--foreground)", width: "100%", fontFamily: "var(--font-sans)" }}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {sectors.map((s) => {
            const isWLTab = s === "watchlist";
            const label   = s === "all"
              ? t("mkt_all_sectors")
              : isWLTab
                ? `★ ${t("mkt_watchlist")}${watchlist.size > 0 ? ` (${watchlist.size})` : ""}`
                : s;
            return (
              <button
                key={s}
                onClick={() => setSector(s)}
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  padding: "5px 10px",
                  borderRadius: 4,
                  background: sector === s ? (isWLTab ? "rgba(245,158,11,0.1)" : "var(--accent)") : "var(--card)",
                  color: sector === s ? (isWLTab ? "#f59e0b" : "var(--primary)") : "var(--muted-foreground)",
                  border: `1px solid ${sector === s ? (isWLTab ? "#f59e0b" : "var(--primary)") : "var(--border)"}`,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table with virtual rows */}
      <div className="rounded overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div
          ref={tableContainerRef}
          className="overflow-auto"
          style={{ maxHeight: "calc(100vh - 340px)", minHeight: 300 }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thCenter} aria-label="Watchlist">★</th>
                <th style={thBase} onClick={() => handleSort("symbol")}>
                  <span className="flex items-center gap-1">{t("mkt_col_symbol")} <SortIcon active={sortKey === "symbol"} dir={sortDir} /></span>
                </th>
                <th style={thRight} onClick={() => handleSort("price")}>
                  <span className="flex items-center justify-end gap-1">{t("mkt_col_price")} <SortIcon active={sortKey === "price"} dir={sortDir} /></span>
                </th>
                <th style={thRight} onClick={() => handleSort("changePct")}>
                  <span className="flex items-center justify-end gap-1">{t("mkt_col_change")} <SortIcon active={sortKey === "changePct"} dir={sortDir} /></span>
                </th>
                <th style={thBase} onClick={() => handleSort("trend")}>
                  <span className="flex items-center gap-1">{t("mkt_col_trend")} <SortIcon active={sortKey === "trend"} dir={sortDir} /></span>
                </th>
                <th style={thRight} onClick={() => handleSort("volume")}>
                  <span className="flex items-center justify-end gap-1">{t("mkt_col_volume")} <SortIcon active={sortKey === "volume"} dir={sortDir} /></span>
                </th>
                <th
                  style={thCenter}
                  title={isId
                    ? "Akumulasi/distribusi dari analisis volume (OBV/CMF) — bukan data broker berlisensi"
                    : "Accumulation/distribution from volume analysis (OBV/CMF) — not licensed broker data"}
                >
                  {isId ? "Akum" : "Accum"}
                </th>
                <th style={thRight} onClick={() => handleSort("mktCap")}>
                  <span className="flex items-center justify-end gap-1">{t("mkt_col_mktcap")} <SortIcon active={sortKey === "mktCap"} dir={sortDir} /></span>
                </th>
                <th style={thRight} onClick={() => handleSort("pe")}>
                  <span className="flex items-center justify-end gap-1">{t("mkt_col_pe")} <SortIcon active={sortKey === "pe"} dir={sortDir} /></span>
                </th>
                <th style={thBase} onClick={() => handleSort("tier")}>
                  <span className="flex items-center gap-1">{t("mkt_col_tier")} <SortIcon active={sortKey === "tier"} dir={sortDir} /></span>
                </th>
                <th style={thRight} onClick={() => handleSort("foreignNet")}>
                  <span className="flex items-center justify-end gap-1">{t("mkt_col_foreign")} <SortIcon active={sortKey === "foreignNet"} dir={sortDir} /></span>
                </th>
                <th style={thBase} onClick={() => handleSort("sector")}>
                  <span className="flex items-center gap-1">{t("mkt_col_sector")} <SortIcon active={sortKey === "sector"} dir={sortDir} /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr><td colSpan={COL_COUNT} style={{ height: paddingTop, padding: 0 }} /></tr>
              )}
              {virtualItems.map((virtualRow) => {
                const stock = filtered[virtualRow.index];
                return (
                  <MarketRow
                    key={stock.symbol}
                    stock={stock}
                    fx={fx}
                    isId={isId}
                    isEven={virtualRow.index % 2 === 0}
                    isWatched={watchlist.has(stock.symbol)}
                    onToggle={handleToggle}
                    accum={accumulation.map.get(stock.symbol)}
                    accumLoading={accumulation.loading}
                  />
                );
              })}
              {paddingBottom > 0 && (
                <tr><td colSpan={COL_COUNT} style={{ height: paddingBottom, padding: 0 }} /></tr>
              )}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>
              {showWatchlistEmpty ? (
                <div>
                  <Star size={28} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
                  <div>{t("mkt_watchlist_empty")}</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    {isId ? "Klik ★ di sebelah kiri saham untuk menambahkannya." : "Click ★ next to any stock to add it."}
                  </div>
                </div>
              ) : (
                isId ? "Tidak ada saham ditemukan" : "No stocks found"
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
