import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminProfilePopup } from '@/app/features/admin/AdminProfilePopup'
import { AppProvider } from '@/app/context/AppContext'
import type { Account, AuthState } from '@/app/features/identity/useAuth'

/**
 * The header chip's popup: two doors and the operator's own credentials behind
 * one of them.
 *
 * The popup acts on the auth object App owns, which is the whole reason a
 * password change can leave the console at all: these tests assert that each
 * control reaches the right method with the right payload, and that the UI
 * reports the server's answer instead of a local wish. The failure that matters
 * is the quiet credential one: a change that looks saved but never left the
 * browser, or a revoked session the screen still renders as signed in.
 */

const ACCOUNT: Account = {
  id: 'op-1',
  email: 'operator@local.invalid',
  full_name: 'Cek Admin Panel',
  phone_number: '0812000000000',
  role: 'admin',
  blocked: false,
  blockedReason: null,
}

function makeAuth(overrides: Partial<AuthState> = {}) {
  return {
    status: 'signed-in',
    account: ACCOUNT,
    error: null,
    refresh: vi.fn(async () => {}),
    signIn: vi.fn(async () => {}),
    signUp: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    updateProfile: vi.fn(async () => {}),
    changeEmail: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
    ...overrides,
  } satisfies AuthState
}

function renderPopup(auth: AuthState = makeAuth(), onClose = vi.fn()) {
  render(
    <AppProvider>
      <AdminProfilePopup onClose={onClose} auth={auth} />
    </AppProvider>,
  )
  return { auth, onClose }
}

async function openEditor(auth: AuthState = makeAuth()) {
  const utils = renderPopup(auth)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /Pengaturan profil/i }))
  return { user, ...utils }
}

describe('the profile popup menu', () => {
  it('covers the screen with the signed-in account, from the server object', async () => {
    renderPopup()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Cek Admin Panel')).toBeInTheDocument()
    expect(screen.getByText('operator@local.invalid')).toBeInTheDocument()
    expect(screen.getByText('Administrator')).toBeInTheDocument()
  })

  it('offers exactly two doors: profile settings and the market page', async () => {
    renderPopup()
    expect(await screen.findByRole('button', { name: /Pengaturan profil/i })).toBeInTheDocument()
    const market = screen.getByRole('link', { name: /Halaman Pasar/i })
    // A real destination, not a button that pretends to navigate.
    expect(market).toHaveAttribute('href', '/')
  })

  it('closes with the X', async () => {
    const { onClose } = renderPopup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^Tutup$/ }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes with Escape', async () => {
    const { onClose } = renderPopup()
    await screen.findByRole('dialog')
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('the profile editor', () => {
  it('saves the name through the shared auth object, not a local rename', async () => {
    const { user, auth } = await openEditor()
    const name = screen.getByLabelText('Nama lengkap')
    await user.clear(name)
    await user.type(name, 'Sari AMD')
    await user.click(screen.getByRole('button', { name: /^Simpan$/ }))
    await waitFor(() =>
      expect(auth.updateProfile).toHaveBeenCalledWith({
        full_name: 'Sari AMD',
        phone_number: '0812000000000',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/Tersimpan/i)
  })

  it('refuses to save a name that did not change', async () => {
    const { auth } = await openEditor()
    // The save is disabled until the server's value differs, so it cannot be
    // pressed to do nothing.
    expect(screen.getByRole('button', { name: /^Simpan$/ })).toBeDisabled()
    expect(auth.updateProfile).not.toHaveBeenCalled()
  })

  it('moves the login email only with the current password attached', async () => {
    const { user, auth } = await openEditor()
    // Two forms ask for the current password; the email form is the first.
    await user.type(screen.getAllByLabelText('Password saat ini')[0], 'rahasia-lama')
    await user.type(screen.getByLabelText('Email login baru'), 'baru@aidss.id')
    await user.click(screen.getByRole('button', { name: /Ganti email$/ }))
    await waitFor(() =>
      expect(auth.changeEmail).toHaveBeenCalledWith({
        current_password: 'rahasia-lama',
        new_email: 'baru@aidss.id',
      }),
    )
  })

  it('reports a taken address with the server word, not a fake success', async () => {
    const { user, auth } = await openEditor(
      makeAuth({
        changeEmail: vi.fn(async () => {
          throw new Error('That email address is already registered.')
        }),
      }),
    )
    await user.type(screen.getAllByLabelText('Password saat ini')[0], 'rahasia-lama')
    await user.type(screen.getByLabelText('Email login baru'), 'punya-orang@aidss.id')
    await user.click(screen.getByRole('button', { name: /Ganti email$/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/already registered/)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('signs the console out through the same object after a password change', async () => {
    const { user, auth } = await openEditor()
    const passwordFields = screen.getAllByLabelText('Password saat ini')
    await user.type(passwordFields[1], 'rahasia-lama')
    await user.type(screen.getByLabelText('Password baru'), 'rahasia-baru-8')
    await user.click(screen.getByRole('button', { name: /Ganti password$/ }))
    await waitFor(() =>
      expect(auth.changePassword).toHaveBeenCalledWith({
        current_password: 'rahasia-lama',
        new_password: 'rahasia-baru-8',
      }),
    )
    // The 204 means every session row is gone. The popup must not keep a
    // signed-in console alive on top of that fact: signOut runs on App's own
    // instance, which is what makes the gate act.
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled())
  })

  it('does not sign out when the server refused the password change', async () => {
    const { user, auth } = await openEditor(
      makeAuth({
        changePassword: vi.fn(async () => {
          throw new Error('Current password is incorrect.')
        }),
      }),
    )
    const passwordFields = screen.getAllByLabelText('Password saat ini')
    await user.type(passwordFields[1], 'salah')
    await user.type(screen.getByLabelText('Password baru'), 'rahasia-baru-8')
    await user.click(screen.getByRole('button', { name: /Ganti password$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Current password is incorrect/)
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('will not post a password shorter than the server floor', async () => {
    const { user, auth } = await openEditor()
    const passwordFields = screen.getAllByLabelText('Password saat ini')
    await user.type(passwordFields[1], 'rahasia-lama')
    await user.type(screen.getByLabelText('Password baru'), 'pendek')
    expect(screen.getByRole('button', { name: /Ganti password$/ })).toBeDisabled()
    expect(auth.changePassword).not.toHaveBeenCalled()
  })

  it('steps back to the menu without closing the popup', async () => {
    const { user, onClose } = await openEditor()
    await user.click(screen.getByRole('button', { name: /Kembali ke menu profil/i }))
    expect(await screen.findByRole('button', { name: /Pengaturan profil/i })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
