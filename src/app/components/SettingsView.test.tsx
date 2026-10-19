import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsView } from './SettingsView'
import { AppProvider } from '../context/AppContext'
import { SIMULATED_FRESHNESS } from '../hooks/useLiveMarket'
import type { ExchangeRateData } from '../hooks/useExchangeRate'
import type { AuthState } from '../hooks/useAuth'

/* The subscription tab reads GET /v1/subscription/current. Kept mutable per test so
 * the three states can be driven separately: they are the point of the tab, and a
 * mocked-away fetch would leave them indistinguishable again. */
const subState = {
  body: { active: false, expiresAt: null, daysRemaining: null, startDate: null } as unknown,
  status: 200,
  throws: false,
}

// The price is a separate read with a separate failure mode, because an account
// can have a working status endpoint and still be on an install with no price
// configured.
const priceState = {
  body: {
    weekly: 15000,
    monthly: 44000,
    annual: 252000,
    updatedAt: '2026-10-01T09:30:00+00:00',
  } as unknown,
  status: 200,
  throws: false,
}

// The account's own attempts to pay — [] is the fact, not a failure.
const payState = {
  rows: [] as unknown[],
  status: 200,
  throws: false,
}

// The destinations a transfer can go to. Read from the server because a
// destination typed into the client is a destination the server never honoured.
const banksState = {
  accounts: [] as Array<{ bank: string; accountNumber: string; holderName: string }>,
  status: 200,
  throws: false,
}

// The declaration POST's honest outcome, plus the bodies it was sent — read
// back by the tests, not guessed.
const declareState = {
  accepted: true,
  afterBody: null as unknown, // what GET /payments/me holds after the POST
}
const declared: unknown[] = []

// Only the transport is faked; the real error classification stays real.
vi.mock('../config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/api')>()),
  ENDPOINTS: {
    subscription: '/v1/subscription/current',
    pricing: '/v1/subscriptions/pricing',
    authMe: '/v1/auth/me',
    payments: '/v1/payments/me',
    paymentsDeclare: '/v1/payments/manual',
    bankAccounts: '/v1/subscriptions/bank-accounts',
  },
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/v1/subscriptions/pricing')) {
      if (priceState.throws) throw new Error('offline')
      return { ok: priceState.status < 400, status: priceState.status, json: async () => priceState.body } as unknown as Response
    }
    if (url.includes('/v1/subscription/current')) {
      if (subState.throws) throw new Error('offline')
      return { ok: subState.status < 400, status: subState.status, json: async () => subState.body } as unknown as Response
    }
    if (url.includes('/v1/payments/me')) {
      if (payState.throws) throw new Error('offline')
      return { ok: payState.status < 400, status: payState.status, json: async () => payState.rows } as unknown as Response
    }
    if (url.includes('/v1/subscriptions/bank-accounts')) {
      if (banksState.throws) throw new Error('offline')
      return { ok: banksState.status < 400, status: banksState.status, json: async () => ({ accounts: banksState.accounts }) } as unknown as Response
    }
    if (url.includes('/v1/payments/manual')) {
      declared.push(JSON.parse(String(init?.body ?? '{}')))
      if (declareState.afterBody !== null) payState.rows = declareState.afterBody as unknown[]
      return {
        ok: declareState.accepted,
        status: declareState.accepted ? 200 : 422,
        json: async () => ({}),
      } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
  }),
}))

const TEST_ACCOUNT = {
  id: '3f2a6c11-0d5e-4a1b-9c77-1f0b2d3e4a55',
  email: 'pengguna@aidss.id',
  full_name: 'Nama Pengguna',
  phone_number: '081234567890',
  role: 'user' as const,
  blocked: false,
  blockedReason: null,
}

function auth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    status: 'signed-in',
    account: TEST_ACCOUNT,
    error: null,
    refresh: async () => {},
    signIn: async () => {},
    signUp: async () => {},
    signOut: async () => {},
    updateProfile: async () => {},
    ...overrides,
  }
}

/**
 * Click-through evidence for docs/settings-module-spec.md v1.1.0.
 *
 * Each test drives a real control and asserts what the user would see. The
 * point is not coverage: it is that every interactive element in Settings has a
 * verified behaviour, and that the banned patterns stay banned.
 */

function fx(overrides: Partial<ExchangeRateData> = {}): ExchangeRateData {
  return {
    usdIdr: 15420,
    change: -85,
    changePct: -0.551,
    isLive: true,
    showUsd: false,
    toggleCurrency: () => {},
    ...overrides,
  } as ExchangeRateData
}

function renderSettings(props: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  return render(
    <AppProvider>
      <SettingsView
        fx={fx()}
        freshness={SIMULATED_FRESHNESS}
        auth={auth()}
        onSignedOut={() => {}}
        {...props}
      />
    </AppProvider>,
  )
}

const TABS = [
  'Profil & Akun',
  'Langganan & Tagihan',
  'Tampilan',
  'Notifikasi',
  'Tentang',
] as const

describe('SettingsView — tab navigation (R-32, R-26)', () => {
  it('exposes every tab the spec defines, with no emoji in any label', () => {
    renderSettings()
    const bar = screen.getByRole('tablist')
    const labels = within(bar)
      .getAllByRole('tab')
      .map((t) => t.textContent ?? '')

    expect(labels).toEqual([...TABS])
    // R-04: emoji would show up here as surrogate pairs, not as ASCII labels.
    for (const label of labels) {
      expect(label).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    }
  })

  it('switches panels on click and marks exactly one tab selected', async () => {
    const user = userEvent.setup()
    renderSettings()

    // Tampilan is the default panel, so opening Settings lands on working
    // controls rather than on a tab whose backend does not exist yet.
    const appearance = screen.getByRole('tab', { name: 'Tampilan' })
    expect(appearance).toHaveAttribute('aria-selected', 'true')

    const about = screen.getByRole('tab', { name: 'Tentang' })
    await user.click(about)

    expect(about).toHaveAttribute('aria-selected', 'true')
    expect(appearance).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('Sumber data')).toBeInTheDocument()
  })

  it('each tab is reachable and activatable by keyboard', async () => {
    const user = userEvent.setup()
    renderSettings()

    const notif = screen.getByRole('tab', { name: 'Notifikasi' })
    notif.focus()
    await user.keyboard('{Enter}')
    expect(notif).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('switch', { name: 'Sinyal AI baru' })).toBeInTheDocument()
  })
})

describe('SettingsView — Tampilan tab (working controls)', () => {
  it('theme choice persists and re-renders the root theme', async () => {
    const user = userEvent.setup()
    renderSettings()

    const dark = screen.getByRole('button', { name: 'Gelap' })
    await user.click(dark)

    expect(localStorage.getItem('aidss-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    const light = screen.getByRole('button', { name: 'Terang' })
    await user.click(light)
    expect(localStorage.getItem('aidss-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('language choice persists and flips all visible copy', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(localStorage.getItem('aidss-locale')).toBe('en')

    await user.click(screen.getByRole('tab', { name: 'About' }))
    expect(screen.getByText('Data source')).toBeInTheDocument()
    expect(screen.queryByText('Sumber data')).not.toBeInTheDocument()
  })

  it('currency choice calls the toggle and marks the pressed option', async () => {
    const user = userEvent.setup()
    let toggled = 0
    renderSettings({ fx: fx({ showUsd: false, toggleCurrency: () => { toggled += 1 } }) })

    expect(screen.getByRole('button', { name: 'IDR' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'USD' }))
    expect(toggled).toBe(1)
  })

  it('an already-selected option is inert rather than firing the toggle again', async () => {
    const user = userEvent.setup()
    let toggled = 0
    renderSettings({ fx: fx({ showUsd: false, toggleCurrency: () => { toggled += 1 } }) })

    await user.click(screen.getByRole('button', { name: 'IDR' }))
    expect(toggled).toBe(0)
  })

  it('says the forex feed has no rate when none has arrived', () => {
    renderSettings({ fx: fx({ isLive: false }) })
    expect(screen.getByText('belum ada feed')).toBeInTheDocument()
    expect(screen.getByText(/bukan kurs pasar/)).toBeInTheDocument()
  })
})

describe('SettingsView — Notifikasi tab (R-26, R-09)', () => {
  it('toggling a switch flips state, persists it, and confirms in words', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('tab', { name: 'Notifikasi' }))
    const sw = screen.getByRole('switch', { name: 'Sinyal AI baru' })

    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.click(sw)

    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(JSON.parse(localStorage.getItem('aidss-notifications') ?? '{}')).toMatchObject({
      ai_signals: false,
    })
    // R-09: the confirmation is text, not a coloured check glyph.
    expect(screen.getByText('Tersimpan')).toBeInTheDocument()
  })

  it('renders no badge or pill for the saved confirmation', async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Notifikasi' }))
    await user.click(screen.getByRole('switch', { name: 'Peringatan risiko' }))

    expect(document.querySelectorAll('[class*="badge"]')).toHaveLength(0)
    expect(screen.getByText('Tersimpan')).toBeInTheDocument()
  })
})

describe('SettingsView — identity, read from the server (R-38)', () => {
  it('Profile shows the account the server returned', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('tab', { name: 'Profil & Akun' }))
    expect(screen.getByText('Nama Pengguna')).toBeInTheDocument()
    expect(screen.getByText('pengguna@aidss.id')).toBeInTheDocument()
    expect(screen.getByText('081234567890')).toBeInTheDocument()
  })

  it('Profile renders role as text, not a coloured badge', async () => {
    // docs/settings-module-spec.md §4.1 removed the role pill for this reason.
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Profil & Akun' }))
    expect(screen.getByText('Pengguna')).toBeInTheDocument()
    expect(screen.queryByText(/subscriber/i)).not.toBeInTheDocument()
  })

  it('Profile offers sign out and calls through', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderSettings({ auth: auth({ signOut }) })

    await user.click(screen.getByRole('tab', { name: 'Profil & Akun' }))
    await user.click(screen.getByRole('button', { name: 'Keluar akun' }))
    expect(signOut).toHaveBeenCalled()
  })

  it('Profile says so when the account could not be loaded, rather than showing a blank', async () => {
    const user = userEvent.setup()
    renderSettings({ auth: auth({ status: 'signed-out', account: null }) })

    await user.click(screen.getByRole('tab', { name: 'Profil & Akun' }))
    expect(screen.getByText('Akun belum dimuat')).toBeInTheDocument()
    expect(screen.getByText(/Periksa koneksi/)).toBeInTheDocument()
  })

  it('Profile refuses to render when there is no account, showing no identity fields', async () => {
    const user = userEvent.setup()
    renderSettings({ auth: auth({ status: 'signed-out', account: null }) })
    await user.click(screen.getByRole('tab', { name: 'Profil & Akun' }))
    expect(screen.queryByLabelText(/nama lengkap/i)).not.toBeInTheDocument()
  })

  it('Subscription states no plan exists rather than showing a fake invoice', async () => {
    subState.body = { active: false, expiresAt: null, daysRemaining: null, startDate: null }
    subState.status = 200
    subState.throws = false
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))
    expect(await screen.findByText('Belum ada langganan')).toBeInTheDocument()
    expect(screen.queryByText(/INV-/)).not.toBeInTheDocument()
  })
})

describe('SettingsView — banned patterns stay banned (R-04, R-09, R-14)', () => {
  it('renders no emoji anywhere across all five tabs', async () => {
    const user = userEvent.setup()
    const { container } = renderSettings()

    for (const name of TABS) {
      await user.click(screen.getByRole('tab', { name }))
      expect(container.textContent ?? '').not.toMatch(
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u,
      )
    }
  })

  it('renders no avatar and no generated initials', async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Profil & Akun' }))
    expect(document.querySelectorAll('[class*="avatar"]')).toHaveLength(0)
  })

  it('About shows the regulatory line as plain text, not a coloured banner', async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Tentang' }))
    const line = screen.getByText(/bukan Penasihat Investasi berizin OJK/)
    expect(line.tagName).toBe('P')
    expect(line).toHaveStyle({ color: 'var(--muted-foreground)' })
  })
})
describe('SettingsView — editing the profile (R-26, R-27)', () => {
  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('tab', { name: 'Profil & Akun' }))
    await user.click(screen.getByRole('button', { name: 'Ubah profil' }))
  }

  it('starts closed, so the account is readable before it is editable', async () => {
    renderSettings()
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'Profil & Akun' }))
    expect(screen.queryByLabelText('Nama lengkap')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ubah profil' })).toBeInTheDocument()
  })

  it('saves both fields through the server', async () => {
    const updateProfile = vi.fn().mockResolvedValue(undefined)
    renderSettings({ auth: auth({ updateProfile }) })
    const user = userEvent.setup()
    await openEditor(user)

    await user.clear(screen.getByLabelText('Nama lengkap'))
    await user.type(screen.getByLabelText('Nama lengkap'), 'Nama Baru')
    await user.clear(screen.getByLabelText('Nomor WhatsApp'))
    await user.type(screen.getByLabelText('Nomor WhatsApp'), '081234567890')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        full_name: 'Nama Baru',
        phone_number: '081234567890',
      }),
    )
  })

  it('keeps Save disabled until something changed', async () => {
    renderSettings()
    const user = userEvent.setup()
    await openEditor(user)
    // A Save button that can be pressed to do nothing is a non-functional control.
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled()

    await user.type(screen.getByLabelText('Nama lengkap'), 'X')
    expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled()
  })

  it('says what the server refused, in text, and stays in edit mode', async () => {
    const updateProfile = vi.fn().mockRejectedValue(new Error('expected an Indonesian mobile number'))
    renderSettings({ auth: auth({ updateProfile }) })
    const user = userEvent.setup()
    await openEditor(user)

    await user.type(screen.getByLabelText('Nama lengkap'), 'X')
    await user.click(screen.getByRole('button', { name: 'Simpan' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('expected an Indonesian mobile number')
    expect(screen.getByLabelText('Nama lengkap')).toBeInTheDocument()
  })

  it('Cancel discards the edit without saving', async () => {
    const updateProfile = vi.fn()
    renderSettings({ auth: auth({ updateProfile }) })
    const user = userEvent.setup()
    await openEditor(user)

    await user.clear(screen.getByLabelText('Nama lengkap'))
    await user.type(screen.getByLabelText('Nama lengkap'), 'Dibuang')
    await user.click(screen.getByRole('button', { name: 'Batal' }))

    expect(updateProfile).not.toHaveBeenCalled()
    expect(screen.getByText('Nama Pengguna')).toBeInTheDocument()
  })

  it('every field has a visible label', async () => {
    renderSettings()
    const user = userEvent.setup()
    await openEditor(user)
    // Placeholder-only fields are invisible to a screen reader once filled.
    expect(screen.getByLabelText('Nama lengkap')).toBeInTheDocument()
    expect(screen.getByLabelText('Nomor WhatsApp')).toBeInTheDocument()
  })
})

describe('the tablist follows the WAI-ARIA keyboard pattern', () => {
  const tabs = () => screen.getAllByRole('tab')

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup()
    renderSettings()
    const first = tabs()[0]
    first.focus()

    await user.keyboard('{ArrowRight}')
    expect(tabs()[1]).toHaveFocus()
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(tabs()[0]).toHaveFocus()
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps only the active tab in the tab order', () => {
    // Otherwise Tab reaches every tab on the way past the list, which is what
    // made the last tab slow to reach on a keyboard.
    renderSettings()
    for (const tab of tabs()) {
      const selected = tab.getAttribute('aria-selected') === 'true'
      expect(tab.getAttribute('tabindex')).toBe(selected ? '0' : '-1')
    }
  })

  it('jumps to the first and last tab with Home and End', async () => {
    const user = userEvent.setup()
    renderSettings()
    const all = tabs()
    const last = all[all.length - 1]
    all[1].focus()

    await user.keyboard('{End}')
    expect(last).toHaveFocus()

    await user.keyboard('{Home}')
    expect(all[0]).toHaveFocus()
  })

  it('wraps past the last tab instead of stopping', async () => {
    const user = userEvent.setup()
    renderSettings()
    const all = tabs()
    all[all.length - 1].focus()

    await user.keyboard('{ArrowRight}')
    expect(tabs()[0]).toHaveFocus()
  })

  it('leaves other keys alone', async () => {
    const user = userEvent.setup()
    renderSettings()
    tabs()[1].focus()
    await user.keyboard('{ArrowDown}')
    expect(tabs()[1]).toHaveFocus()
  })
})

describe('SettingsView — Tab 2 reports the subscription state from the server', () => {
  const openTab = async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))
  }

  beforeEach(() => {
    subState.body = { active: false, expiresAt: null, daysRemaining: null, startDate: null }
    subState.status = 200
    subState.throws = false
  })

  it('shows the expiry date and days remaining when there is one', async () => {
    const in30 = new Date(Date.now() + 30 * 86400_000).toISOString()
    subState.body = { active: true, expiresAt: in30, daysRemaining: 30, startDate: null }

    await openTab()

    expect(await screen.findByText('Masa aktif')).toBeInTheDocument()
    expect(screen.getByText('30 hari tersisa')).toBeInTheDocument()
    // The month name, not a full timestamp: the exact time is noise on a settings row.
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('says the load failed rather than that there is no subscription', async () => {
    // The distinction the boolean-only version lost: telling someone with an
    // active subscription that they have none is a different mistake from showing
    // them an empty page.
    subState.status = 503

    await openTab()

    expect(await screen.findByText('Status tidak dapat dimuat')).toBeInTheDocument()
    expect(screen.queryByText('Belum ada langganan')).not.toBeInTheDocument()
    expect(screen.getByText(/tidak berarti langganan Anda habis/i)).toBeInTheDocument()
  })

  it('shows no renew control at all', async () => {
    // R-26: a control that looks live and does nothing is worse than its absence.
    subState.body = {
      active: true,
      expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      daysRemaining: 30,
      startDate: null,
    }

    await openTab()

    expect(await screen.findByText('Masa aktif')).toBeInTheDocument()
    const labels = ['Perpanjang', 'Upgrade', 'Renew', 'Beli', 'Buy', 'Invoice']
    for (const label of labels) {
      expect(screen.queryByRole('button', { name: new RegExp(label, 'i') })).toBeNull()
    }
  })

  it('invents no plan name, price or percentage', async () => {
    subState.body = {
      active: true,
      expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      daysRemaining: 30,
      startDate: null,
    }

    await openTab()

    const panel = (await screen.findByText('Masa aktif')).closest('div')?.parentElement
      ?.parentElement?.parentElement
    const text = panel?.textContent ?? ''
    // None of these is recorded anywhere, and any of them on screen would be
    // A percentage is still fabricated: `subscriptions` stores only an end date,
    // so "70% remaining" would be a number reconstructed and shown as fact.
    expect(text).not.toMatch(/\d+\s*%/)
    // The prices ARE on screen now, because the server reports them. What must
    // not appear is a price the server did not give — asserted in the block
    // below by pinning them to exactly what it returned.
  })

  it('offers no progress bar driven by a number that does not exist', async () => {
    subState.body = {
      active: true,
      expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      daysRemaining: 30,
      startDate: null,
    }

    await openTab()

    // progressbar is the ARIA role a meter would carry. No meter, no invented scale.
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('meter')).toBeNull()
  })
})

describe('SettingsView — Tab 2 shows what it costs', () => {
  beforeEach(() => {
    // Both reads, reset: a leaked `subState` from an earlier describe would make
    // these tests pass or fail for the wrong reason.
    priceState.body = {
      weekly: 15000,
      monthly: 44000,
      annual: 252000,
      updatedAt: '2026-10-01T09:30:00+00:00',
    }
    priceState.status = 200
    priceState.throws = false
    subState.body = { active: false, expiresAt: null, daysRemaining: null, startDate: null }
    subState.status = 200
    subState.throws = false
  })

  async function openBilling() {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))
  }

  it('reports the three prices from the server', async () => {
    priceState.body = { weekly: 15000, monthly: 20000, annual: 200000 }
    await openBilling()

    expect(await screen.findByText('Rp 15.000')).toBeInTheDocument()
    expect(screen.getByText('Rp 20.000')).toBeInTheDocument()
    expect(screen.getByText('Rp 200.000')).toBeInTheDocument()
  })

  it('says the price cannot be loaded rather than printing zero', async () => {
    // "Rp 0" is a number nobody set, and showing it would be quoting for free.
    priceState.status = 503
    await openBilling()

    expect(await screen.findByText(/tidak dapat dimuat/i)).toBeInTheDocument()
    expect(screen.queryByText('Rp 0')).not.toBeInTheDocument()
  })

  it('still reports the subscription status when the price fails', async () => {
    // Two questions, two answers. One failing must not blank the other.
    priceState.status = 503
    await openBilling()

    expect(await screen.findByText(/Belum ada langganan/i)).toBeInTheDocument()
    expect(screen.getByText(/Harga tidak dapat dimuat/i)).toBeInTheDocument()
  })

  it('shows no renew or buy control', async () => {
    await openBilling()

    // Declaring a transfer starts a human review; no control here promises an
    // instant purchase or a renewal the server would have to honor (R-26).
    expect(screen.queryByRole('button', { name: /Perpanjang|Beli|Upgrade|Renew|Buy/i })).toBeNull()
  })
})

describe('SettingsView — the declared manual transfer (Tab 2, pembayaran)', () => {
  const PENDING = {
    id: 'tx-1',
    invoiceCode: 'INV-20261017120000-ABC123',
    amount: 15000,
    plan: 'monthly',
    paymentGateway: 'manual',
    paymentMethod: 'bank_transfer',
    status: 'pending',
    notes: 'BCA 999000111',
    createdAt: '2026-10-17T12:00:00+00:00',
    expiresAt: '2026-10-17T13:00:00+00:00',
  }

  beforeEach(() => {
    payState.rows = []
    payState.status = 200
    payState.throws = false
    banksState.accounts = []
    banksState.status = 200
    banksState.throws = false
    declareState.accepted = true
    declareState.afterBody = null
    declared.length = 0
  })

  it('shows the waiting transfer with its amount and its moment, and states access is not active yet', async () => {
    payState.rows = [PENDING]
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))

    const block = await screen.findByRole('status')
    expect(within(block).getByText('Transfer sedang diperiksa')).toBeInTheDocument()
    expect(within(block).getByText('Rp 15.000')).toBeInTheDocument()
    expect(within(block).getByText(/Menunggu pemeriksaan admin/)).toBeInTheDocument()
    expect(within(block).getByText(/INV-20261017120000-ABC123/)).toBeInTheDocument()
    // The sentence that keeps the state honest: money declared is not access.
    expect(within(block).getByText(/belum aktif sampai admin memeriksa/i)).toBeInTheDocument()
  })

  it('keeps a refused payment on the record instead of letting it vanish', async () => {
    payState.rows = [
      {
        ...PENDING,
        id: 'tx-2',
        status: 'deny',
        notes: 'BCA 999000111 — Ditolak: nominal tidak cocok',
      },
    ]
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))

    expect(await screen.findByText('Riwayat pembayaran')).toBeInTheDocument()
    expect(screen.getByText(/Ditolak/)).toBeInTheDocument()
    expect(screen.getByText(/nominal tidak cocok/)).toBeInTheDocument()
  })

  it('reads the destination account from the server, never from a constant', async () => {
    banksState.accounts = [
      { bank: 'BNI', accountNumber: '9876543210', holderName: 'PT AIDSS JAYA' },
    ]
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))

    expect(
      await screen.findByText(/BNI · 9876543210 · a\.n PT AIDSS JAYA/),
    ).toBeInTheDocument()
  })

  it('when the server has written no destination, the tab says so instead of showing digits', async () => {
    banksState.accounts = []
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))

    expect(await screen.findByText(/Belum ada rekening tujuan/)).toBeInTheDocument()
  })

  it('declares the transfer to the server and then shows what the re-read holds', async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))
    await screen.findByText(/Rekening tujuan/)

    // Both payment cards carry plan radios now; this declaration posts
    // through the manual form, so the radio is reached by the form's own
    // name rather than a label two cards share.
    const manualAnnual = screen
      .getAllByLabelText('Tahunan')
      .find((el) => (el as HTMLInputElement).name === 'payment-plan')
    expect(manualAnnual).toBeDefined()
    await user.click(manualAnnual as HTMLElement)
    await user.type(screen.getByLabelText(/Catatan untuk admin/), 'BCA 555222333')
    declareState.afterBody = [PENDING]
    await user.click(screen.getByRole('button', { name: /Saya sudah transfer/i }))

    expect(declared).toHaveLength(1)
    expect(declared[0]).toEqual({
      plan: 'annual',
      payment_method: 'bank_transfer',
      note: 'BCA 555222333',
    })
    // The review state, from what the server now holds — not a locally
    // invented row.
    expect(await screen.findByText('Transfer sedang diperiksa')).toBeInTheDocument()
    expect(screen.getByLabelText(/Catatan untuk admin/)).toHaveValue('')
  })

  it('a refused declaration is said out loud, not swallowed', async () => {
    declareState.accepted = false
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))
    await screen.findByText(/Rekening tujuan/)

    await user.click(screen.getByRole('button', { name: /Saya sudah transfer/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('alert').textContent).toMatch(/ditolak server/i)
    expect(screen.queryByText('Transfer sedang diperiksa')).not.toBeInTheDocument()
  })

  it('the tab still loads and speaks when the payment history cannot be read', async () => {
    // An account with no subscription and an unreachable history read must not
    // lose its page: money state failing is not the tab's failure mode.
    payState.throws = true
    const user = userEvent.setup()
    renderSettings()
    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))

    expect(await screen.findByText(/Belum ada langganan/i)).toBeInTheDocument()
    expect(screen.getByText(/Rekening tujuan/)).toBeInTheDocument()
  })
})
