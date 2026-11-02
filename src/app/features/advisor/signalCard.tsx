/*
 * One signal, expanded: the card that pulls its own technicals and broker
 * summary, renders the chart lazily, and composes the read-out pieces from
 * signalParts. Its own file because it is the heaviest component on the
 * screen and the one a reader reaches when asking "what is in a signal".
 */
import { Suspense, lazy } from 'react'
import { ChevronDown, ChevronUp, Clock, AlertTriangle } from 'lucide-react'
import { useTranslation } from '@/app/i18n/translations'
import type { AISignal } from '@/app/features/dashboard/useAISignals'
import { useBrokerSummary } from '@/app/features/signals/useBrokerSummary'
import { useTechnicals } from '@/app/features/market/useTechnicals'
import type { LiveMarketData } from '@/app/features/market/useLiveMarket'
import { DataFreshnessBadge } from '@/app/components/DataFreshnessBadge'
import { BrokerSummaryPanel } from '@/app/features/signals/BrokerSummaryPanel'
import { EntrySignalCard } from '@/app/features/signals/EntrySignalCard'
import { VolumeAccumulationPanel } from '@/app/features/signals/VolumeAccumulationPanel'
import { type Tier, TIER_CFG, tierLabel } from '@/app/features/advisor/signalConfig'
import {
  ProbabilityGauge,
  TrendBadge,
  SituationBadge,
  SituationFacts,
  TradePlanBadge,
  ShapChart,
} from '@/app/features/advisor/signalParts'

// Lightweight Charts is ~45KB and only an expanded card ever renders one, so
// it is code-split rather than shipped in the initial bundle.
const CandlestickChart = lazy(() =>
  import('@/app/features/market/CandlestickChart').then((m) => ({ default: m.CandlestickChart })),
)

export function SignalCard({
  rec,
  isOpen,
  onToggle,
  isId,
  t,
  market,
  servingSource,
}: {
  rec: AISignal
  isOpen: boolean
  onToggle: () => void
  isId: boolean
  // Derived from the hook rather than widened to (key: string), so a typo in a
  // translation key fails the type check instead of rendering the key itself.
  t: ReturnType<typeof useTranslation>['t']
  market: LiveMarketData
  /** What the API says served this signal. Provenance cannot be hardcoded: the
   *  response names no algorithm, so only live-vs-mock is attestable. */
  servingSource: 'live' | 'mock' | null
}) {
  const cfg = TIER_CFG[rec.probabilityTier as Tier]
  const Icon = cfg.icon
  const upPos = rec.upside >= 0

  const technicals = useTechnicals(rec.symbol, 120, isOpen)

  // Live last-trade for this symbol, fed to the chart to pulse today's forming
  // candle. Gated to the honest live case only: a real backend feed, market
  // open, and not the simulated/offline seed. Outside that the chart stays
  // static rather than animating numbers that aren't the market's.
  const isLiveFeed =
    market.source === 'backend_ws' && market.isMarketOpen && !market.freshness.isSimulated
  const livePrice = isLiveFeed ? (market.stocks[rec.symbol]?.price ?? null) : null
  const broksum = useBrokerSummary(rec.symbol, 20, isOpen)

  // Prefer live technicals once loaded; fall back to whatever the signal
  // payload carried. Both may be absent, and every consumer below guards.
  const srLevels = technicals.supportResistance.length
    ? technicals.supportResistance
    : (rec.supportResistance ?? [])
  const gaps = technicals.gaps.length ? technicals.gaps : (rec.openGaps ?? [])
  const trend = technicals.trend ?? rec.trend ?? null
  const snapshot = broksum.snapshot ?? rec.brokerSummary ?? null
  // Prefer the live technicals trade plan / note (computed on fresh bars) over
  // whatever the signal payload carried at generation time.
  const plan = technicals.tradePlan ?? rec.tradePlan ?? null
  const note =
    (isId ? technicals.technicalNote : technicals.technicalNoteEn) ||
    (isId ? rec.technicalNote : rec.technicalNoteEn)
  const patterns = (isId ? rec.activePatterns : rec.activePatternsEn) ?? []
  const unfilledGaps = gaps.filter((g) => !g.isFilled)

  return (
    <div className="overflow-hidden surface-glass">
      {/* Card header. The gauge, the name column and the right metrics wrap on
          narrow screens instead of squeezing the name against the figures —
          flex-shrink-0 alone turned the mobile row into an overlap. */}
      <div
        className="flex items-start gap-4 p-5 cursor-pointer"
        onClick={onToggle}
        style={{ userSelect: 'none', flexWrap: 'wrap', rowGap: 12 }}
      >
        {/* Probability gauge — OJK compliant (replaces absolute buy/sell badge) */}
        <ProbabilityGauge uprob={rec.uprob} tier={rec.probabilityTier as Tier} />

        {/* Name + symbol + thesis */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--foreground)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {rec.symbol}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{rec.name}</span>
            {/* Signal label — for display context only, not trading instruction.
                Tinted surface + coloured text + icon: the colour never carries
                the level alone, and a var() token can't take an alpha hex, so
                the border that used `${tone}25` it is not drawn. */}
            <span
              className="flex items-center gap-1 rounded px-2 py-0.5"
              style={{ background: cfg.bg }}
            >
              <Icon size={11} style={{ color: cfg.color }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: cfg.color,
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {tierLabel(rec.probabilityTier as Tier, isId)}
              </span>
            </span>
            <TrendBadge trend={trend} isId={isId} />
          </div>

          {/* Entry / stop loss — absent when no usable support level exists */}
          {plan && (
            <div className="flex mt-1.5">
              <TradePlanBadge plan={plan} isId={isId} />
            </div>
          )}

          <div
            style={{
              fontSize: 12,
              color: 'var(--muted-foreground)',
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            {isId ? rec.thesis.substring(0, 100) + '…' : rec.thesisEn.substring(0, 100) + '…'}
          </div>
        </div>

        {/* Right metrics — below md they drop to their own row (the name column
            keeps its width); md and up they sit flush to the card edge. */}
        <div className="flex items-start gap-6 flex-shrink-0 w-full md:w-auto md:ml-auto">
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 2 }}>
              {t('ai_target')}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--foreground)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {rec.targetPrice.toLocaleString('id-ID')}
            </div>
            <div
              style={{
                fontSize: 11,
                color: upPos ? 'var(--gain)' : 'var(--loss)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {upPos ? '+' : ''}
              {rec.upside.toFixed(1)}%
            </div>
          </div>
          <div style={{ minWidth: 96 }}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                {t('ai_model_score')}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  color: cfg.color,
                }}
              >
                {rec.modelScore}
              </span>
            </div>
            {/* Confidence bar */}
            <div
              style={{
                width: '100%',
                height: 3,
                background: 'var(--border)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${rec.confidence}%`,
                  height: '100%',
                  background: cfg.color,
                  borderRadius: 2,
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 3 }}>
              {t('ai_confidence')}: {rec.confidence}%
            </div>
          </div>
          <div style={{ color: 'var(--muted-foreground)', marginTop: 4 }}>
            {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {isOpen && (
        <div
          className="px-5 pb-5 flex flex-col gap-5"
          style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}
        >
          {/* Interactive candlestick chart with S/R, entry and stop lines */}
          <div>
            <div className="flex items-center justify-between gap-2" style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--foreground)',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {t('ai_price_action')}
              </div>
              <div className="flex items-center gap-2">
                <DataFreshnessBadge
                  freshness={market.freshness}
                  isConnected={market.source !== 'offline_baseline'}
                  locale={isId ? 'id' : 'en'}
                  compact
                />
                <SituationBadge situation={technicals.situation} isId={isId} />
              </div>
            </div>
            <SituationFacts situation={technicals.situation} isId={isId} />
            <Suspense
              fallback={
                <div
                  style={{
                    height: 280,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: 'var(--muted-foreground)',
                    background: 'var(--muted)',
                    borderRadius: 4,
                  }}
                >
                  {isId ? 'Memuat grafik…' : 'Loading chart…'}
                </div>
              }
            >
              <CandlestickChart
                ohlcv={technicals.ohlcv}
                supportResistance={srLevels}
                entryPrice={plan?.entryPrice ?? null}
                stopLoss={plan?.stopLoss ?? null}
                gaps={gaps}
                situation={technicals.situation}
                height={280}
                locale={isId ? 'id' : 'en'}
                livePrice={livePrice}
              />
            </Suspense>
          </div>

          {/* Actionable technical read: when to enter, where the stop is, R:R */}
          <EntrySignalCard entry={technicals.entrySignal} plan={plan} locale={isId ? 'id' : 'en'} />

          <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {/* Left: thesis + technical note + catalysts + meta */}
            <div className="flex flex-col gap-4">
              {/* Full thesis — the hand-written narrative, never replaced by a template */}
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-sans)',
                    marginBottom: 6,
                  }}
                >
                  {t('ai_thesis')}
                </div>
                <p style={{ fontSize: 12, color: 'var(--foreground)', lineHeight: 1.6 }}>
                  {isId ? rec.thesis : rec.thesisEn}
                </p>
              </div>

              {/* Generated technical commentary — additive to the thesis above */}
              {note && (
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-sans)',
                      marginBottom: 6,
                    }}
                  >
                    {t('ai_technical_note')}
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: 'var(--foreground)',
                      lineHeight: 1.6,
                      background: 'var(--muted)',
                      borderRadius: 4,
                      padding: 10,
                    }}
                  >
                    {note}
                  </p>
                </div>
              )}

              {/* Stop loss rationale */}
              {plan?.stopLoss != null && (
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-sans)',
                      marginBottom: 6,
                    }}
                  >
                    {t('ai_stop_loss')}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--loss)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      Rp {plan.stopLoss.toLocaleString('id-ID')}
                    </span>
                    {plan.stopLossPct != null && (
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--loss)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {plan.stopLossPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
                    {isId ? plan.stopLossReason : plan.stopLossReasonEn}
                  </div>
                </div>
              )}

              {/* Candlestick patterns */}
              {patterns.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-sans)',
                      marginBottom: 6,
                    }}
                  >
                    {t('ai_patterns')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {patterns.map((p, i) => (
                      <span
                        key={`${p}-${i}`}
                        className="rounded px-2 py-0.5"
                        style={{
                          background: 'var(--muted)',
                          border: '1px solid var(--border)',
                          fontSize: 11,
                          color: 'var(--foreground)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Open gaps */}
              {unfilledGaps.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-sans)',
                      marginBottom: 6,
                    }}
                  >
                    {t('ai_open_gaps')}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {unfilledGaps.slice(0, 3).map((g, i) => (
                      <div
                        key={`${g.date}-${i}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span style={{ fontSize: 11, color: 'var(--foreground)' }}>
                          {g.type === 'gap_up'
                            ? isId
                              ? 'Gap naik'
                              : 'Gap up'
                            : isId
                              ? 'Gap turun'
                              : 'Gap down'}{' '}
                          <span style={{ fontFamily: 'var(--font-mono)' }}>
                            {g.gapPct.toFixed(1)}%
                          </span>
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: 'var(--muted-foreground)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {isId ? 'prob. tutup' : 'fill prob.'}{' '}
                          {Math.round(g.fillProbability * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Catalysts */}
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-sans)',
                    marginBottom: 6,
                  }}
                >
                  {t('ai_catalysts')}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {(isId ? rec.catalysts : rec.catalystsEn).map((cat, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <div
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: '50%',
                          background: cfg.color,
                          marginTop: 5,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--foreground)', lineHeight: 1.5 }}>
                        {cat}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Meta row */}
              <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 2 }}>
                    {t('ai_horizon')}
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock size={11} style={{ color: 'var(--muted-foreground)' }} />
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--foreground)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {isId ? rec.horizon : rec.horizonEn}
                    </span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 2 }}>
                    {t('ai_risk_level')}
                  </div>
                  <div className="flex items-center gap-1">
                    <AlertTriangle size={11} style={{ color: 'var(--warning)' }} />
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--foreground)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {isId ? rec.risk : rec.riskEn}
                    </span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 2 }}>
                    {t('ai_upside')}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: upPos ? 'var(--gain)' : 'var(--loss)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {upPos ? '+' : ''}
                    {rec.upside.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Analyst consensus */}
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-sans)',
                    marginBottom: 6,
                  }}
                >
                  {t('ai_analyst_consensus')}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-mono)',
                    lineHeight: 1.8,
                  }}
                >
                  {(isId ? rec.analystConsensus : rec.analystConsensusEn)
                    .split(' | ')
                    .map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                </div>
              </div>
            </div>

            {/* Right: SHAP chart + broker summary */}
            <div className="flex flex-col gap-4">
              <div style={{ background: 'var(--muted)', borderRadius: 4, padding: 16 }}>
                <ShapChart shap={rec.shap} isId={isId} />
                <div
                  className="flex items-center justify-between mt-3 pt-3"
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  {/* Provenance, built from what the API can actually attest.
                      The response carries `source: "live" | "mock"` and a
                      `modelVersion` artefact id; it names no algorithm anywhere,
                      so a fixed "LightGBM + SHAP" was a claim the contract could
                      never confirm, and wrong on the seed path where no model ran. */}
                  <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                    {servingSource === 'live'
                      ? isId
                        ? 'Sumber: model aktif'
                        : 'Source: live model'
                      : servingSource === 'mock'
                        ? isId
                          ? 'Sumber: data contoh'
                          : 'Source: sample data'
                        : isId
                          ? 'Sumber: tidak diketahui'
                          : 'Source: unknown'}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: cfg.color,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {t('ai_model_score')}: {rec.modelScore}
                  </div>
                </div>
              </div>

              {(technicals.volume || technicals.accumulation) && (
                <div style={{ background: 'var(--muted)', borderRadius: 4, padding: 16 }}>
                  <VolumeAccumulationPanel
                    volume={technicals.volume}
                    accumulation={technicals.accumulation}
                    locale={isId ? 'id' : 'en'}
                  />
                </div>
              )}

              <div style={{ background: 'var(--muted)', borderRadius: 4, padding: 16 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-sans)',
                    marginBottom: 10,
                  }}
                >
                  {t('ai_broker_summary')}
                </div>
                <BrokerSummaryPanel
                  snapshot={snapshot}
                  history={broksum.history}
                  source={broksum.source}
                  locale={isId ? 'id' : 'en'}
                  loading={broksum.loading}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
