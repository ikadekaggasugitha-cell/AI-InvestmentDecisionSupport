import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppProvider } from '@/app/context/AppContext'
import { apiFetch } from '@/app/config/api'
import { SuspensionScreen } from '@/app/features/identity/SuspensionScreen'

const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

/* The billing pane this screen reuses reads four endpoints and writes one. The
 * transport is mocked at the same seam SettingsView's tests use, so the screen
 * is exercised with the same wiring it has in the real app — including the
 * claim that a suspended caller can still read price/history/destinations. */
const priceState = {
  body: {
    weekly: 15000,
    monthly: 44000,
    annual: 252000,
    updatedAt: '2026-10-01T09:30:00+00:00',
  } as unknown,
  status: 200,
  throws: false,
}
const subState = {
  body: { active: false, expiresAt: null, daysRemaining: null, startDate: null } as unknown,
  status: 200,
  throws: false,
}
const payState = { rows: [] as unknown[], status: 200, throws: false }
const banksState = {
  accounts: [{ bank: 'BCA', accountNumber: '999000111', holderName: 'Pemilik' }] as Array<{
    bank: string
    accountNumber: string
    holderName: string
  }>,
  status: 200,
  throws: false,
}
const declared: unknown[] = []
const declareState = { accepted: true } as { accepted: boolean }

vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  ENDPOINTS: {
    subscription: '/v1/subscription/current',
    pricing: '/v1/subscriptions/pricing',
    authMe: '/v1/auth/me',
    payments: '/v1/payments/me',
    paymentsDeclare: '/v1/payments/manual',
    bankAccounts: '/v1/subscriptions/bank-accounts',
  },
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/v1/subscriptions/pricing')) {
      if (priceState.throws) throw new Error('offline')
      return {
        ok: priceState.status < 400,
        status: priceState.status,
        json: async () => priceState.body,
      } as unknown as Response
    }
    if (url.includes('/v1/subscription/current')) {
      if (subState.throws) throw new Error('offline')
      return {
        ok: subState.status < 400,
        status: subState.status,
        json: async () => subState.body,
      } as unknown as Response
    }
    if (url.includes('/v1/payments/me')) {
      if (payState.throws) throw new Error('offline')
      return {
        ok: payState.status < 400,
        status: payState.status,
        json: async () => payState.rows,
      } as unknown as Response
    }
    if (url.includes('/v1/subscriptions/bank-accounts')) {
      if (banksState.throws) throw new Error('offline')
      return {
        ok: banksState.status < 400,
        status: banksState.status,
        json: async () => ({ accounts: banksState.accounts }),
      } as unknown as Response
    }
    if (url.includes('/v1/payments/manual')) {
      if (!declareState.accepted)
        return {
          ok: false,
          status: 400,
          json: async () => ({ detail: 'no' }),
        } as unknown as Response
      declared.push(JSON.parse(String(init?.body ?? '{}')))
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    }
    throw new Error(`unexpected fetch ${url}`)
  }),
}))

function renderScreen(reason: 'admin' | 'subscription_expired', onRefresh?: () => Promise<void>) {
  const refresh = onRefresh ?? vi.fn(() => Promise.resolve())
  render(
    // The lapsed screen carries the billing pane, and that pane links to
    // `/bayar` — so it needs the Router a real app would give it.
    <MemoryRouter>
      <AppProvider>
        <SuspensionScreen reason={reason} onRefresh={refresh} />
      </AppProvider>
    </MemoryRouter>,
  )
  return refresh
}

describe('the suspension screen', () => {
  beforeEach(() => {
    // The transport mock is shared across tests in the file; the "never asked
    // for a price" test only counts what ITS test asked for.
    ;(apiFetchMock as ReturnType<typeof vi.fn>).mockClear()
    declared.length = 0
    priceState.status = 200
    priceState.throws = false
    subState.status = 200
    subState.throws = false
    payState.status = 200
    payState.throws = false
    banksState.status = 200
    banksState.throws = false
    declareState.accepted = true
  })

  describe('reason subscription_expired', () => {
    it('says the period has ended, not that nobody signed in', async () => {
      renderScreen('subscription_expired')
      expect(await screen.findByText('Langganan berakhir')).toBeTruthy()
      expect(await screen.findByText(/Masa aktif langganan Anda sudah lewat/)).toBeTruthy()
    })

    it('prices the plan from the server, not from a constant', async () => {
      renderScreen('subscription_expired')
      expect(await screen.findByText('Rp 15.000')).toBeTruthy()
    })

    it('opens a door to the payment screen rather than running its own form', async () => {
      /* The lapsed account is exactly the person `/bayar` is for, so the screen
         that replaces the app must reach it. The declaration form itself moved:
         two forms writing one fact is the defect, and its assertions now live in
         `src/app/features/payment/PayView.test.tsx`. */
      const user = userEvent.setup()
      renderScreen('subscription_expired')

      await user.click(await screen.findByRole('button', { name: /^Bayar$/ }))

      expect(declared).toHaveLength(0)
      expect(screen.queryByText(/Isi pembayaran transfer manual/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Rekening tujuan/)).not.toBeInTheDocument()
    })

    it('the status check is a real round trip to /v1/auth/me', async () => {
      const user = userEvent.setup()
      const refresh = renderScreen('subscription_expired')
      const button = await screen.findByRole('button', {
        name: 'Periksa apakah akses sudah dibuka',
      })
      expect(refresh).not.toHaveBeenCalled()
      await user.click(button)
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    })
  })

  describe('reason admin', () => {
    it('says who closed the account', async () => {
      renderScreen('admin')
      expect(await screen.findByText('Akun dinonaktifkan')).toBeTruthy()
      expect(await screen.findByText(/ditutup oleh administrator/)).toBeTruthy()
    })

    it('offers no payment path at all', async () => {
      renderScreen('admin')
      await screen.findByText('Akun dinonaktifkan')
      // The billing pane never mounts, so no price and no declaration control.
      expect(screen.queryByText('Isi pembayaran transfer manual')).toBeNull()
      expect(screen.queryByText('Rp 15.000')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Saya sudah transfer' })).toBeNull()
    })

    it('the price endpoint is never asked', async () => {
      renderScreen('admin')
      await screen.findByText('Akun dinonaktifkan')
      const asked = apiFetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes('/v1/subscriptions/pricing'))
      expect(asked).toEqual([])
    })
  })
})
