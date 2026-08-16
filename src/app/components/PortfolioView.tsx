import { useState, useMemo, useCallback, type ReactNode } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { TrendingUp, TrendingDown, DollarSign, BarChart2, Plus, Pencil, Trash2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";
import { SECTOR_ALLOCATION, PORTFOLIO_HISTORY } from "../data/idxData";
import { PositionModal, type ModalMode } from "./PositionModal";
import { fmtIdr, fmtAmount } from "../utils/formatting";
import type { PortfolioHolding } from "../hooks/usePortfolio";
import type { LiveMarketData } from "../hooks/useLiveMarket";
import type { ExchangeRateData } from "../hooks/useExchangeRate";
import { AllocationPanel } from "./AllocationPanel";

interface Props {
  market:        LiveMarketData;
  fx:            ExchangeRateData;
  holdings:      PortfolioHolding[];
  onAdd:         (h: PortfolioHolding) => void;
  onUpdate:      (symbol: string, updates: Partial<Omit<PortfolioHolding, "symbol">>) => void;
  onRemove:      (symbol: string, price: number) => void;
}

export function PortfolioView({ market, fx, holdings, onAdd, onUpdate, onRemove }: Props) {
  const { locale } = useApp();
  const { t }      = useTranslation(locale);
  const isId       = locale === "id";
  const fmt        = useCallback((n: number) => fmtAmount(n, fx.showUsd, fx.usdIdr), [fx.showUsd, fx.usdIdr]);

  /* Modal state */
  const [modalMode,   setModalMode]   = useState<ModalMode | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);

  function openModal(mode: ModalMode, symbol?: string) {
    setModalMode(mode);
    setActiveSymbol(symbol ?? null);
  }
  function closeModal() {
    setModalMode(null);
    setActiveSymbol(null);
  }

  const activeHolding = useMemo(
    () => holdings.find((h) => h.symbol === activeSymbol),
    [holdings, activeSymbol]
  );

  const currentPrice = activeSymbol ? (market.stocks[activeSymbol]?.price ?? activeHolding?.avgPrice) : undefined;

  /* Live positions */
  const positions = useMemo(() =>
    holdings.map((h) => {
      const stock  = market.stocks[h.symbol];
      const price  = stock?.price ?? h.avgPrice;
      const value  = h.lots * 100 * price;
      const cost   = h.lots * 100 * h.avgPrice;
      const pnl    = value - cost;
      const pnlPct = pnl / cost;
      return { symbol: h.symbol, name: stock?.name ?? h.symbol, lots: h.lots, avgPrice: h.avgPrice, price, value, cost, pnl, pnlPct };
    }),
  [holdings, market.stocks]);

  const totalValue  = useMemo(() => positions.reduce((s, p) => s + p.value, 0), [positions]);
  const totalCost   = useMemo(() => positions.reduce((s, p) => s + p.cost,  0), [positions]);
  const totalGain   = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? totalGain / totalCost : 0;
  const dailyPnL    = market.dailyPnL;
  const dailyPnLPct = market.dailyPnLPct;
  const weightedRet = totalValue > 0
    ? positions.reduce((s, p) => s + p.pnlPct * (p.value / totalValue), 0)
    : 0;

  const cards = [
    { label: t("dash_portfolio_value"), value: fmt(totalValue), sub: `${t("port_col_cost")}: ${fmt(totalCost)}`, color: "var(--neutral)", icon: DollarSign },
    { label: t("port_unrealized"),      value: `${totalGain >= 0 ? "+" : ""}${fmt(Math.abs(totalGain))}`, sub: `${totalGainPct >= 0 ? "+" : ""}${(totalGainPct * 100).toFixed(1)}% ${t("port_all_time")}`, color: totalGain >= 0 ? "var(--gain)" : "var(--loss)", icon: TrendingUp },
    { label: t("dash_daily_pnl"),       value: `${dailyPnL >= 0 ? "+" : ""}${fmt(Math.abs(dailyPnL))}`, sub: `${dailyPnLPct >= 0 ? "+" : ""}${(dailyPnLPct * 100).toFixed(2)}% ${isId ? "hari ini" : "today"}`, color: dailyPnL >= 0 ? "var(--gain)" : "var(--loss)", icon: dailyPnL >= 0 ? TrendingUp : TrendingDown },
    { label: t("port_weighted_return"), value: `${weightedRet >= 0 ? "+" : ""}${(weightedRet * 100).toFixed(1)}%`, sub: `${positions.length} ${isId ? "posisi aktif" : "active positions"}`, color: "var(--chart-4)", icon: BarChart2 },
  ];

  const sectorData = useMemo(
    () => SECTOR_ALLOCATION.map((s) => ({ name: isId ? s.name : s.nameEn, value: s.value, color: s.color })),
    [isId]
  );

  const returnsBar = useMemo(
    () => positions.map((p) => ({ symbol: p.symbol, ret: +(p.pnlPct * 100).toFixed(1) })),
    [positions]
  );

  const yFmt = (v: number) => fx.showUsd ? `$${((v / fx.usdIdr) / 1e6).toFixed(0)}M` : `${(v / 1e9).toFixed(1)}M`;
  const tooltipFmt = (v: number) => [fmt(v), isId ? "Portofolio" : "Portfolio"];
  const benchFmt   = (v: number) => [fmt(v), "IHSG"];

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

      {/* Modal */}
      {modalMode && (
        <PositionModal
          mode={modalMode}
          initialData={activeHolding}
          currentPrice={currentPrice}
          isId={isId}
          onSave={(h) => {
            if (modalMode === "add")  onAdd(h);
            else onUpdate(h.symbol, { lots: h.lots, avgPrice: h.avgPrice });
          }}
          onRemove={onRemove}
          onClose={closeModal}
        />
      )}

      {/* KPI cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <span style={{ fontSize: 11, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {card.label}
                </span>
                <div style={{ width: 28, height: 28, borderRadius: 4, background: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={13} style={{ color: card.color }} />
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)", lineHeight: 1 }}>{card.value}</div>
              <div style={{ fontSize: 11, color: card.color, fontFamily: "var(--font-mono)", marginTop: 6 }}>{card.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Equity curve + donut */}
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1fr_296px]">
        <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>{t("port_equity_curve")}</div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 16 }}>{t("port_equity_sub")}</div>
          <ResponsiveContainer width="100%" height={196}>
            {/* Spread to a mutable array: Recharts types `data` as any[], and a
                readonly const array is not assignable to it. */}
            <AreaChart data={[...PORTFOLIO_HISTORY]} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} tickFormatter={yFmt} width={64} />
              <Tooltip
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}
                formatter={(v: number, name: string) => name === "value" ? tooltipFmt(v) : benchFmt(v)}
              />
              <Area type="monotone" dataKey="value"     stroke="var(--neutral)"          strokeWidth={1.5} fill="var(--neutral)"          fillOpacity={0.08} dot={false} />
              <Area type="monotone" dataKey="benchmark" stroke="var(--muted-foreground)" strokeWidth={1}   fill="var(--muted-foreground)" fillOpacity={0.04} dot={false} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>{t("port_sector_alloc")}</div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 8 }}>{t("port_alloc_sub")}</div>
          <ResponsiveContainer width="100%" height={130}>
            <PieChart>
              <Pie data={sectorData} cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
                {sectorData.map((s, i) => <Cell key={`port-sec-${i}`} fill={s.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-col gap-1.5 mt-1">
            {sectorData.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div style={{ width: 7, height: 7, borderRadius: 1, background: item.color }} />
                  <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{item.name}</span>
                </div>
                <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{item.value.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Optimiser output vs actual positions — /v1/portfolio/optimise */}
      <AllocationPanel
        holdings={holdings}
        prices={Object.fromEntries(Object.entries(market.stocks).map(([k, v]) => [k, v.price]))}
        locale={isId ? "id" : "en"}
      />

      {/* Returns bar */}
      <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>{t("port_returns")}</div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 16 }}>
          {isId ? "Imbal hasil per saham vs harga beli rata-rata" : "Return per holding vs average cost"}
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={returnsBar} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="symbol" tick={{ fontSize: 10, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={36} />
            <Tooltip
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}
              formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, isId ? "Imbal Hasil" : "Return"]}
            />
            <Bar dataKey="ret" radius={[2, 2, 0, 0]}>
              {returnsBar.map((entry, i) => (
                <Cell key={`bar-${i}`} fill={entry.ret >= 0 ? "var(--gain)" : "var(--loss)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Positions table */}
      <div className="rounded overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{t("port_positions")}</span>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: 8 }}>
              {positions.length} {isId ? "posisi" : "positions"}
            </span>
          </div>
          <button
            onClick={() => openModal("add")}
            className="flex items-center gap-1.5"
            style={{
              background: "var(--primary)", border: "none", borderRadius: 5,
              padding: "6px 12px", cursor: "pointer",
              fontSize: 12, fontWeight: 500, color: "#fff",
            }}
          >
            <Plus size={13} />
            {t("port_add_position")}
          </button>
        </div>
        <div className="overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--muted)" }}>
              {[t("port_col_symbol"), t("port_col_lots"), t("port_col_avg"), t("port_col_current"), t("port_col_value"), t("port_col_cost"), t("port_col_pnl"), t("port_col_return"), t("port_col_weight"), t("port_col_actions")].map((h) => (
                <th key={h} style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 500, padding: "7px 12px", textAlign: h === t("port_col_symbol") ? "left" : "right", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={p.symbol} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--muted)" }}>
                <td style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{p.symbol}</div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 1, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{p.lots.toLocaleString("id-ID")}</td>
                <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{p.avgPrice.toLocaleString("id-ID")}</td>
                <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{p.price.toLocaleString("id-ID")}</td>
                <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{fmt(p.value)}</td>
                <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>{fmt(p.cost)}</td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: p.pnl >= 0 ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>
                    {p.pnl >= 0 ? "+" : ""}{fmt(Math.abs(p.pnl))}
                  </div>
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: p.pnlPct >= 0 ? "var(--gain)" : "var(--loss)", background: p.pnlPct >= 0 ? "var(--gain-bg)" : "var(--loss-bg)", padding: "2px 6px", borderRadius: 3 }}>
                    {p.pnlPct >= 0 ? "+" : ""}{(p.pnlPct * 100).toFixed(1)}%
                  </span>
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                  {totalValue > 0 ? (p.value / totalValue * 100).toFixed(1) : "0.0"}%
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  <div className="flex items-center justify-end gap-1">
                    <ActionBtn
                      icon={<Pencil size={11} />}
                      label={isId ? `Edit ${p.symbol}` : `Edit ${p.symbol}`}
                      onClick={() => openModal("edit", p.symbol)}
                    />
                    <ActionBtn
                      icon={<Trash2 size={11} />}
                      label={isId ? `Hapus ${p.symbol}` : `Remove ${p.symbol}`}
                      danger
                      onClick={() => openModal("delete", p.symbol)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {positions.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>
            {isId ? "Belum ada posisi. Klik \"Tambah Posisi\" untuk memulai." : "No positions yet. Click \"Add Position\" to get started."}
          </div>
        )}
      </div>

    </div>
  );
}

/* ── Tiny action button ──────────────────────────────────────────────────── */
function ActionBtn({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer",
        background: "var(--muted)",
        color: danger ? "var(--loss)" : "var(--muted-foreground)",
        transition: "background 0.1s, color 0.1s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = danger ? "var(--loss-bg)" : "var(--accent)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--muted)"; }}
    >
      {icon}
    </button>
  );
}
