import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthScreen } from './AuthScreen'
import type { AuthState } from '../hooks/useAuth'

const locale = 'id' as const

function makeAuth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    status: 'signed-out',
    account: null,
    error: null,
    refresh: vi.fn(),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    updateProfile: async () => {},
    ...overrides,
  }
}

function renderScreen(
  auth: AuthState,
  onAuthed = vi.fn(),
  extra: { initialMode?: "login" | "signup"; initialPlan?: "weekly" | "monthly" | "annual" | null } = {},
) {
  return render(
    <MemoryRouter>
      <AuthScreen auth={auth} locale={locale} onAuthed={onAuthed} {...extra} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('sign in', () => {
  it('shows the reason a request failed, in text', async () => {
    const signIn = vi.fn().mockRejectedValue(new Error('Incorrect email or password.'))
    renderScreen(makeAuth({ signIn }))
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Email'), 'salah@aidss.id')
    await user.type(screen.getByLabelText('Kata sandi'), 's3cret-pass')
    await user.click(screen.getByRole('button', { name: 'Masuk' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Incorrect email or password.')
  })

  it('calls onAuthed only after the request succeeds', async () => {
    const onAuthed = vi.fn()
    const signIn = vi.fn().mockRejectedValue(new Error('nope'))
    renderScreen(makeAuth({ signIn }), onAuthed)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Email'), 'a@b.id')
    await user.type(screen.getByLabelText('Kata sandi'), 's3cret-pass')
    await user.click(screen.getByRole('button', { name: 'Masuk' }))

    await screen.findByRole('alert')
    expect(onAuthed).not.toHaveBeenCalled()
  })

  it('is reachable and operable by keyboard alone', async () => {
    const signIn = vi.fn().mockResolvedValue(undefined)
    renderScreen(makeAuth({ signIn }))
    const user = userEvent.setup()

    // Tab order follows the visual order: email, password, submit.
    await user.tab()
    expect(screen.getByLabelText('Email')).toHaveFocus()
    await user.keyboard('a@b.id')

    await user.tab()
    expect(screen.getByLabelText('Kata sandi')).toHaveFocus()
    await user.keyboard('s3cret-pass')

    // Enter inside a text field submits the form, so the button never has to be
    // aimed at.
    await user.keyboard('{Enter}')

    expect(signIn).toHaveBeenCalledWith('a@b.id', 's3cret-pass')
  })

  it('reaches the mode toggle by keyboard', async () => {
    renderScreen(makeAuth())
    const user = userEvent.setup()

    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()
    const toggle = screen.getByRole('button', { name: 'Buat akun' })
    expect(toggle).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Nama lengkap')).toBeInTheDocument()
  })
})

describe('create account', () => {
  async function switchToSignup(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Buat akun' }))
  }

  it('switches to the signup form and back', async () => {
    renderScreen(makeAuth())
    const user = userEvent.setup()

    await switchToSignup(user)
    expect(screen.getByLabelText('Nama lengkap')).toBeInTheDocument()
    expect(screen.queryByLabelText('Kata sandi')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(screen.getByRole('heading', { name: 'Masuk' })).toBeInTheDocument()
  })

  it('collects every field the backend requires', async () => {
    const signUp = vi.fn().mockResolvedValue(undefined)
    renderScreen(makeAuth({ signUp }))
    const user = userEvent.setup()
    await switchToSignup(user)

    await user.type(screen.getByLabelText('Nama lengkap'), 'Nama Seseorang')
    await user.type(screen.getByLabelText('Email'), 'baru@aidss.id')
    await user.type(screen.getByLabelText('Nomor WhatsApp'), '081234567890')
    await user.type(screen.getByLabelText('Kata sandi'), 's3cret-pass')
    await user.click(screen.getByRole('button', { name: 'Buat akun' }))

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        email: 'baru@aidss.id',
        full_name: 'Nama Seseorang',
        phone_number: '081234567890',
        password: 's3cret-pass',
      }),
    )
  })

  it('states the password rule before the person is rejected for it', async () => {
    renderScreen(makeAuth())
    await switchToSignup(userEvent.setup())
    expect(screen.getByText('Minimal 8 karakter.')).toBeInTheDocument()
  })

  it('says why the phone number is asked for', async () => {
    renderScreen(makeAuth())
    await switchToSignup(userEvent.setup())
    // A required field with no stated reason reads as data collection.
    expect(screen.getByText(/Dipakai untuk pemberitahuan/)).toBeInTheDocument()
  })

})

describe('what the screen refuses to claim', () => {
  it('says payment happens after sign in, not on this screen', () => {
    // Checkout lives inside the app (Settings Tab 2). This screen must not
    // claim payments are closed, and must not ask for money here either.
    renderScreen(makeAuth())
    expect(screen.getByText(/Pembayaran dibuka setelah masuk/)).toBeInTheDocument()
  })

  it('renders no emoji, and every image carries an accessible name', () => {
    renderScreen(makeAuth())
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    // Dulu larangannya total karena layar tidak punya img sama sekali; kini
    // logo resmi (dipilih pemilik 2026-10-26) hadir sebagai img dan tetap
    // wajib punya nama. Yang ditegakkan itu unlabeled-media, bukan larangan img.
    const imgs = screen.getAllByRole('img')
    for (const img of imgs) expect(img).toHaveAccessibleName()
  })

  it('never leaks the repo name: the product is AIDSS, named in DESIGN.md', () => {
    // The owner named the product (DESIGN.md, transcribed 2026-10-10), so the
    // gate now carries the wordmark. What must still never appear is the raw
    // repository name.
    renderScreen(makeAuth())
    expect(document.body.textContent).not.toMatch(/AI-InvestmentDecisionSupport/i)
  })
})

describe('busy state', () => {
  it('disables the submit button and says work is happening', async () => {
    let release: () => void = () => {}
    const signIn = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    renderScreen(makeAuth({ signIn }))
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Email'), 'a@b.id')
    await user.type(screen.getByLabelText('Kata sandi'), 's3cret-pass')
    await user.click(screen.getByRole('button', { name: 'Masuk' }))

    const busy = await screen.findByRole('button', { name: 'Memproses...' })
    expect(busy).toBeDisabled()
    release()
  })
})

describe('the price a visitor can read', () => {
  // The person deciding whether to subscribe is, by definition, not yet
  // subscribed — the price stays readable without an account, one link away.
  it('stays silent when no pricing surface is wired', () => {
    renderScreen(makeAuth())
    expect(screen.queryByText(/Lihat harga/)).not.toBeInTheDocument()
  })

  it('sends a deciding visitor to the price', async () => {
    const onViewPricing = vi.fn()
    render(
      <MemoryRouter>
        <AuthScreen
          auth={makeAuth()}
          locale={locale}
          onAuthed={vi.fn()}
          onViewPricing={onViewPricing}
        />
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Lihat harga' }))
    expect(onViewPricing).toHaveBeenCalledOnce()
  })
})

describe('the plan the visitor picked on the price sheet', () => {
  const pill = (name: string) => screen.getByRole('button', { name })

  it('stays out of the sign-in form and opens choiceless on the sign-up side', async () => {
    renderScreen(makeAuth())
    expect(screen.queryByText('Paket')).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Buat akun' }))
    expect(await screen.findByText('Paket belum dipilih')).toBeInTheDocument()
    expect(pill('Bulanan').getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem('aidss-plan-intent')).toBeNull()
  })

  it('reads the carried plan into the form, and into storage', () => {
    // A shared link to /daftar?plan=monthly lands without the sheet's click;
    // the effect persists the same intent the click would have written.
    renderScreen(makeAuth(), undefined, { initialMode: 'signup', initialPlan: 'monthly' })
    expect(screen.getByText('Paket terpilih: Bulanan')).toBeInTheDocument()
    expect(pill('Bulanan').getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('aidss-plan-intent')).toBe('monthly')
  })

  it('surfaces a stored intent on signup without a URL parameter', () => {
    localStorage.setItem('aidss-plan-intent', 'weekly')
    renderScreen(makeAuth(), undefined, { initialMode: 'signup' })
    expect(screen.getByText('Paket terpilih: Mingguan')).toBeInTheDocument()
  })

  it('rewrites storage when the person changes the plan, and clears it on kosongkan', async () => {
    renderScreen(makeAuth(), undefined, { initialMode: 'signup', initialPlan: 'monthly' })
    const user = userEvent.setup()

    await user.click(pill('Tahunan'))
    expect(screen.getByText('Paket terpilih: Tahunan')).toBeInTheDocument()
    expect(localStorage.getItem('aidss-plan-intent')).toBe('annual')

    await user.click(screen.getByRole('button', { name: 'kosongkan' }))
    expect(screen.getByText('Paket belum dipilih')).toBeInTheDocument()
    expect(localStorage.getItem('aidss-plan-intent')).toBeNull()
  })

  it('never reads the intent on the sign-in side', () => {
    localStorage.setItem('aidss-plan-intent', 'weekly')
    renderScreen(makeAuth())
    expect(screen.queryByText('Paket terpilih')).not.toBeInTheDocument()
    // Not consumed either: the intent stays put for the signup that follows.
    expect(localStorage.getItem('aidss-plan-intent')).toBe('weekly')
  })
})