import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'
import {
  alertStyle,
  buttonStyle,
  checkboxStyle,
  savedStyle,
  sectionNoteStyle,
  sectionTitleStyle,
  statusLineStyle,
  text,
} from '@/app/features/admin/consoleStyles'

/**
 * Chooses which ways to pay online this install offers.
 *
 * The list next door says where a transfer goes; this one says what the payment
 * page will offer. Both are the operator's decision, and until now only the
 * gateway's own dashboard decided the second one — invisible from inside the
 * product, so an install that should take QRIS only had no way to say so here.
 *
 * Three rules this screen keeps:
 *
 *  - **"Nobody has chosen" is displayed as itself, not as nothing chosen.** The
 *    server distinguishes the two and so must the form: an install that never
 *    wrote this setting still gets whatever its gateway dashboard enables, and a
 *    picker showing every box empty would read as though someone had switched
 *    them all off.
 *  - **The gateway's own codes are shown here and nowhere else on the user's
 *    side.** An operator deciding what to offer benefits from seeing the word
 *    that will be sent outward; a payer choosing how to pay does not, and a body
 *    that knows those words is a body that can pick a method that was just
 *    disabled.
 *  - **A save re-reads from the server.** What the checkboxes show afterwards is
 *    what the payment screen will publish, not what this form intended.
 *
 * There is no client-side rule stopping an empty selection. The server accepts
 * it and it means "no online payment", which is a coherent choice on an install
 * that only takes transfers — so the form warns about what it means and sends it,
 * rather than keeping a second copy of the rule that could disagree.
 */

interface ChannelOption {
  key: string
  label: string
  /** The gateway's own word for this channel, or null when it has none. */
  snap: string | null
}

interface ChannelsState {
  restricted: boolean
  enabled: string[]
  options: ChannelOption[]
  updatedAt: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; server: ChannelsState }
  | { kind: 'unavailable' }
  | { kind: 'forbidden' }

/** A small status pill: green when offered, grey when not, blue when the
 *  gateway still decides. Colour plus a word, never colour alone. */
function statusBadge(tone: 'gain' | 'neutral' | 'info'): CSSProperties {
  const colors = {
    gain: { background: 'var(--gain-bg)', color: 'var(--gain)' },
    info: { background: 'var(--console-accent-quiet)', color: 'var(--console-accent)' },
    neutral: { background: 'var(--neutral-bg)', color: 'var(--console-secondary)' },
  }[tone]
  return {
    ...colors,
    fontSize: text.meta,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  }
}

export function AdminPaymentChannelsView() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  // The working selection. Kept separate from the server's answer so an unsaved
  // change is visible as a change instead of rewriting what the screen claims is
  // stored.
  const [picked, setPicked] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Whether this operator has taken over from the gateway dashboard in this
  // session. Until they do, every box reads as "the gateway decides", and
  // switching one off is the act that starts a list.
  const [choosing, setChoosing] = useState(false)
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async (): Promise<ChannelsState | null> => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    // A refetch after a save keeps the picker on screen rather than flashing
    // "loading" under someone who just pressed a button.
    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }))
    try {
      const res = await apiFetch(ENDPOINTS.adminPaymentChannels, {
        signal: controller.signal,
      })
      if (res.status === 403) {
        setState({ kind: 'forbidden' })
        return null
      }
      if (!res.ok) {
        setState({ kind: 'unavailable' })
        return null
      }
      const body = (await res.json()) as ChannelsState
      setState({ kind: 'ready', server: body })
      setPicked(body.enabled)
      return body
    } catch {
      if (controller.signal.aborted) return null
      setState({ kind: 'unavailable' })
      return null
    }
  }, [])

  useEffect(() => {
    void load()
    return () => inFlight.current?.abort()
  }, [load])

  const toggle = (key: string) => {
    setSaveError(null)
    setSavedAt(null)
    setPicked((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    )
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    setSavedAt(null)
    try {
      const res = await apiFetch(ENDPOINTS.adminPaymentChannels, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: picked }),
      })
      if (!res.ok) {
        setSaveError(String(res.status))
        // Back to the server's answer, not to the fields: a refused write leaves
        // the stored list exactly as it was, and the screen has to show that.
        const server = await load()
        if (server) setPicked(server.enabled)
        return
      }
      const server = await load()
      if (server) {
        setPicked(server.enabled)
        setSavedAt(Date.now())
      }
    } catch {
      setSaveError('network')
      const server = await load()
      if (server) setPicked(server.enabled)
    } finally {
      setSaving(false)
    }
  }

  if (state.kind === 'loading') {
    return <p style={statusLineStyle}>Memuat metode bayar…</p>
  }

  if (state.kind === 'forbidden') {
    return (
      <div role="alert" style={statusLineStyle}>
        Hanya administrator yang bisa memilih metode bayar. Ini bukan masalah langganan.
      </div>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <div role="alert" style={statusLineStyle}>
        Daftar metode bayar tidak dapat dimuat. Formulir sengaja dikosongkan, karena menyimpan tanpa
        tahu isi yang berlaku berarti menimpa pilihan yang sedang berjalan.
      </div>
    )
  }

  const { server } = state
  // An install nobody has configured yet. The boxes are drawn from the registry,
  // which is what the gateway *could* offer, and each is marked accordingly —
  // because "aktif" would be a claim about a dashboard this form cannot see.
  const unrestricted = !server.restricted && !choosing
  const offlineCount = server.options.filter((o) => !o.snap).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h3 style={sectionTitleStyle}>Metode Pembayaran Online</h3>
        <p style={sectionNoteStyle}>
          Kanal yang aktif di sini menentukan apa yang muncul di halaman pembayaran. Menyimpan
          mengganti seluruh daftar, bukan menambah satu baris.
        </p>
      </div>

      {unrestricted ? (
        <div
          style={{
            fontSize: text.body,
            color: 'var(--foreground)',
            background: 'var(--muted)',
            border: '1px solid var(--control-border)',
            borderRadius: 'var(--radius)',
            padding: '8px 10px',
          }}
        >
          <strong>Belum ada daftar yang disimpan di aplikasi ini.</strong>
          <div style={{ marginTop: 4, color: 'var(--console-secondary)' }}>
            Yang menawarkan metode bayar sekarang adalah daftar kanal di sisi pembayaran, dan layar
            ini tidak bisa melihat isinya. Menyimpan daftar di sini akan membatasinya persis ke yang
            Anda centang, termasuk menutup metode yang sedang aktif di sana.
          </div>
        </div>
      ) : (
        <div style={statusLineStyle}>
          {picked.length === 0
            ? 'Tidak ada metode online yang akan ditawarkan. Membayar online ditutup; transfer ' +
              'langsung ke rekening tetap berjalan.'
            : `${picked.length} metode akan ditawarkan di halaman bayar.`}
        </div>
      )}

      {saveError && (
        <div role="alert" style={alertStyle('warning')}>
          {saveError === 'network'
            ? 'Server tidak terjangkau. Daftar tidak berubah.'
            : saveError === '422'
              ? `Permintaan ditolak (${saveError}). Ada nama kanal yang tidak dikenal, daftar tidak berubah.`
              : `Permintaan ditolak (${saveError}). Daftar tidak berubah.`}
        </div>
      )}

      {savedAt !== null && (
        <div style={savedStyle}>
          Tersimpan. Halaman bayar sekarang menawarkan{' '}
          {picked.filter((k) => server.options.find((o) => o.key === k)?.snap).length} metode
          online; tidak ada penyegaran server yang diperlukan.
        </div>
      )}

      <div
        role="group"
        aria-label="Kanal pembayaran"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 8,
          maxWidth: 560,
        }}
      >
        {server.options.map((option) => {
          const checked = picked.includes(option.key)
          return (
            <label
              key={option.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
                border: `1px solid ${checked ? 'var(--console-accent)' : 'var(--control-border)'}`,
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                // The whole card is the click target (it wraps the checkbox), and a
                // chosen channel reads at a glance: accent border plus a soft fill.
                background: checked
                  ? 'var(--console-accent-quiet)'
                  : option.snap
                    ? 'transparent'
                    : 'var(--muted)',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  if (unrestricted) setChoosing(true)
                  toggle(option.key)
                }}
                style={checkboxStyle}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: text.body, fontWeight: 600 }}>{option.label}</span>
                  <span
                    style={statusBadge(
                      !option.snap
                        ? 'neutral'
                        : unrestricted
                          ? 'info'
                          : checked
                            ? 'gain'
                            : 'neutral',
                    )}
                  >
                    {!option.snap
                      ? 'Deklarasi'
                      : unrestricted
                        ? 'Diatur gateway'
                        : checked
                          ? 'Aktif'
                          : 'Nonaktif'}
                  </span>
                </span>
                <span style={{ fontSize: text.meta, color: 'var(--console-secondary)' }}>
                  {!option.snap
                    ? 'Hanya untuk menyatakan transfer; tidak muncul di halaman bayar.'
                    : unrestricted
                      ? 'Belum dibatasi; gateway yang memutuskan.'
                      : checked
                        ? 'Ditawarkan di halaman bayar.'
                        : 'Tidak ditawarkan di halaman bayar.'}
                </span>
                {option.snap && (
                  <span
                    style={{
                      fontSize: text.meta,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--console-meta)',
                    }}
                  >
                    Kode: <span>{option.snap}</span>
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>

      {offlineCount > 0 && (
        <p style={statusLineStyle}>
          Kanal tanpa kode gateway tidak muncul di pemilih pembayaran online. Ia ada di daftar ini
          supaya pernyataan transfer memakai nama yang sama dengan yang dibaca antrean.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* `primary`, matching Rekening Tujuan above. The owner asked for one
            consistent primary colour across the two independent forms on this tab,
            so each form keeps its own save and they look the same; the sections are
            clearly separated, so the two saves are not ambiguous. */}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={buttonStyle('primary')}
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
        {server.updatedAt && (
          <span style={statusLineStyle}>
            Diperbarui {new Date(server.updatedAt).toLocaleString('id-ID')}
          </span>
        )}
      </div>
    </div>
  )
}
