import { useMemo, useCallback, useState, type ElementType } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts'
import {
  TrendingUp,
  Activity,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Zap,
  FlaskConical,
} from 'lucide-react'
import { useApp } from '@/app/context/AppContext'
import { useTranslation } from '@/app/i18n/translations'
import { SECTOR_ALLOCATION, RECENT_TRANSACTIONS, IDX_STOCKS } from '@/app/data/idxData'
import type { AlertItem } from '@/app/features/reports/AlertsView'
import { fmtIdr, fmtAmount } from '@/app/utils/formatting'
import type { PortfolioHolding, Transaction } from '@/app/features/portfolio/usePortfolio'
import type { LiveMarketData } from '@/app/features/market/useLiveMarket'
import type { ExchangeRateData } from '@/app/features/market/useExchangeRate'

interface Props {
  market: LiveMarketData
  fx: ExchangeRateData
  holdings: PortfolioHolding[]
  transactions: Transaction[]
  /** Open a stock in Markets (holding/transaction rows are drill-downs). */
  onSelectSymbol?: (symbol: string) => void
  /** Open the AI Advisor view from a signal row. */
  onOpenAIAdvisor?: () => void
  /**
   * The live alert feed, owned by useAlerts in App. This panel used to render
   * the bundled ALERTS_DATA seed directly with no live/simulated marker, so the
   * dashboard and the Alerts view showed lists with the same heading and
   * different sources, and a backend outage looked like a quiet market.
   */
  alerts: readonly AlertItem[]
  alertsIsLive: boolean
  /** The empty-state action: the only honest way off a "no positions" card. */
  onOpenPortfolio?: () => void
  /**
   * Glass mode, passed down from App's `glassy`. It does one structural thing:
   * the view stops owning its own scroll container and lets the shell column
   * scroll instead, so the sticky glass header has real content flowing under it
   * — the only place backdrop-filter gets something to refract on this screen.
   */
  glass?: boolean
}

const ALERT_ICONS: Record<string, ElementType> = {
  signal: Zap,
  risk: AlertCircle,
  macro: Activity,
  rebalance: TrendingUp,
}
const ALERT_COLORS: Record<string, string> = {
  high: 'var(--loss)',
  medium: 'var(--warning)',
  low: 'var(--neutral)',
}

/* Category hues for the sector donut, matching PortfolioView's ramp so the
   same weight list reads the same colour on both screens. */
const sectorColor = (index: number) =>
  index < 5
    ? (
        [
          'var(--chart-1)',
          'var(--chart-2)',
          'var(--chart-3)',
          'var(--chart-4)',
          'var(--chart-5)',
        ] as const
      )[index]
    : 'var(--muted)'

/* A tiny trend line inside the KPI cards. Flat series stay grey, so they
   do not read as movement. */
function Sparkline({
  data,
  width = 88,
  height = 28,
}: {
  data: number[]
  width?: number
  height?: number
}) {
  const normalized = useMemo(() => data.map((v, i) => ({ v, i })), [data])
  const first = data[0]
  const flat = data.length === 0 || data.every((v) => v === first)
  const up = flat ? undefined : data[data.length - 1] >= first
  // Fixed width/height on the chart itself. ResponsiveContainer with fixed
  // numbers is a div with no room to respond in and recharts warns on it.
  return (
    <LineChart width={width} height={height} data={normalized} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
      <Line
        type="monotone"
        dataKey="v"
        stroke={flat ? 'var(--muted-foreground)' : up ? 'var(--gain)' : 'var(--loss)'}
        strokeWidth={1.4}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  )
}

export function DashboardView({
  market,
  fx,
  holdings,
  transactions,
  onSelectSymbol,
  onOpenAIAdvisor,
  alerts,
  alertsIsLive,
  onOpenPortfolio,
  glass = false,
}: Props) {
  const { locale } = useApp()
  const { t } = useTranslation(locale)
  const isId = locale === 'id'
  const [activeSector, setActiveSector] = useState<string | null>(null)

  const fmt = useCallback(
    (n: number) => fmtAmount(n, fx.showUsd, fx.usdIdr),
    [fx.showUsd, fx.usdIdr],
  )

  const stocks = useMemo(() => Object.values(market.stocks), [market.stocks])
  const chartData = useMemo(() => market.intradayChart, [market.intradayChart])
  /* Portfolio value from live holdings */
  const portfolioValue = useMemo(
    () =>
      holdings.reduce((sum, h) => {
        const price = market.stocks[h.symbol]?.price ?? h.avgPrice
        return sum + h.lots * 100 * price
      }, 0),
    [holdings, market.stocks],
  )

  /* Cost basis of the positions that have one.
   *
   * A holding with no recorded purchase price contributes nothing rather than
   * contributing zero: summing a null as 0 would report a total cost basis that
   * looks complete while silently excluding part of the portfolio, and the
   * unrealised P&L derived from it would be wrong in the direction that flatters.
   */
  const costBasis = useMemo(
    () => holdings.reduce((s, h) => s + (h.avgPrice == null ? 0 : h.lots * 100 * h.avgPrice), 0),
    [holdings],
  )

  /* Daily P&L relative to portfolio prev close (simulated) */
  const dailyPnL = portfolioValue - market.portfolioPrevClose
  const dailyPnLPct =
    market.portfolioPrevClose > 0 ? dailyPnL / market.portfolioPrevClose : market.dailyPnLPct

  /* Top gainer — O(n) linear scan instead of O(n log n) sort */
  const topGainer = useMemo(() => {
    let best = stocks[0]
    for (const s of stocks) {
      if (s.changePct > (best?.changePct ?? -Infinity)) best = s
    }
    return best
  }, [stocks])

  /* Sector weights with the stocks that compose each slice, for the hover
     list. Symbols come from the real universe, not invented examples. */
  const sectorData = useMemo(
    () =>
      [...SECTOR_ALLOCATION]
        .sort((a, b) => b.value - a.value)
        .map((s, i) => ({
          name: isId ? s.name : s.nameEn,
          value: s.value,
          color: sectorColor(i),
          symbols: IDX_STOCKS.filter((st) =>
            isId ? st.sector === s.name : st.sectorEn === s.nameEn,
          )
            .slice(0, 3)
            .map((st) => st.symbol),
        })),
    [isId],
  )

  /* Top 5 holdings from live data */
  const topHoldings = useMemo(
    () =>
      holdings.slice(0, 5).map((h) => {
        const price = market.stocks[h.symbol]?.price ?? h.avgPrice ?? 0
        const value = h.lots * 100 * price
        // Without a purchase price there is no unrealised P&L to state. Reporting
        // zero would be indistinguishable from a position sitting exactly at cost,
        // which is a different and much rarer thing.
        const basis = h.avgPrice == null ? null : h.lots * 100 * h.avgPrice
        const pnl = basis == null ? null : value - basis
        const pnlPct = basis ? pnl! / basis : null
        return { symbol: h.symbol, lots: h.lots, value, pnl, pnlPct }
      }),
    [holdings, market.stocks],
  )

  /* Transactions: use the real log when there is one, otherwise the bundled
     seed. `txIsSample` says which, so the card can state it. */
  const txIsSample = transactions.length === 0
  const recentTx = useMemo(() => {
    if (!txIsSample) {
      return [...transactions]
        .reverse()
        .slice(0, 5)
        .map((tx) => ({
          id: tx.id,
          symbol: tx.symbol,
          type: tx.type,
          total: tx.total,
          date: isId ? tx.timeId : tx.timeEn,
        }))
    }
    return RECENT_TRANSACTIONS.slice(0, 5).map((tx) => ({
      id: String(tx.id),
      symbol: tx.symbol,
      type: tx.type,
      total: tx.total,
      date: tx.date,
    }))
  }, [transactions, isId, txIsSample])

  /* Sparklines reuse the tick history each stock already carries. They
     are trends of real feed data, never invented points, so an empty or
     flat history prints the grey line rather than a shape. */
  const portfolioSpark = useMemo(() => {
    const series = holdings.map((h) => ({
      lots: h.lots,
      history: market.stocks[h.symbol]?.history ?? [],
    }))
    const nonEmpty = series.filter((s) => s.history.length > 0)
    if (!nonEmpty.length) return []
    const min = Math.min(...nonEmpty.map((s) => s.history.length))
    return Array.from({ length: min }, (_, i) =>
      Math.round(nonEmpty.reduce((sum, s) => sum + s.lots * 100 * s.history[i], 0)),
    )
  }, [holdings, market.stocks])
  const ihsgSpark = useMemo(() => chartData.map((p) => p.ihsg), [chartData])
  const pnlSpark = portfolioSpark
  const topGainerSpark = topGainer?.history ?? []

  const cards: Array<{
    label: string
    value: string
    sub: string
    color: string
    signed?: boolean
    lead?: boolean
    spark: number[]
  }> = [
    /* Nilai portofolio is the screen's answer figure, so it prints ~1.3× its
       siblings instead of matching them (the icon chips are gone: none of the
       twenty-three app screens studied paints an icon circle next to a KPI). */
    {
      label: t('dash_portfolio_value'),
      value: fmt(portfolioValue),
      sub: `${t('dash_cost_basis')}: ${fmt(costBasis)}`,
      color: 'var(--muted-foreground)',
      lead: true,
      spark: portfolioSpark,
    },
    {
      label: t('dash_daily_pnl'),
      value: `${dailyPnL >= 0 ? '+' : ''}${fmt(Math.abs(dailyPnL))}`,
      sub: `${dailyPnLPct >= 0 ? '+' : ''}${(dailyPnLPct * 100).toFixed(2)}% ${t('dash_today')}`,
      /* A flat P&L is not a win: zero prints grey and colour is spent only when
         the number actually moved. */
      color:
        dailyPnL > 0 ? 'var(--gain)' : dailyPnL < 0 ? 'var(--loss)' : 'var(--muted-foreground)',
      signed: dailyPnL === 0 ? undefined : dailyPnL > 0,
      spark: pnlSpark,
    },
    {
      label: t('dash_ihsg'),
      value: market.ihsg.value.toLocaleString('id-ID', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      sub: `${market.ihsg.change >= 0 ? '+' : ''}${market.ihsg.change.toFixed(2)} (${market.ihsg.changePct >= 0 ? '+' : ''}${market.ihsg.changePct.toFixed(2)}%)`,
      color:
        market.ihsg.changePct > 0
          ? 'var(--gain)'
          : market.ihsg.changePct < 0
            ? 'var(--loss)'
            : 'var(--muted-foreground)',
      signed: market.ihsg.changePct === 0 ? undefined : market.ihsg.changePct > 0,
      spark: ihsgSpark,
    },
    {
      label: t('dash_top_gainer'),
      value: topGainer?.symbol ?? '—',
      sub: topGainer
        ? `+${topGainer.changePct.toFixed(2)}% · ${topGainer.price.toLocaleString('id-ID')}`
        : '',
      /* Same zero rule: a gainer sitting exactly flat prints grey, and no
         chevron — flat is neither up nor down. */
      color: topGainer && topGainer.changePct > 0 ? 'var(--gain)' : 'var(--muted-foreground)',
      signed: topGainer && topGainer.changePct > 0 ? true : undefined,
      spark: topGainerSpark,
    },
  ]

  /* Donut on the left, legend on the right. Hovering a slice dims the
     others and shows its top stocks, so colour is never the only carrier. */
  const active = activeSector ? sectorData.find((s) => s.name === activeSector) : null
  const sectorCard = (
    <div className="p-5 glass-card">
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2 }}>
        {t('dash_sector_alloc')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 12 }}>
        {active
          ? `${active.name} ${active.value.toFixed(1)}%${active.symbols.length ? ` · ${active.symbols.join(', ')}` : ''}`
          : isId
            ? 'Berdasarkan bobot'
            : 'By weight'}
      </div>
      <div className="flex items-center gap-4">
        {/* Fixed 110×110 canvas: the card sizes the slot, so a container that
            "responds" has nothing to respond to and recharts warns on it. */}
        <PieChart width={110} height={110}>
            <Pie
              data={sectorData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={34}
              outerRadius={50}
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={(_, i) => setActiveSector(sectorData[i]?.name ?? null)}
              onMouseLeave={() => setActiveSector(null)}
            >
              {sectorData.map((s) => (
                <Cell
                  key={s.name}
                  fill={s.color}
                  stroke="var(--card)"
                  fillOpacity={!activeSector || activeSector === s.name ? 1 : 0.35}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--foreground)',
              }}
              formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
            />
          </PieChart>
        <div className="flex flex-col gap-1.5" style={{ flex: 1, minWidth: 0 }}>
          {sectorData.map((s) => (
            <button
              key={s.name}
              type="button"
              onMouseEnter={() => setActiveSector(s.name)}
              onMouseLeave={() => setActiveSector(null)}
              onFocus={() => setActiveSector(s.name)}
              onBlur={() => setActiveSector(null)}
              className="flex items-center gap-2 text-left"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              aria-label={`${s.name} ${s.value.toFixed(1)}%${s.symbols.length ? ` ${s.symbols.join(', ')}` : ''}`}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: s.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--foreground)',
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {s.name}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--muted-foreground)',
                }}
              >
                {s.value.toFixed(1)}%
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div
      className={
        glass
          ? // The shell column scrolls; this view grows to its content so the
            // sticky glass bar above has cards passing beneath it. Compressed
            // rhythm (gap-4/p-5): the alerts row is the dashboard's core value,
            // and the tighter the rows above it, the sooner it enters the
            // viewport.
            'flex flex-col gap-4 p-5 [&>*]:shrink-0'
          : 'min-h-0 flex-1 overflow-y-auto p-5 flex flex-col gap-4 [&>*]:shrink-0'
      }
    >
      {/* KPI row. Icon chips are gone: the KPI's ink is the identity, the
          value is the key number, and the label stays quiet above them. */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="p-5 glass-card">
            <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 8 }}>
              {card.label}
            </div>
            <div
              style={{
                fontSize: card.lead ? 30 : 24,
                fontWeight: 700,
                color: 'var(--foreground)',
                fontFamily: 'var(--font-mono)',
                lineHeight: 1,
              }}
            >
              {card.value}
            </div>
            {card.spark.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Sparkline data={card.spark} width={120} height={24} />
              </div>
            )}
            <div
              className="flex items-center gap-1 mt-1.5"
              style={{ fontSize: 12, color: card.color, fontFamily: 'var(--font-mono)' }}
            >
              {card.signed === true && <ChevronUp size={12} />}
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
          <div className="p-4 glass-card">
            <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
              {t('dash_no_intraday')}
            </div>
          </div>
          {sectorCard}
        </>
      ) : (
        <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1fr_296px] items-start">
          {/* Intraday chart. The main data element owns the one chart hue; the
              grid and axes stay grey and horizontal only. */}
          <div className="p-5 glass-card">
            <div
              style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2 }}
            >
              {t('dash_intraday')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 16 }}>
              {t('dash_intraday_sub')}
            </div>
            <ResponsiveContainer width="100%" height={168}>
              <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="time"
                  tick={{
                    fontSize: 11,
                    fill: 'var(--muted-foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  /* Vendor tick clocks repeat one minute for whole bursts of
                     quotes, so the floor fills with identical stamps. Blank the
                     ones that repeat the previous minute; the ends and each new
                     minute keep their ink. */
                  tickFormatter={(t: string, i: number) =>
                    i === 0 ||
                    i === chartData.length - 1 ||
                    chartData[i]?.time !== chartData[i - 1]?.time
                      ? t
                      : ''
                  }
                />
                <YAxis
                  tick={{
                    fontSize: 11,
                    fill: 'var(--muted-foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={fmtIdr}
                  width={76}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--foreground)',
                  }}
                  formatter={(v: number) => [fmtIdr(v), isId ? 'Portofolio' : 'Portfolio']}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--gain)"
                  strokeWidth={1.5}
                  fill="var(--gain)"
                  fillOpacity={0.08}
                  dot={false}
                />
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
        <div className="p-5 glass-card">
          <div
            style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', marginBottom: 12 }}
          >
            {t('dash_top_holdings')}
          </div>
          {topHoldings.map((h, i) => (
            <div
              key={h.symbol}
              onClick={() => onSelectSymbol?.(h.symbol)}
              role={onSelectSymbol ? 'button' : undefined}
              title={
                onSelectSymbol
                  ? isId
                    ? `Buka ${h.symbol} di Pasar`
                    : `Open ${h.symbol} in Markets`
                  : undefined
              }
              className="flex items-center justify-between py-2"
              style={{
                borderBottom: i < topHoldings.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: onSelectSymbol ? 'pointer' : 'default',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (onSelectSymbol)
                  (e.currentTarget as HTMLDivElement).style.background = 'var(--muted)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLDivElement).style.background = 'transparent'
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {h.symbol}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 1 }}>
                  {h.lots.toLocaleString()} {isId ? 'lot' : 'lots'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {fmt(h.value)}
                </div>
                {/* Blank rather than 0.00% when no purchase price is known: a
                    flat percentage reads as "exactly at cost", which is a claim
                    about a purchase this account has not recorded. */}
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    ...(h.pnlPct == null
                      ? { color: 'var(--muted-foreground)' }
                      : { color: h.pnlPct >= 0 ? 'var(--gain)' : 'var(--loss)' }),
                  }}
                >
                  {h.pnlPct == null
                    ? '—'
                    : `${h.pnlPct >= 0 ? '+' : ''}${(h.pnlPct * 100).toFixed(1)}%`}
                </div>
              </div>
            </div>
          ))}
          {topHoldings.length === 0 && (
            /* Not just a sentence: the next step sits in the frame, so the
               empty card offers a way forward instead of a period. */
            <div style={{ paddingTop: 4 }}>
              <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
                {t('dash_empty_position')}
              </div>
              {onOpenPortfolio && (
                <button
                  onClick={onOpenPortfolio}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    marginTop: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--link)',
                  }}
                >
                  {t('dash_empty_position_action')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recent transactions */}
        <div className="p-5 glass-card">
          {/* Provenance stated in plain text, matching the alerts card below.
              These seed rows are shaped exactly like real ones (ticker, BUY/SELL
              chip, rupiah total, a plausible date), so without the label a
              bundled list reads as the user's own trade history. */}
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>
              {t('dash_recent_tx')}
            </span>
            {txIsSample && (
              <span
                className="flex items-center gap-1"
                style={{ fontSize: 11, color: 'var(--warning)' }}
                title={
                  isId
                    ? 'Belum ada transaksi tercatat. Daftar di bawah adalah data contoh, bukan transaksi Anda.'
                    : 'No transactions recorded yet. The list below is sample data, not your trades.'
                }
              >
                <FlaskConical size={11} />
                {isId ? 'Data contoh' : 'Sample data'}
              </span>
            )}
          </div>
          {recentTx.map((tx, i) => {
            const typeColor =
              tx.type === 'BUY'
                ? 'var(--gain)'
                : tx.type === 'SELL'
                  ? 'var(--loss)'
                  : 'var(--neutral)'
            const typeLabel = isId
              ? tx.type === 'BUY'
                ? 'BELI'
                : tx.type === 'SELL'
                  ? 'JUAL'
                  : 'DIV'
              : tx.type
            return (
              <div
                key={tx.id}
                className="flex items-center justify-between py-2"
                style={{
                  borderBottom: i < recentTx.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: typeColor,
                      background: 'var(--muted)',
                      padding: '1px 5px',
                      borderRadius: 2,
                    }}
                  >
                    {typeLabel}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {tx.symbol}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {fmtIdr(tx.total)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                    {tx.date.split(' ').slice(0, 3).join(' ')}
                  </div>
                </div>
              </div>
            )
          })}
          {recentTx.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', paddingTop: 4 }}>
              {t('port_tx_empty')}
            </div>
          )}
        </div>

        {/* AI alerts */}
        <div className="p-5 glass-card">
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>
              {t('dash_ai_alerts')}
            </div>
            {!alertsIsLive && (
              <span
                className="flex items-center gap-1"
                style={{ fontSize: 11, color: 'var(--warning)' }}
                title={
                  isId
                    ? 'Feed langsung tidak dapat dihubungi; daftar di bawah adalah data contoh.'
                    : 'Live feed unreachable; the list below is sample data.'
                }
              >
                <FlaskConical size={11} />
                {isId ? 'Data contoh' : 'Sample data'}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {/* Top 5 of the live feed. Provenance is stated because the seed
                alerts are shaped exactly like real ones. Each row carries a
                type chip so the list can be scanned by kind at a distance — the
                chip takes the severity ink, the label stays the alert's kind. */}
            {alerts.slice(0, 5).map((alert) => {
              const Icon = ALERT_ICONS[alert.type] ?? AlertCircle
              const color = ALERT_COLORS[alert.severity] ?? 'var(--muted-foreground)'
              const typeLabels: Record<string, string> = isId
                ? { signal: 'Sinyal', risk: 'Risiko', macro: 'Makro', rebalance: 'Rebalancing' }
                : { signal: 'Signal', risk: 'Risk', macro: 'Macro', rebalance: 'Rebalance' }
              return (
                <div
                  key={alert.key}
                  className="flex gap-2.5 p-2 rounded"
                  style={{ background: 'var(--muted)' }}
                >
                  <Icon size={12} style={{ color, flexShrink: 0, marginTop: 2 }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="flex items-center gap-1.5">
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          color,
                          border: `1px solid ${color}40`,
                          background: 'var(--card)',
                          padding: '0 5px',
                          borderRadius: 2,
                          lineHeight: '15px',
                        }}
                      >
                        {typeLabels[alert.type] ?? alert.type}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--foreground)', lineHeight: 1.45, marginTop: 2 }}>
                      {isId ? alert.msgId : alert.msgEn}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
                      {alert.timeId || alert.timeEn}
                    </div>
                  </div>
                </div>
              )
            })}
            {alerts.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: '8px 2px' }}>
                {isId ? 'Tidak ada peringatan aktif.' : 'No active alerts.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
