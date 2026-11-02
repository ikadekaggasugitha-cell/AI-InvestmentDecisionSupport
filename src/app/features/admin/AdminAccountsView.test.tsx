import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminAccountsView, useAdminAccounts } from '@/app/features/admin/AdminAccountsView'
import { AppProvider } from '@/app/context/AppContext'

/**
 * The account table: its columns, block/unblock, and granting a period.
 *
 * Moved here when the table left `AdminView.tsx`. The assertions that matter are
 * the negative ones. This screen holds every account's email and phone number, so
 * "what does it show when it cannot get the data" is the question worth testing:
 * an empty table would tell an administrator whose accounts all exist that there
 * are none. The same rule runs through the columns. A heading is only allowed
 * where the server sends a field, a date is only printed where the server sent
 * one, and the two kinds of blocked row must read differently, because the two
 * have different openers (ADR-0012).
 *
 * The console's own gate is not tested here. A 403 turns the whole page into the
 * doorway screen, which is the shell's business (`AdminView.test.tsx`).
 */

vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  ENDPOINTS: {
    adminAccounts: '/v1/admin/accounts',
  },
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

const mocked = vi.mocked(apiFetch)

type Reply = { status: number; body: unknown }

// Which reply the fake endpoint gives, and in what order. `afterWrite` is what a
// re-read returns, so a test can prove the screen shows the server's new answer
// instead of one it predicted itself.
const state = {
  list: null as Reply | null,
  afterWrite: null as Reply | null,
  block: null as Reply | null,
  grant: null as Reply | null,
  failList: false,
  wrote: false,
}

const ACCOUNTS = [
  {
    id: 'a1',
    email: 'siti@aidss.id',
    full_name: 'Siti Rahayu',
    phone_number: '0812',
    role: 'user',
    blocked: false,
    blocked_at: null,
    blocked_reason: null,
    subscriptionExpiresAt: '2026-11-30T00:00:00+00:00',
  },
  {
    id: 'a2',
    email: 'budi@aidss.id',
    full_name: 'Budi Santoso',
    phone_number: '0813',
    role: 'admin',
    blocked: true,
    blocked_at: '2026-10-01T00:00:00+00:00',
    blocked_reason: 'admin',
    subscriptionExpiresAt: null,
  },
  {
    id: 'a3',
    email: 'lapsed@aidss.id',
    full_name: 'Rina Wibowo',
    phone_number: '0814',
    role: 'user',
    blocked: true,
    blocked_at: '2026-10-05T00:00:00+00:00',
    blocked_reason: 'subscription_expired',
    subscriptionExpiresAt: '2026-10-04T00:00:00+00:00',
  },
]

// The same account with a period the *server* moved, dated nowhere near now +
// the 7 days typed into the dialog.
const EXTENDED = [
  { ...ACCOUNTS[0], subscriptionExpiresAt: '2027-03-01T00:00:00+00:00' },
  ACCOUNTS[1],
  ACCOUNTS[2],
]

function replyFor(url: string, method: string): Reply {
  if (method === 'GET') {
    if (state.failList) throw new Error('offline')
    if (state.wrote && state.afterWrite) return state.afterWrite
    return state.list ?? { status: 200, body: { accounts: ACCOUNTS, hasMore: false } }
  }
  if (url.endsWith('/subscription')) return state.grant ?? { status: 200, body: {} }
  return state.block ?? { status: 200, body: {} }
}

mocked.mockImplementation(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET'
  if (method !== 'GET') state.wrote = true
  const reply = replyFor(url, method)
  return {
    ok: reply.status < 400,
    status: reply.status,
    json: async () => reply.body,
  } as unknown as Response
})

function calls(method?: string) {
  return mocked.mock.calls.filter((c) => {
    const called = (c[1] as RequestInit | undefined)?.method ?? 'GET'
    return method === undefined || method === called
  })
}

/** Reads that carried a search term, however they were worded. */
function searchCalls() {
  return mocked.mock.calls.filter((c) => String(c[0]).includes('q='))
}

/** The body of the one grant request this test made. */
function grantBody() {
  const grant = mocked.mock.calls.find((c) => String(c[0]).endsWith('/subscription'))
  return JSON.parse(String((grant?.[1] as RequestInit).body)) as {
    days: number
    reason: string | null
  }
}

/**
 * The index a column heading names.
 *
 * Assertions reach their column through the heading, never through a number: a
 * reordering would otherwise move an assertion onto a different column and let it
 * pass while testing the wrong thing.
 */
function columnIndex(heading: string): number {
  const headings = screen.getAllByRole('columnheader').map((h) => h.textContent)
  const index = headings.indexOf(heading)
  expect(index, `no column headed ${heading}`).toBeGreaterThan(-1)
  return index
}

/**
 * The pair as the console mounts it: the hook holds the read, the view renders it.
 *
 * Not a stand-in for the shell. The shell passes the same object it gets from
 * `useAdminAccounts`, so testing them joined is testing what actually runs, and
 * the state the gate depends on stays the state the table reads.
 */
function Harness() {
  const accounts = useAdminAccounts()
  return <AdminAccountsView accounts={accounts} />
}

async function renderTable() {
  render(
    <AppProvider>
      <Harness />
    </AppProvider>,
  )
  return screen.findByText('Siti Rahayu')
}

beforeEach(() => {
  mocked.mockClear()
  state.list = null
  state.afterWrite = null
  state.block = null
  state.grant = null
  state.failList = false
  state.wrote = false
})

describe('the columns', () => {
  it('shows what the server returned', async () => {
    await renderTable()
    expect(screen.getByText('siti@aidss.id')).toBeInTheDocument()
    expect(screen.getByText('Budi Santoso')).toBeInTheDocument()
  })

  it('shows the role and the blocked state as they are', async () => {
    await renderTable()
    expect(screen.getAllByText('user')).toHaveLength(2)
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('Diblokir (admin)')).toBeInTheDocument()
    // Queried as a cell, not as text: "Aktif" is also the word on the state
    // filter above the table, and a test that cannot tell the two apart is not
    // asserting anything about the row.
    expect(screen.getByRole('cell', { name: 'Aktif' })).toBeInTheDocument()
  })

  it('invents no column the server does not send', async () => {
    // Every heading here maps to a field `GET /v1/admin/accounts` actually
    // returns. There is still no plan column, because `subscriptions` stores no
    // plan (ADR-0002) and an operator grant produces a period with none at all.
    await renderTable()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Nama',
      'Email',
      'No WA',
      'Role',
      'Status',
      'Berakhir',
      'Aksi',
    ])
  })

  it('names the reason a block was placed, because the two open differently', async () => {
    /* ADR-0012: paying reopens 'subscription_expired', and only this screen's
       unblock reopens 'admin'. An operator shown the same word for both cannot
       tell whether the button in front of them is the right action. */
    await renderTable()

    expect(screen.getByText('Diblokir (langganan habis)')).toBeInTheDocument()
    expect(screen.getByText(/pembayaran baru membukanya kembali/)).toBeInTheDocument()
    expect(screen.getByText('Diblokir (admin)')).toBeInTheDocument()
    expect(screen.getByText(/hanya buka blokir di layar ini/)).toBeInTheDocument()
  })

  it('prints a date only where the server sent one', async () => {
    await renderTable()

    // 30 Nov 2026 in id-ID, from subscriptionExpiresAt on the first fixture.
    expect(screen.getByText('30 Nov 2026')).toBeInTheDocument()
    // An account with no period at all is said as having none, not given a date.
    // The other two rows have periods, so exactly one row says this.
    expect(screen.getAllByText('tidak ada langganan')).toHaveLength(1)
  })

  it('invents no expiry for an install that has none', async () => {
    // Every account without a period. The Berakhir column may then hold nothing
    // but the sentence that says there is none — no default, no placeholder, and
    // no now-plus-something computed from the day count a button offers.
    state.list = {
      status: 200,
      body: {
        accounts: ACCOUNTS.map((a) => ({ ...a, subscriptionExpiresAt: null })),
        hasMore: false,
      },
    }
    await renderTable()

    const ends = columnIndex('Berakhir')
    const endsCells = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[ends])
    expect(endsCells).toHaveLength(3)
    for (const cell of endsCells) {
      expect(cell).toHaveTextContent('tidak ada langganan')
    }
  })

  it('prints the number the account gave, and nothing it did not give', async () => {
    /* The phone column is the one §5.1 asks for that the server has always sent
       and the screen always dropped. An account that registered without a number
       is shown as having none, not as having a blank that could be read as a
       number the console failed to render. */
    state.list = {
      status: 200,
      body: {
        accounts: [ACCOUNTS[0], { ...ACCOUNTS[1], phone_number: '' }, ACCOUNTS[2]],
        hasMore: false,
      },
    }
    await renderTable()

    const phone = columnIndex('No WA')
    const cells = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[phone])
    expect(cells.map((c) => c.textContent)).toEqual(['0812', '—', '0814'])
  })

  it('requests a page rather than everything', async () => {
    await renderTable()

    const listed = calls('GET')[0]
    expect(String(listed[0])).toContain('limit=25')
    expect(String(listed[0])).toContain('offset=0')
  })
})

describe('when the list cannot be read', () => {
  it('says the load failed, and does not say there are no accounts', async () => {
    state.failList = true
    render(
      <AppProvider>
        <Harness />
      </AppProvider>,
    )
    expect(await screen.findByText(/tidak dapat dimuat/i)).toBeInTheDocument()
    // The dangerous version of this is an empty table, which reads as "no accounts".
    expect(screen.queryByText('Tidak ada akun')).not.toBeInTheDocument()
  })

  it('a genuinely empty list is still reported as empty', async () => {
    state.list = { status: 200, body: { accounts: [], hasMore: false } }
    render(
      <AppProvider>
        <Harness />
      </AppProvider>,
    )
    expect(await screen.findByText('Tidak ada akun.')).toBeInTheDocument()
  })
})

describe('blocking and unblocking', () => {
  it('posts to block and reloads rather than patching the row', async () => {
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Blokir siti@aidss.id' }))

    await waitFor(() =>
      expect(
        mocked.mock.calls.some(
          (c) => String(c[0]).endsWith('/a1/block') && (c[1] as RequestInit)?.method === 'POST',
        ),
      ).toBe(true),
    )
    // Reloaded, because the server owns what `blocked_at` is: the last call is a
    // read, not the write.
    await waitFor(() => expect(calls().pop()?.[1]?.method ?? 'GET').toBe('GET'))
  })

  it('deletes to unblock', async () => {
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Buka blokir budi@aidss.id' }))

    await waitFor(() =>
      expect(
        mocked.mock.calls.some(
          (c) => String(c[0]).endsWith('/a2/block') && (c[1] as RequestInit)?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })

  it('names the account in the button label', async () => {
    // Two accounts, one action: a button labelled only "Blokir" leaves the
    // operator guessing which row they are about to close.
    await renderTable()
    expect(screen.getByRole('button', { name: 'Blokir siti@aidss.id' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buka blokir budi@aidss.id' })).toBeInTheDocument()
  })

  it('a failed action says the state is unchanged', async () => {
    state.block = { status: 503, body: {} }
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Blokir siti@aidss.id' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/tidak berubah/i)
  })

  it('the table still renders the real state after a failure', async () => {
    // "State is unchanged" is a claim. If the row flipped anyway, the claim would
    // be false and worse than saying nothing.
    state.block = { status: 503, body: {} }
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Blokir siti@aidss.id' }))
    await screen.findByRole('alert')

    expect(screen.getByRole('cell', { name: 'Aktif' })).toBeInTheDocument()
  })

  it('states that sessions are not deleted', async () => {
    // ADR-0004. Worth saying on the page itself, because an administrator closing
    // an account will reasonably assume every device was signed out.
    await renderTable()
    expect(screen.getByText(/tidak dihapus/i)).toBeInTheDocument()
  })
})

describe('pagination', () => {
  it('stops at the end when hasMore is false', async () => {
    await renderTable()
    expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled()
  })

  it('offers the next page when hasMore is true', async () => {
    state.list = { status: 200, body: { accounts: [ACCOUNTS[0]], hasMore: true } }
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Berikutnya' }))
    await waitFor(() =>
      expect(mocked.mock.calls.some((c) => String(c[0]).includes('offset=25'))).toBe(true),
    )
  })

  it('has no previous page on the first one', async () => {
    state.list = { status: 200, body: { accounts: [ACCOUNTS[0]], hasMore: true } }
    await renderTable()
    expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled()
  })

  it('shows the window it is showing', async () => {
    await renderTable()
    expect(screen.getByText('1–3')).toBeInTheDocument()
  })
})

describe('searching and filtering the list', () => {
  it('sends the term to the server and starts the answer at the first page', async () => {
    // The term is asked for, not applied to whatever page is on screen. A filter
    // that only cut the current page would report "nobody here" about twenty-five
    // rows and leave the account on the next page looking absent.
    const user = userEvent.setup()
    await renderTable()

    await user.type(screen.getByLabelText('Cari'), 'siti')

    await waitFor(() =>
      expect(mocked.mock.calls.some((c) => String(c[0]).includes('q=siti'))).toBe(true),
    )
    const asked = mocked.mock.calls.find((c) => String(c[0]).includes('q=siti'))
    expect(String(asked?.[0])).toContain('offset=0')
  })

  it('asks once per finished word, not once per keystroke', async () => {
    // Four characters produced one read. Eleven requests for one address would
    // put a queue in front of the operator's own typing, and the table would
    // keep flickering between half-terms.
    const user = userEvent.setup()
    await renderTable()
    expect(searchCalls()).toHaveLength(0)

    await user.type(screen.getByLabelText('Cari'), 'siti')

    await waitFor(() => expect(searchCalls()).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(searchCalls()).toHaveLength(1)
    expect(String(searchCalls()[0]?.[0])).toContain('q=siti')
  })

  it('sends the state filter as a parameter, and names it in the readout', async () => {
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Diblokir' }))

    await waitFor(() =>
      expect(mocked.mock.calls.some((c) => String(c[0]).includes('state=blocked'))).toBe(true),
    )
    expect(await screen.findByText(/1\u20133 \u00b7 Diblokir/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Diblokir' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says "nothing matches" when a filter is on, not "there is nobody"', async () => {
    // The two empties are different facts. Telling an operator who searched for
    // one address that the install has no accounts is the invention this screen
    // exists to avoid.
    state.list = { status: 200, body: { accounts: [], hasMore: false } }
    const user = userEvent.setup()
    render(
      <AppProvider>
        <Harness />
      </AppProvider>,
    )

    expect(await screen.findByText('Tidak ada akun.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Aktif' }))

    await waitFor(() =>
      expect(screen.getByText(/cocok dengan pencarian dan saringan/)).toBeInTheDocument(),
    )
    expect(screen.queryByText('Tidak ada akun.')).not.toBeInTheDocument()
  })

  it('a read that fails under a filter is still reported as a failure', async () => {
    // The filter must not swallow the third state: "could not ask" outranks
    // "nothing matches", or a broken database reads as an empty search.
    state.failList = true
    const user = userEvent.setup()
    render(
      <AppProvider>
        <Harness />
      </AppProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Diblokir' }))

    expect(await screen.findByText(/tidak dapat dimuat/i)).toBeInTheDocument()
    expect(screen.queryByText(/cocok dengan/)).not.toBeInTheDocument()
  })
})

describe('granting a period', () => {
  it("says the expiry is the server's before it will write one", async () => {
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Beri masa aktif siti@aidss.id' }))

    const dialog = await screen.findByRole('dialog')
    // Two facts an operator is entitled to before clicking: the end date is not
    // theirs to type, and doing it twice grants twice.
    expect(within(dialog).getByText(/Tanggal berakhir dihitung server/)).toBeInTheDocument()
    expect(within(dialog).getByText(/mengulang aksinya memberi lagi/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Jumlah hari')).toHaveValue(30)
  })

  it('posts to the grant endpoint for that account, then re-reads the list', async () => {
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Beri masa aktif siti@aidss.id' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Beri masa aktif' }))

    await waitFor(() =>
      expect(
        mocked.mock.calls.some(
          (c) =>
            String(c[0]).endsWith('/v1/admin/accounts/a1/subscription') &&
            (c[1] as RequestInit)?.method === 'POST',
        ),
      ).toBe(true),
    )
    // The dialog closes and the row's expiry comes back from the server rather
    // than being written from what this screen guessed: the last call is the
    // re-read of the list.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls().pop()?.[1]?.method ?? 'GET').toBe('GET')
    expect(String(calls().pop()?.[0])).toContain('/v1/admin/accounts')
  })

  it('shows the expiry the server wrote, not now plus the days typed', async () => {
    // The strong version of the previous test. Seven days were typed; the
    // re-read says 1 Mar 2027. Anything the screen computed from the day count
    // would be a different date, and the row would be a prediction wearing the
    // column's clothes.
    state.afterWrite = { status: 200, body: { accounts: EXTENDED, hasMore: false } }
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Beri masa aktif siti@aidss.id' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Jumlah hari'))
    await user.type(within(dialog).getByLabelText('Jumlah hari'), '7')
    await user.click(within(dialog).getByRole('button', { name: 'Beri masa aktif' }))

    expect(await screen.findByText('1 Mar 2027')).toBeInTheDocument()
    expect(screen.queryByText('30 Nov 2026')).not.toBeInTheDocument()
  })

  it('refuses to send a day count that is not a whole positive number', async () => {
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Beri masa aktif siti@aidss.id' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Jumlah hari'))
    await user.type(within(dialog).getByLabelText('Jumlah hari'), '0')

    expect(within(dialog).getByRole('button', { name: 'Beri masa aktif' })).toBeDisabled()
    expect(mocked.mock.calls.some((c) => String(c[0]).includes('/subscription'))).toBe(false)
  })

  it('sends no reason when the operator types none', async () => {
    // An optional field. What would not be optional is the screen inventing a
    // justification for a grant nobody wrote one down.
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Beri masa aktif siti@aidss.id' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Beri masa aktif' }))

    await waitFor(() =>
      expect(mocked.mock.calls.some((c) => String(c[0]).endsWith('/subscription'))).toBe(true),
    )
    const body = grantBody()
    expect(body.days).toBe(30)
    expect(body.reason).toBeNull()
  })

  it('sends the reason the operator wrote, with the day count', async () => {
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Beri masa aktif siti@aidss.id' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Catatan (opsional)'), 'uji coba pemilik')
    await user.click(within(dialog).getByRole('button', { name: 'Beri masa aktif' }))

    await waitFor(() =>
      expect(mocked.mock.calls.some((c) => String(c[0]).endsWith('/subscription'))).toBe(true),
    )
    expect(grantBody()).toEqual({ days: 30, reason: 'uji coba pemilik' })
  })

  it('says what the server refused instead of closing quietly', async () => {
    // A dialog that vanishes on a 422 leaves an operator believing the account
    // got its period. It stays open, the row keeps the old date, and the refusal
    // is named.
    state.grant = { status: 422, body: {} }
    const user = userEvent.setup()
    await renderTable()

    await user.click(screen.getByRole('button', { name: 'Beri masa aktif siti@aidss.id' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Beri masa aktif' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/menolak/)
    expect(screen.getByText('30 Nov 2026')).toBeInTheDocument()
  })
})
