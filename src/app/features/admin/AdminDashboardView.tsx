import { RotateCw } from 'lucide-react'

import {
  buttonStyle,
  helpStyle,
  panelStyle,
  progressFillStyle,
  progressTrackStyle,
  sectionNoteStyle,
  text,
} from '@/app/features/admin/consoleStyles'
import type { OverviewState } from '@/app/features/admin/useAdminOverview'

/**
 * The console's overview: nine figures from one query, no chart. Presentational —
 * the read lives in `useAdminOverview` (called once by the shell, which also feeds
 * the notification badge), so the panel and the badge can never disagree.
 *
 * Nine is what the endpoint answers with; the screen shows six of them as cards,
 * two in the queue strip below, and one inside the run-rate's own formula.
 *
 * Deliberately not a recharts surface. A line chart over a handful of settled
 * payments is decoration; what an operator needs is the number, the window it
 * covers, and the predicate that produced it.
 *
 * Three states are kept apart, because collapsing them is the whole risk:
 *  - **Zeros** are a real answer (a quiet install), and saying so is correct.
 *  - **A refused read** (403) is not about the business at all.
 *  - **A read that failed** (503 / unreachable) must never be drawn as zeros.
 *
 * The run-rate is the one derived figure, and its formula is printed beside it so
 * a reader does not take it for money received.
 */

const numberCell: React.CSSProperties = {
  fontFamily: 'var(--font-console)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: text.figure,
  fontWeight: 600,
  color: 'var(--console-ink)',
  margin: 0,
  // Measured at 390: the label takes the left of the row and the figure the
  // right, so a narrow screen squeezed "Rp 15.000" into two lines. The label
  // wraps instead, which is what labels are for.
  whiteSpace: 'nowrap',
}

function rp(n: number): string {
  // Exact rupiah. The compact formatter would print "Rp 79Rb" for a figure an
  // operator is about to reconcile against a bank statement.
  return `Rp ${n.toLocaleString('id-ID')}`
}

/**
 * The key figures as a responsive card grid (owner direction): the revenue
 * numbers read across the top as cards, not down a long list that leaves the
 * middle of the sheet empty. Each figure is its own bordered card, so there is
 * no shared painted track to leave an empty slab.
 */
const statGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 12,
}

/** The number that leads the screen: the only place at this size. */
const leadCell: React.CSSProperties = {
  fontFamily: 'var(--font-console)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: text.lead,
  fontWeight: 600,
  color: 'var(--console-ink)',
  margin: 0,
  lineHeight: 1.2,
}

export function AdminDashboardView({
  state,
  onReload,
  refreshing,
  onOpenQueue,
}: {
  state: OverviewState
  onReload: (opts?: { silent?: boolean }) => void
  refreshing: boolean
  onOpenQueue: () => void
}) {
  if (state.kind === 'loading') {
    return (
      <p style={{ fontSize: text.body, color: 'var(--console-secondary)' }}>Memuat ringkasan…</p>
    )
  }

  if (state.kind === 'forbidden') {
    return (
      <div role="alert" style={{ fontSize: text.body, color: 'var(--console-secondary)' }}>
        Hanya administrator yang bisa melihat angka ini.
      </div>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <div role="alert" style={{ fontSize: text.body, color: 'var(--console-secondary)' }}>
        Angka tidak dapat dibaca. Ini bukan berarti usahanya sepi: layar ini sengaja tidak
        menampilkan nol, karena nol adalah jawaban dan bukan kegagalan.
        <button
          type="button"
          onClick={() => void onReload({ silent: true })}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 10,
            fontSize: text.body,
            padding: '5px 10px',
            minHeight: 32,
            color: 'var(--foreground)',
            background: 'transparent',
            border: '1px solid var(--control-border)',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          <RotateCw
            size={14}
            strokeWidth={1.9}
            aria-hidden
            focusable={false}
            className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined}
          />
          Coba lagi
        </button>
      </div>
    )
  }

  const f = state.figures

  const statCards = [
    { label: 'Pendapatan hari ini (WIB)', value: rp(f.revenueToday) },
    { label: '30 hari terakhir', value: rp(f.revenueLast30Days) },
    { label: 'Total terselesaikan', value: rp(f.revenueTotal) },
    { label: 'Lajur bulanan (MRR)', value: rp(f.mrrRunRate) },
    { label: 'Langganan aktif', value: f.activeSubscribers.toLocaleString('id-ID') },
    { label: 'Sudah berakhir', value: f.churnedSubscribers.toLocaleString('id-ID') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        {/* No section title: the sheet's h1 already names this module, and an
            identical word under it read as a rendering glitch (owner
            direction). What the section adds is the sentence below, not a
            second label. */}
        <p style={sectionNoteStyle}>
          Angka di bawah hanya menghitung transfer yang sudah disetujui. Transfer yang belum
          diputuskan belum dihitung sebagai pendapatan.
        </p>
      </div>

      {/* First and largest, because it is the only figure an operator can still
          act on. The expired count is kept separate: it is still money sent. */}
      <div
        style={{
          ...panelStyle,
          border: '1px solid var(--control-border)',
          padding: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p style={{ fontSize: text.meta, color: 'var(--console-secondary)', margin: 0 }}>
            Menunggu keputusan Anda
          </p>
          <p style={leadCell}>{f.pendingQueue.toLocaleString('id-ID')} transfer di antrean</p>
          <p
            style={{
              fontSize: text.meta,
              color: 'var(--console-meta)',
              margin: '4px 0 0',
              fontFamily: 'var(--font-console)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {f.expiredQueue.toLocaleString('id-ID')} sudah lewat tenggat, uangnya tetap ada
          </p>
        </div>
        <button type="button" onClick={onOpenQueue} style={buttonStyle('primary')}>
          Buka antrean
        </button>
      </div>

      <div style={statGridStyle}>
        {statCards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} />
        ))}
      </div>

      <p style={{ ...helpStyle, marginTop: 0 }}>
        Lajur bulanan (MRR) dinormalkan dari {f.settledLast30Days} pembayaran terselesaikan 30 hari
        terakhir · mingguan 7, bulanan 30, tahunan 365 hari. Langganan aktif adalah akun dengan masa
        aktif yang masih berjalan; sudah berakhir adalah akun yang pernah punya masa aktif dan
        sekarang tidak.
      </p>

      {/* One honest bar: of the accounts that ever held an active period, the
          share still active. Both numbers come from the same server read; the
          denominator is never invented, and a zero denominator shows no bar. */}
      {f.activeSubscribers + f.churnedSubscribers > 0 && (
        <div style={panelStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 16,
            }}
          >
            <p style={{ fontSize: text.control, color: 'var(--console-secondary)', margin: 0 }}>
              Retensi langganan
            </p>
            <p
              style={{
                fontFamily: 'var(--font-console)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: text.figure,
                fontWeight: 600,
                color: 'var(--console-ink)',
                margin: 0,
              }}
            >
              {Math.round(
                (f.activeSubscribers / (f.activeSubscribers + f.churnedSubscribers)) * 100,
              )}
              %
            </p>
          </div>
          <div
            style={{ ...progressTrackStyle, marginTop: 10 }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(
              (f.activeSubscribers / (f.activeSubscribers + f.churnedSubscribers)) * 100,
            )}
            aria-label="Porsi akun yang masih aktif dari yang pernah berlangganan"
          >
            <div
              style={progressFillStyle(
                f.activeSubscribers / (f.activeSubscribers + f.churnedSubscribers),
              )}
            />
          </div>
          <p style={{ ...helpStyle, marginTop: 8 }}>
            {f.activeSubscribers.toLocaleString('id-ID')} dari{' '}
            {(f.activeSubscribers + f.churnedSubscribers).toLocaleString('id-ID')} akun yang pernah
            berlangganan masih aktif
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void onReload({ silent: true })}
        style={{
          ...buttonStyle('quiet'),
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {/* Same glyph, same contract as the queue's reload: the arrow turns
            only while a read is actually in flight, and the figures underneath
            stay put instead of flickering to a skeleton. */}
        <RotateCw
          size={14}
          strokeWidth={1.9}
          aria-hidden
          focusable={false}
          className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined}
        />
        Muat ulang
      </button>
    </div>
  )
}

/**
 * One stat card: label on top, the figure below it in tabular type. Cards sit in
 * a responsive grid so the key numbers read across, not down a long list.
 */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={panelStyle}>
      <p style={{ fontSize: text.control, color: 'var(--console-secondary)', margin: 0 }}>
        {label}
      </p>
      <p style={{ ...numberCell, textAlign: 'left', marginTop: 6 }}>{value}</p>
    </div>
  )
}
