import type { ExchangeRateData } from '@/app/features/market/useExchangeRate'
import {
  ChoiceGroup,
  Divider,
  Metric,
  Panel,
  SettingRow,
} from '@/app/features/settings/tabPrimitives'

export function TabAppearance({
  id,
  isDark,
  onToggleTheme,
  locale,
  onToggleLocale,
  fx,
}: {
  id: boolean
  isDark: boolean
  onToggleTheme: () => void
  locale: 'id' | 'en'
  onToggleLocale: () => void
  fx: ExchangeRateData
}) {
  return (
    <Panel title={id ? 'Tampilan' : 'Appearance'}>
      <SettingRow
        label={id ? 'Tema' : 'Theme'}
        description={id ? 'Tampilan terang atau gelap' : 'Light or dark appearance'}
      >
        <ChoiceGroup
          options={[
            {
              key: 'light',
              label: id ? 'Terang' : 'Light',
              active: !isDark,
              onClick: isDark ? onToggleTheme : undefined,
            },
            {
              key: 'dark',
              label: id ? 'Gelap' : 'Dark',
              active: isDark,
              onClick: isDark ? undefined : onToggleTheme,
            },
          ]}
          id={id}
        />
      </SettingRow>

      <Divider />

      <SettingRow
        label={id ? 'Bahasa antarmuka' : 'Interface language'}
        description={id ? 'Bahasa teks antarmuka' : 'Language of interface text'}
      >
        <ChoiceGroup
          options={[
            {
              key: 'id',
              label: 'Indonesia',
              active: locale === 'id',
              onClick: locale === 'en' ? onToggleLocale : undefined,
            },
            {
              key: 'en',
              label: 'English',
              active: locale === 'en',
              onClick: locale === 'id' ? onToggleLocale : undefined,
            },
          ]}
          id={id}
        />
      </SettingRow>

      <Divider />

      <SettingRow
        label={id ? 'Mata uang' : 'Currency'}
        description={
          id ? 'Nilai portofolio ditampilkan dalam' : 'Portfolio values are displayed in'
        }
      >
        <ChoiceGroup
          options={[
            {
              key: 'idr',
              label: 'IDR',
              active: !fx.showUsd,
              onClick: fx.showUsd ? fx.toggleCurrency : undefined,
            },
            {
              key: 'usd',
              label: 'USD',
              active: fx.showUsd,
              onClick: !fx.showUsd ? fx.toggleCurrency : undefined,
            },
          ]}
          id={id}
        />
      </SettingRow>

      <Divider />

      <FxCard fx={fx} id={id} />
    </Panel>
  )
}

function FxCard({ fx, id }: { fx: ExchangeRateData; id: boolean }) {
  // The rate is pushed with the market snapshot, so it is never older than the
  // prices. Saying so is the point: an unexplained number reads as a live feed.
  const weaker = fx.change > 0
  return (
    <div
      className="surface-glass"
      style={{
        padding: '16px 20px',
        marginTop: 16,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--foreground)',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {id ? 'Kurs USD/IDR' : 'USD/IDR rate'}
        <span
          style={{
            fontSize: 11,
            fontWeight: 400,
            color: fx.isLive ? 'var(--muted-foreground)' : 'var(--warning)',
          }}
        >
          {fx.isLive
            ? id
              ? 'dari snapshot pasar'
              : 'from market snapshot'
            : id
              ? 'belum ada feed'
              : 'no feed yet'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <Metric
          label={id ? 'Kurs saat ini' : 'Current rate'}
          value={`Rp ${fx.usdIdr.toLocaleString('id-ID')}`}
        />
        <Metric
          label={id ? 'Perubahan' : 'Change'}
          value={`${fx.change >= 0 ? '+' : ''}${fx.change.toLocaleString('id-ID')}`}
          tone={fx.change > 0 ? 'loss' : fx.change < 0 ? 'gain' : undefined}
        />
        <Metric
          label="%"
          value={`${fx.changePct >= 0 ? '+' : ''}${fx.changePct.toFixed(3)}%`}
          tone={fx.changePct > 0 ? 'loss' : fx.changePct < 0 ? 'gain' : undefined}
        />
      </div>

      <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '12px 0 0' }}>
        {fx.isLive
          ? id
            ? 'Kurs dikirim bersama snapshot pasar, jadi kesegaran kurs mengikuti feed pasar. Rupiah melemah berarti potensi kerugian bagi investor yang memegang aset dalam dolar.'
            : 'The rate arrives with the market snapshot, so it refreshes whenever the feed does. Rupiah weakening means potential loss for a holder of dollar-denominated assets.'
          : id
            ? 'Feed forex belum pernah mengirim angka, jadi nilai di atas bukan kurs pasar. Muat ulang setelah backend terhubung.'
            : 'The forex feed has not reported a rate yet, so the figure above is not a market rate. Reload once the backend is connected.'}
      </p>
      {weaker && !fx.isLive && null}
    </div>
  )
}
