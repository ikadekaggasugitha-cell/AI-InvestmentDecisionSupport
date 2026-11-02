import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PublicNotes } from '@/app/features/public/PublicNotes'

/* The shared footer reads the support address from the server, so this screen
   renders a component that fetches. Mocked rather than left to reach a backend
   that may or may not be running; the address's own behaviour is pinned in
   PublicFooter.test.tsx. */
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

/**
 * The third public surface (owner, 2026-11-02): the screen the price sheet's
 * burger "Catatan" now leads to. The rules this suite pins:
 *
 *  - Every sentence here is something the running system already does, so the
 *    page is allowed to exist in front of a paying prospect. That is the whole
 *    point of ADR-0013, and the four checks at the bottom are its teeth: no
 *    algorithm name the API contract cannot support, no price figure that would
 *    compete with the server's own, no contact channel that has never been
 *    given to anyone, no pictograph standing in for an icon.
 *  - It is NOT the terms of service. The disclaimer paragraph in the shared
 *    footer stays where it was; this page says plainly that the legal document
 *    is still a draft, which is what that document asks of us.
 *  - Navigation walks inside the app: hrefs stay real for middle-click and
 *    sharing while clicks go through handlers, and the menu never offers the
 *    page the reader is already standing on.
 */
function renderNotes(
  locale: 'id' | 'en' = 'id',
  overrides: Partial<Parameters<typeof PublicNotes>[0]> = {},
) {
  const handlers = {
    onEnter: vi.fn(),
    onSignUp: vi.fn(),
    onViewPricing: vi.fn(),
    onViewFeatures: vi.fn(),
    ...overrides,
  }
  const utils = render(<PublicNotes locale={locale} {...handlers} />)
  return { ...utils, handlers }
}

const SECTIONS = [
  'Bukan penasihat investasi',
  'Angka yang Anda lihat adalah probabilitas',
  'Dari mana datanya, dan seberapa baru',
  'Angka contoh dan angka Anda',
  'Apa yang dibuka langganan',
  'Cara membayar dan apa yang terjadi setelahnya',
  'Pengembalian dana',
  'Data pribadi Anda',
  'Status layanan dan revisi catatan ini',
]

describe('PublicNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ email: null }),
    } as unknown as Response)
  })

  it('states what it is, and what it is not', () => {
    renderNotes()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Catatan')
    /* The sentence that keeps this page from becoming a fake ToS. */
    expect(screen.getByText(/bukan syarat layanan/)).toBeInTheDocument()
    expect(screen.getByText(/masih draf internal dan belum mengikat/)).toBeInTheDocument()
  })

  it('renders every section as a heading with an anchor of its own', () => {
    const { container } = renderNotes()
    for (const title of SECTIONS) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }
    /* Each heading sits in an element a footer or deep link can land on. */
    for (const id of [
      'risiko',
      'probabilitas',
      'data',
      'contoh',
      'langganan',
      'pembayaran',
      'pengembalian-dana',
      'privasi',
      'status',
    ]) {
      expect(container.querySelector(`section#${id}, article#${id}`)).toBeInTheDocument()
    }
  })

  it('offers a jump rail whose links match the sections one for one', () => {
    const { container } = renderNotes()
    const rail = within(screen.getByRole('navigation', { name: 'Daftar bagian catatan' }))
    const hrefs = rail.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual([
      '#risiko',
      '#probabilitas',
      '#data',
      '#contoh',
      '#langganan',
      '#pembayaran',
      '#pengembalian-dana',
      '#privasi',
      '#status',
    ])
    /* Every rail link lands on an element that exists on this page. */
    for (const href of hrefs) {
      expect(container.querySelector(`main ${href}`)).toBeInTheDocument()
    }
    /* Short labels, not the sentence headings: the rail is 208px wide. */
    expect(rail.getByRole('link', { name: 'Bukan penasihat' })).toBeInTheDocument()
    expect(rail.queryByRole('link', { name: SECTIONS[0] })).not.toBeInTheDocument()
  })

  it('carries the revision stamp as printed text, not the browser clock', () => {
    renderNotes()
    expect(screen.getByText(/Catatan ini direvisi 2 November 2026/)).toBeInTheDocument()
  })

  it('offers Harga and Fitur in the menu, and never this page itself', async () => {
    const user = userEvent.setup()
    const { handlers } = renderNotes()
    await user.click(screen.getByRole('button', { name: 'Buka menu navigasi' }))
    const nav = within(screen.getByRole('navigation', { name: 'Navigasi layar catatan' }))

    const harga = nav.getByRole('link', { name: 'Harga' })
    const fitur = nav.getByRole('link', { name: 'Fitur' })
    expect(harga).toHaveAttribute('href', '/')
    expect(fitur).toHaveAttribute('href', '/fitur')
    expect(nav.queryByRole('link', { name: 'Catatan' })).not.toBeInTheDocument()

    await user.click(harga)
    expect(handlers.onViewPricing).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Buka menu navigasi' }))
    await user.click(nav.getByRole('link', { name: 'Fitur' }))
    expect(handlers.onViewFeatures).toHaveBeenCalledTimes(1)
  })

  it('runs the hamburger as a real small menu: open, Escape, focus back', async () => {
    const user = userEvent.setup()
    renderNotes()
    const button = screen.getByRole('button', { name: 'Buka menu navigasi' })
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(button)
  })

  it('keeps both enter gates standing beside the menu', async () => {
    const user = userEvent.setup()
    const { handlers } = renderNotes()
    /* The bar, not the page: the footer carries the same two gates now, for the
       reader who has already scrolled past the bar. */
    const bar = within(screen.getByRole('banner'))
    await user.click(bar.getByRole('button', { name: 'Masuk' }))
    expect(handlers.onEnter).toHaveBeenCalledTimes(1)
    await user.click(bar.getByRole('button', { name: /Buat akun/ }))
    expect(handlers.onSignUp).toHaveBeenCalledTimes(1)
  })

  it('shares the footer chrome: the disclaimer stays, the footer carries no links', () => {
    const { container } = renderNotes()
    /* The one-sentence disclaimer is still on the page, at the anchor the other
       screens cross to. This screen joined the app; it did not replace the
       footer's own statement. */
    expect(container.querySelector('#catatan')).toBeInTheDocument()
    const footer = within(screen.getByRole('contentinfo'))
    /* No links and no call to action, on any of the three public screens
       (owner, 2026-11-02). "Hubungi kami" is absent for the same reason this
       page states in its own copy: no channel has ever been named. */
    expect(footer.queryAllByRole('link')).toHaveLength(0)
    expect(footer.queryByText('Hubungi kami')).not.toBeInTheDocument()
    /* The nine sections are reachable from the page's own jump rail, which is
       where that job belongs: the footer used to repeat the rail as a column.
       Every rail anchor still lands on a heading that exists on this page. */
    const rail = within(screen.getByRole('navigation', { name: 'Daftar bagian catatan' }))
    for (const entry of rail.getAllByRole('link')) {
      expect(container.querySelector(entry.getAttribute('href') as string)).toBeInTheDocument()
    }
  })

  it('switches to English headings with the locale', () => {
    renderNotes('en')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Notes')
    expect(screen.getByRole('heading', { level: 2, name: 'Not an investment adviser' }))
    expect(screen.getByText(/These notes were revised 2 November 2026/)).toBeInTheDocument()
  })
})

describe('what the notes page is not allowed to claim', () => {
  const source = () =>
    readFileSync(join(process.cwd(), 'src/app/features/public/PublicNotes.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

  it('names no algorithm the API contract cannot support', () => {
    for (const name of ['LightGBM', 'XGBoost', 'CatBoost']) {
      expect(source()).not.toContain(name)
    }
  })

  it('quotes no price, which the server owns', () => {
    expect(source()).not.toMatch(/Rp\s?\d/)
  })

  it('invents no contact channel: no phone number, no email, no WhatsApp', () => {
    const text = source()
    expect(text).not.toMatch(/wa\.me|whatsapp|mailto:/i)
    expect(text).not.toMatch(/08\d{8,}/)
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)
  })

  it('uses no pictographic glyph in place of an icon', () => {
    // Same boundary the app-wide guard draws: arrows, dingbats and emoji are
    // out; typographic punctuation (en dash, middle dot) is punctuation.
    expect(source()).not.toMatch(
      /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u,
    )
  })
})
