import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminView } from './AdminView'
import { AppProvider } from '../context/AppContext'

/**
 * `/admin` — the account list, and block/unblock.
 *
 * The assertions that matter here are the negative ones. This page has every
 * account's email and phone number on it, so "what does it show when it cannot get
 * the data" is the question worth testing: an empty table would tell an
 * administrator whose accounts all exist that there are none.
 */

type Reply = { status: number; body: unknown }

const calls: { url: string; method: string }[] = []
const state = {
  list: null as Reply | null,
  block: null as Reply | null,
  failList: false,
}

const ACCOUNTS = [
  { id: 'a1', email: 'siti@aidss.id', full_name: 'Siti Rahayu', phone_number: '0812', role: 'user', blocked: false, blocked_at: null },
  { id: 'a2', email: 'budi@aidss.id', full_name: 'Budi Santoso', phone_number: '0813', role: 'admin', blocked: true, blocked_at: '2026-10-01T00:00:00+00:00' },
]

vi.mock('../config/api', () => ({
  ENDPOINTS: { adminAccounts: '/v1/admin/accounts' },
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })

    if (method !== 'GET') {
      const reply = state.block ?? { status: 200, body: {} }
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as unknown as Response
    }

    if (state.failList) throw new Error('offline')

    const reply = state.list ?? { status: 200, body: { accounts: ACCOUNTS, hasMore: false } }
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as unknown as Response
  }),
}))

function renderAdmin() {
  return render(
    <AppProvider>
      <AdminView />
    </AppProvider>,
  )
}

beforeEach(() => {
  calls.length = 0
  state.list = null
  state.block = null
  state.failList = false
})

describe('the account list', () => {
  it('shows what the server returned', async () => {
    renderAdmin()
    expect(await screen.findByText('Siti Rahayu')).toBeInTheDocument()
    expect(screen.getByText('siti@aidss.id')).toBeInTheDocument()
    expect(screen.getByText('Budi Santoso')).toBeInTheDocument()
  })

  it('shows the role and the blocked state as they are', async () => {
    renderAdmin()
    await screen.findByText('Siti Rahayu')
    expect(screen.getByText('user')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('Diblokir')).toBeInTheDocument()
    expect(screen.getByText('Aktif')).toBeInTheDocument()
  })

  it('invents no column the server does not send', async () => {
    // No last-seen, no plan, no spend: none of those is recorded anywhere, and a
    // column here would be a column of invented data beside real emails.
    renderAdmin()
    await screen.findByText('Siti Rahayu')
    const headings = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headings).toEqual(['Nama', 'Email', 'Role', 'Status', 'Aksi'])
  })

  it('requests a page rather than everything', async () => {
    renderAdmin()
    await screen.findByText('Siti Rahayu')
    expect(calls[0].url).toContain('limit=')
    expect(calls[0].url).toContain('offset=0')
  })
})

describe('when the list cannot be read', () => {
  it('says the load failed, and does not say there are no accounts', async () => {
    state.failList = true
    renderAdmin()
    const message = await screen.findByText(/tidak dapat dimuat/i)
    expect(message).toBeInTheDocument()
    // The dangerous version of this is an empty table, which reads as "no accounts".
    expect(screen.queryByText('Tidak ada akun')).not.toBeInTheDocument()
  })

  it('a 403 says who may see the list', async () => {
    state.list = { status: 403, body: { detail: 'Administrator access required.' } }
    renderAdmin()
    expect(await screen.findByText(/Hanya administrator/i)).toBeInTheDocument()
    expect(screen.queryByText('Tidak ada akun')).not.toBeInTheDocument()
  })

  it('a genuinely empty list is still reported as empty', async () => {
    state.list = { status: 200, body: { accounts: [], hasMore: false } }
    const { container } = renderAdmin()
    await waitFor(() => {
      expect(container.textContent).toContain('Tidak ada akun')
    })
  })
})

describe('blocking and unblocking', () => {
  it('posts to block and reloads rather than patching the row', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await screen.findByText('Siti Rahayu')

    await user.click(screen.getByRole('button', { name: 'Blokir siti@aidss.id' }))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/a1/block'))).toBe(true)
    })
    // Reloaded, because the server owns what blocked_at is.
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(1))
  })

  it('deletes to unblock', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await screen.findByText('Budi Santoso')

    await user.click(screen.getByRole('button', { name: 'Buka blokir budi@aidss.id' }))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/a2/block'))).toBe(true)
    })
  })

  it('names the account in the button label', async () => {
    // Two accounts, one action: a button labelled only "Blokir" leaves the
    // operator guessing which row they are about to close.
    renderAdmin()
    await screen.findByText('Siti Rahayu')
    expect(screen.getByRole('button', { name: 'Blokir siti@aidss.id' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buka blokir budi@aidss.id' })).toBeInTheDocument()
  })

  it('a failed action says the state is unchanged', async () => {
    state.block = { status: 503, body: {} }
    const user = userEvent.setup()
    renderAdmin()
    await screen.findByText('Siti Rahayu')

    await user.click(screen.getByRole('button', { name: 'Blokir siti@aidss.id' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/tidak berubah/i)
  })

  it('the table still renders the real state after a failure', async () => {
    // "State is unchanged" is a claim. If the row flipped anyway, the claim would
    // be false and worse than saying nothing.
    state.block = { status: 503, body: {} }
    const user = userEvent.setup()
    renderAdmin()
    await screen.findByText('Siti Rahayu')

    await user.click(screen.getByRole('button', { name: 'Blokir siti@aidss.id' }))
    await screen.findByRole('alert')

    expect(screen.getByText('Aktif')).toBeInTheDocument()
  })
})

describe('pagination', () => {
  it('stops at the end when hasMore is false', async () => {
    renderAdmin()
    await screen.findByText('Siti Rahayu')
    expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled()
  })

  it('offers the next page when hasMore is true', async () => {
    state.list = { status: 200, body: { accounts: [ACCOUNTS[0]], hasMore: true } }
    const user = userEvent.setup()
    renderAdmin()
    await screen.findByText('Siti Rahayu')

    expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Berikutnya' }))
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('offset=25'))).toBe(true)
    })
  })

  it('has no previous page on the first one', async () => {
    state.list = { status: 200, body: { accounts: [ACCOUNTS[0]], hasMore: true } }
    renderAdmin()
    await screen.findByText('Siti Rahayu')
    expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled()
  })
})

describe('what the page says about blocking', () => {
  it('states that sessions are not deleted', async () => {
    // ADR-0004. Worth saying on the page itself, because an administrator closing
    // an account will reasonably assume every device was signed out.
    renderAdmin()
    await screen.findByText('Siti Rahayu')
    expect(screen.getByText(/tidak dihapus/i)).toBeInTheDocument()
  })
})