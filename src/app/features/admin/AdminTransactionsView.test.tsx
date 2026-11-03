import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminTransactionsView } from '@/app/features/admin/AdminTransactionsView'

/**
 * The operator's payment queue.
 *
 * The backend has been finished and tested for a while; this screen is the
 * first thing that ever called it. So the assertions worth having are about
 * what the operator is told when an adjudication does *not* happen: a 409 and a
 * 503 both leave the money exactly where it was, and an operator who cannot see
 * that is left guessing about a payment someone made.
 *
 * Two absences are asserted too, because they are the decisions this screen
 * exists to keep: no control claims a receipt was opened (there is no stored
 * file, ADR-0011), and none claims a message was delivered — approving queues a
 * confirmation when this install can send email, and only the worker knows
 * whether it went out.
 */
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

const mocked = vi.mocked(apiFetch)

const PENDING = {
  id: 'tx-1',
  invoiceCode: 'AID-20261102-7731',
  amount: 44000,
  plan: 'monthly',
  paymentGateway: 'manual',
  paymentMethod: 'bank_transfer',
  status: 'pending',
  notes: 'Sudah transfer ke BCA, jam 21.40.',
  payerEmail: 'pembayar@aidss.id',
  createdAt: '2026-11-01T14:40:00+00:00',
  updatedAt: '2026-11-01T14:40:00+00:00',
  approvedAt: null,
  subscriptionId: null,
  expiresAt: '2099-01-01T00:00:00+00:00',
}

const SETTLED = {
  ...PENDING,
  id: 'tx-2',
  invoiceCode: 'AID-20261101-1201',
  status: 'settlement',
  approvedAt: '2026-11-02T03:15:00+00:00',
  subscriptionId: 'sub-9f2c-0000-0000',
  expiresAt: null,
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

/** The queue's envelope: one page plus the answer to "is there more". */
function page(rows: unknown[], hasMore = false) {
  return ok({ transactions: rows, hasMore })
}

function err(status: number, detail?: string) {
  return {
    ok: false,
    status,
    json: async () => (detail ? { detail } : {}),
  } as unknown as Response
}

/** Reads answer `page`; the first POST/PUT answers `action`. */
function serve(rows: unknown[], action: () => Response, hasMore = false) {
  let posted = false
  mocked.mockImplementation(async (_url, init) => {
    if ((init as RequestInit)?.method) {
      posted = true
      return action()
    }
    // After the action the queue re-reads, and the re-read must show the new
    // state rather than the one the client predicted.
    if (posted) return page([], false)
    return page(rows, hasMore)
  })
}

function callsTo(suffix: string, method?: string) {
  return mocked.mock.calls.filter(
    (c) =>
      String(c[0]).endsWith(suffix) ||
      (method && (c[1] as RequestInit)?.method === method && String(c[0]).includes(suffix)),
  )
}

describe('the queue as the server holds it', () => {
  beforeEach(() => {
    mocked.mockReset()
    mocked.mockResolvedValue(page([PENDING]))
  })

  it('renders the row the server sent, with its evidence', async () => {
    render(<AdminTransactionsView />)

    expect(await screen.findByText('AID-20261102-7731')).toBeInTheDocument()
    // Exact rupiah, not the compact formatter: matching a bank transfer to
    // "Rp 44Rb" is how the wrong row gets approved.
    expect(screen.getByText('Rp 44.000')).toBeInTheDocument()
    expect(screen.getByText('pembayar@aidss.id')).toBeInTheDocument()
    expect(screen.getByText(/Sudah transfer ke BCA/)).toBeInTheDocument()
  })

  it('prints the server status untranslated inside the table', async () => {
    const { container } = render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')

    // Scoped to the table on purpose: the filter control above it is allowed to
    // say "Menunggu", because that names the working set, not a row's state.
    const table = container.querySelector('table') as HTMLElement
    expect(within(table).getByText('pending')).toBeInTheDocument()
    expect(within(table).queryByText(/Menunggu/)).not.toBeInTheDocument()
  })

  it('asks for the pending set first, and the chosen set after', async () => {
    const user = userEvent.setup()
    render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')

    expect(String(mocked.mock.calls[0][0])).toContain('status=pending')
    expect(String(mocked.mock.calls[0][0])).toContain('limit=50')
    expect(String(mocked.mock.calls[0][0])).toContain('offset=0')

    await user.click(screen.getByRole('button', { name: 'Selesai' }))
    await waitFor(() => {
      const last = mocked.mock.calls[mocked.mock.calls.length - 1]
      expect(String(last?.[0])).toContain('status=settlement')
    })
  })

  it('disables the next page when the server says there is none', async () => {
    mocked.mockResolvedValue(page([PENDING], false))
    render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')

    expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeDisabled()
    expect(screen.getByText('1–1')).toBeInTheDocument()
    expect(screen.queryByText(/masih ada lagi/)).not.toBeInTheDocument()
  })

  it('announces a partial page and asks for the next one', async () => {
    const user = userEvent.setup()
    mocked.mockResolvedValue(page([PENDING], true))
    render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')

    // A full page that does not say so reads as the whole queue, which is the
    // mistake this paging exists to stop.
    expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeEnabled()
    expect(screen.getByText(/masih ada lagi/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Berikutnya' }))
    await waitFor(() => {
      const last = mocked.mock.calls[mocked.mock.calls.length - 1]
      expect(String(last?.[0])).toContain('offset=50')
    })
  })

  it('says an expired row is still money, and still approvable', async () => {
    mocked.mockResolvedValue(page([{ ...PENDING, id: 'tx-3', status: 'expire' }]))
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261102-7731')
    expect(screen.getByText(/uangnya tetap ada, masih bisa disetujui/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Setujui AID-20261102-7731/ })).toBeEnabled()
  })

  it('offers no action on a row that has already been decided', async () => {
    mocked.mockResolvedValue(page([SETTLED]))
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261101-1201')
    expect(screen.queryByRole('button', { name: /Setujui/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tolak/ })).not.toBeInTheDocument()
    expect(screen.getByText('final')).toBeInTheDocument()
    // What the money bought, named by the id the server minted.
    expect(screen.getByText(/masa aktif sub-9f2c/)).toBeInTheDocument()
  })

  it('prints the moment the money was accepted, and only on settled rows', async () => {
    /* The CSV export carries `approved_at`. A column that leaves the console in a
       file but never appears on screen is a quieter second copy of the ledger,
       so the queue reads the same field the export writes. A pending row has no
       approval moment at all, and printing one would be printing a date the
       server never wrote. */
    mocked.mockResolvedValue(page([SETTLED, PENDING]))
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261101-1201')
    expect(screen.getByText(/disetujui 2 Nov 2026/)).toBeInTheDocument()
    // Exactly one row was approved; the pending one says nothing about approval.
    expect(screen.getAllByText(/disetujui/)).toHaveLength(1)
  })

  it('separates "there is nothing" from "we could not ask"', async () => {
    mocked.mockResolvedValue(page([]))
    const { unmount } = render(<AdminTransactionsView />)
    expect(await screen.findByText(/Tidak ada yang menunggu keputusan/)).toBeInTheDocument()
    unmount()

    mocked.mockRejectedValue(new Error('offline'))
    render(<AdminTransactionsView />)
    const message = await screen.findByText(/tidak dapat dimuat/i)
    expect(message).toBeInTheDocument()
    // The dangerous version: an empty queue read from a failed request.
    expect(screen.queryByText(/Tidak ada yang menunggu keputusan/)).not.toBeInTheDocument()
  })
})

describe('approving', () => {
  beforeEach(() => {
    mocked.mockReset()
  })

  it('confirms first, then posts and re-reads', async () => {
    const user = userEvent.setup()
    serve([PENDING], () =>
      ok({
        transactionId: 'tx-1',
        invoiceCode: PENDING.invoiceCode,
        plan: 'monthly',
        amount: 44000,
        status: 'settlement',
        subscriptionId: 'sub-1',
        subscriptionExpiresAt: '2026-12-02T00:00:00+00:00',
      }),
    )
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261102-7731')
    await user.click(screen.getByRole('button', { name: /Setujui AID-20261102-7731/ }))

    // The confirmation names what the click does, including that the length is
    // not this screen's to choose.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/mengikuti paket di baris ini/)).toBeInTheDocument()
    expect(within(dialog).getByText('Rp 44.000')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /Ya, setujui/ }))

    await waitFor(() =>
      expect(callsTo('/v1/admin/transactions/tx-1/approve', 'POST').length).toBeGreaterThan(0),
    )
    // The expiry on screen is the server's, not a client-side now + 30 days.
    expect(await screen.findByRole('status')).toHaveTextContent(/Masa aktif berlaku sampai/)
  })

  it('a 409 says the row is unchanged and carries the server reason', async () => {
    const user = userEvent.setup()
    serve([PENDING], () => err(409, 'The transaction is in a state approve cannot proceed from'))
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261102-7731')
    await user.click(screen.getByRole('button', { name: /Setujui AID-20261102-7731/ }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /Ya, setujui/ }),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/tidak lagi dalam keadaan yang bisa Anda putuskan/i)
    expect(alert).toHaveTextContent(/Transaksi tidak berubah\./)
    expect(alert).toHaveTextContent(/cannot proceed/)
  })

  it('a 503 says nothing was changed, because that is the endpoint promise', async () => {
    const user = userEvent.setup()
    serve([PENDING], () => err(503, 'Approve did not complete. The transaction is unchanged.'))
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261102-7731')
    await user.click(screen.getByRole('button', { name: /Setujui AID-20261102-7731/ }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /Ya, setujui/ }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/Transaksi tidak berubah\./)
  })
})

describe('denying', () => {
  beforeEach(() => {
    mocked.mockReset()
  })

  it('will not send a refusal without a reason', async () => {
    const user = userEvent.setup()
    mocked.mockResolvedValue(page([PENDING]))
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261102-7731')
    await user.click(screen.getByRole('button', { name: /Tolak AID-20261102-7731/ }))

    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', { name: /Tolak dengan alasan ini/ })
    expect(submit).toBeDisabled()
    expect(callsTo('/deny', 'POST')).toHaveLength(0)
  })

  it('sends the reason the operator typed', async () => {
    const user = userEvent.setup()
    serve([PENDING], () => ok({ ...PENDING, status: 'deny' }))
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261102-7731')
    await user.click(screen.getByRole('button', { name: /Tolak AID-20261102-7731/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Alasan$/), 'Nomor rekening tidak cocok.')
    await user.click(within(dialog).getByRole('button', { name: /Tolak dengan alasan ini/ }))

    await waitFor(() => expect(callsTo('/deny', 'POST').length).toBeGreaterThan(0))
    const body = JSON.parse(String(callsTo('/deny', 'POST')[0][1]?.body))
    expect(body).toEqual({ reason: 'Nomor rekening tidak cocok.' })
  })

  it('a 409 on a settled row says denial would revoke access, and changes nothing', async () => {
    const user = userEvent.setup()
    serve([PENDING], () => err(409, 'The transaction is settled, and denial would revoke access'))
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261102-7731')
    await user.click(screen.getByRole('button', { name: /Tolak AID-20261102-7731/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Alasan$/), 'salah')
    await user.click(within(dialog).getByRole('button', { name: /Tolak dengan alasan ini/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Transaksi tidak berubah\./)
    expect(alert).toHaveTextContent(/revoke access/)
  })

  it('Escape closes the dialog without adjudicating anything', async () => {
    const user = userEvent.setup()
    mocked.mockResolvedValue(page([PENDING]))
    render(<AdminTransactionsView />)

    await screen.findByText('AID-20261102-7731')
    await user.click(screen.getByRole('button', { name: /Tolak AID-20261102-7731/ }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(callsTo('/deny', 'POST')).toHaveLength(0)
  })
})

describe('what this screen is not allowed to claim', () => {
  beforeEach(() => {
    mocked.mockReset()
    mocked.mockResolvedValue(page([PENDING]))
  })

  it('offers no receipt viewer, because no receipt is stored', async () => {
    const { container } = render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')

    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('button', { name: /bukti|preview|zoom|perbesar/i })).toBeNull()
  })

  it('describes the mail as queued, never as already delivered', async () => {
    /* The rule this file was written to hold did not disappear when an email
       transport arrived; it moved. Approving now queues a message, and the queue
       must not say the payer was told — that is the worker's answer, in a table
       this screen does not read. And WhatsApp still is not a channel this install
       has, so naming one here would be inventing it. */
    render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')
    const text = document.body.textContent ?? ''

    expect(text).not.toMatch(/telah dikirim|sudah dikirim|notifikasi terkirim|emailed/i)
    expect(text).not.toMatch(/whatsapp/i)
    // It is allowed to say the honest conditional thing, and point at where the
    // answer actually lives.
    expect(text).toMatch(/mengantrekan/)
    expect(text).toMatch(/Integrasi/)
  })
})

describe('exporting the queue', () => {
  beforeEach(() => {
    mocked.mockReset()
    mocked.mockResolvedValue(page([PENDING]))
    // jsdom implements neither half of an object URL. The download itself is
    // the browser's job; what is under test here is what the app asked the
    // server for, and what it says when the answer is no.
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:aidss'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for the whole selected set, not the page on screen', async () => {
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download)
    })
    mocked.mockImplementation(async (url) =>
      String(url).includes('/export')
        ? ({
            ok: true,
            status: 200,
            blob: async () => new Blob(['invoice_code']),
          } as unknown as Response)
        : page([PENDING]),
    )

    const user = userEvent.setup()
    render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')

    await user.click(screen.getByRole('button', { name: 'Ekspor CSV baris berstatus Menunggu' }))

    await waitFor(() => expect(downloads).toEqual(['aidss-antrean-pending.csv']))
    const asked = mocked.mock.calls.find((c) => String(c[0]).includes('/export'))
    expect(String(asked?.[0])).toContain('status=pending')
    expect(String(asked?.[0])).toContain('limit=5000')
  })

  it('names the set it will export, so the file cannot be mistaken for the whole ledger', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')

    expect(
      screen.getByRole('button', { name: 'Ekspor CSV baris berstatus Menunggu' }),
    ).toBeInTheDocument()
  })

  it('says the file was not made when the server refuses, and stays on the page', async () => {
    mocked.mockImplementation(async (url) =>
      String(url).includes('/export')
        ? ({ ok: false, status: 403, json: async () => ({}) } as unknown as Response)
        : page([PENDING]),
    )

    const user = userEvent.setup()
    render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')

    await user.click(screen.getByRole('button', { name: 'Ekspor CSV baris berstatus Menunggu' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Berkas tidak dibuat.')
    // The queue is still on screen: a refused export must not lose the work.
    expect(screen.getByText('AID-20261102-7731')).toBeInTheDocument()
  })

  it('does not pretend a file arrived when the transport failed', async () => {
    mocked.mockImplementation(async (url) => {
      if (String(url).includes('/export')) throw new Error('offline')
      return page([PENDING])
    })

    const user = userEvent.setup()
    render(<AdminTransactionsView />)
    await screen.findByText('AID-20261102-7731')

    await user.click(screen.getByRole('button', { name: 'Ekspor CSV baris berstatus Menunggu' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Server tidak terjangkau.')
  })
})
