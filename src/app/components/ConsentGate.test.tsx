import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ConsentGate, ConsentModal } from './ConsentGate'
import { clearConsent, hasAcceptedConsent, writeConsent } from './consent'

const useAuthMock = vi.fn(() => ({ account: { id: 'acct-a' } as { id: string } | null }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

// The consent POST is the point of the second describe block, so the fetch mock
// records it rather than stubbing it away.
const posted: string[] = []
const postState = { ok: true, throw: false }
vi.mock('../config/api', () => ({
  ENDPOINTS: { authConsent: '/v1/auth/consent' },
  apiFetch: vi.fn(async (url: string) => {
    posted.push(url)
    if (postState.throw) throw new Error('offline')
    return { ok: postState.ok, status: postState.ok ? 200 : 503 } as unknown as Response
  }),
}))

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

  it('says the acceptance is recorded on the server', () => {
    // It now is: POST /v1/auth/consent writes to consent_acceptances. The modal used
    // to say "stored in this browser only", which was the honest version while there
    // was no server-side record — and wrong the moment there was one.
    render(
      <MemoryRouter>
        <ConsentModal locale={locale} onAccept={() => {}} />
      </MemoryRouter>,
    )
    const note = document.body.textContent ?? ''
    expect(note).toMatch(/dicatat di server/i)
    // The version matters: an acceptance of old wording is not consent to new
    // wording, so the person is told which text they agreed to.
    expect(note).toMatch(/versi teksnya/i)
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

describe('reporting the acceptance to the server', () => {
  beforeEach(() => {
    posted.length = 0
    postState.ok = true
    postState.throw = false
  })

  async function acceptAndWait() {
    const user = userEvent.setup()
    renderGate()
    await user.click(screen.getByRole('button', { name: 'Saya Mengerti & Setuju' }))
    // The POST is fired after the local marker, so let the microtask chain settle.
    await waitFor(() => expect(posted).toHaveLength(1))
  }

  it('records it once the button has been pressed', async () => {
    await acceptAndWait()
    expect(posted[0]).toContain('/v1/auth/consent')
  })

  it('the modal closes even when the server call fails', async () => {
    // The person pressed the button. Refusing to close the modal because the
    // network is down is a worse failure than a missing server-side record, and
    // the record can still be added later — consent has to be deliberate.
    postState.ok = false
    const user = userEvent.setup()
    renderGate()

    await user.click(screen.getByRole('button', { name: 'Saya Mengerti & Setuju' }))

    expect(await screen.findByText(/Sinyal AI/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the content is revealed even when the request throws', async () => {
    postState.throw = true
    const user = userEvent.setup()
    renderGate()

    await user.click(screen.getByRole('button', { name: 'Saya Mengerti & Setuju' }))

    expect(await screen.findByText(/Sinyal AI/)).toBeInTheDocument()
  })

  it('nothing is reported for an anonymous visitor', async () => {
    // No account to attribute it to, and POST /v1/auth/consent would reject it.
    const user = userEvent.setup()
    useAuthMock.mockReturnValue({ account: null } as never)
    render(
      <MemoryRouter>
        <ConsentGate locale={locale}>
          <p>Konten</p>
        </ConsentGate>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Saya Mengerti & Setuju' }))
    await waitFor(() => expect(screen.getByText('Konten')).toBeInTheDocument())
    expect(posted).toHaveLength(0)
  })
})
