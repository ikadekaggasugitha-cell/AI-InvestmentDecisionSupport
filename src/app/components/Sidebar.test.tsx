import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SIMULATED_FRESHNESS } from '../hooks/useLiveMarket'

/**
 * The sidebar used to render a hardcoded operator: the name "James Davidson",
 * the title "Portfolio Manager", and a "JD" initials avatar. None of it came
 * from anywhere. backend/api/routers/auth.py signs a JWT from AUTH_USERNAME and
 * never reads a users table, so all three were fabricated and presented as fact
 * (R-38, R-23, R-18).
 *
 * These assertions exist to stop that block from being reintroduced.
 */

const noop = () => {}

function renderSidebar() {
  return render(
    <Sidebar
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
    renderSidebar()
    expect(screen.getByText('Operator Tunggal')).toBeInTheDocument()
    expect(screen.getByText('Belum ada akun terhubung')).toBeInTheDocument()
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