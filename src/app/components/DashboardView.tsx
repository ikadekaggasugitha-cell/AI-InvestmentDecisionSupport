import { useMemo, useCallback, type ElementType } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { TrendingUp, TrendingDown, Activity, DollarSign, ChevronUp, ChevronDown, AlertCircle, Zap } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";
import { SECTOR_ALLOCATION, RECENT_TRANSACTIONS, ALERTS_DATA } from "../data/idxData";
import { fmtIdr, fmtAmount } from "../utils/formatting";
import type { PortfolioHolding, Transaction } from "../hooks/usePortfolio";
import type { LiveMarketData } from "../hooks/useLiveMarket";
import type { ExchangeRateData } from "../hooks/useExchangeRate";

interface Props {
  market:       LiveMarketData;
  fx:           ExchangeRateData;
  holdings:     PortfolioHolding[];
  transactions: Transaction[];
}

const ALERT_ICONS: Record<string, ElementType> = {
  signal: Zap, risk: AlertCircle, macro: Activity, rebalance: TrendingUp,
};
const ALERT_COLORS: Record<string, string> = {
  high: "var(--loss)", medium: "var(--warning)", low: "var(--neutral)",
};

export function DashboardView({ market, fx, holdings, transactions }: Props) {
  const { locale } = useApp();
  const { t }      = useTranslation(locale);
  const isId       = locale === "id";

  const fmt = useCallback(
    (n: number) => fmtAmount(n, fx.showUsd, fx.usdIdr),
    [fx.showUsd, fx.usdIdr]
  );

  const stocks    = useMemo(() => Object.values(market.stocks), [market.stocks]);
  const chartData = useMemo(() => market.intradayChart, [market.intradayChart]);

  /* Portfolio value from live holdings */
  const portfolioValue = useMemo(() =>
    holdings.reduce((sum, h) => {
      const price = market.stocks[h.symbol]?.price ?? h.avgPrice;
      return sum + h.lots * 100 * price;
    }, 0),
  [holdings, market.stocks]);

  /* Cost basis from current holdings (static until CRUD) */
  const costBasis = useMemo(
    () => holdings.reduce((s, h) => s + h.lots * 100 * h.avgPrice, 0),
    [holdings]
  );

  /* Daily P&L relative to portfolio prev close (simulated) */
  const dailyPnL    = portfolioValue - market.portfolioPrevClose;
  const dailyPnLPct = market.portfolioPrevClose > 0
    ? dailyPnL / market.portfolioPrevClose
    : market.dailyPnLPct;

  /* Top gainer — O(n) linear scan instead of O(n log n) sort */
  const topGainer = useMemo(() => {
    let best = stocks[0];
    for (const s of stocks) {
      if (s.changePct > (best?.changePct ?? -Infinity)) best = s;
    }
    return best;
  }, [stocks]);

  const sectorData = useMemo(
    () => SECTOR_ALLOCATION.map((s) => ({ name: isId ? s.name : s.nameEn, value: s.value, color: s.color })),
    [isId]
  );

  /* Top 5 holdings from live data */
  const topHoldings = useMemo(
    () => holdings.slice(0, 5).map((h) => {
      const price  = market.stocks[h.symbol]?.price ?? h.avgPrice;
      const value  = h.lots * 100 * price;
      const pnl    = value - h.lots * 100 * h.avgPrice;
      const pnlPct = pnl / (h.lots * 100 * h.avgPrice);
      return { symbol: h.symbol, lots: h.lots, value, pnl, pnlPct };
    }),
    [holdings, market.stocks]
  );

  /* Transactions: use real log if available, fallback to seed data */
  const recentTx = useMemo(() => {
    if (transactions.length > 0) {
      return [...transactions].reverse().slice(0, 5).map((tx) => ({
        id:     tx.id,
        symbol: tx.symbol,
        type:   tx.type,
        total:  tx.total,
        date:   isId ? tx.timeId : tx.timeEn,
      }));
    }
    return RECENT_TRANSACTIONS.slice(0, 5).map((tx) => ({
      id:     String(tx.id),
      symbol: tx.symbol,
      type:   tx.type,
      total:  tx.total,
      date:   tx.date,
    }));
  }, [transactions, isId]);

  const cards = [
    {
      label: t("dash_portfolio_value"),
      value: fmt(portfolioValue),
      sub:   `${t("dash_cost_basis")}: ${fmt(costBasis)}`,
      color: "var(--neutral)",
      icon:  DollarSign,
      signed: undefined as boolean | undefined,
    },
    {
      label: t("dash_daily_pnl"),
      value: `${dailyPnL >= 0 ? "+" : ""}${fmt(Math.abs(dailyPnL))}`,
      sub:   `${dailyPnLPct >= 0 ? "+" : ""}${(dailyPnLPct * 100).toFixed(2)}% ${t("dash_today")}`,
      color: dailyPnL >= 0 ? "var(--gain)" : "var(--loss)",
      icon:  dailyPnL >= 0 ? TrendingUp : TrendingDown,
      signed: dailyPnL >= 0,
    },
    {
      label: t("dash_ihsg"),
      value: market.ihsg.value.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      sub:   `${market.ihsg.change >= 0 ? "+" : ""}${market.ihsg.change.toFixed(2)} (${market.ihsg.changePct >= 0 ? "+" : ""}${market.ihsg.changePct.toFixed(2)}%)`,
      color: market.ihsg.changePct >= 0 ? "var(--gain)" : "var(--loss)",
      icon:  Activity,
      signed: market.ihsg.changePct >= 0,
    },
    {
      label: t("dash_top_gainer"),
      value: topGainer?.symbol ?? "—",
      sub:   topGainer ? `+${topGainer.changePct.toFixed(2)}% · ${topGainer.price.toLocaleString("id-ID")}` : "",
      color: "var(--gain)",
      icon:  TrendingUp,
      signed: true,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

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
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                {card.value}
              </div>
              <div className="flex items-center gap-1 mt-1.5" style={{ fontSize: 11, color: card.color, fontFamily: "var(--font-mono)" }}>
                {card.signed === true  && <ChevronUp size={11} />}
                {card.signed === false && <ChevronDown size={11} />}
                {card.sub}
              </div>
            </div>
          );
        })}
      </div>

      {/* Chart row */}
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1fr_296px]">

        {/* Intraday chart */}
        <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>
            {t("dash_intraday")}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 16 }}>
            {t("dash_intraday_sub")}
          </div>
          <ResponsiveContainer width="100%" height={196}>
            <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} tickFormatter={fmtIdr} width={76} />
              <Tooltip
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}
                formatter={(v: number) => [fmtIdr(v), isId ? "Portofolio" : "Portfolio"]}
              />
              <Area type="monotone" dataKey="value" stroke="var(--gain)" strokeWidth={1.5} fill="var(--gain)" fillOpacity={0.08} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Sector donut */}
        <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>
            {t("dash_sector_alloc")}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 8 }}>
            {isId ? "Berdasarkan bobot" : "By weight"}
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <PieChart>
              <Pie data={sectorData} cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
                {sectorData.map((s, i) => <Cell key={`sec-${i}`} fill={s.color} />)}
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
                <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                  {item.value.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">

        {/* Top holdings */}
        <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 12 }}>
            {t("dash_top_holdings")}
          </div>
          {topHoldings.map((h, i) => (
            <div key={h.symbol} className="flex items-center justify-between py-2" style={{ borderBottom: i < topHoldings.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{h.symbol}</div>
                <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 1 }}>{h.lots.toLocaleString()} {isId ? "lot" : "lots"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{fmt(h.value)}</div>
                <div style={{ fontSize: 10, color: h.pnlPct >= 0 ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>
                  {h.pnlPct >= 0 ? "+" : ""}{(h.pnlPct * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          ))}
          {topHoldings.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", paddingTop: 4 }}>
              {isId ? "Belum ada posisi" : "No positions yet"}
            </div>
          )}
        </div>

        {/* Recent transactions */}
        <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 12 }}>
            {t("dash_recent_tx")}
          </div>
          {recentTx.map((tx, i) => {
            const typeColor = tx.type === "BUY" ? "var(--gain)" : tx.type === "SELL" ? "var(--loss)" : "var(--neutral)";
            const typeLabel = isId ? (tx.type === "BUY" ? "BELI" : tx.type === "SELL" ? "JUAL" : "DIV") : tx.type;
            return (
              <div key={tx.id} className="flex items-center justify-between py-2" style={{ borderBottom: i < recentTx.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 700, color: typeColor, background: "var(--muted)", padding: "1px 5px", borderRadius: 2 }}>
                    {typeLabel}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{tx.symbol}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{fmtIdr(tx.total)}</div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{tx.date.split(" ").slice(0, 3).join(" ")}</div>
                </div>
              </div>
            );
          })}
          {recentTx.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", paddingTop: 4 }}>
              {t("port_tx_empty")}
            </div>
          )}
        </div>

        {/* AI alerts */}
        <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 12 }}>
            {t("dash_ai_alerts")}
          </div>
          <div className="flex flex-col gap-2">
            {ALERTS_DATA.map((alert) => {
              const Icon  = ALERT_ICONS[alert.type] ?? AlertCircle;
              const color = ALERT_COLORS[alert.severity] ?? "var(--muted-foreground)";
              return (
                <div key={alert.id} className="flex gap-2.5 p-2 rounded" style={{ background: "var(--muted)" }}>
                  <Icon size={12} style={{ color, flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 11, color: "var(--foreground)", lineHeight: 1.4 }}>
                      {isId ? alert.msgId : alert.msgEn}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 2 }}>
                      {isId ? alert.timeId : alert.timeEn}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
