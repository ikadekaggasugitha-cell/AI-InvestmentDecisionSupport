import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'
import {
  alertStyle,
  controlStyle as inputStyle,
  labelStyle,
  savedStyle,
  sectionNoteStyle,
  statusLineStyle,
  text,
} from '@/app/features/admin/consoleStyles'

/**
 * Sets the support address the public footer publishes.
 *
 * The address lives in `system_settings.contact_support`; this is the form that
 * writes it. The rules are imported straight from the two forms next door:
 *
 *  - **The screen shows what the server holds.** After a save it re-reads rather
 *    than trusting the field, so what the footer will publish is what this form
 *    ends up displaying.
 *  - **A refused save changes nothing.** The field goes back to the last address
 *    the server confirmed, and the screen says the write was refused rather than
 *    leaving a typed string sitting there as if it were published.
 *
 * Clearing is allowed here and refused for the destination list, and the two
 * answers differ for one reason: one box going blank is the only way to say
 * "take the address off the page", while an emptied destination list would be a
 * silent delete of every account. So the button names what an empty field will
 * do instead of letting it look untouched.
 *
 * There is no "verify address" control. Nothing here verifies anything: the
 * operator types where people should write, and a button implying the server had
 * checked deliverability would promise the exact thing no one has done.
 */

interface ServerContact {
  email: string | null
  updatedAt: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; updatedAt: string | null }
  | { kind: 'unavailable' }
  | { kind: 'forbidden' }

export function AdminContactView() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // What the server last confirmed. A refused write goes back to this, so the
  // field cannot drift into a state the footer is not publishing.
  const lastKnown = useRef<string | null>(null)

  const restoreDraft = useCallback(() => {
    if (lastKnown.current === null) return
    setDraft(lastKnown.current)
  }, [])

  /**
   * A re-read (`quiet`) still lands in a ready state: what the form shows after a
   * save — refused or accepted — is whatever the server just confirmed, including
   * the "diperbarui" timestamp, which is the server's to state.
   */
  const load = useCallback(async (quiet = false): Promise<boolean> => {
    if (!quiet) setState({ kind: 'loading' })
    try {
      const res = await apiFetch(ENDPOINTS.adminContact)
      if (res.status === 403) {
        if (!quiet) setState({ kind: 'forbidden' })
        return false
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as ServerContact
      const email = body.email ?? ''
      lastKnown.current = email
      setState({ kind: 'ready', updatedAt: body.updatedAt })
      setDraft(email)
      return true
    } catch {
      if (!quiet) setState({ kind: 'unavailable' })
      return false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setSaving(true)
    setSaveError(null)
    setSavedAt(null)
    try {
      const res = await apiFetch(ENDPOINTS.adminContact, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: draft }),
      })
      if (!res.ok) {
        setSaveError(String(res.status))
        if (!(await load(true))) restoreDraft()
        return
      }
      if (await load(true)) setSavedAt(Date.now())
      else restoreDraft()
    } catch {
      setSaveError('network')
      if (!(await load(true))) restoreDraft()
    } finally {
      setSaving(false)
    }
  }

  if (state.kind === 'loading') {
    return <p style={statusLineStyle}>Memuat kontak…</p>
  }

  if (state.kind === 'forbidden') {
    return (
      <div role="alert" style={statusLineStyle}>
        Hanya administrator yang bisa mengubah kontak bantuan. Ini bukan masalah langganan.
      </div>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <div role="alert" style={statusLineStyle}>
        Kontak tidak dapat dimuat. Formulir sengaja dikosongkan, karena menyimpan dadakan berarti
        menimpa alamat yang sedang berlaku di footer publik.
      </div>
    )
  }

  // An empty field over a published address is a removal, not a no-op, so the
  // control says so rather than showing "Simpan" over a blank box.
  const clearing = draft.trim() === '' && lastKnown.current !== null && lastKnown.current !== ''
  const unchanged = draft === (lastKnown.current ?? '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        {/* No section title; the h1 above already says Kontak, so the title
            only repeated it (owner direction). */}
        <p style={sectionNoteStyle}>
          Alamat kontak yang ditampilkan di footer publik. Jika kosong, bagian kontak tidak
          ditampilkan sama sekali, bukan menjadi tautan mati.
        </p>
      </div>

      {saveError && (
        <div role="alert" style={alertStyle('warning')}>
          {saveError === 'network'
            ? 'Server tidak terjangkau. Alamat tidak berubah.'
            : saveError === '422'
              ? `Permintaan ditolak (${saveError}). Yang ditulis bukan satu alamat email yang sah, alamat tidak berubah.`
              : `Permintaan ditolak (${saveError}). Alamat tidak berubah.`}
        </div>
      )}

      {savedAt !== null && (
        <div style={savedStyle}>
          {draft.trim() === ''
            ? 'Tersimpan. Footer publik tidak lagi menampilkan alamat kontak.'
            : 'Tersimpan. Footer publik sekarang menampilkan alamat ini.'}
        </div>
      )}

      <div>
        <label htmlFor="admin-contact-email" style={labelStyle}>
          Email
        </label>
        <input
          id="admin-contact-email"
          value={draft}
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          placeholder="support@aidss.id"
          onChange={(e) => setDraft(e.target.value)}
          style={inputStyle}
        />
        {draft.trim() === '' && (
          <p style={{ ...statusLineStyle, marginTop: 6 }}>
            {lastKnown.current
              ? 'Kosong; menyimpannya menghapus alamat dari footer.'
              : 'Belum ada alamat yang dipublikasikan.'}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || unchanged}
          style={{
            fontSize: text.body,
            padding: '7px 16px',
            minHeight: 32,
            fontWeight: 600,
            color: clearing ? 'var(--loss)' : 'var(--primary-foreground)',
            background: clearing ? 'transparent' : 'var(--primary)',
            border: `1px solid ${clearing ? 'var(--loss)' : 'var(--primary)'}`,
            borderRadius: 'var(--radius)',
            cursor: saving || unchanged ? 'default' : 'pointer',
            opacity: saving || unchanged ? 0.7 : 1,
          }}
        >
          {saving ? 'Menyimpan…' : clearing ? 'Hapus dari footer' : 'Simpan'}
        </button>
        {state.updatedAt && (
          <span style={statusLineStyle}>
            Diperbarui {new Date(state.updatedAt).toLocaleString('id-ID')}
          </span>
        )}
      </div>
    </div>
  )
}
