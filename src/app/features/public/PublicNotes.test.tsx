import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PublicNotes } from '@/app/features/public/PublicNotes'

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
    await user.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(handlers.onEnter).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /Buat akun/ }))
    expect(handlers.onSignUp).toHaveBeenCalledTimes(1)
  })

  it('shares the footer chrome: the disclaimer stays, the contact stays held', () => {
    const { container } = renderNotes()
    /* The one-sentence disclaimer is still on the page. This screen joined the
       app; it did not replace the footer's own statement. */
    expect(container.querySelector('#catatan')).toBeInTheDocument()
    const held = screen.getByText('Hubungi kami')
    expect(held.closest('a')).toBeNull()
    /* In-page anchors point at sections that exist on this page. */
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>(
      '.pub-footer-col a[href^="#"]',
    )) {
      expect(container.querySelector(anchor.getAttribute('href') as string)).toBeInTheDocument()
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
