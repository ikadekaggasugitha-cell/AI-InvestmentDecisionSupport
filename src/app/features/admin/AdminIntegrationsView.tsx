import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'
import { text } from '@/app/features/admin/consoleStyles'

/**
 * Which integrations this install is wired to. Read-only, on purpose.
 *
 * The gateway keys stay in the deployment's environment. Writing them to
 * `system_settings` would store a secret as plaintext jsonb, carry it into every
 * backup, need masking on every read path, and still not take effect without a
 * restart — `get_settings()` is cached at import. A form that looked like it
 * saved credentials and changed nothing would be worse than no form at all, so
 * there is no input field here and the screen says why.
 *
 * Email left that rule when the operator asked to set the sending address from
 * the console: `AdminSmtpView` next door writes those fields, and the transport
 * reads the stored row at send time. This component still reads only status, and
 * the split is not cosmetic — the test below this file's guard asserts that no
 * host, username or credential can come out of *this* endpoint.
 *
 * Listed here are the integrations this code actually reads: the Midtrans gateway
 * and the SMTP settings behind the notification outbox. WhatsApp is not listed,
 * because `Settings` has no field for it and no transport exists — showing it as
 * "not configured" would imply the app has a place to put one.
 */

interface IntegrationState {
  midtransConfigured: boolean
  midtransEnvironment: string
  emailConfigured: boolean
  /** Setting NAMES that stand between this install and a sent confirmation.
   *  Never values, and never the host: which provider an install uses is itself
   *  information about it. */
  emailMissing: string[]
  // A boolean rather than a word, and that is not a style choice: this
  // endpoint's guard asserts that no string comes out of it except the site
  // name, because a status screen has no business repeating a host. "Is the
  // sender the operator's own, or the deployment's?" is a yes-or-no question.
  emailSenderStored: boolean
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; integrations: IntegrationState }
  | { kind: 'unavailable' }
  | { kind: 'forbidden' }

export function AdminIntegrationsView() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setState({ kind: 'loading' })
    try {
      const res = await apiFetch(ENDPOINTS.adminIntegrations, { signal: controller.signal })
      if (res.status === 403) {
        setState({ kind: 'forbidden' })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const integrations = (await res.json()) as IntegrationState
      if (controller.signal.aborted) return
      setState({ kind: 'ready', integrations })
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
      <p style={{ fontSize: text.body, color: 'var(--console-secondary)' }}>Memuat integrasi…</p>
    )
  }

  if (state.kind === 'forbidden') {
    return (
      <div role="alert" style={{ fontSize: text.body, color: 'var(--console-secondary)' }}>
        Hanya administrator yang bisa melihat status ini.
      </div>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <div
        role="alert"
        style={{ fontSize: text.body, color: 'var(--console-secondary)', maxWidth: 560 }}
      >
        Status integrasi tidak dapat dibaca. Layar ini sengaja tidak menampilkan &quot;belum
        dikonfigurasi&quot;, karena tidak tahu dan belum dikonfigurasi adalah dua pernyataan yang
        berbeda.
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

  const { integrations } = state

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
      <div>
        <h3 style={{ fontSize: text.control, fontWeight: 600, margin: 0 }}>Integrasi</h3>
        <p style={{ fontSize: text.meta, color: 'var(--console-secondary)', marginTop: 4 }}>
          Hanya integrasi yang kode ini baca yang tampil di sini. Tidak ada kolom untuk mengetik
          kunci Midtrans: kredensial gateway tinggal di lingkungan deployment dan nilainya dibaca
          sekali saat aplikasi naik, jadi formulir yang tampak menyimpan tidak akan mengubah apa
          pun. Email berbeda — alamat pengirimnya disunting di bagian berikutnya, dan berlaku pada
          pengiriman berikutnya tanpa memulai ulang.
        </p>
      </div>

      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <Row
          label="Midtrans"
          value={integrations.midtransConfigured ? 'Terpasang' : 'Belum dikonfigurasi'}
          tone={integrations.midtransConfigured ? 'ok' : 'off'}
          note={
            integrations.midtransConfigured
              ? 'Checkout bisa membuka halaman bayar.'
              : 'Tanpa kunci, permintaan checkout dijawab 503 dan transfer manual tetap jalan.'
          }
        />
        {/* Which site the money would reach. Sandbox and production look the same
            once a page opens, and only one of them takes real money. */}
        <Row
          label="Site yang dituju"
          value={integrations.midtransEnvironment}
          tone={integrations.midtransEnvironment === 'production' ? 'ok' : 'off'}
          note={
            integrations.midtransEnvironment === 'production'
              ? 'Transaksi nyata.'
              : 'Halaman sandbox; tidak ada uang sungguhan yang bergerak.'
          }
        />
        {/* Email is the second integration, and the one the operator cannot infer
            from the queue: approving a transfer queues a confirmation only when
            this install can send it, so "not configured" here means the payer
            learns nothing and nobody is at fault for that. */}
        <Row
          label="Email"
          value={
            integrations.emailConfigured ? 'Terkirim bila ada yang diantrekan' : 'Belum terpasang'
          }
          tone={integrations.emailConfigured ? 'ok' : 'off'}
          note={
            integrations.emailConfigured
              ? 'Transfer yang disetujui atau ditolak diantrekan sebagai pesan dan dikirim worker.'
              : `Antrean tidak menulis pesan. Yang belum diisi: ${integrations.emailMissing.join(', ') || 'tidak ada'}.`
          }
        />
      </div>

      <p style={{ fontSize: text.meta, color: 'var(--console-secondary)', margin: 0 }}>
        Nilai kunci tidak pernah dikirim ke layar ini, bahkan sebagian.
      </p>
      {/* Where mail actually goes is the second question, and the first one's
          answer does not settle it: an install can be "configured" and still be
          sending from an address nobody chose. */}
      <div>
        <Row
          label="Alamat pengirim kini"
          value={
            integrations.emailSenderStored ? 'Tersimpan di basis data' : 'Lingkungan deployment'
          }
          tone={integrations.emailSenderStored ? 'ok' : 'off'}
          note={
            integrations.emailSenderStored
              ? 'Ditulis operator lewat layar ini; lingkungan tidak lagi menjawabnya.'
              : 'Masih datang dari lingkungan deployment. Sunting di bawah untuk memindahkannya.'
          }
        />
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone: 'ok' | 'off'
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ fontSize: text.body, minWidth: 140 }}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: text.body,
          fontWeight: 600,
          color: tone === 'ok' ? 'var(--gain)' : 'var(--console-secondary)',
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: text.meta, color: 'var(--console-secondary)' }}>{note}</span>
    </div>
  )
}
