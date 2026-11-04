import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminPaymentChannelsView } from '@/app/features/admin/AdminPaymentChannelsView'

/**
 * The form that decides what the payment screen offers online.
 *
 * The reason this file exists is the failure mode the whole feature is built
 * around: a channel that is not offered produces no error anywhere. So the
 * assertions here are about what the form says and sends, not about it looking
 * tidy.
 *
 *  - "Nobody has configured this" is displayed as itself. Showing every box
 *    empty in that state would tell an operator they had switched everything off
 *    when they had not, and saving from there would then really do it.
 *  - The screen re-reads after a save. What the boxes show is what the server
 *    holds, because that is what the payment page will publish.
 *  - A refused write changes nothing on screen and says so.
 *  - The gateway's codes are on this screen and are the reason it is an admin
 *    screen: they are what will be sent outward.
 *  - A channel with no code is marked as such, because ticking it does not put
 *    a method on the payment page.
 */
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

const mocked = vi.mocked(apiFetch)

const OPTIONS = [
  { key: 'qris', label: 'QRIS', snap: 'qris' },
  { key: 'va_mandiri', label: 'Virtual Account Mandiri', snap: 'echannel' },
  { key: 'credit_card', label: 'Kartu kredit', snap: 'credit_card' },
  { key: 'bank_transfer', label: 'Transfer bank langsung', snap: null },
]

/** An install where the operator has chosen. */
const RESTRICTED = {
  restricted: true,
  enabled: ['qris'],
  options: OPTIONS,
  updatedAt: '2026-10-14T10:00:00+00:00',
}

/** An install where nobody ever wrote the setting. */
const UNSET = { restricted: false, enabled: [], options: OPTIONS, updatedAt: null }

function respond(body: unknown, status = 200) {
  mocked.mockImplementation(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as unknown as Response,
  )
}

function writes() {
  return mocked.mock.calls.filter(
    (call) => (call[1] as { method?: string } | undefined)?.method === 'PUT',
  )
}

function sentChannels() {
  const [, init] = writes()[0]
  return JSON.parse(String((init as { body: string }).body)).channels as string[]
}

beforeEach(() => {
  mocked.mockReset()
})

describe('memuat daftar kanal', () => {
  it('menampilkan setiap kanal yang dikenal registry, termasuk yang mati', async () => {
    respond(UNSET)
    render(<AdminPaymentChannelsView />)

    expect(await screen.findByText('Kartu kredit')).toBeInTheDocument()
    expect(screen.getByText('Transfer bank langsung')).toBeInTheDocument()
  })

  it('mencentang hanya kanal yang server simpan', async () => {
    respond(RESTRICTED)
    render(<AdminPaymentChannelsView />)

    await screen.findByText('QRIS')
    expect(screen.getByRole('checkbox', { name: /QRIS/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Kartu kredit/i })).not.toBeChecked()
  })

  it('menyebut kode gateway di samping pilihannya', async () => {
    /* The operator is deciding what gets sent outward, so this screen is where
       that word belongs. The payer's screen never shows it, which is the point
       of keeping the two lists apart. */
    respond(RESTRICTED)
    render(<AdminPaymentChannelsView />)

    await screen.findByText('echannel')
  })

  it('penanda kanal yang tidak punya kode gateway', async () => {
    respond(RESTRICTED)
    render(<AdminPaymentChannelsView />)

    await screen.findByText(/hanya untuk menyatakan transfer/i)
  })

  it('menampilkan kapan daftar terakhir disimpan', async () => {
    respond(RESTRICTED)
    render(<AdminPaymentChannelsView />)

    expect(await screen.findByText(/Diperbarui/)).toBeInTheDocument()
  })
})

describe('keadaan belum pernah dipilih', () => {
  it('mengatakannya apa adanya, bukan sebagai semua kanal mati', async () => {
    respond(UNSET)
    render(<AdminPaymentChannelsView />)

    expect(
      await screen.findByText(/Belum ada daftar yang disimpan di instalasi ini/i),
    ).toBeInTheDocument()
    // Said in the banner and again on every box, because the box is where an
    // operator's eye is when they are choosing.
    expect((await screen.findAllByText(/gateway yang memutuskan/i)).length).toBeGreaterThan(1)
  })

  it('tidak menulis apa pun hanya karena layar dibuka', async () => {
    respond(UNSET)
    render(<AdminPaymentChannelsView />)

    await screen.findByText('QRIS')
    expect(writes()).toHaveLength(0)
  })
})

describe('menyimpan pilihan', () => {
  it('mengirim daftar yang sedang berlaku plus satu yang baru dicentang', async () => {
    respond(RESTRICTED)
    render(<AdminPaymentChannelsView />)

    await userEvent.click(await screen.findByRole('checkbox', { name: /Kartu kredit/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(sentChannels()).toEqual(['qris', 'credit_card'])
  })

  it('mencentang satu kanal di instalasi yang belum terbatas memulai daftar', async () => {
    /* The first tick is the act that takes over from the gateway dashboard. The
       boxes read "gateway yang memutuskan" until then, so starting a list from
       one tick must not silently send every other channel as enabled. */
    respond(UNSET)
    render(<AdminPaymentChannelsView />)

    await userEvent.click(await screen.findByRole('checkbox', { name: /QRIS/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(sentChannels()).toEqual(['qris'])
  })

  it('menampilkan daftar yang server konfirmasi setelah menyimpan, bukan yang tadi dikirim', async () => {
    // The read after the write answers with something other than the request: a
    // channel the server did not keep must not sit on screen as if it had.
    let first = true
    mocked.mockImplementation(async (url, init) => {
      const writing = (init as { method?: string } | undefined)?.method === 'PUT'
      if (writing) first = false
      const served = first ? RESTRICTED : { ...RESTRICTED, enabled: ['qris', 'va_mandiri'] }
      return { ok: true, status: 200, json: async () => served } as unknown as Response
    })
    render(<AdminPaymentChannelsView />)

    await userEvent.click(await screen.findByRole('checkbox', { name: /Kartu kredit/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Virtual Account Mandiri/i })).toBeChecked(),
    )
  })

  it('membiarkan daftar kosong dikirim dan menyebut akibatnya lebih dulu', async () => {
    /* The server accepts an empty list and it means online payment is closed.
       A form that blocked it locally would be a second opinion about the
       operator's own setting; a form that allowed it silently would be a way to
       switch off the money path without meaning to. */
    respond(RESTRICTED)
    render(<AdminPaymentChannelsView />)

    await userEvent.click(await screen.findByRole('checkbox', { name: /QRIS/i }))
    expect(
      screen.getByText(/Membayar online ditutup; transfer langsung ke rekening tetap berjalan/i),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(sentChannels()).toEqual([])
  })
})

describe('penyimpanan yang gagal', () => {
  it('menunda dan mengembalikan daftar ke yang server pegang', async () => {
    respond(RESTRICTED)
    render(<AdminPaymentChannelsView />)

    await userEvent.click(await screen.findByRole('checkbox', { name: /Kartu kredit/i }))
    mocked.mockImplementationOnce(
      async () =>
        ({
          ok: false,
          status: 422,
          json: async () => ({ detail: 'unknown payment channel' }),
        }) as unknown as Response,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/422/)
    expect(screen.getByRole('checkbox', { name: /Kartu kredit/i })).not.toBeChecked()
  })

  it('tidak mengaku tersimpan ketika jawaban server tidak terbaca', async () => {
    respond(RESTRICTED)
    render(<AdminPaymentChannelsView />)

    await userEvent.click(await screen.findByRole('button', { name: 'Simpan' }))
    mocked.mockImplementationOnce(async () => {
      throw new Error('unreachable')
    })
    await userEvent.click(screen.getByRole('checkbox', { name: /Kartu kredit/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Server tidak terjangkau/)
    expect(screen.queryByText(/Tersimpan/)).not.toBeInTheDocument()
  })
})

describe('yang bukan administrator dan yang tidak bisa dimuat', () => {
  it('berhenti pada 403 dengan kalimat yang benar', async () => {
    respond({}, 403)
    render(<AdminPaymentChannelsView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Hanya administrator/)
    expect(writes()).toHaveLength(0)
  })

  it('kosongkan formulir kalau daftar tidak terbaca, jangan tampilkan daftar kosong', async () => {
    /* An empty picker here would look like "everything is off", and saving from
       it would really switch online payment off on an install that is working. */
    respond({}, 503)
    render(<AdminPaymentChannelsView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak dapat dimuat/)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
