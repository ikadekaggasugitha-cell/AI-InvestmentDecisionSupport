import type { ExchangeRateData } from '@/app/features/market/useExchangeRate'
import type { DataFreshness } from '@/app/features/market/useLiveMarket'
import { Divider, Panel } from '@/app/features/settings/tabPrimitives'

export function TabAbout({
  id,
  fx,
  freshness,
}: {
  id: boolean
  fx: ExchangeRateData
  freshness?: DataFreshness
}) {
  // Only facts this component can actually verify. Version, model name and
  // last-trained date are absent on purpose: they are not readable from the
  // backend, so a fixed string there would be a number that goes stale.
  const feedStatus = !fx.isLive
    ? id
      ? 'Belum terhubung'
      : 'Not connected'
    : !freshness
      ? id
        ? 'Langsung'
        : 'Live'
      : freshness.isSimulated
        ? id
          ? 'Simulasi'
          : 'Simulated'
        : freshness.isDelayed
          ? id
            ? `Tertunda ${Math.round(freshness.delaySeconds / 60)} menit`
            : `Delayed ${Math.round(freshness.delaySeconds / 60)} min`
          : id
            ? 'Langsung'
            : 'Live'

  const rows: [string, string][] = [
    [id ? 'Sumber data' : 'Data source', 'IDX / Yahoo Finance'],
    [id ? 'Bursa' : 'Exchange', 'BEI (IDX)'],
    [id ? 'Zona waktu' : 'Timezone', 'WIB (UTC+7)'],
    [id ? 'Status feed' : 'Feed status', feedStatus],
  ]

  return (
    <Panel title={id ? 'Tentang' : 'About'}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{
              background: 'var(--muted)',
              borderRadius: 'var(--radius)',
              padding: '10px 14px',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>
              {label}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--foreground)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      <Divider />

      {/* Regulatory line, plain text. The consent modal in AIAdvisorView is the
          enforced gate (Gate 2 in docs/legal-and-consent.md); this is the
          standing reference, not a second consent surface. */}
      <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}>
        {id
          ? 'AIDSS adalah perangkat analisis data, bukan Penasihat Investasi berizin OJK. Semua skor adalah probabilitas matematis, bukan rekomendasi beli, jual, atau tahan efek.'
          : 'AIDSS is a data analytics tool, not an OJK-licensed Investment Advisor. Every score is a mathematical probability, not a recommendation to buy, sell, or hold any security.'}
      </p>
    </Panel>
  )
}
