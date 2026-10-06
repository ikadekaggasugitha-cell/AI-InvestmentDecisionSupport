import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SIMULATED_FRESHNESS } from '../hooks/useLiveMarket'
import type { Account } from '../hooks/useAuth'

/**
 * The sidebar used to render a hardcoded operator: the name "James Davidson",
 * the title "Portfolio Manager", and a "JD" initials avatar. None of it came
 * from anywhere. backend/api/routers/auth.py signs a JWT from AUTH_USERNAME and
 * never reads a users table, so all three were fabricated and presented as fact
 * (R-38, R-23, R-18).
 *
 * The block now shows the account /v1/auth/me returns, which is real. These
 * assertions keep the difference clear: the name shown must be the name the
 * account actually has, and nothing may be derived from it.
 */

const noop = () => {}

function renderSidebar(account: Account | null = null) {
  return render(
    <Sidebar
      account={account}
      currentView="dashboard"
      onViewChange={noop}
      alertCount={0}
      watchlistCount={0}
      isMarketOpen={false}
      isMobile={false}
      isOpen={true}
      onClose={noop}
    />,
  )
}

describe('Sidebar operator block', () => {
  it('shows no fabricated person, job title, or initials avatar', () => {
    const { container } = renderSidebar()
    const text = container.textContent ?? ''

    expect(text).not.toMatch(/James Davidson/)
    expect(text).not.toMatch(/Portfolio Manager|Manajer Portofolio/)
    // No element holding a bare two-letter monogram as its whole content.
    for (const el of Array.from(container.querySelectorAll('div'))) {
      expect(el.textContent?.trim()).not.toMatch(/^[A-Z]{2}$/)
    }
  })

  it('states plainly that no account is connected', () => {
    renderSidebar(null)
    // "Operator Tunggal" described a deployment that no longer exists: there are
    // accounts now. What is true with nobody signed in is simply that there is no
    // account, and that is what it says.
    expect(screen.queryByText('Operator Tunggal')).not.toBeInTheDocument()
    expect(screen.getByText('Belum ada akun terhubung')).toBeInTheDocument()
  })

  it('shows the name the signed-in account actually has', () => {
    renderSidebar({
      id: 'acct-1',
      email: 'pemilik@aidss.id',
      full_name: 'Siti Rahayu',
      phone_number: '081234567890',
      role: 'user',
      blocked: false,
    })
    expect(screen.getByText('Siti Rahayu')).toBeInTheDocument()
    expect(screen.queryByText('Belum ada akun terhubung')).not.toBeInTheDocument()
  })

  it('does not derive an initial or a monogram from the name', () => {
    const { container } = renderSidebar({
      id: 'acct-1',
      email: 'pemilik@aidss.id',
      full_name: 'Siti Rahayu',
      phone_number: '081234567890',
      role: 'user',
      blocked: false,
    })
    for (const el of Array.from(container.querySelectorAll('div'))) {
      expect(el.textContent?.trim()).not.toMatch(/^[A-Z]{2}$/)
    }
  })

  it('labels an administrator as one and says nothing about payment', () => {
    renderSidebar({
      id: 'acct-2',
      email: 'admin@aidss.id',
      full_name: 'Budi Santoso',
      phone_number: '081234567891',
      role: 'admin',
      blocked: false,
    })
    expect(screen.getByText('Administrator')).toBeInTheDocument()
    // CONTEXT.md rule 2: role is not entitlement, so this must not read as one.
    expect(screen.queryByText(/subscriber|langganan|premium/i)).not.toBeInTheDocument()
  })

  it('still renders every navigation destination', () => {
    renderSidebar()
    // Sidebar defaults to the Indonesian locale, so these are the ID labels.
    for (const label of ['Dashboard', 'Pasar', 'Portofolio', 'AI Advisor', 'Risiko', 'Berita', 'Laporan', 'Pengaturan', 'Peringatan']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('does not claim a market is open when it is closed', () => {
    renderSidebar()
    expect(screen.getByText(/CLOSED|TUTUP/i)).toBeInTheDocument()
    expect(SIMULATED_FRESHNESS.isSimulated).toBe(true)
  })
})