import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AdminIntegrationsView } from '@/app/features/admin/AdminIntegrationsView'

/**
 * The integrations panel, and the two things it must not do: type a key, or
 * name an integration this code does not have.
 *
 * The screen is read-only by decision rather than by omission, so the assertion
 * worth having is that there is no input anywhere on it. The second is that an
 * install with no gateway says so plainly, because a payment surface that reads
 * as ready when it cannot take money is the failure this panel exists to prevent.
 */
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

const mocked = vi.mocked(apiFetch)

function respond(body: unknown, status = 200) {
  mocked.mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response)
}

/** The two mail states, so every fixture spells out which one it is describing. */
const MAIL_ON = { emailConfigured: true, emailMissing: [] }
const MAIL_OFF = {
  emailConfigured: false,
  emailMissing: ['NOTIFICATIONS_ENABLED', 'SMTP_HOST', 'SMTP_MAIL_FROM'],
}

describe('AdminIntegrationsView', () => {
  beforeEach(() => {
    mocked.mockReset()
  })

  it('reports the gateway as wired and names the site it would reach', async () => {
    respond({ midtransConfigured: true, midtransEnvironment: 'production', ...MAIL_ON })
    render(<AdminIntegrationsView />)

    expect(await screen.findByText('Terpasang')).toBeInTheDocument()
    expect(screen.getByText('production')).toBeInTheDocument()
    expect(screen.getByText('Transaksi nyata.')).toBeInTheDocument()
  })

  it('says an unwired install cannot take money, instead of looking ready', async () => {
    respond({ midtransConfigured: false, midtransEnvironment: 'sandbox', ...MAIL_OFF })
    render(<AdminIntegrationsView />)

    expect(await screen.findByText('Belum dikonfigurasi')).toBeInTheDocument()
    expect(
      screen.getByText(/halaman bayar Midtrans tidak bisa dibuka; transfer manual tetap/),
    ).toBeInTheDocument()
  })

  it('offers no field anywhere to type a credential', async () => {
    respond({ midtransConfigured: true, midtransEnvironment: 'sandbox', ...MAIL_ON })
    const { container } = render(<AdminIntegrationsView />)
    await screen.findByText('Terpasang')

    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    // The only button is the retry, which does not appear in this state.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('names no integration the code does not read', async () => {
    respond({ midtransConfigured: true, midtransEnvironment: 'sandbox', ...MAIL_ON })
    render(<AdminIntegrationsView />)
    await screen.findByText('Terpasang')

    const text = document.body.textContent ?? ''
    // WhatsApp still has no field in Settings and no transport, so a row for it
    // would imply a place to put a key. Email left this list the moment the
    // outbox arrived — which is why the assertion names one channel and not two.
    expect(text).not.toMatch(/whatsapp/i)
    expect(screen.getByText('Email')).toBeInTheDocument()
  })

  it('tells the operator which setting is missing rather than only saying no', async () => {
    // "Not configured" alone sends somebody to three files to guess at. The
    // server returns setting NAMES, never values, and the screen shows them.
    respond({ midtransConfigured: true, midtransEnvironment: 'sandbox', ...MAIL_OFF })
    render(<AdminIntegrationsView />)
    await screen.findByText('Belum terpasang')

    expect(screen.getByText(/NOTIFICATIONS_ENABLED/)).toBeInTheDocument()
    expect(screen.getByText(/SMTP_HOST/)).toBeInTheDocument()
  })

  it('renders only the facts the server sends, and nothing that could hold a secret', async () => {
    // The guarantee that no key material crosses the wire is the endpoint's, and
    // it is tested there. What this screen can prove is narrower and still worth
    // pinning: it renders the fields it was given and no slot beside them, and a
    // value that leaked through would show up as text on the page.
    respond({
      midtransConfigured: true,
      midtransEnvironment: 'sandbox',
      emailConfigured: true,
      emailMissing: [],
    })
    render(<AdminIntegrationsView />)
    await screen.findByText('Terpasang')

    expect(screen.getByText('Midtrans')).toBeInTheDocument()
    expect(screen.getByText('Site yang dituju')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    // Exact matches: the note under each value repeats the word "sandbox", and a
    // regex here would count the explanation as a second field.
    expect(screen.getByText('Terpasang')).toBeInTheDocument()
    expect(screen.getByText('sandbox')).toBeInTheDocument()
    expect(screen.getByText(/Nilai kunci tidak pernah dikirim ke layar ini/)).toBeInTheDocument()
  })

  it('does not report "not configured" when it could not read the answer', async () => {
    // "Unknown" and "off" are different claims, and only one of them is safe to
    // show an operator who is about to decide whether to take payments.
    respond({ detail: 'unavailable' }, 503)
    render(<AdminIntegrationsView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak dapat dibaca/i)
    expect(screen.queryByText('Belum dikonfigurasi')).not.toBeInTheDocument()
  })

  it('retries when the operator asks it to', async () => {
    respond({ detail: 'unavailable' }, 503)
    const user = userEvent.setup()
    render(<AdminIntegrationsView />)
    await screen.findByRole('alert')

    respond({ midtransConfigured: true, midtransEnvironment: 'sandbox', ...MAIL_ON })
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }))

    await waitFor(() => expect(screen.getByText('Terpasang')).toBeInTheDocument())
  })

  it('tells a non-administrator the role is what is missing', async () => {
    respond({ detail: 'Administrator access required' }, 403)
    render(<AdminIntegrationsView />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Hanya administrator/i)
  })
})
