import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'

/**
 * The console's overview: nine figures, no chart.
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
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--foreground)',
  margin: 0,
}

function rp(n: number): string {
  // Exact rupiah. The compact formatter would print "Rp 79Rb" for a figure an
  // operator is about to reconcile against a bank statement.
  return `Rp ${n.toLocaleString('id-ID')}`
}

/**
 * How many columns the figure block uses, by width.
 *
 * A fixed count rather than `auto-fit`, because of how the block draws itself:
 * the container paints `--border` behind the cells and leaves a 1px gap, which
 * is what makes the hairlines. An `auto-fit` count that does not divide the
 * number of cells leaves the last row's empty tracks showing that same paint —
 * a grey slab the width of four cards that reads as a panel which lost its
 * figures. The remainder is closed by the last cell (see `spanFor`), so the
 * paint is only ever visible between two real cells.
 */
function useFigureColumns(): number {
  const [columns, setColumns] = useState(3)

  useEffect(() => {
    // jsdom and anything without matchMedia keeps the desktop count, which is
    // what the guard in `App.tsx` does for its own media query.
    if (typeof window.matchMedia !== 'function') return
    const wide = window.matchMedia('(min-width: 900px)')
    const middle = window.matchMedia('(min-width: 560px)')
    const apply = () => setColumns(wide.matches ? 3 : middle.matches ? 2 : 1)
    apply()
    wide.addEventListener('change', apply)
    middle.addEventListener('change', apply)
    return () => {
      wide.removeEventListener('change', apply)
      middle.removeEventListener('change', apply)
    }
  }, [])

  return columns
}

/** Columns this cell takes. Only the last one can be wider than one. */
function spanFor(index: number, count: number, columns: number): number | undefined {
  const remainder = count % columns
  if (remainder !== 0 && index === count - 1) return columns - remainder + 1
  return undefined
}

export function AdminDashboardView({ onOpenQueue }: { onOpenQueue: () => void }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const inFlight = useRef<AbortController | null>(null)
  const columns = useFigureColumns()

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
    return <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Memuat ringkasan…</p>
  }

  if (state.kind === 'forbidden') {
    return (
      <div role="alert" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
        Hanya administrator yang bisa melihat angka ini.
      </div>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <div role="alert" style={{ fontSize: 12, color: 'var(--muted-foreground)', maxWidth: 560 }}>
        Angka tidak dapat dibaca. Ini bukan berarti usahanya sepi: layar ini sengaja tidak
        menampilkan nol, karena nol adalah jawaban dan bukan kegagalan.
        <button
          type="button"
          onClick={() => void load()}
          style={{
            display: 'block',
            marginTop: 10,
            fontSize: 12,
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

  // Built as a list so the cell count is the array's length rather than a number
  // kept in sync by hand; `spanFor` closes the last row from that length.
  const cells: { label: string; value: string; note?: string }[] = [
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
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Ringkasan</h2>
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>
          Sembilan angka, satu pertanyaan ke server. Uang yang dihitung adalah baris berstatus
          settlement saja — transfer yang belum diputuskan bukan pendapatan.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 1,
          background: 'var(--border)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}
      >
        {cells.map((cell, index) => (
          <Figure
            key={cell.label}
            label={cell.label}
            value={cell.value}
            note={cell.note}
            span={spanFor(index, cells.length, columns)}
          />
        ))}
      </div>

      {/* The queue is the only thing on this screen an operator can still act on
          today, so it is a way in rather than a number to admire. The two counts
          stay apart: an expired row is still money someone sent. */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
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
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}>
            Antrean pembayaran
          </p>
          <p style={numberCell}>{f.pendingQueue.toLocaleString('id-ID')} menunggu keputusan</p>
          <p
            style={{
              fontSize: 11,
              color: 'var(--muted-foreground)',
              margin: '4px 0 0',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {f.expiredQueue.toLocaleString('id-ID')} sudah lewat tenggat, uangnya tetap ada
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenQueue}
          style={{
            fontSize: 12,
            padding: '7px 14px',
            minHeight: 32,
            fontWeight: 600,
            color: 'var(--primary-foreground)',
            background: 'var(--primary)',
            border: '1px solid var(--primary)',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
          }}
        >
          Buka antrean
        </button>
      </div>

      <button
        type="button"
        onClick={() => void load()}
        style={{
          alignSelf: 'flex-start',
          fontSize: 12,
          padding: '5px 10px',
          minHeight: 32,
          color: 'var(--foreground)',
          background: 'transparent',
          border: '1px solid var(--control-border)',
          borderRadius: 3,
          cursor: 'pointer',
        }}
      >
        Muat ulang
      </button>
    </div>
  )
}

function Figure({
  label,
  value,
  note,
  span,
}: {
  label: string
  value: string
  note?: string
  /** Grid columns this cell takes; absent means one. */
  span?: number
}) {
  return (
    <div
      style={{
        background: 'var(--card)',
        padding: 16,
        ...(span ? { gridColumn: `span ${span}` } : null),
      }}
    >
      <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}>{label}</p>
      <p style={numberCell}>{value}</p>
      {note && (
        <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '4px 0  0' }}>{note}</p>
      )}
    </div>
  )
}
