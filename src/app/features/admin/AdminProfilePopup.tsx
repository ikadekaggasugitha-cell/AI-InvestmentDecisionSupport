import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, ChevronRight, Store, UserCog, X } from 'lucide-react'

import { useApp } from '@/app/context/AppContext'
import type { AuthState } from '@/app/features/identity/useAuth'
import {
  alertStyle,
  buttonStyle,
  controlStyle,
  helpStyle,
  labelStyle,
  mono,
  savedStyle,
  sectionNoteStyle,
  sectionTitleStyle,
  text,
} from '@/app/features/admin/consoleStyles'

/**
 * The operator's own account, opened from the identity chip in the header.
 *
 * The chip used to be a plain link to the market dashboard. That made the one
 * place an operator could change their own name, address or password reachable
 * only by leaving the console, and left the console with no way to answer
 * "who am I signed in as" at all. Now the chip opens this screen: it covers the
 * whole console, offers the two real destinations (profile settings, and the
 * market page) behind one close control, and it edits the account through the
 * same endpoints the subscriber app uses, so nothing here is a second, admin-
 * only truth about the person.
 *
 * The email is not part of the identity form because it is not a profile
 * field: it is the login identifier, and `PUT /v1/auth/me` refuses it. It moves
 * through /v1/auth/change-email, which asks for the current password first.
 * A password change revokes every session server-side, and the copy says so
 * rather than letting the screen go dark without warning.
 *
 * The `auth` object is App's own instance, passed down like SettingsView
 * receives it. That is load-bearing, not tidiness: a second `useAuth()` here
 * would sign out only its own copy, leaving the gate in App reading a status
 * that never changed, and the operator staring at a popup that covers a screen
 * it will never leave. (Measured, not theorised.)
 */

type View = 'menu' | 'profile'

/**
 * The save buttons share one footprint: a wider, steadier hit area than the
 * console's generic button (owner direction, Nov 2026), and all three wear
 * the same primary fill so the screen answers as one form of actions. The
 * widths follow the labels and stay apart deliberately (owner decision);
 * three equal-width buttons on one screen is the one pattern this popup sets
 * aside, by the same owner-authorised exception the Rekening tab already
 * uses for its two saves.
 *
 * `disabled` fades the fill rather than leaving it at full colour: a blue
 * button that looks live but answers nothing is the one state this screen
 * cannot afford, now that all three actions wear the fill.
 */
function saveButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...buttonStyle('primary'),
    padding: '8px 20px',
    minHeight: 40,
    fontSize: text.control,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'default' : 'pointer',
  }
}

/**
 * The popup's cards on the gray ground: white paper, a hairline softer than
 * the console's divider, and a shadow faint enough to read as lift rather
 * than decoration (owner direction). The radius sits in the console's nested
 * family, below the sheet's 20.
 */
const popupCardStyle: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--console-header-edge)',
  borderRadius: 16,
  boxShadow: '0 1px 2px rgba(20, 36, 58, 0.04), 0 4px 14px rgba(20, 36, 58, 0.06)',
  padding: '20px 24px',
}

/**
 * A navigation card you can press. Its edge keeps `--control-border` while
 * the static card above may sit on the softer hairline, because a clickable
 * boundary is a control boundary (ADR-0007); everything else matches the
 * cards: white paper, soft shadow, and the chevron that says this row goes
 * somewhere.
 */
const navRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  minHeight: 64,
  padding: '14px 16px',
  fontSize: text.control,
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
  background: 'var(--card)',
  border: '1px solid var(--control-border)',
  borderRadius: 12,
  boxShadow: '0 1px 2px rgba(20, 36, 58, 0.04), 0 4px 14px rgba(20, 36, 58, 0.05)',
  color: 'var(--console-ink)',
  textDecoration: 'none',
  boxSizing: 'border-box',
}

/** The role as a pill on the console's quiet blue, same pairing as the header tag. */
const rolePillStyle: CSSProperties = {
  fontSize: text.body,
  fontWeight: 600,
  color: 'var(--console-accent)',
  background: 'var(--console-accent-quiet)',
  borderRadius: 999,
  padding: '3px 10px',
  whiteSpace: 'nowrap',
}

const avatarStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  flexShrink: 0,
  borderRadius: '50%',
  background: 'var(--console-accent)',
  color: 'var(--console-accent-ink)',
  fontSize: text.control,
  fontWeight: 700,
}

/** Up to two letters, first and last word, so the circle names the person. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

export function AdminProfilePopup({ onClose, auth }: { onClose: () => void; auth: AuthState }) {
  const { locale } = useApp()
  const isId = locale === 'id'
  const [view, setView] = useState<View>('menu')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null
    boxRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreTo?.focus()
    }
  }, [onClose])

  const account = auth.account

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'var(--console-popup-ground)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 20px',
          // Sticky inside the popup's own scroller: however far the cards run,
          // the back arrow and the X stay reachable (owner direction). The
          // ground is opaque so nothing shows through the band.
          position: 'sticky',
          top: 0,
          zIndex: 1,
          flexShrink: 0,
          background: 'var(--console-popup-ground)',
          // The hairline token, not --border: this divider sits ten lines above
          // the first button, and the control-boundary guard reads proximity.
          borderBottom: '1px solid var(--console-hairline)',
          maxWidth: 680,
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        {view === 'profile' && (
          <button
            type="button"
            aria-label={isId ? 'Kembali ke menu profil' : 'Back to the profile menu'}
            onClick={() => setView('menu')}
            style={{
              ...buttonStyle('quiet'),
              padding: '6px 10px',
              minHeight: 32,
            }}
          >
            <ArrowLeft size={16} strokeWidth={1.9} aria-hidden focusable={false} />
          </button>
        )}
        <h2
          id="profile-popup-title"
          style={{ ...sectionTitleStyle, fontSize: text.heading + 2, margin: 0, flex: 1 }}
        >
          {view === 'menu'
            ? isId
              ? 'Akun operator'
              : 'Operator account'
            : isId
              ? 'Pengaturan profil'
              : 'Profile settings'}
        </h2>
        <button
          type="button"
          aria-label={isId ? 'Tutup' : 'Close'}
          onClick={onClose}
          style={{
            ...buttonStyle('quiet'),
            padding: '6px 10px',
            minHeight: 32,
          }}
        >
          <X size={16} strokeWidth={1.9} aria-hidden focusable={false} />
        </button>
      </div>

      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-popup-title"
        tabIndex={-1}
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 680,
          margin: '0 auto',
          // The header band already carries its own 16px of padding; opening
          // the body at 12 keeps the title and the first card one tight step
          // apart instead of a void (owner direction).
          padding: '12px 20px 40px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {account === null && (
          <p style={sectionNoteStyle}>
            {isId ? 'Akun sedang dimuat...' : 'Loading the account...'}
          </p>
        )}

        {account !== null && view === 'menu' && (
          <MenuView
            isId={isId}
            account={account}
            onOpenProfile={() => setView('profile')}
            onClose={onClose}
          />
        )}

        {account !== null && view === 'profile' && <ProfileView isId={isId} auth={auth} />}
      </div>
    </div>
  )
}

/** The two doors the header chip actually offers: fix your account, or leave. */
function MenuView({
  isId,
  account,
  onOpenProfile,
  onClose,
}: {
  isId: boolean
  account: { full_name: string; email: string; role: string }
  onOpenProfile: () => void
  onClose: () => void
}) {
  const roleLabel = account.role === 'admin' ? 'Administrator' : isId ? 'Pengguna' : 'User'
  return (
    <>
      <div style={{ ...popupCardStyle, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span aria-hidden style={avatarStyle}>
          {initialsOf(account.full_name)}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: text.heading,
              fontWeight: 700,
              color: 'var(--console-ink)',
              overflowWrap: 'anywhere',
            }}
          >
            {account.full_name}
          </span>
          <span
            style={{
              ...mono,
              display: 'block',
              fontSize: text.control,
              color: 'var(--console-secondary)',
              marginTop: 2,
              overflowWrap: 'anywhere',
            }}
          >
            {account.email}
          </span>
        </span>
        <span style={rolePillStyle}>{roleLabel}</span>
      </div>

      <button type="button" onClick={onOpenProfile} style={navRowStyle}>
        <UserCog size={18} strokeWidth={1.9} aria-hidden focusable={false} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontWeight: 600 }}>
            {isId ? 'Pengaturan profil' : 'Profile settings'}
          </strong>
          <span
            style={{
              display: 'block',
              fontSize: text.control,
              color: 'var(--console-secondary)',
              marginTop: 2,
            }}
          >
            {isId
              ? 'Ganti nama, nomor WhatsApp, email masuk, dan password.'
              : 'Change your name, WhatsApp number, login email and password.'}
          </span>
        </span>
        <ChevronRight
          size={18}
          strokeWidth={1.9}
          aria-hidden
          focusable={false}
          style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--console-secondary)' }}
        />
      </button>

      {/* A real link, not a button that pretends to route: this is the one
          option that leaves the console, and the browser should treat it that
          way. Closing first keeps the popup off the market page's back stack. */}
      <a href="/" onClick={onClose} style={navRowStyle}>
        <Store size={18} strokeWidth={1.9} aria-hidden focusable={false} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontWeight: 600 }}>{isId ? 'Halaman Pasar' : 'Market page'}</strong>
          <span
            style={{
              display: 'block',
              fontSize: text.control,
              color: 'var(--console-secondary)',
              marginTop: 2,
            }}
          >
            {isId
              ? 'Tutup konsol dan buka dashboard aplikasi untuk pengguna.'
              : 'Close the console and open the app dashboard users see.'}
          </span>
        </span>
        <ChevronRight
          size={18}
          strokeWidth={1.9}
          aria-hidden
          focusable={false}
          style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--console-secondary)' }}
        />
      </a>
    </>
  )
}

function ProfileView({ isId, auth }: { isId: boolean; auth: AuthState }) {
  const account = auth.account
  if (account === null) return null

  const [name, setName] = useState(account.full_name)
  const [phone, setPhone] = useState(account.phone_number)
  const [identityBusy, setIdentityBusy] = useState(false)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [identitySaved, setIdentitySaved] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSaved, setEmailSaved] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const identityDirty = name !== account.full_name || phone !== account.phone_number

  const saveIdentity = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setIdentityBusy(true)
      setIdentityError(null)
      setIdentitySaved(false)
      try {
        await auth.updateProfile({ full_name: name, phone_number: phone })
        setIdentitySaved(true)
      } catch (err) {
        setIdentityError(err instanceof Error ? err.message : String(err))
      } finally {
        setIdentityBusy(false)
      }
    },
    [auth, name, phone],
  )

  const saveEmail = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setEmailBusy(true)
      setEmailError(null)
      setEmailSaved(false)
      try {
        await auth.changeEmail({ current_password: emailPassword, new_email: newEmail })
        setNewEmail('')
        setEmailPassword('')
        setEmailSaved(true)
      } catch (err) {
        setEmailError(err instanceof Error ? err.message : String(err))
      } finally {
        setEmailBusy(false)
      }
    },
    [auth, emailPassword, newEmail],
  )

  const savePassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setPasswordBusy(true)
      setPasswordError(null)
      try {
        await auth.changePassword({
          current_password: currentPassword,
          new_password: newPassword,
        })
        // The 204 means every session row is gone. Signing out on App's own
        // auth instance is what makes the gate act on that fact: the local
        // status flips, the console unmounts, and the signed-out view answers
        // (the public landing, per App's gate, with the way back in one click).
        await auth.signOut()
      } catch (err) {
        setPasswordError(err instanceof Error ? err.message : String(err))
        setPasswordBusy(false)
      }
    },
    [auth, currentPassword, newPassword],
  )

  return (
    <>
      <section style={{ ...popupCardStyle, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h3 style={sectionTitleStyle}>{isId ? 'Nama dan kontak' : 'Name and contact'}</h3>
          <p style={sectionNoteStyle}>
            {isId
              ? 'Nama dan nomor WhatsApp yang tampil di akun Anda.'
              : 'The name and WhatsApp number shown on your account.'}
          </p>
        </div>
        <form onSubmit={saveIdentity} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="operator-name" style={labelStyle}>
              {isId ? 'Nama lengkap' : 'Full name'}
            </label>
            <input
              id="operator-name"
              name="full_name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={controlStyle}
              autoComplete="name"
            />
          </div>
          <div>
            <label htmlFor="operator-phone" style={labelStyle}>
              {isId ? 'Nomor WhatsApp' : 'WhatsApp number'}
            </label>
            <input
              id="operator-phone"
              name="phone_number"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={controlStyle}
              autoComplete="tel"
            />
          </div>
          {identityError && (
            <p role="alert" style={alertStyle('loss')}>
              {identityError}
            </p>
          )}
          {identitySaved && (
            <p role="status" style={savedStyle}>
              {isId ? 'Tersimpan.' : 'Saved.'}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={!identityDirty || identityBusy}
              style={saveButtonStyle(!identityDirty || identityBusy)}
            >
              {identityBusy ? (isId ? 'Menyimpan...' : 'Saving...') : isId ? 'Simpan' : 'Save'}
            </button>
          </div>
        </form>
      </section>

      <section style={{ ...popupCardStyle, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h3 style={sectionTitleStyle}>{isId ? 'Email masuk' : 'Login email'}</h3>
          <p style={sectionNoteStyle}>
            {isId
              ? 'Email adalah alamat masuk Anda, jadi menggantinya butuh password saat ini. Perangkat ini tetap masuk; mulai masuk berikutnya pakai alamat baru.'
              : 'The email is your login address, so moving it takes the current password. This device stays signed in; the next sign-in uses the new address.'}
          </p>
        </div>
        <form onSubmit={saveEmail} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="operator-email-current" style={labelStyle}>
              {isId ? 'Password saat ini' : 'Current password'}
            </label>
            <input
              id="operator-email-current"
              name="current_password"
              type="password"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              style={controlStyle}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label htmlFor="operator-email-new" style={labelStyle}>
              {isId ? 'Email login baru' : 'New login email'}
            </label>
            <input
              id="operator-email-new"
              name="new_email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={controlStyle}
              autoComplete="email"
            />
            <p style={helpStyle}>
              {isId ? `Saat ini: ${account.email}` : `Currently: ${account.email}`}
            </p>
          </div>
          {emailError && (
            <p role="alert" style={alertStyle('loss')}>
              {emailError}
            </p>
          )}
          {emailSaved && (
            <p role="status" style={savedStyle}>
              {isId ? 'Email masuk diganti.' : 'The login email was changed.'}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={emailPassword.length === 0 || newEmail.length === 0 || emailBusy}
              style={saveButtonStyle(
                emailPassword.length === 0 || newEmail.length === 0 || emailBusy,
              )}
            >
              {emailBusy
                ? isId
                  ? 'Menyimpan...'
                  : 'Saving...'
                : isId
                  ? 'Ganti email'
                  : 'Change email'}
            </button>
          </div>
        </form>
      </section>

      <section style={{ ...popupCardStyle, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h3 style={sectionTitleStyle}>{isId ? 'Password' : 'Password'}</h3>
          <p style={sectionNoteStyle}>
            {isId
              ? 'Setelah ganti password, semua perangkat keluar dan Anda masuk lagi dengan password baru di sini.'
              : 'After a password change every device signs out, and you sign in again with the new password here.'}
          </p>
        </div>
        <form onSubmit={savePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label htmlFor="operator-password-current" style={labelStyle}>
              {isId ? 'Password saat ini' : 'Current password'}
            </label>
            <input
              id="operator-password-current"
              name="current_password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              style={controlStyle}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label htmlFor="operator-password-new" style={labelStyle}>
              {isId ? 'Password baru' : 'New password'}
            </label>
            <input
              id="operator-password-new"
              name="new_password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={controlStyle}
              autoComplete="new-password"
            />
            <p style={helpStyle}>{isId ? 'Minimal 8 karakter.' : 'At least 8 characters.'}</p>
          </div>
          {passwordError && (
            <p role="alert" style={alertStyle('loss')}>
              {passwordError}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={currentPassword.length === 0 || newPassword.length < 8 || passwordBusy}
              style={saveButtonStyle(
                currentPassword.length === 0 || newPassword.length < 8 || passwordBusy,
              )}
            >
              {passwordBusy
                ? isId
                  ? 'Menyimpan...'
                  : 'Saving...'
                : isId
                  ? 'Ganti password'
                  : 'Change password'}
            </button>
          </div>
        </form>
      </section>
    </>
  )
}
