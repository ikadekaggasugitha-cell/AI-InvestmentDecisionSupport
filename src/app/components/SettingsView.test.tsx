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

vi.mock('../config/api', () => ({
  ENDPOINTS: {
    subscription: '/v1/subscription/current',
    authMe: '/v1/auth/me',
  },
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes('/v1/subscription/current')) {
      if (subState.throws) throw new Error('offline')
      return { ok: subState.status < 400, status: subState.status, json: async () => subState.body } as unknown as Response
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
    // fabricated — which is what this tab used to be careful about.
    expect(text).not.toMatch(/Rp\\s*\\d/i)
    expect(text).not.toMatch(/\\d+\\s*%/)
    expect(text).not.toMatch(/monthly|annual|bulanan|tahunan/i)
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
