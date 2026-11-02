import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminContactView } from '@/app/features/admin/AdminContactView'

/**
 * The form that sets the address the public footer publishes.
 *
 * Four rules this screen exists to keep, the same four its two siblings keep:
 *
 *  - It shows what the **server** holds. After a save it re-reads, so what the
 *    footer will publish is what the form ends up displaying, not what was typed.
 *  - A refused save changes nothing on screen. The field goes back to the last
 *    address the server confirmed, and the refusal is shown, not swallowed.
 *  - Clearing is a named action. One box going blank is the only way to take an
 *    address off the page, so the button says what it will do instead of letting
 *    a blank field look untouched.
 *  - No control claims to verify an address. Nobody verifies deliverability
 *    here, and a button implying otherwise would promise the exact thing no one
 *    has done.
 */
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

const mocked = vi.mocked(apiFetch)

const ON_SERVER = { email: 'support@aidss.id', updatedAt: '2026-11-02T10:00:00+00:00' }
const NOTHING = { email: null, updatedAt: null }

function respond(status: number, body: unknown) {
  mocked.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response)
}

function writes() {
  return mocked.mock.calls.filter(
    (c) =>
      String(c[0]).endsWith('/v1/admin/settings/contact') &&
      (c[1] as RequestInit)?.method === 'PUT',
  )
}

function emailField() {
  return screen.getByLabelText(/^Email$/)
}

describe('AdminContactView', () => {
  beforeEach(() => {
    mocked.mockReset()
    respond(200, ON_SERVER)
  })

  it('shows the address the server holds, not one it made up', async () => {
    render(<AdminContactView />)

    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))
    expect(screen.getByText(/Diperbarui/)).toBeInTheDocument()
  })

  it('opens a blank form when nothing is published, and says so', async () => {
    respond(200, NOTHING)
    render(<AdminContactView />)

    await waitFor(() => expect(emailField()).toHaveValue(''))
    expect(screen.getByText(/Belum ada alamat yang dipublikasikan/i)).toBeInTheDocument()
    /* No timestamp claim for a value that was never written. */
    expect(screen.queryByText(/Diperbarui/)).not.toBeInTheDocument()
  })

  it('sends the address in one request, as written', async () => {
    render(<AdminContactView />)
    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))

    await userEvent.clear(emailField())
    await userEvent.type(emailField(), 'bantuan@aidss.id')
    await userEvent.click(screen.getByRole('button', { name: /^Simpan$/ }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ email: 'bantuan@aidss.id' })
  })

  it('shows what the server confirmed after a save, not what was typed', async () => {
    render(<AdminContactView />)
    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))

    await userEvent.clear(emailField())
    await userEvent.type(emailField(), 'salah-ketik@aidss.id')
    // The read-back says something else than the write was asked to store.
    respond(200, ON_SERVER)
    await userEvent.click(screen.getByRole('button', { name: /^Simpan$/ }))

    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))
    expect(screen.getByText(/Endpoint publik sekarang melaporkan alamat ini/i)).toBeInTheDocument()
  })

  it('a refused address leaves the field on what the server still holds', async () => {
    render(<AdminContactView />)
    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))

    await userEvent.clear(emailField())
    await userEvent.type(emailField(), 'bukan alamat')
    // The PUT is refused; the read that follows still answers from the server.
    mocked.mockImplementation(async (_url, init) =>
      (init as RequestInit)?.method === 'PUT'
        ? ({
            ok: false,
            status: 422,
            json: async () => ({ detail: 'nope' }),
          } as unknown as Response)
        : ({ ok: true, status: 200, json: async () => ON_SERVER } as unknown as Response),
    )
    await userEvent.click(screen.getByRole('button', { name: /^Simpan$/ }))

    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))
    expect(screen.getByRole('alert')).toHaveTextContent('422')
    expect(screen.getByRole('alert')).toHaveTextContent('bukan satu alamat email yang sah')
  })

  it('an empty field over a published address asks to remove it, not to save', async () => {
    render(<AdminContactView />)
    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))

    await userEvent.clear(emailField())

    expect(screen.getByRole('button', { name: /Hapus dari footer/i })).toBeInTheDocument()
    expect(screen.getByText(/menyimpannya menghapus alamat dari footer/i)).toBeInTheDocument()
  })

  it('clearing publishes nothing, and the form says the footer will stop showing it', async () => {
    render(<AdminContactView />)
    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))

    await userEvent.clear(emailField())
    respond(200, NOTHING)
    await userEvent.click(screen.getByRole('button', { name: /Hapus dari footer/i }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ email: '' })
    await waitFor(() => expect(screen.getByRole('button', { name: /^Simpan$/ })).toBeDisabled())
    expect(
      screen.getByText(/Footer publik tidak lagi menampilkan alamat kontak/i),
    ).toBeInTheDocument()
  })

  it('will not save a field nobody changed', async () => {
    render(<AdminContactView />)
    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))

    expect(screen.getByRole('button', { name: /^Simpan$/ })).toBeDisabled()
    expect(writes()).toHaveLength(0)
  })

  it('tells a non-administrator it is their absence of a role, not a network problem', async () => {
    respond(403, { detail: 'Administrator access required' })
    render(<AdminContactView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Hanya administrator/i)
    expect(screen.queryByLabelText(/^Email$/)).not.toBeInTheDocument()
  })

  it('refuses to edit over an unknown stored value', async () => {
    /* Saving blind would overwrite whatever the footer is publishing with a
       guess, and the operator would never be told which address disappeared. */
    mocked.mockRejectedValue(new Error('offline'))
    render(<AdminContactView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /menimpa alamat yang sedang berlaku/i,
    )
    expect(screen.queryByLabelText(/^Email$/)).not.toBeInTheDocument()
  })

  it('offers no control that pretends the address was verified', async () => {
    render(<AdminContactView />)
    await waitFor(() => expect(emailField()).toHaveValue('support@aidss.id'))

    expect(screen.queryByRole('button', { name: /verifikasi|cek|test/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
