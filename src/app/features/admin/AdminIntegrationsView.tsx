import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'

/**
 * Which payment gateway this install is wired to. Read-only, on purpose.
 *
 * The keys stay in the deployment's environment. Writing them to
 * `system_settings` would store a secret as plaintext jsonb, carry it into every
 * backup, need masking on every read path, and still not take effect without a
 * restart — `get_settings()` is cached at import. A form that looked like it
 * saved credentials and changed nothing would be worse than no form at all, so
 * there is no input field here and the screen says why.
 *
 * Only Midtrans is listed, because only Midtrans exists: `Settings` has no SMTP
 * field and no WhatsApp gateway, and no transport for either is in this codebase.
 * Showing them as "not configured" would imply the app has a place to put them.
 */

interface IntegrationState {
  midtransConfigured: boolean
  midtransEnvironment: string
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
    return <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Memuat integrasi…</p>
  }

  if (state.kind === 'forbidden') {
    return (
      <div role="alert" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
        Hanya administrator yang bisa melihat status ini.
      </div>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <div role="alert" style={{ fontSize: 12, color: 'var(--muted-foreground)', maxWidth: 560 }}>
        Status integrasi tidak dapat dibaca. Layar ini sengaja tidak menampilkan &quot;belum
        dikonfigurasi&quot;, karena tidak tahu dan belum dikonfigurasi adalah dua pernyataan yang
        berbeda.
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

  const { integrations } = state

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Integrasi</h3>
        <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4 }}>
          Hanya integrasi yang kode ini baca yang tampil di sini. Tidak ada kolom untuk mengetik
          kunci: kredensial tinggal di lingkungan deployment, dan mengubahnya berarti menyunting
          berkas lingkungan lalu memulai ulang proses — nilainya dibaca sekali saat aplikasi naik,
          jadi formulir yang tampak menyimpan tidak akan mengubah apa pun.
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
      </div>

      <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}>
        Nilai kunci tidak pernah dikirim ke layar ini, bahkan sebagian.
      </p>
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
      <span style={{ fontSize: 12, minWidth: 140 }}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          fontWeight: 600,
          color: tone === 'ok' ? 'var(--gain)' : 'var(--muted-foreground)',
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{note}</span>
    </div>
  )
}
