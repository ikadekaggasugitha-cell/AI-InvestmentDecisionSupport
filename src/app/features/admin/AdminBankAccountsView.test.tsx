import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminBankAccountsView } from '@/app/features/admin/AdminBankAccountsView'

/**
 * The form that sets where a manual transfer goes.
 *
 * Four rules this screen exists to keep, unchanged by this form growing fields:
 *
 *  - It shows what the **server** holds — after a save it re-reads, so what the
 *    public endpoint will publish is what the form ends up displaying.
 *  - A refused save changes nothing on screen. The list goes back to the last
 *    list the server confirmed, and the refusal is shown, not swallowed.
 *  - An empty stored list is said out loud ("belum ada rekening tujuan"), not
 *    rendered as a quiet empty table that looks like a list that lost data.
 *  - No control claims to verify a bank account. Nobody verified anything.
 *
 * Two more since the bank became a choice and each row a visibility:
 *
 *  - The bank list comes from the server. A copy in this file would be a second
 *    answer to which banks exist, and the server is what rejects an unknown one.
 *  - Hiding a row is not deleting it. The row stays on this form, marked, and
 *    the save still carries it.
 */
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

const mocked = vi.mocked(apiFetch)

const BANK_OPTIONS = {
  options: [
    { code: 'bca', name: 'BCA' },
    { code: 'mandiri', name: 'Bank Mandiri' },
    { code: 'other', name: 'Lainnya (tulis sendiri)' },
  ],
}

const ON_SERVER = {
  accounts: [
    {
      bank: 'BCA',
      accountNumber: '1234567890',
      holderName: 'PT AIDSS',
      code: 'bca',
      enabled: true,
    },
  ],
  updatedAt: '2026-10-14T10:00:00+00:00',
}

const EMPTY = { accounts: [], updatedAt: null }

/**
 * One response for the account list, one for the bank options.
 *
 * The options are answered separately rather than falling into the same body,
 * because the form asks two questions and a mock that answers both with the
 * account list would leave `bankOptions` empty — every test would then be
 * reading a select with no choices, which is not the screen anyone uses.
 */
function respond(status: number, body: unknown) {
  mocked.mockImplementation(async (url) => {
    const isOptions = String(url).endsWith('/v1/admin/settings/bank-options')
    const served = isOptions ? BANK_OPTIONS : body
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => served,
    } as unknown as Response
  })
}

function writes() {
  return mocked.mock.calls.filter(
    (c) =>
      String(c[0]).endsWith('/v1/admin/settings/bank-accounts') &&
      (c[1] as RequestInit)?.method === 'PUT',
  )
}

function bankField() {
  return screen.getByLabelText(/^Bank$/)
}

function toggle(index = 1) {
  return screen.getByRole('switch', { name: `Tampilkan rekening ke-${index} ke user` })
}

describe('AdminBankAccountsView', () => {
  beforeEach(() => {
    mocked.mockReset()
    respond(200, ON_SERVER)
  })

  it('shows the destinations the server holds, not rows it made up', async () => {
    render(<AdminBankAccountsView />)

    // The select holds the code; the name beside it is what the server sent.
    await waitFor(() => expect(bankField()).toHaveValue('bca'))
    expect(bankField()).toHaveTextContent('BCA')
    expect(screen.getByLabelText(/Nomor rekening/i)).toHaveValue('1234567890')
    expect(screen.getByLabelText(/Nama pemilik/i)).toHaveValue('PT AIDSS')
    expect(screen.getAllByLabelText(/^Bank$/)).toHaveLength(1)
  })

  it('offers the banks the server lists, not a list written here', async () => {
    render(<AdminBankAccountsView />)
    await waitFor(() => expect(bankField()).toHaveValue('bca'))

    const codes = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(codes).toEqual(['bca', 'mandiri', 'other'])
  })

  it('asks for the bank name when the bank is the one they write themselves', async () => {
    // `other` is a real choice, not a failure to pick: a curated list is by
    // definition incomplete, and without it a destination at a smaller bank
    // could not be recorded at all.
    render(<AdminBankAccountsView />)
    await waitFor(() => expect(bankField()).toHaveValue('bca'))

    await userEvent.selectOptions(bankField(), 'other')

    const name = await screen.findByLabelText(/Nama bank untuk rekening ke-1/i)
    expect(name).toBeInTheDocument()
    // The name they already had is kept rather than cleared, so switching to
    // `other` cannot silently empty the field the public reads.
    expect(name).toHaveValue('BCA')
  })

  it('choosing a named bank sets the name from the server, not from the keyboard', async () => {
    render(<AdminBankAccountsView />)
    await waitFor(() => expect(bankField()).toHaveValue('bca'))

    await userEvent.selectOptions(bankField(), 'mandiri')

    expect(bankField()).toHaveValue('mandiri')
    expect(screen.queryByLabelText(/Nama bank untuk/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Simpan/i }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    const sent = JSON.parse(String(writes()[0][1]?.body)).accounts[0]
    expect(sent).toMatchObject({ code: 'mandiri', bank: 'Bank Mandiri' })
  })

  it('hides a row without deleting it', async () => {
    render(<AdminBankAccountsView />)
    await waitFor(() => expect(toggle()).toBeInTheDocument())

    await userEvent.click(toggle())

    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Disembunyikan')).toBeInTheDocument()
    // Still on the form. A hidden destination that vanished from the list would
    // read as a deleted one, and the operator would re-enter it.
    expect(bankField()).toHaveValue('bca')

    await userEvent.click(screen.getByRole('button', { name: /Simpan/i }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    const sent = JSON.parse(String(writes()[0][1]?.body)).accounts[0]
    expect(sent).toMatchObject({ code: 'bca', enabled: false })
  })

  it('says so when the save leaves the public with nothing to show', async () => {
    // "Endpoint publik melaporkan daftar ini" would be false with every row
    // hidden, and the operator would believe customers can still pay. The
    // message is read off the server's answer after the save, so the re-read
    // here has to carry the hidden row the way the real endpoint would.
    const HIDDEN = {
      accounts: [{ ...ON_SERVER.accounts[0], enabled: false }],
      updatedAt: '2026-10-14T10:05:00+00:00',
    }
    let putHappened = false
    mocked.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/bank-options')) {
        return { ok: true, status: 200, json: async () => BANK_OPTIONS } as unknown as Response
      }
      // Flipped by the PUT itself, not by the test after the click: `save()`
      // keeps running after the click resolves, so a flag set from here would
      // race the re-read and decide which message the test happens to see.
      if ((init as RequestInit | undefined)?.method === 'PUT') {
        putHappened = true
        return {
          ok: true,
          status: 200,
          json: async () => ({ accounts: [], updatedAt: null }),
        } as unknown as Response
      }
      const body = putHappened ? HIDDEN : ON_SERVER
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    })

    render(<AdminBankAccountsView />)
    await waitFor(() => expect(toggle()).toBeInTheDocument())

    await userEvent.click(toggle())
    await userEvent.click(screen.getByRole('button', { name: /Simpan/i }))

    expect(await screen.findByText(/semua rekening sedang disembunyikan/i)).toBeInTheDocument()
  })

  it('says there is no destination yet rather than rendering a quiet empty list', async () => {
    respond(200, EMPTY)
    render(<AdminBankAccountsView />)

    expect(await screen.findByText(/belum ada rekening tujuan/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Bank$/)).not.toBeInTheDocument()
  })

  it('sends the whole list in one request', async () => {
    render(<AdminBankAccountsView />)
    await waitFor(() => expect(bankField()).toHaveValue('bca'))

    const number = screen.getByLabelText(/Nomor rekening/i)
    await userEvent.clear(number)
    await userEvent.type(number, '9998887776')
    await userEvent.click(screen.getByRole('button', { name: /Simpan/i }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    const [, init] = writes()[0]
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      accounts: [
        {
          bank: 'BCA',
          accountNumber: '9998887776',
          holderName: 'PT AIDSS',
          code: 'bca',
          enabled: true,
        },
      ],
    })
  })

  it("shows the server's answer after saving, not what was typed", async () => {
    const SAVED = {
      accounts: [
        {
          bank: 'Bank Mandiri',
          accountNumber: '5555444433',
          holderName: 'PT AIDSS',
          code: 'mandiri',
          enabled: true,
        },
      ],
      updatedAt: '2026-10-15T08:00:00+00:00',
    }
    let served = 0
    mocked.mockImplementation(async (url) => {
      if (String(url).endsWith('/bank-options')) {
        return { ok: true, status: 200, json: async () => BANK_OPTIONS } as unknown as Response
      }
      served += 1
      // Call 1 is the initial load and call 2 is the PUT, which changes
      // nothing; call 3 is the re-read, and what it holds is what shows.
      const body = served === 3 ? SAVED : ON_SERVER
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    })

    render(<AdminBankAccountsView />)
    await waitFor(() => expect(bankField()).toHaveValue('bca'))
    await userEvent.click(screen.getByRole('button', { name: /Simpan/i }))

    await waitFor(() => expect(bankField()).toHaveValue('mandiri'))
    expect(screen.getByLabelText(/Nomor rekening/i)).toHaveValue('5555444433')
  })

  it('keeps the confirmed list on screen when the save is refused', async () => {
    render(<AdminBankAccountsView />)
    await waitFor(() => expect(bankField()).toHaveValue('bca'))

    respond(422, { detail: 'an empty list is refused' })
    const holder = screen.getByLabelText(/Nama pemilik/i)
    await userEvent.clear(holder)
    await userEvent.type(holder, 'Nama yang tidak tersimpan')
    await userEvent.click(screen.getByRole('button', { name: /Simpan/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/ditolak \(422\)/)
    // The typed text was never accepted, so it is not on the screen.
    expect(await screen.findByLabelText(/Nama pemilik/i)).toHaveValue('PT AIDSS')
  })

  it('forwards the empty-list refusal instead of pretending it saved', async () => {
    // GET succeeds; every PUT is refused, exactly as the endpoint refuses it.
    mocked.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/bank-options')) {
        return { ok: true, status: 200, json: async () => BANK_OPTIONS } as unknown as Response
      }
      if ((init as RequestInit | undefined)?.method === 'PUT') {
        return {
          ok: false,
          status: 422,
          json: async () => ({ detail: 'an empty list is refused' }),
        } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ON_SERVER } as unknown as Response
    })
    render(<AdminBankAccountsView />)
    await waitFor(() => expect(bankField()).toHaveValue('bca'))

    await userEvent.click(screen.getByRole('button', { name: /Hapus rekening ke-1/i }))
    await userEvent.click(screen.getByRole('button', { name: /Simpan/i }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    const [, init] = writes()[0]
    // The attempt is real — the server's refusal is what the form renders, not a
    // client-side rule that could drift from the one the endpoint enforces.
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ accounts: [] })

    expect(await screen.findByRole('alert')).toHaveTextContent(/ditolak \(422\)/)
    // The server still holds the one destination, so it comes back on re-read.
    expect(await screen.findByLabelText(/^Bank$/)).toHaveValue('bca')
  })

  it('has no control that claims to verify a bank account', async () => {
    render(<AdminBankAccountsView />)
    await waitFor(() => expect(bankField()).toBeInTheDocument())

    // Nothing anywhere verifies a bank account number. A button saying so would
    // promise the exact thing nobody does (R-26).
    expect(screen.queryByRole('button', { name: /verifikasi/i })).toBeNull()
    expect(screen.queryByText(/terverifikasi/i)).toBeNull()
  })

  it('adds a row that starts hidden-free and ready for a written-in bank', async () => {
    render(<AdminBankAccountsView />)
    await waitFor(() => expect(bankField()).toHaveValue('bca'))

    await userEvent.click(screen.getByRole('button', { name: /Tambah rekening/i }))

    const banks = screen.getAllByLabelText(/^Bank$/)
    expect(banks).toHaveLength(2)
    // `other`, not blank: a new row defaults to the one choice where the name is
    // the operator's to type, so there is no state where a row has selected a
    // bank and left its name empty.
    expect(banks[1]).toHaveValue('other')
    expect(screen.getByLabelText(/Nama bank untuk rekening ke-2/i)).toHaveValue('')
    expect(screen.getAllByLabelText(/Nomor rekening/i)[1]).toHaveValue('')
    expect(toggle(2)).toHaveAttribute('aria-checked', 'true')
  })

  it('is not a form at all when the viewer is not an administrator', async () => {
    respond(403, {})
    render(<AdminBankAccountsView />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Simpan/i })).not.toBeInTheDocument()
  })

  it('renders nothing editable when the server cannot be asked', async () => {
    mocked.mockRejectedValue(new Error('offline'))
    render(<AdminBankAccountsView />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Simpan/i })).not.toBeInTheDocument()
  })
})
