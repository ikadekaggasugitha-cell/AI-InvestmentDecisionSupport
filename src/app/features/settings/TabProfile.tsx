import { useState } from 'react'
import { useApp } from '@/app/context/AppContext'
import type { AuthState } from '@/app/features/identity/useAuth'
import { useTranslation } from '@/app/i18n/translations'
import { Divider, Metric, Panel, Unavailable } from '@/app/features/settings/tabPrimitives'
import {
  fieldInput,
  fieldLabel,
  primaryButton,
  secondaryButton,
  signOutButton,
} from '@/app/features/settings/settingsStyles'

export function TabProfile({
  id,
  auth,
  onSignedOut,
}: {
  id: boolean
  auth: AuthState
  onSignedOut: () => void
}) {
  const { locale } = useApp()
  // Real data, from GET /v1/auth/me. Before the multi-user backend this tab said
  // the backend had no user store, which stopped being true the moment the users
  // table existed.
  const account = auth.account
  const { t: t2 } = useTranslation(locale)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(account?.full_name ?? '')
  const [draftPhone, setDraftPhone] = useState(account?.phone_number ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty =
    account !== null && (draftName !== account.full_name || draftPhone !== account.phone_number)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      await auth.updateProfile({ full_name: draftName, phone_number: draftPhone })
      setEditing(false)
      setSaved(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t2('auth_error_generic'))
    } finally {
      setSaving(false)
    }
  }

  if (!account) {
    return (
      <Panel title={id ? 'Profil & Akun' : 'Profile & Account'}>
        <Unavailable
          id={id}
          title={id ? 'Akun belum dimuat' : 'Account not loaded'}
          body={
            id
              ? 'Gagal memuat akun. Periksa koneksi lalu buka lagi halaman ini.'
              : 'Could not load the account. Check the connection and reopen this tab.'
          }
        />
      </Panel>
    )
  }

  const roleLabel =
    account.role === 'admin' ? (id ? 'Administrator' : 'Administrator') : id ? 'Pengguna' : 'User'

  return (
    <Panel title={id ? 'Profil & Akun' : 'Profile & Account'}>
      <div className="account-name">{account.full_name}</div>
      <div className="account-email">{account.email}</div>

      <Divider />

      <Metric label={id ? 'Nomor WhatsApp' : 'WhatsApp'} value={account.phone_number} />
      {/* Role as a text label, not a coloured pill: see docs/settings-module-spec.md
          §4.1, which removed the badge for exactly this reason. */}
      <Metric label={id ? 'Peran' : 'Role'} value={roleLabel} />

      {account.blocked && (
        <p className="account-blocked">
          {id
            ? 'Akun ini sedang diblokir, jadi akses datanya ditolak.'
            : 'This account is blocked, so its data access is refused.'}
        </p>
      )}

      <Divider />

      {/* Editable fields. Every control here has a label, a real border and a
          focus ring from focus.css, and the save button is disabled until
          something actually changed, so it cannot be pressed to do nothing. */}
      {editing ? (
        <form onSubmit={save}>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="profile-name" style={fieldLabel}>
              {id ? 'Nama lengkap' : 'Full name'}
            </label>
            <input
              id="profile-name"
              name="full_name"
              type="text"
              className="auth-control"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              style={fieldInput}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="profile-phone" style={fieldLabel}>
              {id ? 'Nomor WhatsApp' : 'WhatsApp number'}
            </label>
            <input
              id="profile-phone"
              name="phone_number"
              type="tel"
              inputMode="tel"
              className="auth-control"
              value={draftPhone}
              onChange={(e) => setDraftPhone(e.target.value)}
              style={fieldInput}
            />
          </div>

          {saveError && (
            <p role="alert" className="profile-error">
              {saveError}
            </p>
          )}
          {saved && (
            <p role="status" className="profile-saved">
              {t2('auth_saved')}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="submit"
              className="auth-control"
              disabled={!dirty || saving}
              style={primaryButton}
            >
              {saving ? t2('auth_working') : t2('auth_save')}
            </button>
            <button
              type="button"
              className="auth-control"
              onClick={() => {
                setEditing(false)
                setSaveError(null)
                setSaved(false)
              }}
              style={secondaryButton}
            >
              {t2('auth_cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="auth-control"
          onClick={() => {
            setEditing(true)
            setDraftName(account.full_name)
            setDraftPhone(account.phone_number)
            setSaveError(null)
            setSaved(false)
          }}
          style={secondaryButton}
        >
          {t2('auth_edit_profile')}
        </button>
      )}

      <Divider />

      <button
        type="button"
        className="auth-control"
        disabled={busy}
        style={signOutButton}
        onClick={async () => {
          setBusy(true)
          await auth.signOut()
          onSignedOut()
        }}
      >
        {id ? 'Keluar akun' : 'Sign out'}
      </button>
    </Panel>
  )
}
