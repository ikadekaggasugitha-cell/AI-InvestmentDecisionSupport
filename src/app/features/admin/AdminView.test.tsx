import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminView } from '@/app/features/admin/AdminView'
import { AppProvider } from '@/app/context/AppContext'

/**
 * `/admin` — the shell: the gate, the tab strip, and what the strip opens onto.
 *
 * The table itself is tested in `AdminAccountsView.test.tsx`, and the queue in
 * `AdminTransactionsView.test.tsx`. What belongs here is the wiring only this
 * component owns: the account read is also the probe that decides whether the
 * person in front of the page is an operator, so a 403 must replace the whole
 * console rather than leave a table that looks empty; the `OPERATOR ACCESS` tag
 * may only be worn after an endpoint has actually answered 200; and every section
 * must be reachable from this one URL, which is the recorded decision about how
 * the console is laid out.
 */

type Reply = { status: number; body: unknown }

const calls: { url: string; method: string }[] = []
const state = {
  list: null as Reply | null,
  pricing: null as Reply | null,
  overview: null as Reply | null,
  queue: null as Reply | null,
}

const OVERVIEW = {
  revenueToday: 69000,
  revenueLast30Days: 358000,
  revenueTotal: 1240000,
  mrrRunRate: 358000,
  settledLast30Days: 9,
  pendingQueue: 2,
  expiredQueue: 1,
  activeSubscribers: 7,
  churnedSubscribers: 3,
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
]

const QUEUE = {
  transactions: [
    {
      id: 't1',
      invoiceCode: 'INV-2026-10-01',
      amount: 44000,
      plan: 'monthly',
      paymentGateway: 'manual',
      paymentMethod: 'transfer',
      status: 'pending',
      notes: 'transfer BCA',
      payerEmail: 'siti@aidss.id',
      createdAt: '2026-10-01T09:00:00+00:00',
      updatedAt: null,
      expiresAt: '2026-10-02T09:00:00+00:00',
      subscriptionId: null,
    },
  ],
  hasMore: false,
}

// Only the transport is faked; the real error classification stays real.
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  ENDPOINTS: {
    adminAccounts: '/v1/admin/accounts',
    adminPricing: '/v1/admin/settings/pricing',
    adminTransactions: '/v1/admin/transactions',
    adminOverview: '/v1/admin/analytics/overview',
    subscription: '/v1/subscription/current',
  },
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })

    if (method !== 'GET') {
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    }

    let reply: Reply
    if (url.startsWith('/v1/admin/transactions')) {
      reply = state.queue ?? { status: 200, body: QUEUE }
    } else if (url.endsWith('/v1/admin/settings/pricing')) {
      reply = state.pricing ?? {
        status: 200,
        body: {
          weekly: 15000,
          monthly: 44000,
          annual: 252000,
          updatedAt: '2026-10-01T09:30:00+00:00',
        },
      }
    } else if (url.endsWith('/v1/admin/analytics/overview')) {
      reply = state.overview ?? { status: 200, body: OVERVIEW }
    } else {
      reply = state.list ?? { status: 200, body: { accounts: ACCOUNTS, hasMore: false } }
    }
    return {
      ok: reply.status < 400,
      status: reply.status,
      json: async () => reply.body,
    } as unknown as Response
  }),
}))

/**
 * Renders the console and, by default, lands on the overview.
 *
 * `null` leaves the tabs alone, which is what the gate screen needs: a 403
 * replaces the whole console, tablist included, so there is nothing to click.
 */
async function renderAdmin(tab: string | null = 'Ringkasan') {
  const utils = render(
    <AppProvider>
      <AdminView />
    </AppProvider>,
  )
  if (tab !== null) {
    await waitFor(() => expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: tab }))
  }
  return utils
}

beforeEach(() => {
  calls.length = 0
  state.list = null
  state.pricing = null
  state.overview = null
  state.queue = null
})

describe('the gate', () => {
  it('a 403 says who may see the list, and closes the console', async () => {
    state.list = { status: 403, body: { detail: 'Administrator access required.' } }
    // No tab to switch to: the refusal replaces the whole console, tablist
    // included, which is the point of the gate screen.
    await renderAdmin(null)
    expect(await screen.findByText(/Hanya administrator/i)).toBeInTheDocument()
    expect(screen.queryByText('Tidak ada akun')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('does not wear the operator tag on a refusal', async () => {
    // The tag is a claim about the server's verdict, so a 403 must leave it off.
    state.list = { status: 403, body: {} }
    await renderAdmin(null)
    expect(screen.queryByText('OPERATOR ACCESS')).not.toBeInTheDocument()
  })

  it('wears the operator tag only after the read has answered 200', async () => {
    await renderAdmin()
    expect(await screen.findByText('OPERATOR ACCESS')).toBeInTheDocument()
  })

  it('names the console for the person standing outside it', async () => {
    // The gate describes what is behind the door, in the words the operator would
    // use, so a visitor can tell whether to ask for access at all.
    state.list = { status: 403, body: {} }
    await renderAdmin(null)
    await screen.findByText(/Hanya administrator/i)
    expect(screen.getByText('Verifikasi pembayaran transfer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Kembali ke aplikasi/i })).toBeInTheDocument()
  })
})

describe('the tab strip', () => {
  it('reaches the account table without a second URL', async () => {
    // The extraction moved the table out of this file. That it still opens here is
    // the assertion worth keeping: the shell passes its own read down, and the
    // columns the shell promised are the columns that appear.
    const user = userEvent.setup()
    await renderAdmin()

    await user.click(screen.getByRole('tab', { name: /Akun/i }))
    expect(await screen.findByText('Siti Rahayu')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'admin-panel-accounts')
  })

  it('reaches the price without a second URL', async () => {
    // /admin is already an operational tool at its own URL. A second route would
    // add routing and a nav element to solve a problem this page does not have.
    const user = userEvent.setup()
    await renderAdmin('Akun')
    await screen.findByText('Siti Rahayu')
    expect(screen.getByRole('tab', { name: /Akun/i })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: /Harga/i }))

    // The price form is what proves the switch happened; a selected tab would
    // also pass with an empty panel.
    await waitFor(() => expect(screen.getByLabelText(/Bulanan/i)).toHaveValue(44000))
    expect(screen.queryByText('Siti Rahayu')).not.toBeInTheDocument()
  })

  it('reaches the payment queue without a second URL', async () => {
    // The queue is the console's daily work, so it sits next to the accounts and
    // still shares this one URL.
    const user = userEvent.setup()
    await renderAdmin('Akun')
    await screen.findByText('Siti Rahayu')

    await user.click(screen.getByRole('tab', { name: /Antrean/i }))
    await waitFor(() => expect(screen.getByText('Antrean Pembayaran')).toBeInTheDocument())
    expect(screen.queryByText('Siti Rahayu')).not.toBeInTheDocument()
    expect(await screen.findByText('INV-2026-10-01')).toBeInTheDocument()
  })

  it('labels the bank-account tab for what it opens, not for payments', async () => {
    // A tab called "Pembayaran" that opens destination settings next to a real
    // payment queue points at the wrong thing.
    await renderAdmin()
    expect(screen.getByRole('tab', { name: /Antrean/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Rekening' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Pembayaran' })).not.toBeInTheDocument()
  })

  it('pairs every tab with the panel it controls', async () => {
    // aria-controls is how a keyboard user knows where the focus goes. A pairing
    // that lies is worse than no tabs at all.
    await renderAdmin()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(7)
    for (const tab of tabs) {
      const panelId = tab.getAttribute('aria-controls')
      expect(panelId, tab.textContent ?? '').toBeTruthy()
      const [, id] = (panelId ?? '').split('admin-panel-')
      expect(tab.id).toBe(`admin-tab-${id}`)
    }
    // Exactly one tab reports itself selected, whichever tab that is.
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
  })
})

describe('the overview', () => {
  it('opens the console, and every figure comes from the server', async () => {
    // The landing tab is the overview, and the numbers are the endpoint's.
    await renderAdmin('Ringkasan')

    expect(await screen.findByText('Rp 69.000')).toBeInTheDocument()
    expect(screen.getByText('Rp 1.240.000')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('prints the run-rate formula, because a bare MRR reads as money received', async () => {
    await renderAdmin('Ringkasan')
    await screen.findByText('Rp 69.000')

    expect(screen.getByText(/dinormalkan dari 9 pembayaran terselesaikan/)).toBeInTheDocument()
  })

  it('counts the expired backlog apart from the waiting one', async () => {
    // An expired row is still money someone sent. Folding the two together would
    // tell the operator the backlog had been resolved.
    await renderAdmin('Ringkasan')
    await screen.findByText('Rp 69.000')

    expect(screen.getByText('2 menunggu keputusan')).toBeInTheDocument()
    expect(screen.getByText(/1 sudah lewat tenggat/)).toBeInTheDocument()
  })

  it('the queue figure is a way in, not a number to admire', async () => {
    const user = userEvent.setup()
    await renderAdmin('Ringkasan')
    await screen.findByText('Rp 69.000')

    await user.click(screen.getByRole('button', { name: 'Buka antrean' }))
    expect(await screen.findByText('Antrean Pembayaran')).toBeInTheDocument()
  })

  it('a failed read says so instead of drawing a flat line of zeros', async () => {
    // This is the failure the whole screen exists to avoid: zeros are a fact
    // about the business, and "we could not ask" is a fact about the install.
    state.overview = { status: 503, body: { detail: 'unreadable' } }
    await renderAdmin('Ringkasan')

    expect(await screen.findByRole('alert')).toHaveTextContent(/bukan berarti usahanya sepi/i)
    expect(screen.queryByText('Rp 0')).not.toBeInTheDocument()
  })
})
