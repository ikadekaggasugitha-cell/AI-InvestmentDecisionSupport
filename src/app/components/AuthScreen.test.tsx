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

function renderScreen(auth: AuthState, onAuthed = vi.fn()) {
  return render(
    <MemoryRouter>
      <AuthScreen auth={auth} locale={locale} onAuthed={onAuthed} />
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
  it('says payment is not open, because it is not', () => {
    // The backend has no payment path at all. A page that implied otherwise
    // would be promising something the product cannot do.
    renderScreen(makeAuth())
    expect(screen.getByText(/Beta gratis/)).toBeInTheDocument()
  })

  it('renders no emoji and no icon-only control', () => {
    renderScreen(makeAuth())
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('names the product nowhere, because the name is still undecided', () => {
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