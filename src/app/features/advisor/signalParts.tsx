/*
 * The read-out pieces of an advisor signal card: the tier gauge, the trend
 * badge, the price-action situation, the trade plan, and the SHAP chart.
 * Every one of them is presentational — they render what the hooks already
 * returned, and none of them fetches anything.
 */
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  ArrowUpToLine,
  ArrowUpFromLine,
  Minimize2,
  MoveHorizontal,
  MoveRight,
  Zap,
} from 'lucide-react'
import type { ElementType } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { AISignal } from '@/app/features/dashboard/useAISignals'
import type { SituationInfo } from '@/app/features/market/useTechnicals'

export type Tier = 'VERY_HIGH' | 'HIGH' | 'NEUTRAL' | 'LOW'

export const TIER_CFG: Record<Tier, { color: string; bg: string; icon: ElementType }> = {
  VERY_HIGH: { color: 'var(--gain)', bg: 'var(--gain-bg)', icon: TrendingUp },
  HIGH: { color: 'var(--gain)', bg: 'var(--gain-bg)', icon: TrendingUp },
  NEUTRAL: { color: 'var(--warning)', bg: 'var(--warning-bg)', icon: Minus },
  LOW: { color: 'var(--loss)', bg: 'var(--loss-bg)', icon: TrendingDown },
}

// Probability-band wording (REC-01). Replaces the former BELI/JUAL labels,
// whose imperative reading conflicted with OJK rule CMP-01 (GAP-01).
export function tierLabel(tier: Tier, isId: boolean): string {
  const map: Record<Tier, [string, string]> = {
    VERY_HIGH: ['Probabilitas Sangat Tinggi', 'Very High Probability'],
    HIGH: ['Probabilitas Tinggi', 'High Probability'],
    NEUTRAL: ['Probabilitas Netral', 'Neutral Probability'],
    LOW: ['Probabilitas Rendah', 'Low Probability'],
  }
  return isId ? map[tier][0] : map[tier][1]
}

/* OJK-compliant probability gauge. The ring is gone: one solid ring per row
   is a donut with one slice, only much quieter. The figure prints ink and the
   tier chip beside the name carries the level colour. */
export function ProbabilityGauge({ uprob, tier }: { uprob: number; tier: Tier }) {
  const isDown = tier === 'LOW'
  const displayProb = isDown ? 100 - uprob : uprob

  return (
    <div style={{ minWidth: 64 }}>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--foreground)',
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.1,
        }}
      >
        {displayProb}%
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
        {isDown ? 'Prob. turun' : 'Prob. naik'}
      </div>
    </div>
  )
}

/* Trend direction badge — omitted entirely when no trend data is present. */
export function TrendBadge({ trend, isId }: { trend: AISignal['trend']; isId: boolean }) {
  if (!trend) return null

  const cfg =
    {
      uptrend: {
        color: 'var(--gain)',
        bg: 'var(--gain-bg)',
        icon: TrendingUp,
        id: 'Uptrend',
        en: 'Uptrend',
      },
      downtrend: {
        color: 'var(--loss)',
        bg: 'var(--loss-bg)',
        icon: TrendingDown,
        id: 'Downtrend',
        en: 'Downtrend',
      },
      sideways: {
        color: 'var(--muted-foreground)',
        bg: 'var(--muted)',
        icon: MoveRight,
        id: 'Sideways',
        en: 'Sideways',
      },
    }[trend.trend] ?? null

  if (!cfg) return null
  const Icon = cfg.icon

  return (
    <span
      className="flex items-center gap-1 rounded px-2 py-0.5"
      style={{ background: cfg.bg }}
      title={
        isId ? `Kekuatan tren: ${trend.strength}/100` : `Trend strength: ${trend.strength}/100`
      }
    >
      <Icon size={11} style={{ color: cfg.color, flexShrink: 0 }} />
      <span
        style={{ fontSize: 11, fontWeight: 600, color: cfg.color, fontFamily: 'var(--font-sans)' }}
      >
        {isId ? cfg.id : cfg.en}
      </span>
    </span>
  )
}

/* ── Price-action situation ────────────────────────────────────────────────
 *
 * WHERE price sits in the structure, read deterministically on the backend with
 * ATR-scaled zones. Each label pairs a colour with an icon AND a text label
 * (never colour alone) — same accessibility convention as TrendBadge, and it
 * keeps the read honest under the OJK "no bare buy/sell" framing.
 */
export const SITUATION_CFG: Record<
  SituationInfo['situation'],
  { tone: 'gain' | 'loss' | 'warning' | 'neutral'; icon: ElementType; id: string; en: string }
> = {
  tembus_resistance: { tone: 'gain', icon: TrendingUp, id: 'Tembus Resistance', en: 'Breakout' },
  mantul_support: {
    tone: 'gain',
    icon: ArrowUpFromLine,
    id: 'Mantul Support',
    en: 'Support Bounce',
  },
  gagal_breakdown: { tone: 'gain', icon: Zap, id: 'Spring (Bear Trap)', en: 'Spring (Bear Trap)' },
  uji_resistance: {
    tone: 'warning',
    icon: ArrowUpToLine,
    id: 'Uji Resistance',
    en: 'Testing Resistance',
  },
  volatility_squeeze: {
    tone: 'warning',
    icon: Minimize2,
    id: 'Squeeze Volatilitas',
    en: 'Volatility Squeeze',
  },
  gagal_breakout: { tone: 'loss', icon: AlertTriangle, id: 'Gagal Breakout', en: 'False Breakout' },
  tembus_support: { tone: 'loss', icon: TrendingDown, id: 'Tembus Support', en: 'Breakdown' },
  konsolidasi_lebar: {
    tone: 'neutral',
    icon: MoveHorizontal,
    id: 'Konsolidasi Lebar',
    en: 'Wide Consolidation',
  },
}

export const SITUATION_TONE: Record<string, { color: string; bg: string }> = {
  gain: { color: 'var(--gain)', bg: 'var(--gain-bg)' },
  loss: { color: 'var(--loss)', bg: 'var(--loss-bg)' },
  warning: { color: 'var(--warning)', bg: 'var(--muted)' },
  neutral: { color: 'var(--muted-foreground)', bg: 'var(--muted)' },
}

/* The primary situation pill — sits in the chart header. Null when absent. */
export function SituationBadge({
  situation,
  isId,
}: {
  situation: SituationInfo | null
  isId: boolean
}) {
  if (!situation) return null
  const cfg = SITUATION_CFG[situation.situation]
  if (!cfg) return null
  const tone = SITUATION_TONE[cfg.tone]
  const Icon = cfg.icon

  return (
    <span
      className="flex items-center gap-1 rounded px-2 py-0.5"
      style={{ background: tone.bg }}
      title={isId ? situation.note : situation.noteEn}
    >
      <Icon size={11} style={{ color: tone.color }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: tone.color }}>
        {isId ? cfg.id : cfg.en}
      </span>
    </span>
  )
}

/* The structural facts under the header: nearest S/R with signed distances, the
 * ATR% volatility read, and a squeeze pill when the coil isn't already the
 * primary label. Mono, muted — it grounds the badge in concrete price levels. */
export function SituationFacts({
  situation,
  isId,
}: {
  situation: SituationInfo | null
  isId: boolean
}) {
  if (!situation) return null
  const fmt = (n: number) => n.toLocaleString('id-ID')
  const showSqueeze = situation.squeeze && situation.situation !== 'volatility_squeeze'

  return (
    <div
      className="flex items-center flex-wrap gap-x-3 gap-y-1"
      style={{
        fontSize: 11,
        color: 'var(--muted-foreground)',
        fontFamily: 'var(--font-mono)',
        margin: '6px 0 10px',
      }}
    >
      {situation.nearestSupport != null && (
        <span>
          Support{' '}
          <b style={{ color: 'var(--foreground)', fontWeight: 600 }}>
            {fmt(situation.nearestSupport)}
          </b>
          {situation.distSupportPct != null && (
            <span style={{ color: 'var(--gain)' }}> −{situation.distSupportPct.toFixed(1)}%</span>
          )}
        </span>
      )}
      {situation.nearestResistance != null && (
        <span>
          Resistance{' '}
          <b style={{ color: 'var(--foreground)', fontWeight: 600 }}>
            {fmt(situation.nearestResistance)}
          </b>
          {situation.distResistancePct != null && (
            <span style={{ color: 'var(--loss)' }}>
              {' '}
              +{situation.distResistancePct.toFixed(1)}%
            </span>
          )}
        </span>
      )}
      <span
        title={
          isId ? 'Volatilitas harian (Average True Range)' : 'Daily volatility (Average True Range)'
        }
      >
        ATR{' '}
        <b style={{ color: 'var(--foreground)', fontWeight: 600 }}>
          {situation.atrPct.toFixed(1)}%
        </b>
      </span>
      {showSqueeze && (
        <span
          className="flex items-center gap-1 rounded"
          style={{
            padding: '0 5px',
            color: 'var(--warning)',
            border: '1px solid var(--warning)',
            opacity: 0.85,
          }}
          title={
            isId
              ? 'Volatilitas menyempit: potensi pergerakan eksplosif'
              : 'Volatility compressing: potential explosive move'
          }
        >
          <Minimize2 size={9} />
          {isId ? 'Squeeze' : 'Squeeze'}
        </span>
      )}
    </div>
  )
}

/**
 * Entry / stop-loss badge.
 *
 * Renders nothing when there is no trade plan. The backend omits the plan when
 * no support level sits at a usable distance — showing a placeholder or a
 * guessed level here would be worse than showing nothing, because the reader
 * cannot tell a derived stop from an invented one.
 */

export function TradePlanBadge({ plan, isId }: { plan: AISignal['tradePlan']; isId: boolean }) {
  if (!plan || plan.entryPrice == null || plan.stopLoss == null) return null

  return (
    <span
      className="flex items-center gap-1.5 rounded px-2 py-0.5"
      style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
    >
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
        {isId ? 'Entry' : 'Entry'}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--foreground)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {plan.entryPrice.toLocaleString('id-ID')}
      </span>
      <span style={{ fontSize: 11, color: 'var(--border)' }}>|</span>
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>SL</span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--loss)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {plan.stopLoss.toLocaleString('id-ID')}
        {plan.stopLossPct != null && ` (${plan.stopLossPct.toFixed(1)}%)`}
      </span>
      {plan.riskRewardRatio != null && (
        <>
          <span style={{ fontSize: 11, color: 'var(--border)' }}>|</span>
          <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>R/R</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--foreground)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {plan.riskRewardRatio.toFixed(1)}
          </span>
        </>
      )}
    </span>
  )
}

/* SHAP waterfall bar chart */

export function ShapChart({ shap, isId }: { shap: AISignal['shap']; isId: boolean }) {
  const data = [...shap].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  const chartData = data.map((d) => ({
    name: isId ? d.factor : d.factorEn,
    value: d.value,
    fill: d.value >= 0 ? 'var(--gain)' : 'var(--loss)',
  }))

  return (
    <div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--foreground)',
          marginBottom: 4,
          fontFamily: 'var(--font-sans)',
        }}
      >
        {isId ? 'Faktor Penentu (SHAP)' : 'SHAP Factor Analysis'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 10 }}>
        {isId ? 'Kontribusi fitur terhadap probabilitas' : 'Feature contributions to probability'}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 24, bottom: 0, left: 0 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={78}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--foreground)',
            }}
            formatter={(v: number) => [
              `${v > 0 ? '+' : ''}${v}`,
              isId ? 'Kontribusi' : 'Contribution',
            ]}
          />
          <Bar dataKey="value" radius={[0, 2, 2, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={`shap-${i}`} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* OJK Legal Disclaimer Modal */

/**
 * One recommendation card.
 *
 * Extracted from the list body because it owns hooks: `useTechnicals` and
 * `useBrokerSummary` cannot be called from inside a `.map()` callback. Both are
 * gated on `isOpen`, so a collapsed card issues no requests — otherwise every
 * page load would fire two round trips per symbol for panels nobody has opened.
 */
