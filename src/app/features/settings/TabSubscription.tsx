import { useEffect, useState } from 'react'
import { ENDPOINTS, apiFetch } from '@/app/config/api'
import { usePayments } from '@/app/features/settings/usePayments'
import { readPlanIntent, writePlanIntent } from '@/app/planIntent'
import { PAYMENT_METHODS } from '@/app/features/settings/constants'
import { Panel, Unavailable } from '@/app/features/settings/tabPrimitives'

/* Exported because the suspension screen reuses it: a lapsed account reaches
   this same billing pane on its own screen, where every endpoint it reads —
   status, price, bank accounts, payment history — is one the access gate still
   answers (backend/api/main.py keeps the payment router ungated). Rendering a
   second copy of the form there would be two places claiming to bill. */

export function TabSubscription({ id }: { id: boolean }) {
  /* Read from the server, three states kept apart:
   *
   *   - `active`   — there is a subscription, with a date and a day count
   *   - loaded     — the server answered, and the answer was "none"
   *   - error      — we could not ask
   *
   * The last two look identical if you only carry a boolean, and they mean opposite
   * things: telling someone with an active subscription that they have none is a
   * different mistake from showing them an empty page. There is no fourth state with
   * a plan name, a price or an invoice, because none of those are recorded anywhere
   * and inventing them is what this tab used to be careful not to do.
   */
  const [state, setState] = useState<{
    loading: boolean
    error: string | null
    subscription: {
      active: boolean
      expiresAt: string | null
      daysRemaining: number | null
    } | null
  }>({ loading: true, error: null, subscription: null })

  /* The price, read separately from the status because they answer different
     questions and can fail independently: an account with no subscription can
     still read what one costs, and a working status endpoint says nothing about
     whether this install has a price configured. */
  const [price, setPrice] = useState<{
    loading: boolean
    error: string | null
    weekly: number | null
    monthly: number | null
    annual: number | null
  }>({ loading: true, error: null, weekly: null, monthly: null, annual: null })

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const res = await apiFetch(ENDPOINTS.subscription, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setState({ loading: false, error: null, subscription: await res.json() })
      } catch {
        if (controller.signal.aborted) return
        setState({ loading: false, error: 'unknown', subscription: null })
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const res = await apiFetch(ENDPOINTS.pricing, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { weekly: number; monthly: number; annual: number }
        setPrice({
          loading: false,
          error: null,
          weekly: body.weekly,
          monthly: body.monthly,
          annual: body.annual,
        })
      } catch {
        // Left as `unknown` rather than zero. A price of zero is a number nobody
        // set, and printing "Rp 0" here would be quoting for free.
        if (controller.signal.aborted) return
        setPrice({
          loading: false,
          error: 'unknown',
          weekly: null,
          monthly: null,
          annual: null,
        })
      }
    })()
    return () => controller.abort()
  }, [])

  /* The bank accounts, read the way the price is: from the server, per mount,
     because the destination is the one fact a transfer depends on and a cached
     copy of it would be a previous account's answer. */
  const [banks, setBanks] = useState<{
    loading: boolean
    error: string | null
    accounts: { bank: string; accountNumber: string; holderName: string }[]
  }>({ loading: true, error: null, accounts: [] })

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const res = await apiFetch(ENDPOINTS.bankAccounts, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as {
          accounts: { bank: string; accountNumber: string; holderName: string }[]
        }
        if (controller.signal.aborted) return
        setBanks({ loading: false, error: null, accounts: body.accounts ?? [] })
      } catch {
        if (controller.signal.aborted) return
        setBanks({ loading: false, error: 'unknown', accounts: [] })
      }
    })()
    return () => controller.abort()
  }, [])

  /* The account's own attempts to pay: the waiting money and the refusals. */
  const payments = usePayments()

  /* The declaration defaults are mild on purpose: the server still prices the
     plan, so no default here can cost anyone the wrong amount. The only seed
     allowed to preselect is the plan intent the visitor themselves put in:
     picked on the price sheet, carried through signup, cleared on use. */
  const [plan, setPlan] = useState<'weekly' | 'monthly' | 'annual'>(
    () => readPlanIntent() ?? 'monthly',
  )
  const [method, setMethod] = useState('bank_transfer')
  const [note, setNote] = useState('')
  /* The gateway's own plan choice, deliberate and separate: the two cards
     should never flip each other's state from underneath the reader. */
  const [gatewayPlan, setGatewayPlan] = useState<'weekly' | 'monthly' | 'annual'>(
    () => readPlanIntent() ?? 'monthly',
  )

  const emptyBody = state.error
    ? id
      ? 'Status langganan tidak dapat dimuat. Itu tidak berarti langganan Anda habis.'
      : 'Subscription status could not be loaded. That does not mean your subscription has ended.'
    : id
      ? 'Transfer ke salah satu rekening di atas, nyatakan transfernya di formulir, dan akses menyala setelah pembayaran diperiksa admin.'
      : 'Transfer to one of the accounts above, declare it with the form, and access starts once the payment has been reviewed.'

  const active = state.subscription?.active === true
  const expiry =
    active && state.subscription?.expiresAt ? new Date(state.subscription.expiresAt) : null
  const days = state.subscription?.daysRemaining ?? null

  const fmt = id ? 'id-ID' : 'en-GB'
  const waiting = (payments.rows ?? []).filter(
    (r) => r.status === 'pending' || r.status === 'expire',
  )
  const history = (payments.rows ?? []).filter(
    (r) => r.status !== 'pending' && r.status !== 'expire',
  )

  /** The server's status names, said in this tab's words — no renaming of
      facts, just the same fact with the words the account reads. */
  const statusLabel = (status: string) =>
    status === 'pending'
      ? id
        ? 'Menunggu pemeriksaan admin'
        : 'Awaiting review'
      : status === 'expire'
        ? id
          ? 'Kedaluwarsa antrian — masih bisa disetujui'
          : 'Aged out of the queue — still approvable'
        : status === 'deny'
          ? id
            ? 'Ditolak'
            : 'Refused'
          : status === 'settlement'
            ? id
              ? 'Disetujui'
              : 'Approved'
            : status

  const declare = async (e: React.FormEvent) => {
    e.preventDefault()
    const outcome = await payments.declare({
      plan,
      payment_method: method,
      note: note.trim() || null,
    })
    if (outcome === 'ok') {
      setNote('')
      // The carried intent served its purpose: the choice here is now the
      // person's own word, not the price sheet's.
      writePlanIntent(null)
    }
  }

  /* The gateway's one ask: a page. By the time it opens, the pending row
     behind it is already in this tab's own history — the server wrote the
     row in the same request whose answer carried the URL. */
  const startCheckout = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await payments.checkout(gatewayPlan)
    if (result?.redirectUrl) {
      window.open(result.redirectUrl, '_blank', 'noopener,noreferrer')
      // Same clearing rule as the manual declaration: the row the server wrote
      // in this very request becomes the choice of record.
      writePlanIntent(null)
    }
  }

  return (
    <Panel title={id ? 'Langganan & Tagihan' : 'Subscription & Billing'}>
      {/* What it costs, whether or not there is one. Read from the server, never
          from a constant: an administrator can change it, and a build-time copy
          of the number would be a second source drifting from the first. */}
      {price.loading ? (
        <div className="setting-row" style={{ paddingBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            {id ? 'Memuat harga…' : 'Loading price…'}
          </span>
        </div>
      ) : price.error ? (
        <div className="setting-row" style={{ paddingBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            {id
              ? 'Harga tidak dapat dimuat. Tidak ditampilkan sebagai nol — nol bukan harga yang ditetapkan.'
              : 'The price could not be loaded. Not shown as zero — zero is not a price anyone set.'}
          </span>
        </div>
      ) : (
        <div className="setting-row" style={{ paddingBottom: 12, display: 'flex', gap: 24 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>
              {id ? 'Harga' : 'Price'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
              {id
                ? 'Mingguan, bulanan, dan tahunan, dari server.'
                : 'Weekly, monthly, and annual, from the server.'}
            </div>
          </div>
          {/* Three parallel prices, each carrying its plan name: a stack of
              bare numbers would make the reader guess which is which. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'right' }}>
            {(
              [
                ['weekly', id ? 'Mingguan' : 'Weekly'],
                ['monthly', id ? 'Bulanan' : 'Monthly'],
                ['annual', id ? 'Tahunan' : 'Annual'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 1 }}>
                  {label}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {`Rp ${price[key]?.toLocaleString(id ? 'id-ID' : 'en-GB')}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {active ? (
        <>
          <div
            className="setting-row"
            style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>
                {id ? 'Masa aktif' : 'Active period'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
                {id
                  ? 'Diturunkan dari tanggal berakhir subscription.'
                  : "Derived from the subscription's end date."}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div
                style={{ fontSize: 12, color: 'var(--foreground)', fontFamily: 'var(--font-mono)' }}
              >
                {expiry
                  ? expiry.toLocaleDateString(id ? 'id-ID' : 'en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                  : '—'}
              </div>
              {days !== null && (
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
                  {id ? `${days} hari tersisa` : `${days} days remaining`}
                </div>
              )}
            </div>
          </div>
        </>
      ) : state.loading ? (
        <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
          {id ? 'Memuat status…' : 'Loading status…'}
        </span>
      ) : (
        <>
          {waiting.length > 0 && (
            <div
              role="status"
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '14px 16px',
                background: 'var(--card)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                {id ? 'Transfer sedang diperiksa' : 'Transfer under review'}
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--muted-foreground)',
                  marginTop: 4,
                  marginBottom: 0,
                }}
              >
                {id
                  ? 'Akses datanya belum aktif sampai admin memeriksa pembayaran ini — tidak ada yang menyala otomatis dari baris ini.'
                  : 'Data access stays inactive until an administrator reviews this payment — nothing turns on by itself.'}
              </p>
              {waiting.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    fontSize: 12,
                    borderTop: '1px solid var(--border)',
                    paddingTop: 10,
                    marginTop: 10,
                  }}
                >
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>
                      {`Rp ${row.amount.toLocaleString(fmt)}`}
                    </div>
                    <div style={{ color: 'var(--muted-foreground)', fontSize: 11, marginTop: 2 }}>
                      {`${statusLabel(row.status)} · ${new Date(row.createdAt).toLocaleString(fmt)}`}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--muted-foreground)',
                      fontSize: 11,
                      textAlign: 'right',
                    }}
                  >
                    {row.invoiceCode}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* The declaration itself. The amount is never asked: the server
              prices the plan — a claim the payer could price is a checkout the
              payer would control. */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
              background: 'var(--card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                {id ? 'Isi pembayaran transfer manual' : 'Pay by manual transfer'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
                {id
                  ? 'Uang dikirim di luar aplikasi; di sini Anda menyatakan transfer. Admin mencocokkannya dengan mutasi, jadi tuliskan nomor dan nama pengirim.'
                  : "The money moves outside this app; here you declare that it moved. An administrator matches it to the statement, so leave the sender's number and name."}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>
                {id ? 'Rekening tujuan' : 'Destination account'}
              </div>
              {banks.loading ? (
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>
                  {id ? 'Memuat rekening…' : 'Loading accounts…'}
                </div>
              ) : banks.error ? (
                <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 4 }}>
                  {id
                    ? 'Rekening tidak dapat dimuat. Transfer tanpa rekening yang ditulis server tidak boleh ditebak.'
                    : "The accounts could not be loaded. Transferring without the server's account is a guess nobody should make."}
                </div>
              ) : banks.accounts.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>
                  {id
                    ? 'Belum ada rekening tujuan yang ditulis admin — tunggu sampai muncul di sini.'
                    : 'No destination account has been written yet — wait for one to appear here.'}
                </div>
              ) : (
                banks.accounts.map((b, i) => (
                  <div
                    key={`${b.bank}-${b.accountNumber}-${i}`}
                    style={{
                      fontSize: 12,
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-mono)',
                      marginTop: i === 0 ? 6 : 2,
                    }}
                  >
                    {`${b.bank} · ${b.accountNumber} · a.n ${b.holderName}`}
                  </div>
                ))
              )}
            </div>

            <form onSubmit={declare} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: 16 }}>
                <legend
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', padding: 0 }}
                >
                  {id ? 'Paket' : 'Plan'}
                </legend>
                {(
                  [
                    ['weekly', id ? 'Mingguan' : 'Weekly'],
                    ['monthly', id ? 'Bulanan' : 'Monthly'],
                    ['annual', id ? 'Tahunan' : 'Annual'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: 'var(--foreground)',
                      cursor: 'pointer',
                      minHeight: 32,
                    }}
                  >
                    <input
                      type="radio"
                      name="payment-plan"
                      checked={plan === value}
                      onChange={() => {
                        setPlan(value)
                        writePlanIntent(value)
                      }}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>

              <fieldset
                style={{
                  border: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <legend
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', padding: 0 }}
                >
                  {id ? 'Cara transfer' : 'Method'}
                </legend>
                {PAYMENT_METHODS.map((m) => (
                  <label
                    key={m.value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: 'var(--foreground)',
                      cursor: 'pointer',
                      minHeight: 32,
                    }}
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      checked={method === m.value}
                      onChange={() => setMethod(m.value)}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    {m.label}
                  </label>
                ))}
              </fieldset>

              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  id ? 'Nomor & nama pengirim (opsional)' : "Sender's number & name (optional)"
                }
                aria-label={
                  id ? 'Catatan untuk admin yang memeriksa' : 'Note for the reviewing administrator'
                }
                maxLength={500}
                style={{
                  fontSize: 13,
                  padding: '9px 12px',
                  minHeight: 36,
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--control-border)',
                  background: 'var(--input-background, #fff)',
                  color: 'var(--foreground)',
                  width: '100%',
                }}
              />

              {payments.declareError && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--warning)', margin: 0 }}>
                  {payments.declareError === 'unavailable'
                    ? id
                      ? 'Server tidak dapat mencatat transfer sekarang — harga belum terbaca. Tidak ada yang tersimpan; coba lagi nanti.'
                      : 'The server cannot record a transfer right now — the price is unreadable. Nothing was saved; try again later.'
                    : payments.declareError === 'network'
                      ? id
                        ? 'Server tidak terjangkau. Transfer belum tercatat.'
                        : 'The server is unreachable. The transfer was not recorded.'
                      : id
                        ? 'Permintaan ditolak server. Periksa isian lalu kirim ulang.'
                        : 'The request was refused. Check the fields and send again.'}
                </p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="submit"
                  disabled={payments.declaring}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '9px 16px',
                    minHeight: 32,
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--primary)',
                    color: 'var(--primary-foreground)',
                    background: 'var(--primary)',
                    cursor: payments.declaring ? 'default' : 'pointer',
                    opacity: payments.declaring ? 0.7 : 1,
                  }}
                >
                  {payments.declaring
                    ? id
                      ? 'Mengirim…'
                      : 'Sending…'
                    : id
                      ? 'Saya sudah transfer'
                      : "I've transferred"}
                </button>
                <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                  {id
                    ? 'Nominal yang dicatat adalah harga server untuk paket yang dipilih.'
                    : "The recorded amount is the server's price for the chosen plan."}
                </span>
              </div>
            </form>
          </div>

          {/* Midtrans' page, opened by redirect rather than embedded: the
              server minted it for an order the tab already lists below. The
              card stays below the manual form, and both stay listed when one
              of them is unavailable — an install without the gateway says so
              in sentence form instead of swallowing the option. */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
              background: 'var(--card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                {id ? 'Bayar lewat Midtrans' : 'Pay via Midtrans'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
                {id
                  ? 'Halaman pembayaran dibuka di tab baru — kartu, QRIS, atau e-wallet. Statusnya masuk ke daftar di bawah, dan akses menyala ketika pembayaran diterima.'
                  : 'The payment page opens in a new tab — card, QRIS, or e-wallet. Its status appears in the list below, and access starts when the payment has been received.'}
              </div>
            </div>

            <form
              onSubmit={startCheckout}
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: 16 }}>
                <legend
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', padding: 0 }}
                >
                  {id ? 'Paket' : 'Plan'}
                </legend>
                {(
                  [
                    ['weekly', id ? 'Mingguan' : 'Weekly'],
                    ['monthly', id ? 'Bulanan' : 'Monthly'],
                    ['annual', id ? 'Tahunan' : 'Annual'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      color: 'var(--foreground)',
                      cursor: 'pointer',
                      minHeight: 32,
                    }}
                  >
                    <input
                      type="radio"
                      name="gateway-plan"
                      checked={gatewayPlan === value}
                      onChange={() => {
                        setGatewayPlan(value)
                        writePlanIntent(value)
                      }}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="submit"
                  disabled={payments.checkoutBusy}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '9px 16px',
                    minHeight: 32,
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--primary)',
                    color: 'var(--primary-foreground)',
                    background: 'var(--primary)',
                    cursor: payments.checkoutBusy ? 'default' : 'pointer',
                    opacity: payments.checkoutBusy ? 0.7 : 1,
                  }}
                >
                  {payments.checkoutBusy
                    ? id
                      ? 'Menunggu halaman bayar…'
                      : 'Waiting for the payment page…'
                    : id
                      ? 'Buka halaman bayar Midtrans'
                      : 'Open the Midtrans payment page'}
                </button>
                <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                  {id
                    ? 'Nominal yang dicatat adalah harga server untuk paket yang dipilih.'
                    : "The recorded amount is the server's price for the chosen plan."}
                </span>
              </div>

              {payments.checkoutError && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--warning)', margin: 0 }}>
                  {payments.checkoutError === 'unavailable'
                    ? id
                      ? 'Pembayaran online belum aktif di server ini. Transfer manual di atas masih berlaku.'
                      : 'Online payment is not active on this server. The manual transfer above still works.'
                    : payments.checkoutError === 'network'
                      ? id
                        ? 'Server tidak terjangkau. Halaman pembayaran tidak dibuka.'
                        : 'The server is unreachable. The payment page was not opened.'
                      : id
                        ? 'Pembayaran online tidak dapat dibuka sekarang. Transfer manual di atas masih berlaku.'
                        : 'Online payment could not be opened right now. The manual transfer above still works.'}
                </p>
              )}
            </form>
          </div>

          {history.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>
                {id ? 'Riwayat pembayaran' : 'Payment history'}
              </div>
              {history.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    fontSize: 12,
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: 8,
                  }}
                >
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>
                      {`Rp ${row.amount.toLocaleString(fmt)}`}
                    </div>
                    <div
                      style={{
                        color: row.status === 'deny' ? 'var(--loss)' : 'var(--muted-foreground)',
                        fontSize: 11,
                        marginTop: 2,
                      }}
                    >
                      {`${statusLabel(row.status)} · ${new Date(row.createdAt).toLocaleString(fmt)}`}
                      {row.status === 'deny' && row.notes ? ` · ${row.notes}` : ''}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--muted-foreground)',
                      fontSize: 11,
                      textAlign: 'right',
                    }}
                  >
                    {row.invoiceCode}
                  </div>
                </div>
              ))}
            </div>
          )}

          {waiting.length === 0 && (
            <Unavailable
              id={id}
              title={
                state.error
                  ? id
                    ? 'Status tidak dapat dimuat'
                    : 'Status unavailable'
                  : id
                    ? 'Belum ada langganan'
                    : 'No subscription yet'
              }
              body={emptyBody}
            />
          )}
        </>
      )}

      {/* Nothing here promises instant access from a click (R-26). A declared
          transfer starts a human review; the gateway's checkout settles
          itself — through Midtrans' callback, not this tab's button. Either
          way it is money received that turns into access, written by `grant()`
          from the settlement or the admin's approval — never a third hand. */}
    </Panel>
  )
}
