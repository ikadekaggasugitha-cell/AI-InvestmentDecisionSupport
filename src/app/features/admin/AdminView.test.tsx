import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminView } from '@/app/features/admin/AdminView'
import { AppProvider } from '@/app/context/AppContext'
import type { AuthState } from '@/app/features/identity/useAuth'

/**
 * `/admin` — the shell: the gate, the tab strip, and what the strip opens onto.
 *
 * The table itself is tested in `AdminAccountsView.test.tsx`, and the queue in
 * `AdminTransactionsView.test.tsx`. What belongs here is the wiring only this
 * component owns: the account read is also the probe that decides whether the
 * person in front of the page is an operator, so a 403 must replace the whole
 * console rather than leave a table that looks empty; the `Akses operator` tag
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
    authMe: '/v1/auth/me',
  },
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })

    if (method !== 'GET') {
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    }

    // The signed-in operator behind the header chip's popup.
    if (url === '/v1/auth/me') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'op-1',
          email: 'operator@local.invalid',
          full_name: 'Cek Admin Panel',
          phone_number: '0812000000000',
          role: 'admin',
          blocked: false,
          blockedReason: null,
        }),
      } as unknown as Response
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
// The one auth instance App would own. The profile popup acts on this object,
// so the stub is what keeps the shell test about wiring rather than about
// network calls the popup no longer owns.
const AUTH: AuthState = {
  status: 'signed-in',
  account: {
    id: 'op-1',
    email: 'operator@local.invalid',
    full_name: 'Cek Admin Panel',
    phone_number: '0812000000000',
    role: 'admin',
    blocked: false,
    blockedReason: null,
  },
  error: null,
  refresh: async () => {},
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  updateProfile: async () => {},
  changeEmail: async () => {},
  changePassword: async () => {},
}

async function renderAdmin(tab: string | null = 'Ringkasan') {
  const utils = render(
    <AppProvider>
      <AdminView auth={AUTH} />
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
  // The new-arrivals dot reads its baseline from storage; each test starts
  // without one unless it deliberately seeds it.
  localStorage.removeItem('aidss-admin-queue-seen')
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
    expect(screen.queryByText('Akses operator')).not.toBeInTheDocument()
  })

  it('wears the operator tag only after the read has answered 200', async () => {
    await renderAdmin()
    expect(await screen.findByText('Akses operator')).toBeInTheDocument()
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
    // The switch is proven by the panel's own content, not by a heading: the
    // module name now appears once per screen (owner direction), so the queue
    // opens on its table instead of on a repeated title.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Antrean/i })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
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

  it('traverses the strip with arrows, not only with Tab', async () => {
    // Seven tabs at tabIndex={-1} except the selected one is the ARIA roving
    // pattern, and it is only honest if the arrows move between them. Without a
    // keydown handler the strip is a set of seven stops the keyboard can reach but
    // not travel — there is no way from the first section to the last without
    // pressing Tab seven times.
    const user = userEvent.setup()
    await renderAdmin()

    const selected = () =>
      screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')
        ?.textContent
    const focused = () => document.activeElement?.textContent

    screen.getByRole('tab', { name: /Ringkasan/i }).focus()

    await user.keyboard('{ArrowRight}')
    // Selection follows focus rather than waiting for Enter: the panels here each
    // issue their own read, and an operator who arrow-walks a strip is looking at
    // each one as they pass, not previewing a target they intend to press.
    await waitFor(() => expect(selected()).toBe('Akun'))
    expect(focused()).toBe('Akun')

    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(selected()).toBe('Antrean'))

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(selected()).toBe('Akun'))

    // Home and End, and both ends wrap rather than dead-ending.
    await user.keyboard('{End}')
    await waitFor(() => expect(selected()).toBe('Integrasi'))
    expect(focused()).toBe('Integrasi')

    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(selected()).toBe('Ringkasan'))

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(selected()).toBe('Integrasi'))

    await user.keyboard('{Home}')
    await waitFor(() => expect(selected()).toBe('Ringkasan'))

    // The roving tabindex survives the walk: one stop in the Tab order, and it is
    // the selected tab. Seven stops would mean the strip is not a tablist at all.
    expect(
      screen.getAllByRole('tab').filter((t) => t.getAttribute('tabindex') === '0'),
    ).toHaveLength(1)
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true')
  })
})

/**
 * The accent dose cap, checked against the shell's real composition.
 *
 * "One primary action per screen" cannot be tested one file at a time, because the
 * screens are not the files: the Rekening panel renders two settings views and the
 * Integrasi panel renders two more, so a rule counted per module would pass while
 * the screen showed two teal buttons that both say "Simpan". That is what this
 * caught. Reading the pairing out of `AdminView.tsx` rather than writing it here
 * means adding a section to a tab puts that section under the rule immediately.
 */
describe('the accent dose cap', () => {
  it('gives every screen at most one primary action', () => {
    const shell = readFileSync(resolve(__dirname, 'AdminView.tsx'), 'utf8')
    const perPanel = new Map<string, string[]>()
    let panel: string | null = null
    for (const m of shell.matchAll(/id="admin-panel-([a-z]+)"|<(Admin[A-Za-z]+View)\b/g)) {
      if (m[1]) {
        panel = m[1]
        perPanel.set(panel, [])
      } else if (panel) {
        perPanel.get(panel)!.push(m[2])
      }
    }

    const offenders: string[] = []
    for (const [name, views] of perPanel) {
      const primaries = views.filter((view) =>
        readFileSync(resolve(__dirname, `${view}.tsx`), 'utf8').includes(`buttonStyle('primary')`),
      )
      // The Rekening tab hosts two independent settings forms (destinations and
      // channels), each with its own primary save by owner decision; every other
      // screen keeps at most one primary action.
      const cap = name === 'payments' ? 2 : 1
      if (primaries.length > cap) offenders.push(`${name}: ${primaries.join(', ')}`)
    }
    expect(offenders).toEqual([])
    // The guard is only worth having if the walk found the panels. An empty map
    // would pass the assertion above by inspecting nothing.
    expect([...perPanel.keys()].sort()).toEqual([
      'accounts',
      'contact',
      'dashboard',
      'integrations',
      'payments',
      'pricing',
      'transactions',
    ])
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

    // The waiting count leads the screen in its own words; the expired one is a
    // separate sentence under it, never a sum of the two.
    expect(screen.getByText('2 transfer di antrean')).toBeInTheDocument()
    expect(screen.getByText(/1 sudah lewat tenggat, uangnya tetap ada/)).toBeInTheDocument()
    expect(screen.queryByText(/3 transfer di antrean/)).not.toBeInTheDocument()
  })

  it('the queue figure is a way in, not a number to admire', async () => {
    const user = userEvent.setup()
    await renderAdmin('Ringkasan')
    await screen.findByText('Rp 69.000')

    await user.click(screen.getByRole('button', { name: 'Buka antrean' }))
    // The way in lands on the queue's real rows, not on a title that repeats
    // the tab label.
    expect(await screen.findByText('INV-2026-10-01')).toBeInTheDocument()
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

/**
 * The header chip. It used to be a link to the market dashboard and nothing
 * else; it is now the door into the operator's own account, and the market
 * page is one choice inside the popup rather than the whole behaviour.
 */
describe('the profile chip', () => {
  it('opens the profile popup over the console', async () => {
    await renderAdmin()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Buka menu profil' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // The identity is read from /v1/auth/me, and the two doors are in there.
    expect(await screen.findByText('operator@local.invalid')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pengaturan profil/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Halaman Pasar/i })).toHaveAttribute('href', '/')
  })

  it('is a button with a dialog behind it, not a link that navigates on click', async () => {
    await renderAdmin()
    const chip = screen.getByRole('button', { name: 'Buka menu profil' })
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog')
  })
})

/**
 * The new-arrivals dot. The badge number has always answered "how many are
 * waiting"; the dot answers the different question the operator actually acts
 * on: "has anything arrived since I last looked". These tests hold that line,
 * including the failure where a full queue with nothing new lights the dot
 * anyway, which would train the operator to ignore it.
 */
describe('the new-arrivals dot', () => {
  it('lights the Antrean tab when more transfers are pending than the operator has seen', async () => {
    localStorage.setItem('aidss-admin-queue-seen', '0')
    await renderAdmin()
    await screen.findByText('Rp 69.000')
    expect(document.querySelector('[data-queue-new]')).toBeInTheDocument()
  })

  it('stays dark when the backlog is exactly what the operator already saw', async () => {
    // Same pendingQueue of 2, baseline of 2: a full queue is not a new queue.
    localStorage.setItem('aidss-admin-queue-seen', '2')
    await renderAdmin()
    await screen.findByText('Rp 69.000')
    expect(document.querySelector('[data-queue-new]')).not.toBeInTheDocument()
  })

  it('a first visit counts the current backlog as seen and stores the baseline', async () => {
    await renderAdmin()
    await screen.findByText('Rp 69.000')
    expect(document.querySelector('[data-queue-new]')).not.toBeInTheDocument()
    expect(localStorage.getItem('aidss-admin-queue-seen')).toBe('2')
  })

  it('goes out when the queue opens, and the baseline moves with it', async () => {
    localStorage.setItem('aidss-admin-queue-seen', '0')
    await renderAdmin()
    await screen.findByText('Rp 69.000')
    expect(document.querySelector('[data-queue-new]')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /Antrean/i }))
    await screen.findByText('INV-2026-10-01')
    expect(document.querySelector('[data-queue-new]')).not.toBeInTheDocument()
    expect(localStorage.getItem('aidss-admin-queue-seen')).toBe('2')
  })

  it('says how many are new in the bell name', async () => {
    localStorage.setItem('aidss-admin-queue-seen', '0')
    await renderAdmin()
    await screen.findByText('Rp 69.000')
    expect(
      screen.getByRole('button', { name: 'Buka antrean pembayaran, 2 transfer baru' }),
    ).toBeInTheDocument()
  })

  it('keeps the bell name plain when nothing is new', async () => {
    localStorage.setItem('aidss-admin-queue-seen', '2')
    await renderAdmin()
    await screen.findByText('Rp 69.000')
    expect(screen.getByRole('button', { name: 'Buka antrean pembayaran' })).toBeInTheDocument()
  })
})
