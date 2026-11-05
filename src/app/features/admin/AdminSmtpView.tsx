import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'
import {
  alertStyle,
  buttonStyle,
  controlStyle as inputStyle,
  helpStyle,
  labelStyle,
  savedStyle,
  sectionNoteStyle,
  sectionTitleStyle,
  statusLineStyle,
  text,
} from '@/app/features/admin/consoleStyles'

/**
 * The email this install writes from, typed by the operator.
 *
 * It sits under the integration status on purpose: one screen answers "what is
 * wired up" and "what do I change", and splitting them across tabs is how a
 * status line and an edit end up describing different installs.
 *
 * The rules that make this form true rather than decorative:
 *
 *  - **It saves to the database and the transport reads that row when it sends.**
 *    No restart, no cache. This is the whole reason the screen exists; a form
 *    writing a row the mailer never read would look identical and do nothing.
 *  - **The password is never shown, in any shape.** The field arrives empty even
 *    when a credential is stored, because what comes back from the server is a
 *    boolean. Leaving it empty on save keeps the stored one.
 *  - **The values shown are the ones in force**, which may come from the
 *    deployment's environment rather than from a row. Pre-filling blanks over a
 *    working configuration would invite an operator to "fix" something that was
 *    never broken.
 *  - **A refused write goes back to what the server holds.** The fields an
 *    operator typed are not evidence that anything was stored.
 *
 * What this screen cannot promise: the password is stored as plaintext in
 * `system_settings`. It is in every backup of this database and readable by
 * anyone with read access to Postgres. That is written here as well as in the ADR
 * because it is the one consequence an operator would otherwise learn from an
 * incident.
 */

interface SmtpForm {
  host: string
  port: number
  username: string
  fromAddress: string
  useTls: boolean
  enabled: boolean
  hasPassword: boolean
  stored: boolean
  updatedAt: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; form: SmtpForm }
  | { kind: 'unavailable' }
  | { kind: 'forbidden' }

export function AdminSmtpView() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  // The typed values. `password` is deliberately absent from the server's shape
  // and lives only here, empty until someone types a new one.
  const [draft, setDraft] = useState({
    host: '',
    port: '',
    username: '',
    fromAddress: '',
    useTls: true,
    enabled: false,
    password: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    // A refetch after a write keeps the form on screen instead of flashing
    // "loading" under someone who just pressed a button: the values arriving are
    // the same fields with the server's answer in them.
    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }))
    try {
      const res = await apiFetch(ENDPOINTS.adminSmtp, { signal: controller.signal })
      if (res.status === 403) {
        setState({ kind: 'forbidden' })
        return null
      }
      if (!res.ok) {
        setState({ kind: 'unavailable' })
        return null
      }
      const form = (await res.json()) as SmtpForm
      setState({ kind: 'ready', form })
      // The password box starts empty whatever the server holds, and the label
      // beside it says what that means. A field that looked prefilled would be a
      // field an operator could copy out of.
      setDraft({
        host: form.host,
        port: String(form.port),
        username: form.username,
        fromAddress: form.fromAddress,
        useTls: form.useTls,
        enabled: form.enabled,
        password: '',
      })
      return form
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

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    setSavedAt(null)
    const body = {
      host: draft.host.trim(),
      port: draft.port.trim() ? Number(draft.port.trim()) : null,
      username: draft.username.trim(),
      fromAddress: draft.fromAddress.trim(),
      useTls: draft.useTls,
      enabled: draft.enabled,
      // Blank means "keep what is stored", which is why it is sent as an empty
      // string rather than left out — the rule lives on the server and the form
      // is not allowed a second copy of it.
      password: draft.password,
    }
    try {
      const res = await apiFetch(ENDPOINTS.adminSmtp, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setSaveError(String(res.status))
        // Back to the server's answer rather than leaving the typed values in the
        // boxes as though they had been stored.
        await load()
        return
      }
      const form = await load()
      if (form) {
        setSavedAt(Date.now())
        setDraft((current) => ({ ...current, password: '' }))
      }
    } catch {
      setSaveError('network')
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (state.kind === 'loading') {
    return <p style={statusLineStyle}>Memuat konfigurasi email…</p>
  }

  if (state.kind === 'forbidden') {
    return (
      <div role="alert" style={statusLineStyle}>
        Hanya administrator yang bisa menyunting konfigurasi email.
      </div>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <div role="alert" style={statusLineStyle}>
        Konfigurasi email tidak dapat dibaca. Formulir sengaja tidak ditampilkan, karena mengetik ke
        layar yang tidak tahu isinya berarti menimpa sesuatu yang mungkin sedang bekerja.
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

  const { form } = state

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
      <div>
        <h3 style={sectionTitleStyle}>Konfigurasi Email</h3>
        <p style={sectionNoteStyle}>
          {form.stored
            ? 'Yang tersimpan di basis data instalasi ini. Mengosongkan satu kolom akan menyerahkannya kembali ke lingkungan deployment.'
            : 'Belum ada yang disimpan di instalasi ini; nilai di bawah datang dari lingkungan deployment. Menyimpan apa pun akan menuliskannya ke basis data.'}
        </p>
      </div>

      {saveError && (
        <div role="alert" style={alertStyle('warning')}>
          {saveError === 'network'
            ? 'Server tidak terjangkau. Konfigurasi tidak berubah.'
            : `Permintaan ditolak (${saveError}). Konfigurasi tidak berubah${
                saveError === '422' ? ' — ada isian yang tidak bisa dipakai server surat.' : '.'
              }`}
        </div>
      )}

      {savedAt !== null && (
        <div style={savedStyle}>
          Tersimpan. Berkas yang sudah ada di antrean memakai konfigurasi ini pada percobaan
          berikutnya; tidak ada proses yang perlu dimulai ulang.
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label htmlFor="smtp-host" style={labelStyle}>
            Host
          </label>
          <input
            id="smtp-host"
            value={draft.host}
            onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            placeholder="smtp.example.com"
            autoComplete="off"
            spellCheck={false}
            style={inputStyle}
          />
          <p style={helpStyle}>Tanpa http:// atau smtp://, dan tanpa port di belakangnya.</p>
        </div>

        <div>
          <label htmlFor="smtp-port" style={labelStyle}>
            Port
          </label>
          <input
            id="smtp-port"
            value={draft.port}
            onChange={(e) => setDraft({ ...draft, port: e.target.value })}
            inputMode="numeric"
            placeholder="587"
            style={{ ...inputStyle, maxWidth: 140 }}
          />
          <p style={helpStyle}>
            465 sudah terenkripsi sejak koneksi dibuka; 587 memakai STARTTLS di bawah.
          </p>
        </div>

        <div>
          <label htmlFor="smtp-username" style={labelStyle}>
            Username
          </label>
          <input
            id="smtp-username"
            value={draft.username}
            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            autoComplete="off"
            spellCheck={false}
            style={inputStyle}
          />
          <p style={helpStyle}>Kosong bila relay mengizinkan tanpa login.</p>
        </div>

        <div>
          <label htmlFor="smtp-password" style={labelStyle}>
            Password
          </label>
          <input
            id="smtp-password"
            type="password"
            value={draft.password}
            onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            // A browser that "helpfully" remembers a server credential into a
            // form field is one autofill away from putting it somewhere else.
            autoComplete="new-password"
            placeholder={
              form.hasPassword ? 'terisi — kosongkan untuk mempertahankan' : 'belum diisi'
            }
            style={inputStyle}
          />
          <p style={helpStyle}>
            {form.hasPassword
              ? 'Kosong untuk mempertahankan yang tersimpan. Menyunting kolom lain tidak menghapus kredensial.'
              : 'Belum ada password yang tersimpan di instalasi ini.'}
          </p>
        </div>

        <div>
          <label htmlFor="smtp-from" style={labelStyle}>
            Alamat Pengirim
          </label>
          <input
            id="smtp-from"
            value={draft.fromAddress}
            onChange={(e) => setDraft({ ...draft, fromAddress: e.target.value })}
            placeholder="billing@namaproduk.com"
            autoComplete="off"
            spellCheck={false}
            style={inputStyle}
          />
          <p style={helpStyle}>
            Yang terbaca di header From. Satu alamat, bukan daftar; bukan mailto:.
          </p>
        </div>

        <Toggle
          id="smtp-tls"
          label="Mulai TLS"
          on={draft.useTls}
          onChange={(next) => setDraft({ ...draft, useTls: next })}
          help="Enkripsi setelah koneksi terbuka. Tidak dipakai pada port 465."
        />
        <Toggle
          id="smtp-enabled"
          label="Kirim email dari instalasi ini"
          on={draft.enabled}
          onChange={(next) => setDraft({ ...draft, enabled: next })}
          help="Pintu utamanya. Dengan ini mati, antrean notifikasi tidak menulis pesan apa pun."
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={buttonStyle('primary')}
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
        {form.updatedAt && (
          <span style={statusLineStyle}>
            Diperbarui {new Date(form.updatedAt).toLocaleString('id-ID')}
          </span>
        )}
      </div>

      <p style={statusLineStyle}>
        Password disimpan apa adanya di basis data, bukan di lingkungan. Artinya ia ikut dalam
        setiap cadangan basis data dan terbaca oleh akun yang punya hak baca Postgres. Yang tidak
        berlaku: password tidak pernah ditampilkan di layar ini, tidak pernah dikirim kembali ke
        browser, dan tidak pernah masuk log.
      </p>
    </div>
  )
}

function Toggle({
  id,
  label,
  on,
  onChange,
  help,
}: {
  id: string
  label: string
  on: boolean
  onChange: (next: boolean) => void
  help: string
}) {
  return (
    <div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        aria-label={`${label}: ${on ? 'aktif' : 'tidak aktif'}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: text.body,
          padding: '7px 12px',
          minHeight: 32,
          color: on ? 'var(--foreground)' : 'var(--console-secondary)',
          background: 'transparent',
          border: '1px solid var(--control-border)',
          borderRadius: 'var(--radius)',
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: on ? 'var(--gain)' : 'var(--console-secondary)',
          }}
        />
        {label}
      </button>
      <p style={helpStyle}>{help}</p>
    </div>
  )
}
