import { useState } from 'react'
import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import { useApp } from '@/app/context/AppContext'
import { useTranslation } from '@/app/i18n/translations'
import { useAISignals } from '@/app/features/dashboard/useAISignals'
import type { LiveMarketData } from '@/app/features/market/useLiveMarket'
import { AdvisorChat } from '@/app/features/advisor/AdvisorChat'
import { ViewSkeleton } from '@/app/components/ViewSkeleton'
import { ViewError } from '@/app/components/ViewError'
import { ConsentModal } from '@/app/features/identity/ConsentGate'
import {
  clearConsent,
  hasAcceptedConsent,
  writeConsent,
  reportConsent,
} from '@/app/features/identity/consent'
import { useAuth } from '@/app/features/identity/useAuth'
import { SignalCard } from '@/app/features/advisor/signalCard'

export function AIAdvisorView({ market }: { market: LiveMarketData }) {
  const { locale } = useApp()
  const { t } = useTranslation(locale)
  const isId = locale === 'id'
  const [expanded, setExpanded] = useState<number | null>(null)
  // Persisted so the gate survives a reload or navigating away and back — the
  // previous plain useState(false) reset on every mount, which made the OJK
  // disclaimer gate cosmetic rather than a real gate (GAP-16). Server-side
  // recording of the acceptance for audit is a separate concern (GAP-03).
  // Gate 2 lives in ConsentGate now, so the AI signals list is gated the same way
  // as the advisor chat and the stock detail panel. Reading the acceptance from
  // the shared helper keeps the "revoke" button below honest. Server-side
  // recording of the acceptance for audit is a separate concern (GAP-03).
  const auth = useAuth()
  const accountId = auth.account?.id ?? null
  const [disclaimerAccepted, setDisclaimerAccepted] = useState<boolean>(() =>
    hasAcceptedConsent(accountId),
  )
  const {
    signals,
    loading,
    error,
    failure,
    generatedAt,
    isLive,
    modelMetrics,
    modelVersion,
    servingSource,
  } = useAISignals()

  const avgUprob = signals.length
    ? Math.round(signals.reduce((s, r) => s + r.uprob, 0) / signals.length)
    : 0
  const activeSignals = signals.filter((r) => r.probabilityTier !== 'NEUTRAL').length

  // The backend's own stamp, not the moment the browser received it. On the seed
  // path there is no model run to have a time, so the tile shows a dash rather
  // than a number that changes on every reload.
  const lastUpdatedLabel =
    generatedAt && !Number.isNaN(Date.parse(generatedAt))
      ? new Date(generatedAt).toLocaleTimeString(isId ? 'id-ID' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Jakarta',
        }) + ' WIB'
      : '—'

  // Walk-forward AUC from the model's training report. Null on the seed path and
  // on a bundle with no report, so the tile shows a dash instead of a number no
  // model produced. The sub-line is the other gate metric, decile lift, so the
  // reader can see which quantity is being claimed rather than one bare figure.
  const meanAuc = modelMetrics?.meanAuc ?? null
  const decileLift = modelMetrics?.decileLift ?? null
  const aucLabel = meanAuc === null ? '—' : `${(meanAuc * 100).toFixed(1)}%`
  const trainedAtLabel = modelMetrics?.trainedAt
    ? new Date(modelMetrics.trainedAt).toLocaleDateString(isId ? 'id-ID' : 'en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      }) + ' WIB'
    : null
  const aucTitle =
    meanAuc === null
      ? isId
        ? 'Tidak ada model ter-train untuk data ini'
        : 'No trained model produced this data'
      : [
          `${isId ? 'AUC walk-forward' : 'Walk-forward AUC'}: ${aucLabel}`,
          decileLift === null
            ? null
            : `${isId ? 'lift desil teratas' : 'top-decile lift'}: ${(decileLift * 100).toFixed(1)} pp`,
          trainedAtLabel ? `${isId ? 'dilatih' : 'trained'}: ${trainedAtLabel}` : null,
          modelVersion && modelVersion !== 'seed-v1.0' ? `artefak: ${modelVersion}` : null,
          modelMetrics?.symbols
            ? `${isId ? 'simbol' : 'symbols'}: ${modelMetrics.symbols.toLocaleString(isId ? 'id-ID' : 'en-US')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')

  if (loading) {
    return <ViewSkeleton rows={5} label={isId ? 'Memuat sinyal AI…' : 'Loading AI signals…'} />
  }
  // A fetch error no longer blanks the page: the hook keeps the last good
  // snapshot (or seed) in `signals`, so the view stays usable and an offline
  // banner below explains the numbers are simulated. Only a genuine empty state
  // (no data at all) falls through to the full error screen.
  if (error && signals.length === 0) {
    return <ViewError message={error} failure={failure} locale={locale} />
  }

  return (
    <>
      {!disclaimerAccepted && (
        <ConsentModal
          locale={isId ? 'id' : 'en'}
          onAccept={() => {
            // Local first, then the server — same pattern as ConsentGate
            writeConsent(accountId)
            setDisclaimerAccepted(true)
            void reportConsent(accountId)
          }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-6 flex flex-col gap-5 [&>*]:shrink-0">
        {/* Offline / simulated-data banner — shown only when the live fetch
            failed. The cards below still render the last good snapshot (or the
            bundled seed), and the hook re-polls, so this clears itself once the
            backend is reachable again. */}
        {/* Same rule as RiskView: a refusal is an answer from a healthy server,
            not an outage. Blaming the connection here sent people to debug the
            wrong thing when their only real problem was the subscription. */}
        {error && !isLive && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded"
            role="alert"
            style={{
              background: failure?.kind === 'locked' ? 'var(--warning-bg)' : 'var(--loss-bg)',
              border: `1px solid ${failure?.kind === 'locked' ? 'var(--warning)' : 'var(--loss)'}`,
            }}
          >
            <AlertTriangle
              size={14}
              style={{
                color: failure?.kind === 'locked' ? 'var(--warning)' : 'var(--loss)',
                flexShrink: 0,
              }}
            />
            <div style={{ fontSize: 13, color: 'var(--foreground)', flex: 1 }}>
              {failure?.kind === 'locked' ? (
                <>
                  <span style={{ fontWeight: 600, color: 'var(--warning)' }}>
                    {isId ? 'Sinyal tidak dikirim:' : 'Signals not served:'}
                  </span>{' '}
                  {isId
                    ? 'langganan belum aktif. Ini bukan masalah koneksi, server berjalan baik.'
                    : 'the subscription is not active. This is not a connection problem, the server is healthy.'}
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 600, color: 'var(--loss)' }}>
                    {isId ? 'Mode simulasi:' : 'Simulated mode:'}
                  </span>{' '}
                  {isId
                    ? 'Backend tidak terjangkau, menampilkan data simulasi. Sistem mencoba menyambung kembali otomatis.'
                    : 'Backend unreachable, showing simulated data. The system is retrying automatically.'}
                </>
              )}
            </div>
          </div>
        )}

        {/* OJK compliance notice banner */}
        <div
          className="flex items-center gap-3 px-4 py-3 rounded"
          style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning)' }}
        >
          <ShieldCheck size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: 'var(--foreground)', flex: 1 }}>
            <span style={{ fontWeight: 600, color: 'var(--warning)' }}>
              {isId ? 'Kepatuhan OJK:' : 'OJK Compliance:'}
            </span>{' '}
            {isId
              ? 'Seluruh output berupa Probabilitas Skor, bukan nasihat investasi atau instruksi beli/jual yang pasti.'
              : 'All outputs are Probability Scores, not investment advice or definitive buy/sell instructions.'}
          </div>
          <button
            onClick={() => {
              clearConsent(accountId)
              setDisclaimerAccepted(false)
            }}
            aria-label={isId ? 'Batalkan persetujuan OJK' : 'Revoke OJK consent'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--muted-foreground)',
              padding: 0,
            }}
          >
            <X size={12} />
          </button>
        </div>

        {/* Header metrics. The first tile is the model's own walk-forward AUC
            from the backend's training report, not a hardcoded string — it used
            to read "84.7%" unconditionally, on live data and seed data alike.
            Labelled AUC rather than "accuracy" because there is no accuracy
            figure in the report: the label is imbalanced, so accuracy measures
            calibration against the imbalance, which is why the training gate
            measures AUC and decile lift. A dash means no model produced this
            data. */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}
        >
          {/* Icon tiles out (0 of 23 study screens): the number is the identity,
              the label sits quiet above it, and the AUC tooltip stays attached
              to the tile. */}
          {[
            { label: t('ai_model_auc'), value: aucLabel, title: aucTitle },
            { label: t('ai_active_signals'), value: String(activeSignals), title: undefined },
            { label: t('ai_avg_confidence'), value: `${avgUprob}%`, title: undefined },
            { label: t('ai_last_updated'), value: lastUpdatedLabel, title: undefined },
          ].map((m) => (
            <div key={m.label} className="p-4 surface-glass" title={m.title}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--muted-foreground)',
                  marginBottom: 6,
                  lineHeight: 1.4,
                }}
              >
                {m.label}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--foreground)',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 1,
                }}
              >
                {m.value}
              </div>
            </div>
          ))}
        </div>

        {/* Portfolio Q&A — streams from /v1/advisor/chat */}
        <AdvisorChat locale={isId ? 'id' : 'en'} />

        {/* Recommendation cards */}
        <div className="flex flex-col gap-3">
          {signals.map((rec) => (
            <SignalCard
              key={rec.id}
              rec={rec}
              isOpen={expanded === rec.id}
              onToggle={() => setExpanded(expanded === rec.id ? null : rec.id)}
              isId={isId}
              t={t}
              market={market}
              servingSource={servingSource}
            />
          ))}
        </div>
      </div>
    </>
  )
}
