import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'
import {
  buttonStyle,
  helpStyle,
  sectionNoteStyle,
  sectionTitleStyle,
  text,
} from '@/app/features/admin/consoleStyles'

/**
 * The console's overview: nine figures from one query, no chart.
 *
 * Nine is what the endpoint answers with; the screen shows six of them as cards,
 * two in the queue strip below, and one inside the run-rate's own formula. The
 * sub-heading used to lead with "sembilan angka", which invited a reader to count
 * six and conclude the panel was missing three.
 *
 * Deliberately not a recharts surface. A line chart over a handful of settled
 * payments is decoration, and `docs/DESIGN.md` sets this product's ENERGY at 1:
 * nothing here should try to impress the person reading it. What an operator
 * needs is the number, the window it covers, and the predicate that produced it.
 *
 * Three states are kept apart, because collapsing them is the whole risk of a
 * dashboard:
 *
 *  - **Zeros** are a real answer. An install that has not been paid for is quiet,
 *    and saying so plainly is correct.
 *  - **A refused read** (403) is not about the business at all.
 *  - **A read that failed** (503, or the server being unreachable) must never be
 *    drawn as a flat line. An operator who sees zeros when the truth is "we could
 *    not ask" stops looking, and that is how a broken database hides for a week.
 *
 * The one figure that is not a direct sum or count is the run-rate, and it says
 * so on its own face: the formula is printed beside it, because a number labelled
 * MRR invites a reader to treat it as money received.
 */

interface OverviewFigures {
  revenueToday: number
  revenueLast30Days: number
  revenueTotal: number
  mrrRunRate: number
  settledLast30Days: number
  pendingQueue: number
  expiredQueue: number
  activeSubscribers: number
  churnedSubscribers: number
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; figures: OverviewFigures }
  | { kind: 'unavailable' }
  | { kind: 'forbidden' }

const numberCell: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: text.figure,
  fontWeight: 600,
  color: 'var(--console-ink)',
  margin: 0,
  // Measured at 390: the label takes the left of the row and the figure the
  // right, so a narrow screen squeezed "Rp 15.000" into "Rp" over "15.000". A
  // figure that splits is no longer the number an operator reads; the label
  // wraps instead, which is what labels are for.
  whiteSpace: 'nowrap',
}

function rp(n: number): string {
  // Exact rupiah. The compact formatter would print "Rp 79Rb" for a figure an
  // operator is about to reconcile against a bank statement.
  return `Rp ${n.toLocaleString('id-ID')}`
}

/**
 * How the figures are laid out: one column of label/value rows, read top to
 * bottom.
 *
 * This replaced a three-across grid of six equal cells. That shape is the
 * default dashboard, and here it was also untrue to the data: it put "today's
 * revenue" and "already ended" in boxes of identical weight, and gave the only
 * derived figure on the screen a box the same size as a direct sum.
 *
 * The old grid carried a bug class of its own, recorded so nobody reintroduces
 * either the layout or the bug: the container painted `--border` behind the
 * cells and left a 1px gap to make the hairlines, so a column count that did
 * not divide the cell count left the last row's empty tracks showing that paint
 * — a grey slab the width of four cards that read as a panel which had lost its
 * figures. A single column with a hairline under each row cannot produce an
 * empty track, because there is no track left empty. That is the reason this is
 * a list, not only a preference.
 */
const figureRowsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
}

/**
 * The number that leads the screen: one size above the figure rows, and the
 * only place on this screen at it. When everything is large, nothing is.
 */
const leadCell: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: text.lead,
  fontWeight: 600,
  color: 'var(--console-ink)',
  margin: 0,
  lineHeight: 1.2,
}

export function AdminDashboardView({ onOpenQueue }: { onOpenQueue: () => void }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setState({ kind: 'loading' })
    try {
      const res = await apiFetch(ENDPOINTS.adminOverview, { signal: controller.signal })
      if (res.status === 403) {
        setState({ kind: 'forbidden' })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const figures = (await res.json()) as OverviewFigures
      if (controller.signal.aborted) return
      setState({ kind: 'ready', figures })
    } catch {
      if (controller.signal.aborted) return
      setState({ kind: 'unavailable' })
    }
  }, [])

  useEffect(() => {
    void load()
    return () => inFlight.current?.abort()
  }, [load])

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
      <div
        role="alert"
        style={{ fontSize: text.body, color: 'var(--console-secondary)', maxWidth: 560 }}
      >
        Angka tidak dapat dibaca. Ini bukan berarti usahanya sepi: layar ini sengaja tidak
        menampilkan nol, karena nol adalah jawaban dan bukan kegagalan.
        <button
          type="button"
          onClick={() => void load()}
          style={{
            display: 'block',
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
          Coba lagi
        </button>
      </div>
    )
  }

  const f = state.figures

  // Built as a list so the row count is the array's length rather than a number
  // kept in sync by hand. The queue is deliberately not in it: it is the one
  // number on this screen an operator can still change, so it is above the list
  // and larger than everything in it.
  const figures: { label: string; value: string; note?: string }[] = [
    { label: 'Pendapatan hari ini (WIB)', value: rp(f.revenueToday) },
    { label: '30 hari terakhir', value: rp(f.revenueLast30Days) },
    { label: 'Total terselesaikan', value: rp(f.revenueTotal) },
    // The only derived figure, and the formula is on its face: without it a
    // reader would take this for money received.
    {
      label: 'Lajur bulanan (MRR)',
      value: rp(f.mrrRunRate),
      note: `dinormalkan dari ${f.settledLast30Days} pembayaran terselesaikan 30 hari terakhir · mingguan 7, bulanan 30, tahunan 365 hari`,
    },
    {
      label: 'Langganan aktif',
      value: f.activeSubscribers.toLocaleString('id-ID'),
      note: 'akun dengan masa aktif yang masih berjalan',
    },
    {
      label: 'Sudah berakhir',
      value: f.churnedSubscribers.toLocaleString('id-ID'),
      note: 'akun yang pernah punya masa aktif dan sekarang tidak',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={sectionTitleStyle}>Ringkasan</h2>
        <p style={sectionNoteStyle}>
          Satu pertanyaan ke server untuk angka-angka di bawah. Uang yang dihitung adalah baris
          berstatus settlement saja — transfer yang belum diputuskan bukan pendapatan.
        </p>
      </div>

      {/* First on the screen and the largest thing on it, because it is the only
          figure here an operator can still act on. An expired row is kept as a
          separate count rather than added in: it is still money someone sent, and
          folding it into the pending number would make the queue look smaller
          than the money waiting. */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--control-border)',
          borderRadius: 'var(--radius)',
          padding: 16,
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
              fontFamily: 'var(--font-mono)',
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

      <div style={figureRowsStyle}>
        {figures.map((cell, index) => (
          <Figure key={cell.label} {...cell} last={index === figures.length - 1} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => void load()}
        style={{ ...buttonStyle('quiet'), alignSelf: 'flex-start' }}
      >
        Muat ulang
      </button>
    </div>
  )
}

/**
 * One figure row: label left, value right, note under it on the meta rung.
 *
 * A row rather than a card, because these six are read as a column of answers and
 * not compared side by side. The hairline is `--border` — a divider between two
 * rows, which carries no information by its edge; a control border here would
 * make six things look like six things you can click.
 */
function Figure({
  label,
  value,
  note,
  last,
}: {
  label: string
  value: string
  note?: string
  /** The final row drops its hairline; the panel below already closes the group. */
  last?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        padding: '10px 0',
        borderBottom: last ? undefined : '1px solid var(--border)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: text.control, color: 'var(--console-secondary)', margin: 0 }}>
          {label}
        </p>
        {note && <p style={{ ...helpStyle, marginTop: 3, maxWidth: 520 }}>{note}</p>}
      </div>
      {/* The value is the thing an operator reconciles, so it is the leading
          colour on the row rather than the muted one the label carries. */}
      <p style={{ ...numberCell, textAlign: 'right' }}>{value}</p>
    </div>
  )
}
