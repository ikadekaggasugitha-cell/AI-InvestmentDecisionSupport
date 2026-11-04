/**
 * `/bayar` — the one screen where a payer chooses how to pay.
 *
 * The behaviour tested here moved out of Settings, where two forms wrote the same
 * fact and neither asked which account the money went to. Nothing is deleted on
 * the way: every assertion the old billing cards carried is here, plus the ones
 * the new questions need.
 *
 * Four things this screen can get wrong, in the order they would hurt:
 *
 *  - **Offer a method the operator did not allow.** The channel list comes from
 *    the server, and the pick is sent as our key. A list baked into the bundle
 *    would be a second answer, and the wrong one would sit in a file nobody
 *    reads.
 *  - **Send a gateway code from the browser.** Not tested here because it is not
 *    possible: the public endpoint does not carry them, and the checkout body
 *    only ever holds `plan` and `channel`. The `enabled_payments` half is the
 *    gateway test's job.
 *  - **Quote a price the server did not set.** No request this screen makes has an
 *    amount in it.
 *  - **Leave a state unnamed.** No destinations, an unreadable price, online
 *    payment switched off, and a gateway that never got configured are four
 *    different sentences; an empty box is not one of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PayView } from '@/app/features/payment/PayView'

const priceState = {
  body: { weekly: 15000, monthly: 44000, annual: 252000 } as unknown,
  status: 200,
  throws: false,
}
const channelState = {
  restricted: true,
  channels: [{ key: 'qris', label: 'QRIS' }] as { key: string; label: string }[],
  status: 200,
}
const bankState = {
  accounts: [{ bank: 'BNI', accountNumber: '9876543210', holderName: 'PT AIDSS JAYA' }] as {
    bank: string
    accountNumber: string
    holderName: string
  }[],
  status: 200,
}
const historyState = { rows: [] as unknown[], throws: false }
const gateState = {
  status: 200,
  body: { redirectUrl: 'https://pay.example.test/snap/v2/vt/INV-GW-01' } as unknown,
  throws: false,
}
const declareState = { status: 200, throws: false }

const checkouts: unknown[] = []
const declared: unknown[] = []

vi.mock('@/app/config/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config/api')>()),
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const send = (status: number, body: unknown) =>
      ({ ok: status < 400, status, json: async () => body }) as unknown as Response

    if (url.includes('/v1/subscriptions/pricing')) {
      if (priceState.throws) throw new Error('offline')
      return send(priceState.status, priceState.body)
    }
    if (url.includes('/v1/subscriptions/payment-channels')) {
      return send(channelState.status, {
        restricted: channelState.restricted,
        channels: channelState.channels,
      })
    }
    if (url.includes('/v1/subscriptions/bank-accounts')) {
      return send(bankState.status, { accounts: bankState.accounts })
    }
    if (url.includes('/v1/payments/me')) {
      if (historyState.throws) throw new Error('offline')
      return send(200, historyState.rows)
    }
    if (url.includes('/v1/payments/checkout')) {
      if (gateState.throws) throw new Error('offline')
      checkouts.push(JSON.parse(String(init?.body ?? '{}')))
      return send(gateState.status, gateState.status < 400 ? gateState.body : {})
    }
    if (url.includes('/v1/payments/manual')) {
      if (declareState.throws) throw new Error('offline')
      declared.push(JSON.parse(String(init?.body ?? '{}')))
      return send(
        declareState.status,
        declareState.status < 400
          ? { id: 'tx-1', invoiceCode: 'INV-1', amount: 44000 }
          : { detail: 'refused' },
      )
    }
    return send(200, {})
  }),
}))

function renderPay(props: Partial<Parameters<typeof PayView>[0]> = {}) {
  return render(
    <PayView
      locale="id"
      initialPlan={null}
      onBack={() => {}}
      onOpenBilling={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  priceState.body = { weekly: 15000, monthly: 44000, annual: 252000 }
  priceState.status = 200
  priceState.throws = false
  channelState.restricted = true
  channelState.channels = [{ key: 'qris', label: 'QRIS' }]
  channelState.status = 200
  bankState.accounts = [{ bank: 'BNI', accountNumber: '9876543210', holderName: 'PT AIDSS JAYA' }]
  bankState.status = 200
  historyState.rows = []
  historyState.throws = false
  gateState.status = 200
  gateState.throws = false
  gateState.body = { redirectUrl: 'https://pay.example.test/snap/v2/vt/INV-GW-01' }
  declareState.status = 200
  declareState.throws = false
  checkouts.length = 0
  declared.length = 0
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

describe('membaca pilihan dari server', () => {
  it('menampilkan kanal yang server izinkan, bukan daftar dari bundle', async () => {
    channelState.channels = [
      { key: 'qris', label: 'QRIS' },
      { key: 'va_mandiri', label: 'Virtual Account Mandiri' },
    ]
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Bayar online/i }))
    const methods = screen.getByRole('radiogroup', { name: 'Metode online' })
    expect(
      within(methods).getByRole('radio', { name: /Virtual Account Mandiri/i }),
    ).toBeInTheDocument()
    expect(within(methods).getByRole('radio', { name: /QRIS/i })).toBeInTheDocument()
  })

  it('tidak menawarkan kanal yang server matikan', async () => {
    /* `restricted: true` with an empty list is the operator's own "no online
       payment", and it reads as that rather than as a list that lost its contents
       or a server that would not answer. */
    channelState.channels = []
    renderPay()

    const online = await screen.findByRole('radio', { name: /Bayar online/i })
    expect(online).toBeDisabled()
    expect(online).toHaveTextContent(/Pembayaran online sedang dimatikan/i)
    expect(screen.queryByRole('radiogroup', { name: 'Metode online' })).not.toBeInTheDocument()
  })

  it('menyebut bahwa gateway yang memutuskan bila belum ada daftar tersimpan', async () => {
    /* `restricted: false` is not "nothing is enabled". Rendering it as an empty
       picker would tell a payer they had no online option on an install whose
       gateway is offering several. */
    channelState.restricted = false
    channelState.channels = []
    renderPay()

    // The online path stays available, with one unrestricted action.
    const online = await screen.findByRole('radio', { name: /Bayar online/i })
    expect(online).toBeEnabled()
    await userEvent.click(online)
    expect(await screen.findByText(/sisi gateway, bukan daftar di layar ini/i)).toBeInTheDocument()
  })

  it('menyebut metode yang benar-benar ada, bukan daftar yang mungkin mati', async () => {
    /* The path card used to say "Kartu, QRIS, atau e-wallet" unconditionally. On
       an install where credit_card is switched off, a payer who read "kartu" and
       found no card option had been told the screen was broken. The sentence is
       built from the server's labels now. */
    channelState.channels = [
      { key: 'qris', label: 'QRIS' },
      { key: 'gopay', label: 'GoPay' },
    ]
    renderPay()

    const online = await screen.findByRole('radio', { name: /Bayar online/i })
    expect(online).toHaveTextContent('QRIS, GoPay')
    expect(online).not.toHaveTextContent(/karti/i)
  })

  it('harga dibaca dari server dan tidak ada yang bisa diubah di body', async () => {
    renderPay()
    expect(await screen.findByText('Rp 44.000')).toBeInTheDocument()
    expect(screen.getByText('Rp 15.000')).toBeInTheDocument()
    expect(screen.getByText('Rp 252.000')).toBeInTheDocument()
  })

  it('harga yang tidak terbaca tidak pernah ditampilkan sebagai nol', async () => {
    priceState.status = 503
    renderPay()

    expect(await screen.findByText(/tidak dapat dimuat/i)).toBeInTheDocument()
    expect(screen.queryByText('Rp 0')).not.toBeInTheDocument()
  })
})

describe('bayar online', () => {
  it('mengirim kanal yang dipilih dan membuka halaman yang server buat', async () => {
    channelState.channels = [
      { key: 'qris', label: 'QRIS' },
      { key: 'va_bca', label: 'Virtual Account BCA' },
    ]
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Bayar online/i }))
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Metode online' })).getByRole('radio', {
        name: /Virtual Account BCA/i,
      }),
    )

    await waitFor(() => expect(checkouts).toHaveLength(1))
    expect(checkouts[0]).toEqual({ plan: 'monthly', channel: 'va_bca' })
    expect(window.open).toHaveBeenCalledWith(
      'https://pay.example.test/snap/v2/vt/INV-GW-01',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('nama kanal yang dikirim adalah kunci kita, bukan kode gateway', async () => {
    /* The body must not be able to carry `bca_va`. The public endpoint does not
       publish codes, and this asserts the screen never invents one either. */
    channelState.channels = [{ key: 'va_bca', label: 'Virtual Account BCA' }]
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Bayar online/i }))
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Metode online' })).getByRole('radio', {
        name: /Virtual Account BCA/i,
      }),
    )

    await waitFor(() => expect(checkouts).toHaveLength(1))
    expect(JSON.stringify(checkouts[0])).not.toContain('bca_va"')
    expect((checkouts[0] as { channel: string }).channel).toBe('va_bca')
  })

  it('tanpa pilihan kanal, yang membatasi adalah daftar server', async () => {
    channelState.restricted = false
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Bayar online/i }))
    await user.click(screen.getByRole('button', { name: /Buka halaman bayar/i }))

    await waitFor(() => expect(checkouts).toHaveLength(1))
    expect(checkouts[0]).toEqual({ plan: 'monthly' })
  })

  it('masa akses yang dipilih ikut ke permintaan checkout', async () => {
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Tahunan/i }))
    await user.click(screen.getByRole('radio', { name: /Bayar online/i }))
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Metode online' })).getByRole('radio', {
        name: /^QRIS$/,
      }),
    )

    await waitFor(() => expect(checkouts).toHaveLength(1))
    expect(checkouts[0]).toEqual({ plan: 'annual', channel: 'qris' })
  })

  it('gateway yang belum terpasang dijawab dengan kalimat, bukan jendela kosong', async () => {
    gateState.status = 503
    gateState.body = {}
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Bayar online/i }))
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Metode online' })).getByRole('radio', {
        name: /^QRIS$/,
      }),
    )

    expect(
      await screen.findByText(/Pembayaran online belum aktif di server ini/i),
    ).toBeInTheDocument()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('server yang menjawab tanpa halaman disebut, bukan didiamkan', async () => {
    gateState.body = {}
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Bayar online/i }))
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Metode online' })).getByRole('radio', {
        name: /^QRIS$/,
      }),
    )

    expect(await screen.findByText(/tanpa halaman bayar/i)).toBeInTheDocument()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('kanal yang tidak terbaca dari server tidak pura-pura kosong', async () => {
    channelState.status = 503
    renderPay()

    const online = await screen.findByRole('radio', { name: /Bayar online/i })
    expect(online).toBeDisabled()
    expect(online).toHaveTextContent(/tidak dapat dibaca dari server/i)
    expect(screen.queryByRole('button', { name: /Buka halaman bayar/i })).not.toBeInTheDocument()
  })
})

describe('transfer langsung', () => {
  it('rekening yang dibaca dari server, dengan nomor dan nama di samping pilihannya', async () => {
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Transfer langsung/i }))
    const choice = await screen.findByRole('radio', { name: /BNI/i })
    expect(choice).toHaveTextContent('9876543210')
    expect(choice).toHaveTextContent('PT AIDSS JAYA')
  })

  it('menyatakan transfer ke rekening yang dipilih', async () => {
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Transfer langsung/i }))
    await user.click(screen.getByRole('radio', { name: /BNI/i }))
    await user.type(screen.getByLabelText(/Catatan untuk yang memeriksa/i), '08/11 via m-banking')
    await user.click(screen.getByRole('button', { name: /Nyatakan transfer/i }))

    await waitFor(() => expect(declared).toHaveLength(1))
    expect(declared[0]).toEqual({
      plan: 'monthly',
      payment_method: 'bank_transfer',
      note: '08/11 via m-banking',
      destination_account: '9876543210',
    })
    expect(await screen.findByText(/Transfer dinyatakan ke rekening ini/i)).toBeInTheDocument()
  })

  it('nominal yang harus dikirim adalah harga server, dan tidak pernah ditanyakan', async () => {
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Transfer langsung/i }))
    await user.click(screen.getByRole('radio', { name: /BNI/i }))

    expect(await screen.findByText(/Nominal yang harus dikirim/i)).toBeInTheDocument()
    const step = screen.getByRole('region', { name: /Pilih rekening, kirim, lalu nyatakan/i })
    expect(within(step).getByText('Rp 44.000')).toBeInTheDocument()
    // There is no field for it anywhere on the screen.
    expect(screen.queryByLabelText(/nominal|jumlah/i)).not.toBeInTheDocument()
  })

  it('tanpa memilih rekening, deklarasi tidak terkirim', async () => {
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Transfer langsung/i }))
    const submit = await screen.findByRole('button', { name: /Nyatakan transfer/i })
    expect(submit).toBeDisabled()

    await user.click(submit).catch(() => {})
    expect(declared).toHaveLength(0)
  })

  it('deklarasi yang ditolak server dikatakan, dan tidak mengaku tersimpan', async () => {
    declareState.status = 422
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Transfer langsung/i }))
    await user.click(screen.getByRole('radio', { name: /BNI/i }))
    await user.click(screen.getByRole('button', { name: /Nyatakan transfer/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/ditolak/i)
    expect(screen.queryByText(/Transfer dinyatakan/i)).not.toBeInTheDocument()
  })

  it('server yang tak terjangkau tidak membuat payer mengira transfernya tercatat', async () => {
    declareState.throws = true
    const user = userEvent.setup()
    renderPay()

    await user.click(await screen.findByRole('radio', { name: /Transfer langsung/i }))
    await user.click(screen.getByRole('radio', { name: /BNI/i }))
    await user.click(screen.getByRole('button', { name: /Nyatakan transfer/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak terjangkau/i)
    expect(screen.queryByText(/Transfer dinyatakan/i)).not.toBeInTheDocument()
  })

  it('jalur transfer tidak tersedia saat admin belum menampilkan rekening', async () => {
    bankState.accounts = []
    renderPay()

    const transfer = await screen.findByRole('radio', { name: /Transfer langsung/i })
    expect(transfer).toBeDisabled()
    expect(
      screen.getByText(/Belum ada rekening tujuan yang ditampilkan admin/i),
    ).toBeInTheDocument()
  })

  it('rekening yang tidak terbaca tidak menampilkan angka untuk ditiru', async () => {
    bankState.status = 503
    renderPay()

    const transfer = await screen.findByRole('radio', { name: /Transfer langsung/i })
    expect(transfer).toBeDisabled()
    expect(transfer).toHaveTextContent(/tidak dapat dibaca dari server/i)
    expect(screen.queryByRole('button', { name: /Nyatakan transfer/i })).not.toBeInTheDocument()
  })
})

describe('halaman ini tanpa merek gateway', () => {
  it('tidak menyebut nama pemrosesnya', async () => {
    const { container } = renderPay()
    await screen.findByRole('radio', { name: /Bayar online/i })
    expect(container.textContent).not.toMatch(/midtrans/i)
  })

  it('bahasa Inggrisnya memakai kata yang sama, tanpa merek', async () => {
    const { container } = renderPay({ locale: 'en' })
    await screen.findByRole('radio', { name: /Pay online/i })
    expect(container.textContent).toContain('Direct transfer')
    expect(container.textContent).not.toMatch(/midtrans/i)
  })
})
