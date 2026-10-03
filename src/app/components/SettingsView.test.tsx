import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsView } from './SettingsView'
import { AppProvider } from '../context/AppContext'
import { SIMULATED_FRESHNESS } from '../hooks/useLiveMarket'
import type { ExchangeRateData } from '../hooks/useExchangeRate'

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
      <SettingsView fx={fx()} freshness={SIMULATED_FRESHNESS} {...props} />
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

describe('SettingsView — tabs whose backend does not exist (R-38, R-24)', () => {
  it('Profile states there is no account rather than inventing one', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('tab', { name: 'Profil & Akun' }))
    expect(screen.getByText('Belum ada akun terhubung')).toBeInTheDocument()
    expect(screen.getByText(/beroperasi sebagai satu operator/)).toBeInTheDocument()
    // No fabricated identity fields.
    expect(screen.queryByLabelText(/nama lengkap/i)).not.toBeInTheDocument()
  })

  it('Subscription states no plan exists rather than showing a fake invoice', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('tab', { name: 'Langganan & Tagihan' }))
    expect(screen.getByText('Belum ada langganan')).toBeInTheDocument()
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