import { useMemo, useCallback, type ElementType } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { TrendingUp, Activity, ChevronUp, ChevronDown, AlertCircle, Zap, FlaskConical } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";
import { SECTOR_ALLOCATION, RECENT_TRANSACTIONS } from "../data/idxData";
import type { AlertItem } from "./AlertsView";
import { fmtIdr, fmtAmount } from "../utils/formatting";
import type { PortfolioHolding, Transaction } from "../hooks/usePortfolio";
import type { LiveMarketData } from "../hooks/useLiveMarket";
import type { ExchangeRateData } from "../hooks/useExchangeRate";

interface Props {
  market:       LiveMarketData;
  fx:           ExchangeRateData;
  holdings:     PortfolioHolding[];
  transactions: Transaction[];
  /** Open a stock in Markets (holding/transaction rows are drill-downs). */
  onSelectSymbol?: (symbol: string) => void;
  /**
   * The live alert feed, owned by useAlerts in App. This panel used to render
   * the bundled ALERTS_DATA seed directly with no live/simulated marker, so the
   * dashboard and the Alerts view showed lists with the same heading and
   * different sources, and a backend outage looked like a quiet market.
   */
  alerts: readonly AlertItem[];
  alertsIsLive: boolean;
  /** The empty-state action: the only honest way off a "no positions" card. */
  onOpenPortfolio?: () => void;
}

const ALERT_ICONS: Record<string, ElementType> = {
  signal: Zap, risk: AlertCircle, macro: Activity, rebalance: TrendingUp,
};
const ALERT_COLORS: Record<string, string> = {
  high: "var(--loss)", medium: "var(--warning)", low: "var(--neutral)",
};

export function DashboardView({ market, fx, holdings, transactions, onSelectSymbol, alerts, alertsIsLive, onOpenPortfolio }: Props) {
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

  /* Cost basis of the positions that have one.
   *
   * A holding with no recorded purchase price contributes nothing rather than
   * contributing zero: summing a null as 0 would report a total cost basis that
   * looks complete while silently excluding part of the portfolio, and the
   * unrealised P&L derived from it would be wrong in the direction that flatters.
   */
  const costBasis = useMemo(
    () => holdings.reduce((s, h) => s + (h.avgPrice == null ? 0 : h.lots * 100 * h.avgPrice), 0),
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

  /* The seed's sector weights describe the market's structure. The list needs
     no per-slice colour at all: the bar list prints ink on the largest row and
     grey behind it, so the chart's one hue stays with the intraday curve. */
  const sectorData = useMemo(
    () => SECTOR_ALLOCATION.map((s) => ({
      name: isId ? s.name : s.nameEn,
      value: s.value,
    })),
    [isId]
  );

  /* Top 5 holdings from live data */
  const topHoldings = useMemo(
    () => holdings.slice(0, 5).map((h) => {
      const price = market.stocks[h.symbol]?.price ?? h.avgPrice ?? 0;
      const value = h.lots * 100 * price;
      // Without a purchase price there is no unrealised P&L to state. Reporting
      // zero would be indistinguishable from a position sitting exactly at cost,
      // which is a different and much rarer thing.
      const basis = h.avgPrice == null ? null : h.lots * 100 * h.avgPrice;
      const pnl    = basis == null ? null : value - basis;
      const pnlPct = basis ? pnl! / basis : null;
      return { symbol: h.symbol, lots: h.lots, value, pnl, pnlPct };
    }),
    [holdings, market.stocks]
  );

  /* Transactions: use the real log when there is one, otherwise the bundled
     seed. `txIsSample` says which, so the card can state it. */
  const txIsSample = transactions.length === 0;
  const recentTx = useMemo(() => {
    if (!txIsSample) {
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
  }, [transactions, isId, txIsSample]);

  const cards: Array<{
    label: string; value: string; sub: string; color: string; signed?: boolean; lead?: boolean;
  }> = [
    /* Nilai portofolio is the screen's answer figure, so it prints ~1.3× its
       siblings instead of matching them (the icon chips are gone: none of the
       twenty-three app screens studied paints an icon circle next to a KPI). */
    {
      label: t("dash_portfolio_value"),
      value: fmt(portfolioValue),
      sub:   `${t("dash_cost_basis")}: ${fmt(costBasis)}`,
      color: "var(--muted-foreground)",
      lead:  true,
    },
    {
      label: t("dash_daily_pnl"),
      value: `${dailyPnL >= 0 ? "+" : ""}${fmt(Math.abs(dailyPnL))}`,
      sub:   `${dailyPnLPct >= 0 ? "+" : ""}${(dailyPnLPct * 100).toFixed(2)}% ${t("dash_today")}`,
      /* A flat P&L is not a win: zero prints grey and colour is spent only when
         the number actually moved. */
      color: dailyPnL > 0 ? "var(--gain)" : dailyPnL < 0 ? "var(--loss)" : "var(--muted-foreground)",
      signed: dailyPnL === 0 ? undefined : dailyPnL > 0,
    },
    {
      label: t("dash_ihsg"),
      value: market.ihsg.value.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      sub:   `${market.ihsg.change >= 0 ? "+" : ""}${market.ihsg.change.toFixed(2)} (${market.ihsg.changePct >= 0 ? "+" : ""}${market.ihsg.changePct.toFixed(2)}%)`,
      color: market.ihsg.changePct > 0 ? "var(--gain)" : market.ihsg.changePct < 0 ? "var(--loss)" : "var(--muted-foreground)",
      signed: market.ihsg.changePct === 0 ? undefined : market.ihsg.changePct > 0,
    },
    {
      label: t("dash_top_gainer"),
      value: topGainer?.symbol ?? "—",
      sub:   topGainer ? `+${topGainer.changePct.toFixed(2)}% · ${topGainer.price.toLocaleString("id-ID")}` : "",
      /* Same zero rule: a gainer sitting exactly flat prints grey, and no
         chevron — flat is neither up nor down. */
      color: topGainer && topGainer.changePct > 0 ? "var(--gain)" : "var(--muted-foreground)",
      signed: topGainer && topGainer.changePct > 0 ? true : undefined,
    },
  ];

  /* The sector list renders in both feed states — beside the chart with data,
     full-width under the slim notice without — so it lives as one element.
     Six parts exceed the ring budget (three to five slices): the bar list
     ranks them and reads without hue. */
  const sectorCard = (
    <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>
        {t("dash_sector_alloc")}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 12 }}>
        {isId ? "Berdasarkan bobot" : "By weight"}
      </div>
      <div className="flex flex-col gap-2.5">
        {[...sectorData].sort((a, b) => b.value - a.value).map((s, i, arr) => {
          const topValue = arr[0].value > 0 ? arr[0].value : 1;
          return (
            <div key={s.name}>
              <div className="flex items-baseline justify-between">
                <span style={{ fontSize: 13, color: i === 0 ? "var(--foreground)" : "var(--muted-foreground)" }}>
                  {s.name}
                </span>
                <span style={{ fontSize: 13, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                  {s.value.toFixed(1)}%
                </span>
              </div>
              {/* Proportional to the largest row and capped at 88%, so the
                  trail never reads as a full-width rule; a zero share draws
                  no bar rather than a fake sliver. */}
              <div style={{ height: 6, borderRadius: 3, background: "var(--muted)", marginTop: 4 }}>
                <div
                  style={{
                    height: "100%",
                    borderRadius: 3,
                    background: i === 0 ? "var(--foreground)" : "var(--neutral)",
                    width: s.value > 0 ? `${Math.max((s.value / topValue) * 88, 1.5)}%` : "0%",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6 flex flex-col gap-5 [&>*]:shrink-0">

      {/* KPI row. Icon chips are gone: the KPI's ink is the identity, the
          value is the key number, and the label stays quiet above them. */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 8 }}>
              {card.label}
            </div>
            <div style={{ fontSize: card.lead ? 26 : 20, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)", lineHeight: 1 }}>
              {card.value}
            </div>
            <div className="flex items-center gap-1 mt-1.5" style={{ fontSize: 12, color: card.color, fontFamily: "var(--font-mono)" }}>
              {card.signed === true  && <ChevronUp size={12} />}
              {card.signed === false && <ChevronDown size={12} />}
              <span>{card.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Chart row. An empty feed in the wide chart frame is a void, not a
          state: the empty feed prints a slim strip and the sector list takes
          the row; with data both cards sit side by side. */}
      {chartData.length === 0 ? (
        <>
          <div className="rounded p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
              {t("dash_no_intraday")}
            </div>
          </div>
          {sectorCard}
        </>
      ) : (
        <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1fr_296px] items-start">

          {/* Intraday chart. The main data element owns the one chart hue; the
              grid and axes stay grey and horizontal only. */}
          <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>
              {t("dash_intraday")}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 16 }}>
              {t("dash_intraday_sub")}
            </div>
            <ResponsiveContainer width="100%" height={196}>
              <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} tickFormatter={fmtIdr} width={76} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}
                  formatter={(v: number) => [fmtIdr(v), isId ? "Portofolio" : "Portfolio"]}
                />
                <Area type="monotone" dataKey="value" stroke="var(--gain)" strokeWidth={1.5} fill="var(--gain)" fillOpacity={0.08} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {sectorCard}
        </div>
      )}

      {/* Bottom row. items-start keeps each card at its own height instead of
          stretching a short list into an empty band; three-up starts at lg
          because three ~150px columns at 768 truncate the figures. */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3 items-start">

        {/* Top holdings */}
        <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", marginBottom: 12 }}>
            {t("dash_top_holdings")}
          </div>
          {topHoldings.map((h, i) => (
            <div
              key={h.symbol}
              onClick={() => onSelectSymbol?.(h.symbol)}
              role={onSelectSymbol ? "button" : undefined}
              title={onSelectSymbol ? (isId ? `Buka ${h.symbol} di Pasar` : `Open ${h.symbol} in Markets`) : undefined}
              className="flex items-center justify-between py-2"
              style={{
                borderBottom: i < topHoldings.length - 1 ? "1px solid var(--border)" : "none",
                cursor: onSelectSymbol ? "pointer" : "default",
                transition: "background-color 0.15s",
              }}
              onMouseEnter={(e) => { if (onSelectSymbol) (e.currentTarget as HTMLDivElement).style.background = "var(--muted)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{h.symbol}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>{h.lots.toLocaleString()} {isId ? "lot" : "lots"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{fmt(h.value)}</div>
                {/* Blank rather than 0.00% when no purchase price is known: a
                    flat percentage reads as "exactly at cost", which is a claim
                    about a purchase this account has not recorded. */}
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    ...(h.pnlPct == null
                      ? { color: "var(--muted-foreground)" }
                      : { color: h.pnlPct >= 0 ? "var(--gain)" : "var(--loss)" }),
                  }}
                >
                  {h.pnlPct == null ? "—" : `${h.pnlPct >= 0 ? "+" : ""}${(h.pnlPct * 100).toFixed(1)}%`}
                </div>
              </div>
            </div>
          ))}
          {topHoldings.length === 0 && (
            /* Not just a sentence: the next step sits in the frame, so the
               empty card offers a way forward instead of a period. */
            <div style={{ paddingTop: 4 }}>
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                {t("dash_empty_position")}
              </div>
              {onOpenPortfolio && (
                <button
                  onClick={onOpenPortfolio}
                  style={{
                    background: "none", border: "none", padding: 0,
                    marginTop: 6, cursor: "pointer",
                    fontSize: 13, fontWeight: 500, color: "var(--link)",
                  }}
                >
                  {t("dash_empty_position_action")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recent transactions */}
        <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          {/* Provenance stated in plain text, matching the alerts card below.
              These seed rows are shaped exactly like real ones (ticker, BUY/SELL
              chip, rupiah total, a plausible date), so without the label a
              bundled list reads as the user's own trade history. */}
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
              {t("dash_recent_tx")}
            </span>
            {txIsSample && (
              <span
                className="flex items-center gap-1"
                style={{ fontSize: 11, color: "var(--warning)" }}
                title={isId
                  ? "Belum ada transaksi tercatat. Daftar di bawah adalah data contoh, bukan transaksi Anda."
                  : "No transactions recorded yet. The list below is sample data, not your trades."}
              >
                <FlaskConical size={11} />
                {isId ? "Data contoh" : "Sample data"}
              </span>
            )}
          </div>
          {recentTx.map((tx, i) => {
            const typeColor = tx.type === "BUY" ? "var(--gain)" : tx.type === "SELL" ? "var(--loss)" : "var(--neutral)";
            const typeLabel = isId ? (tx.type === "BUY" ? "BELI" : tx.type === "SELL" ? "JUAL" : "DIV") : tx.type;
            return (
              <div key={tx.id} className="flex items-center justify-between py-2" style={{ borderBottom: i < recentTx.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, color: typeColor, background: "var(--muted)", padding: "1px 5px", borderRadius: 2 }}>
                    {typeLabel}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{tx.symbol}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{fmtIdr(tx.total)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{tx.date.split(" ").slice(0, 3).join(" ")}</div>
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
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
              {t("dash_ai_alerts")}
            </div>
            {!alertsIsLive && (
              <span
                className="flex items-center gap-1"
                style={{ fontSize: 11, color: "var(--warning)" }}
                title={isId
                  ? "Feed langsung tidak dapat dihubungi; daftar di bawah adalah data contoh."
                  : "Live feed unreachable; the list below is sample data."}
              >
                <FlaskConical size={11} />
                {isId ? "Data contoh" : "Sample data"}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {/* Top 5 of the live feed. Provenance is stated because the seed
                alerts are shaped exactly like real ones. */}
            {alerts.slice(0, 5).map((alert) => {
              const Icon  = ALERT_ICONS[alert.type] ?? AlertCircle;
              const color = ALERT_COLORS[alert.severity] ?? "var(--muted-foreground)";
              return (
                <div key={alert.key} className="flex gap-2.5 p-2 rounded" style={{ background: "var(--muted)" }}>
                  <Icon size={12} style={{ color, flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 12, color: "var(--foreground)", lineHeight: 1.45 }}>
                      {isId ? alert.msgId : alert.msgEn}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>
                      {alert.timeId || alert.timeEn}
                    </div>
                  </div>
                </div>
              );
            })}
            {alerts.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "8px 2px" }}>
                {isId ? "Tidak ada peringatan aktif." : "No active alerts."}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
