import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'

import { PublicFooter } from '@/app/features/public/PublicFooter'

/**
 * The shared footer's own rules, tested once instead of three times.
 *
 * The one behaviour that lives here rather than on a page is the contact
 * address. It is the only value in this component that is not written in code,
 * and the reason is the thing under test: an address invented here would be a
 * promise nothing keeps, which is what ADR-0013 exists to stop. So the row
 * appears when the server publishes an address, and does not appear at all when
 * it does not — never a `mailto:` with nothing after it, which is the failure
 * `docs/settings-module-spec.md` §4 already rules on for this feature.
 */
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

const mocked = vi.mocked(apiFetch)

function answers(body: unknown, ok = true, status = 200) {
  mocked.mockResolvedValue({ ok, status, json: async () => body } as unknown as Response)
}

function renderFooter(locale: 'id' | 'en' = 'id') {
  return render(<PublicFooter locale={locale} updatedAt={null} />)
}

function footer() {
  return within(screen.getByRole('contentinfo'))
}

describe('the contact address', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing at all when the server publishes no address', async () => {
    answers({ email: null, updatedAt: null })
    const { container } = renderFooter()

    expect(await footer().findByText('Trading Intelligence Platform')).toBeInTheDocument()
    expect(footer().queryByText('Hubungi kami')).not.toBeInTheDocument()
    /* Not even a link waiting for a value: an href that resolves to `mailto:` is
       a control that goes nowhere, and it looks exactly like a working one. */
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull()
  })

  it('shows the label and the address when the operator set one', async () => {
    answers({ email: 'support@aidss.id', updatedAt: '2026-11-02T09:00:00Z' })
    renderFooter()

    const link = await footer().findByRole('link', { name: 'support@aidss.id' })
    expect(footer().getByText('Hubungi kami')).toBeInTheDocument()
    /* The address is published as it was written: no lowercasing, no folding, no
       reformatting into something the operator did not type. */
    expect(link.getAttribute('href')).toBe('mailto:support@aidss.id')
  })

  it('prints the address itself, not a word like "email" to hover over', async () => {
    answers({ email: 'support@aidss.id' })
    renderFooter()

    expect(await footer().findByText('support@aidss.id')).toBeInTheDocument()
  })

  it('says Contact us in English, and keeps the address as written', async () => {
    answers({ email: 'Support@AIDSS.id' })
    renderFooter('en')

    const link = await footer().findByRole('link', { name: 'Support@AIDSS.id' })
    expect(footer().getByText('Contact us')).toBeInTheDocument()
    expect(link.getAttribute('href')).toBe('mailto:Support@AIDSS.id')
  })

  it.each([
    ['a refused read', { ok: false, status: 403, body: {} }],
    ['an unreadable stored value', { ok: false, status: 503, body: {} }],
    ['a server that is not there', null],
  ])('treats %s as no address rather than a broken link', async (_label, reply) => {
    if (reply === null) mocked.mockRejectedValue(new Error('offline'))
    else answers(reply.body, reply.ok, reply.status)

    const { container } = renderFooter()
    expect(await footer().findByText('Trading Intelligence Platform')).toBeInTheDocument()
    expect(footer().queryByText('Hubungi kami')).not.toBeInTheDocument()
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull()
  })

  it('asks the contact endpoint and nobody else for it', async () => {
    answers({ email: 'support@aidss.id' })
    renderFooter()
    await footer().findByRole('link', { name: 'support@aidss.id' })

    expect(mocked).toHaveBeenCalledTimes(1)
    expect(String(mocked.mock.calls[0][0])).toMatch(/\/v1\/subscriptions\/contact$/)
  })

  it('invents no address in its own source', () => {
    /* The same boundary PublicNotes.test.tsx draws for that page, and the reason
       this file is the one that pins it: the footer is where a fabricated contact
       would do the most damage, because a visitor would write to it. */
    const source = readFileSync(
      join(process.cwd(), 'src/app/features/public/PublicFooter.tsx'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    expect(source).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)
    expect(source).not.toMatch(/wa\.me|whatsapp/i)
    expect(source).not.toMatch(/08\d{8,}/)
  })
})

describe('the rest of the footer, unchanged by the contact row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    answers({ email: 'support@aidss.id' })
  })

  it('still carries no navigation and no call to action', async () => {
    renderFooter()
    await footer().findByRole('link', { name: 'support@aidss.id' })

    /* The contact link is the only link in this component. That is the whole of
       the owner's 2026-11-02 decision, still true after the address arrived. */
    expect(footer().getAllByRole('link')).toHaveLength(1)
    expect(footer().queryByRole('button', { name: 'Masuk' })).not.toBeInTheDocument()
    expect(footer().queryByText('Buat akun')).not.toBeInTheDocument()
    expect(footer().queryByRole('heading')).not.toBeInTheDocument()
  })

  it('keeps the risk note at the anchor the other screens cross to', async () => {
    const { container } = renderFooter()
    await footer().findByText('Trading Intelligence Platform')

    const disclaimer = container.querySelector('#catatan')
    expect(disclaimer).not.toBeNull()
    expect(disclaimer?.textContent).toContain('alat bantu keputusan, bukan penasihat investasi')
  })

  it('writes without the banned dash, even with an address published', async () => {
    const { container } = renderFooter()
    await footer().findByRole('link', { name: 'support@aidss.id' })

    expect(container.textContent).not.toContain('—')
    expect(container.textContent).not.toContain('–')
  })
})
