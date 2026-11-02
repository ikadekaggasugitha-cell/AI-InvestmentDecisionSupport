import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PublicPricing } from '@/app/features/public/PublicPricing'

/**
 * The price a visitor reads with no session. The rules this suite pins:
 *
 *  - The numbers are the server's. Nothing anywhere in this repo is allowed to
 *    keep a private copy of a number the admin can change (plan-harga-admin):
 *    the three price lines, the annual card's "Setara … per bulan", and the
 *    saving strip are all derived from the response the page just received.
 *  - A refused price is never printed as zero. 503 means the install has no
 *    configured price, and "Rp 0" quotes a real customer for free. The price
 *    slots empty out; the period suffix goes with them.
 *  - There is no purchase control. Deciding to pay starts inside the app,
 *    with a session behind it: Masuk opens the sign-in form and Buat akun
 *    opens the signup form directly (owner, 2026-10-23), and nothing else on
 *    the page is a purchase control.
 *  - The fixed reference (design-harga-fix.png, ronde 9) shows monthly as the
 *    pre-checked pick; the radio picks the plan like its card's button does,
 *    and only Enter or Space can commit it. The pillar band and the navy
 *    footer belong to the page's facts: each pillar said once with its own
 *    sentence, the tax sentence in the caption as the owner's word, and a
 *    live Jakarta clock. The contact entry stays held until the owner names
 *    its channel — not focusable, not clickable, not a dead control.
 */
vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/app/config/api'

const mocked = vi.mocked(apiFetch)

function respond(status: number, body: unknown) {
  mocked.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response)
}

describe('PublicPricing', () => {
  beforeEach(() => {
    mocked.mockReset()
    respond(200, { weekly: 15000, monthly: 44000, annual: 252000, updatedAt: null })
  })

  it("shows the three prices the server holds, with the reference's periods", async () => {
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())
    expect(screen.getByText('Rp 44.000')).toBeInTheDocument()
    expect(screen.getByText('Rp 252.000')).toBeInTheDocument()
    expect(screen.getByText('/ minggu')).toBeInTheDocument()
    expect(screen.getByText('/ bulan')).toBeInTheDocument()
    expect(screen.getByText('/ tahun')).toBeInTheDocument()
  })

  it("derives the saving line from the server's three prices", async () => {
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 252.000')).toBeInTheDocument())

    // 44.000 × 12 = 528.000 against 252.000 → 52, rounded.
    expect(screen.getByText(/Hemat 52% terhadap tarif bulanan/)).toBeInTheDocument()
  })

  it('hides the saving line when the annual price saves nothing', async () => {
    respond(200, { weekly: 15000, monthly: 44000, annual: 528000, updatedAt: null })
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 528.000')).toBeInTheDocument())

    expect(screen.queryByText(/Hemat/)).not.toBeInTheDocument()
  })

  it("derives the annual card's monthly equivalence from the server's own numbers", async () => {
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 252.000')).toBeInTheDocument())

    // 252.000 / 12 = 21.000, formatted by the same money formatter.
    expect(screen.getByText('Setara Rp 21.000 per bulan')).toBeInTheDocument()
  })

  it('hides the annual equivalence while the server has not answered', () => {
    mocked.mockReturnValue(new Promise(() => {}) as Promise<Response>)
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )

    expect(screen.queryByText(/Setara Rp/)).not.toBeInTheDocument()
  })

  it('says it is loading rather than flashing a number nobody set', () => {
    mocked.mockReturnValue(new Promise(() => {}) as Promise<Response>)
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )

    expect(screen.getByText(/Memuat harga/)).toBeInTheDocument()
    expect(screen.queryByText(/Rp /)).not.toBeInTheDocument()
  })

  it('answers a missing price in words, never as zero, and empties every price row', async () => {
    respond(503, { detail: 'No pricing is configured on this server.' })
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText(/Tidak ditampilkan sebagai nol/)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Rp 0/)).not.toBeInTheDocument()
    /* A period suffix beside an empty slot would imply a number is coming. */
    expect(screen.queryByText('/ minggu')).not.toBeInTheDocument()
    expect(screen.queryByText(/Setara Rp/)).not.toBeInTheDocument()
  })

  it('keeps the same promise when the backend is unreachable', async () => {
    mocked.mockRejectedValue(new TypeError('failed to fetch'))
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText(/Harga tidak dapat dimuat/)).toBeInTheDocument())
  })

  it('names exactly what the gate opens, and sells nothing here', async () => {
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    /* The four facts have two homes since the footer stopped being a sitemap
       (2026-11-02): the name-only rows on each card and the pillar band's
       columns with their sentences — 3 + 1 occurrences each. The footer's
       PRODUK column used to be the fifth, and it pointed all four at #pilar. */
    expect(screen.getAllByText('Sinyal').length).toBe(4)
    expect(screen.getAllByText('Peringatan otomatis').length).toBe(4)
    expect(screen.getAllByText('Panel risiko').length).toBe(4)
    expect(screen.getAllByText('Optimasi portofolio').length).toBe(4)
    expect(screen.getByText(/lengkap dengan alasannya/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Beli|Bayar/i })).not.toBeInTheDocument()
  })

  it('splits the topbar gate: Masuk enters, Buat akun signs up', async () => {
    const onEnter = vi.fn()
    const onSignUp = vi.fn()
    const user = userEvent.setup()
    render(
      <PublicPricing
        locale="id"
        onEnter={onEnter}
        onPickPlan={vi.fn()}
        onSignUp={onSignUp}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    /* Scoped to the bar because the footer carries the same two gates: a
       reader who has finished a long page has no topbar on screen anymore. */
    const bar = within(screen.getByRole('banner'))
    await user.click(bar.getByRole('button', { name: 'Masuk' }))
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(onSignUp).not.toHaveBeenCalled()

    await user.click(bar.getByRole('button', { name: 'Buat akun' }))
    expect(onSignUp).toHaveBeenCalledTimes(1)
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('carries the picked plan into the signup walk-in, per row', async () => {
    const onPickPlan = vi.fn()
    const user = userEvent.setup()
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={onPickPlan}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Pilih paket Bulanan' }))
    expect(onPickPlan).toHaveBeenCalledWith('monthly')

    await user.click(screen.getByRole('button', { name: 'Pilih paket Mingguan' }))
    expect(onPickPlan).toHaveBeenLastCalledWith('weekly')

    await user.click(screen.getByRole('button', { name: 'Pilih paket Tahunan' }))
    expect(onPickPlan).toHaveBeenLastCalledWith('annual')
  })

  it('speaks English to an English visitor', async () => {
    render(
      <PublicPricing
        locale="en"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('Rp 15,000')).toBeInTheDocument())
    expect(screen.getByText('Rp 44,000')).toBeInTheDocument()
    expect(screen.getByText('/ week')).toBeInTheDocument()
    expect(screen.getByText('Equivalent to Rp 21,000 per month')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose plan Monthly' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Create account' }),
    ).toBeInTheDocument()
    expect(screen.getByText('FLEXIBLE')).toBeInTheDocument()
    expect(screen.getByText('Best value')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Pricing sheet navigation' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Choose plan' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Choose plan Monthly' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Choose plan Annual' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it("shows the reference's badges on the cards, per language", async () => {
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    expect(screen.getByText('FLEKSIBEL')).toBeInTheDocument()
    expect(screen.getByText('POPULER')).toBeInTheDocument()
    expect(screen.getByText('Nilai Terbaik')).toBeInTheDocument()
  })

  it("pre-checks the monthly radio as the fixed reference's pick", async () => {
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    expect(screen.getByRole('radiogroup', { name: 'Pilih paket' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Pilih paket Bulanan' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Pilih paket Tahunan' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByRole('radio', { name: 'Pilih paket Mingguan' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it("closes the cards with the owner's caption, taxes included by word", async () => {
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    expect(screen.getByText(/sudah termasuk pajak/)).toBeInTheDocument()
  })

  it("tells the pillar band's four sentences once each", async () => {
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    expect(screen.getByRole('heading', { name: 'Yang Anda dapatkan' })).toBeInTheDocument()
    expect(screen.getByText('EMPAT PILAR AIDSS')).toBeInTheDocument()
    expect(screen.getByText(/lengkap dengan alasannya/)).toBeInTheDocument()
    expect(screen.getByText(/memenuhi aturan yang Anda tetapkan/)).toBeInTheDocument()
  })

  it("sends the topbar's Fitur and Catatan to their own screens", async () => {
    const onViewFeatures = vi.fn()
    const onViewNotes = vi.fn()
    const user = userEvent.setup()
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={onViewFeatures}
        onViewNotes={onViewNotes}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    /* The links live behind the hamburger at the bar's far right (owner,
       2026-10-24): the landmark serves the reader once the menu is open. */
    const menuButton = screen.getByRole('button', { name: 'Buka menu navigasi' })
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await user.click(menuButton)
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')

    const nav = within(screen.getByRole('navigation', { name: 'Navigasi lembar harga' }))
    const fitur = nav.getByRole('link', { name: 'Fitur' })
    /* The href stays real for middle-click; the click walks through the app. */
    expect(fitur).toHaveAttribute('href', '/fitur')
    await user.click(fitur)
    expect(onViewFeatures).toHaveBeenCalledTimes(1)

    /* Catatan left the page (owner, 2026-11-02): it is a screen with its own
       URL now, not a jump to the footer's one-sentence disclaimer. The href
       stays real so the reader can share or middle-click it. */
    const catatan = nav.getByRole('link', { name: 'Catatan' })
    expect(catatan).toHaveAttribute('href', '/catatan')
    await user.click(catatan)
    expect(onViewNotes).toHaveBeenCalledTimes(1)
    /* The Harga entry is gone (owner, 2026-10-23): the topbar already sits
       on the price section, so that anchor pointed at where the reader is. */
    expect(nav.queryByRole('link', { name: 'Harga' })).not.toBeInTheDocument()

    /* Escape closes the menu and returns focus to its button (R-32). The
       menu already shut itself after the Fitur click, so reopen it first. */
    await user.click(menuButton)
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(menuButton)
  })

  it('keeps the enter gates outside the menu, standing at the far right', async () => {
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    const menu = screen
      .getByRole('button', { name: 'Buka menu navigasi' })
      .closest('.pub-menu') as HTMLElement
    const gates = within(screen.getByRole('banner'))
    expect(menu.contains(gates.getByRole('button', { name: 'Masuk' }))).toBe(false)
    expect(menu.contains(gates.getByRole('button', { name: 'Buat akun' }))).toBe(false)
    /* The menu button is the last control inside the bar's container. */
    const bar = menu.closest('.pub-container') as HTMLElement
    expect(bar.lastElementChild).toBe(menu)
  })

  it('closes the sheet with brand, the risk note, and the bottom line, and nothing else', async () => {
    respond(200, {
      weekly: 15000,
      monthly: 44000,
      annual: 252000,
      updatedAt: '2026-10-21T16:00:00Z',
    })
    const { container } = render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={vi.fn()}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    const footer = within(screen.getByRole('contentinfo'))

    /* No call to action and no links (owner, 2026-11-02). This footer once
       carried eleven links, five of them to #harga, then briefly a closing band
       with Buat akun and Masuk. Both are gone: the page bottom is not where the
       page finishes its argument, and the gates live in the topbar and the plan
       cards, which have their own tests. */
    expect(footer.queryAllByRole('link')).toHaveLength(0)
    expect(footer.queryByRole('heading')).not.toBeInTheDocument()
    expect(footer.queryByRole('button', { name: 'Masuk' })).not.toBeInTheDocument()
    expect(footer.queryByText('Buat akun')).not.toBeInTheDocument()
    expect(footer.queryByText('Fitur')).not.toBeInTheDocument()
    expect(footer.queryByText('Catatan')).not.toBeInTheDocument()
    /* No contact entry either. It used to be a held span; the owner's settings
       spec already rules that an empty channel means the row is not rendered. */
    expect(footer.queryByText('Hubungi kami')).not.toBeInTheDocument()

    /* What it does carry: who is speaking, what the product is not, and the
       facts under its own line. */
    expect(footer.getByRole('img', { name: 'AIDSS' })).toBeInTheDocument()
    expect(footer.getByText('Trading Intelligence Platform')).toBeInTheDocument()
    expect(footer.getByText(/Pendukung keputusan investasi harian/)).toBeInTheDocument()
    expect(container.querySelector('#catatan')).toBeInTheDocument()
    expect(footer.getByText(/alat bantu keputusan, bukan penasihat investasi/)).toBeInTheDocument()
    expect(footer.getByText(/© 2026 AIDSS · MCASS/)).toBeInTheDocument()
    /* The footer's only control is the language switch. */
    expect(footer.getAllByRole('button')).toHaveLength(1)
    expect(footer.getByRole('button', { name: 'Switch to English' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(footer.getByText(/Harga diperbarui/)).toBeInTheDocument()
    expect(footer.getByText(/\d{2}:\d{2} WIB/)).toBeInTheDocument()
    /* The sessions are printed, and the footer never claims the exchange is
       open right now: there is no holiday table behind that call, and a page
       whose argument is that it does not overstate must not start one. Word
       boundaries matter here: "bukan" contains "buka". */
    expect(footer.getByText('Bursa Senin-Jumat')).toBeInTheDocument()
    expect(footer.getByText('09:00-12:00 dan 13:30-15:50')).toBeInTheDocument()
    expect(footer.queryByText(/\b(buka|tutup|live)\b/i)).not.toBeInTheDocument()
  })

  it("keeps the footer's Jakarta clock to the minute", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-23T10:38:48Z'))
      mocked.mockReturnValue(new Promise(() => {}) as Promise<Response>)
      render(
        <PublicPricing
          locale="id"
          onEnter={vi.fn()}
          onPickPlan={vi.fn()}
          onSignUp={vi.fn()}
          onViewFeatures={vi.fn()}
          onViewNotes={vi.fn()}
        />,
      )

      expect(screen.getByText('17:38 WIB')).toBeInTheDocument()
      /* Eleven seconds later it is still the same minute: seconds in a footer
         answer no question, and the poll that watches for the roll returns the
         same string until it happens. */
      act(() => {
        vi.advanceTimersByTime(11000)
      })
      expect(screen.getByText('17:38 WIB')).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(60000)
      })
      expect(screen.getByText('17:39 WIB')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("lets the radio pick the plan the same way its card's button does", async () => {
    const onPickPlan = vi.fn()
    const user = userEvent.setup()
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={onPickPlan}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    await user.click(screen.getByRole('radio', { name: 'Pilih paket Tahunan' }))
    expect(onPickPlan).toHaveBeenCalledWith('annual')
    expect(screen.getByRole('radio', { name: 'Pilih paket Tahunan' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('moves only the focus with arrow keys, never a choice', async () => {
    const onPickPlan = vi.fn()
    render(
      <PublicPricing
        locale="id"
        onEnter={vi.fn()}
        onPickPlan={onPickPlan}
        onSignUp={vi.fn()}
        onViewFeatures={vi.fn()}
        onViewNotes={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('Rp 15.000')).toBeInTheDocument())

    const [mingguan, bulanan, tahunan] = screen.getAllByRole('radio')
    mingguan.focus()
    fireEvent.keyDown(mingguan, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(bulanan)
    fireEvent.keyDown(bulanan, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tahunan)
    fireEvent.keyDown(tahunan, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(bulanan)
    expect(onPickPlan).not.toHaveBeenCalled()
  })
})
