/**
 * The billing tab's payment door, and what it no longer holds.
 *
 * This file used to drive the gateway card that sat inside Settings. That card
 * moved to `/bayar` — its assertions are alive in
 * `src/app/features/payment/PayView.test.tsx`, including the 503 sentence and the
 * "server answered without a page" case. What remains to test here is the reason
 * the card left:
 *
 *  - The tab hands payment to one screen rather than running its own two forms.
 *    Two controls writing the same fact are two places that can answer differently.
 *  - The tab keeps the record. A payer who has already declared a transfer must be
 *    able to see it, including the destination they named and any refusal.
 *  - Nothing about the gateway is decided here: no method list, no channel, no
 *    amount. The tab is a reader.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import { SettingsView } from '@/app/features/settings/SettingsView'
import { AppProvider } from '@/app/context/AppContext'
import { SIMULATED_FRESHNESS } from '@/app/features/market/useLiveMarket'
import type { ExchangeRateData } from '@/app/features/market/useExchangeRate'
import type { AuthState } from '@/app/features/identity/useAuth'

const priceState = {
  body: { weekly: 15000, monthly: 44000, annual: 252000 } as unknown,
  throws: false,
}
const payState = {
  rows: [] as unknown[],
  throws: false,
}
/** Where the app was asked to navigate, so the door can be pointed at. */
const navigated: string[] = []

vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes('/v1/subscriptions/pricing')) {
      if (priceState.throws) throw new Error('offline')
      return { ok: true, status: 200, json: async () => priceState.body } as unknown as Response
    }
    if (url.includes('/v1/subscription/current')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          active: false,
          expiresAt: null,
          daysRemaining: null,
          startDate: null,
        }),
      } as unknown as Response
    }
    if (url.includes('/v1/payments/me')) {
      if (payState.throws) throw new Error('offline')
      return { ok: true, status: 200, json: async () => payState.rows } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
  }),
}))

// The tab navigates rather than rendering a payment form, so the assertion that
// matters is where it asked to go.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => (path: string) => {
      navigated.push(path)
    },
  }
})

const TEST_ACCOUNT = {
  id: '3f2a6c11-0d5e-4a1b-9c77-1f0b2d3e4a55',
  email: 'pengguna@aidss.id',
  full_name: 'Nama Pengguna',
  phone_number: '081234567890',
  role: 'user' as const,
  blocked: false,
  blockedReason: null,
}

function auth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    status: 'signed-in',
    account: TEST_ACCOUNT,
    error: null,
    refresh: async () => {},
    signIn: async () => {},
    signUp: async () => {},
    signOut: async () => {},
    updateProfile: async () => {},
    ...overrides,
  }
}

function fx(): ExchangeRateData {
  return {
    usdIdr: 15420,
    change: -85,
    changePct: -0.551,
    isLive: true,
    showUsd: false,
    toggleCurrency: () => {},
  } as ExchangeRateData
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <AppProvider>
        <SettingsView
          fx={fx()}
          freshness={SIMULATED_FRESHNESS}
          auth={auth()}
          onSignedOut={() => {}}
        />
      </AppProvider>
    </MemoryRouter>,
  )
}

async function openBillingTab() {
  renderSettings()
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: /Langganan & Tagihan/ }))
  return { user }
}

const PENDING = {
  id: 'tx-1',
  invoiceCode: 'INV-20261101120000-ABC123',
  amount: 44000,
  plan: 'monthly',
  paymentGateway: 'manual',
  paymentMethod: 'bank_transfer',
  destination: 'BNI 9876543210 a.n. PT AIDSS JAYA',
  status: 'pending',
  notes: '08/11 14:20 via m-banking',
  createdAt: '2026-11-08T07:20:00+00:00',
  expiresAt: '2026-11-09T07:20:00+00:00',
}

beforeEach(() => {
  priceState.throws = false
  payState.rows = []
  payState.throws = false
  navigated.length = 0
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('pintu bayar di tab tagihan', () => {
  it('menunjuk satu layar, bukan menjalankan formularnya sendiri', async () => {
    const { user } = await openBillingTab()

    await user.click(await screen.findByRole('button', { name: /^Bayar$/ }))

    expect(navigated).toEqual(['/bayar'])
  })

  it('tidak menyimpan formulir pembayaran di dalam tab', async () => {
    /* Two forms writing one fact is the defect that moved. If a declaration control
       reappears here, the check that fails is this one, and the reason is in the
       sentence above rather than in a comment two files away. */
    await openBillingTab()
    await screen.findByText(/Pilih masa akses, lalu bayar online/i)

    expect(screen.queryByRole('button', { name: /Saya sudah transfer/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buka halaman bayar/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Catatan untuk/i)).not.toBeInTheDocument()
  })

  it('tidak punya daftar metode bayar sendiri', async () => {
    /* The tab used to render `PAYMENT_METHODS` from a constant in the bundle. That
       list is the server's answer now, so this asserts the source of the tab holds
       no channel keys of its own — the file is the thing that could drift back.
       The tab is opened first so the check sits beside the behaviour it protects. */
    await openBillingTab()
    await screen.findByText(/Pilih masa akses, lalu bayar online/i)

    const view = readFileSync(
      join(process.cwd(), 'src/app/features/settings/TabSubscription.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const key of ['va_bca', 'va_mandiri', 'bank_transfer', 'qris']) {
      expect(view).not.toContain(key)
    }
  })
})

describe('tab tetap memegang catatan pembayarannya', () => {
  it('menunjukkan transfer yang sedang diperiksa, lengkap dengan rekeningnya', async () => {
    payState.rows = [PENDING]
    await openBillingTab()

    const block = await screen.findByRole('status')
    expect(within(block).getByText('Transfer sedang diperiksa')).toBeInTheDocument()
    expect(within(block).getByText(/Rp 44.000/)).toBeInTheDocument()
    expect(within(block).getByText(/Menunggu pemeriksaan admin/)).toBeInTheDocument()
    // Access is not implied by a row existing.
    expect(within(block).getByText(/belum aktif sampai admin memeriksa/i)).toBeInTheDocument()
  })

  it('menyebut rekening yang diklaim payer saat transfer ditolak', async () => {
    payState.rows = [
      {
        ...PENDING,
        id: 'tx-2',
        status: 'deny',
        destination: 'BCA 1234567890 a.n. PT AIDSS',
        notes: 'Ditolak: nominal tidak cocok',
      },
    ]
    await openBillingTab()

    const history = await screen.findByText('Riwayat pembayaran')
    const row = history.parentElement as HTMLElement
    expect(within(row).getByText(/Ditolak/)).toBeInTheDocument()
    expect(within(row).getByText(/BCA 1234567890 a\.n\. PT AIDSS/)).toBeInTheDocument()
    expect(within(row).getByText(/nominal tidak cocok/)).toBeInTheDocument()
  })

  it('menyebut riwayat yang tidak terbaca, bukan diam-diam menampilkan daftar kosong', async () => {
    payState.throws = true
    await openBillingTab()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Riwayat pembayaran tidak dapat dimuat/i)
    // The claim an empty list would have made silently is refused out loud.
    expect(alert).toHaveTextContent(/bukan bukti bahwa belum ada pembayaran/i)
  })

  it('tetap menampilkan harga saat riwayat pembayaran tidak terbaca', async () => {
    /* The two reads answer different questions and fail independently. Losing the
       price because the history did would be one failure rendered as two. */
    payState.throws = true
    await openBillingTab()

    expect(await screen.findByText('Rp 44.000')).toBeInTheDocument()
    expect(screen.getByText(/Bayar langganan/i)).toBeInTheDocument()
  })
})
