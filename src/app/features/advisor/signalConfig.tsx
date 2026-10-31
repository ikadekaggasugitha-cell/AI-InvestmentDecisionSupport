/*
 * Tier and price-action vocabulary for advisor signal cards: the colours, the
 * icons, the bilingual labels. Config, not components — so signalParts.tsx can
 * stay a components-only module and keep Fast-Refresh working while a card is
 * open, and so the OJK wording (REC-01) lives in exactly one place.
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
  Zap,
} from 'lucide-react'
import type { ElementType } from 'react'
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
