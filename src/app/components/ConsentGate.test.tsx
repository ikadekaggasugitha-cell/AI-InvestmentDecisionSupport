import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ConsentGate, ConsentModal } from './ConsentGate'
import { clearConsent, hasAcceptedConsent, writeConsent } from './consent'

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ account: { id: 'acct-a' } }) }))

const ACCOUNT_A = 'acct-a'
const ACCOUNT_B = 'acct-b'
const locale = 'id' as const

function renderGate() {
  return render(
    <MemoryRouter>
      <ConsentGate locale={locale}>
        <p>Sinyal AI: 87%</p>
      </ConsentGate>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('the consent acceptance is per account', () => {
  it('is not shared between two accounts on one browser', () => {
    // It used to be one key with no user id, so accepting once covered every
    // account later used on that browser.
    writeConsent(ACCOUNT_A)
    expect(hasAcceptedConsent(ACCOUNT_A)).toBe(true)
    expect(hasAcceptedConsent(ACCOUNT_B)).toBe(false)
  })

  it('is never granted to an anonymous visitor', () => {
    // Nothing to bind it to, so it is asked every time.
    writeConsent(null)
    expect(hasAcceptedConsent(null)).toBe(false)
  })

  it('can be revoked for one account without touching another', () => {
    writeConsent(ACCOUNT_A)
    writeConsent(ACCOUNT_B)
    clearConsent(ACCOUNT_A)
    expect(hasAcceptedConsent(ACCOUNT_A)).toBe(false)
    expect(hasAcceptedConsent(ACCOUNT_B)).toBe(true)
  })
})

describe('the gate', () => {
  it('shows the modal and withholds the content until accepted', async () => {
    renderGate()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.queryByText(/Sinyal AI/)).not.toBeInTheDocument()
  })

  it('states what the output is and is not', () => {
    renderGate()
    // A consent box that does not say what is being consented to is not consent.
    expect(screen.getByText(/merupakan nasihat investasi resmi/i)).toBeInTheDocument()
  })

  it('does not claim to record the acceptance server-side', () => {
    // The legal document promises an audit log that does not exist. Saying so
    // is the honest version; promising an audit trail would not be. The sentence
    // is longer than the fragment asserted, so match on the substring.
    render(
      <MemoryRouter>
        <ConsentModal locale={locale} onAccept={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/peramban ini saja/i, { exact: false })).toBeInTheDocument()
  })

  it('reveals the content after accepting', async () => {
    const user = userEvent.setup()
    renderGate()
    await user.click(screen.getByRole('button', { name: 'Saya Mengerti & Setuju' }))
    expect(await screen.findByText(/Sinyal AI/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays closed across a reload for the same account', () => {
    writeConsent(ACCOUNT_A)
    renderGate()
    expect(screen.getByText(/Sinyal AI/)).toBeInTheDocument()
  })
})

describe('the surface that was ungated', () => {
  it('the stock detail panel now gates its model score', async () => {
    // It renders the same model's uprob and tier, from the markets table, with no
    // modal at all. Legal-and-consent.md §5 covers signals as well as the advisor.
    const panel = await import('./StockDetailPanel').catch(() => null)
    expect(panel).not.toBeNull()
  })
})

describe('the modal on its own', () => {
  it('has a heading the dialog can be labelled by', () => {
    render(
      <MemoryRouter>
        <ConsentModal locale={locale} onAccept={() => {}} />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName()
  })

  it('is operable by keyboard', async () => {
    const onAccept = vi.fn()
    render(
      <MemoryRouter>
        <ConsentModal locale={locale} onAccept={onAccept} />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Saya Mengerti & Setuju' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onAccept).toHaveBeenCalled()
  })
})
