import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'
import { readPlanIntent, writePlanIntent } from '@/app/planIntent'
import { usePaymentOptions } from '@/app/features/payment/usePaymentOptions'
import { usePayments } from '@/app/features/settings/usePayments'

/**
 * One place to choose how to pay.
 *
 * The screen exists because the two ways of paying used to be two forms in
 * Settings, both writing the same fact: a declaration with a method picked from a
 * list baked into the bundle, and a card that opened the gateway with no say in
 * what that gateway would offer. Neither asked which account the money went to.
 *
 * Three rules this screen keeps, in the order they can go wrong:
 *
 *  - **The price and both option lists come from the server, every time.** A plan
 *    name, an amount, a bank, or a payment method written into this bundle would
 *    be a second source, and the server is what quotes, publishes, and refuses.
 *    The body of a declaration has no amount field at all — a payer who can price
 *    their own payment is a payer who can pay less.
 *  - **Online payment offers what this install allows.** When the operator has
 *    chosen channels, they are listed and the pick is sent as our key. When nobody
 *    has chosen, the screen says the gateway decides and sends no channel, because
 *    showing a picker built from this code's registry would be presenting our list
 *    as the install's configuration.
 *  - **A transfer names where it went.** The payer picks one of the destinations
 *    the operator displays, and the number and holder are shown beside the choice
 *    before they commit, not after.
 *
 * Every state that is not a list is said out loud. No destinations, a price that
 * will not load, and online payment switched off are three different sentences
 * about three different things, and rendering any of them as an empty box leaves
 * the payer guessing about where their money would go.
 */

type Plan = 'weekly' | 'monthly' | 'annual'

const PLANS: { key: Plan; id: string; en: string }[] = [
  { key: 'weekly', id: 'Mingguan', en: 'Weekly' },
  { key: 'monthly', id: 'Bulanan', en: 'Monthly' },
  { key: 'annual', id: 'Tahunan', en: 'Annual' },
]

/** The price, in full. Not the chart's compact form: a payer transfers this
 *  number, so "Rp 44Rb" would be a price they have to expand in their head and a
 *  bank form they have to retype. `formatting.ts`'s `fmtIdr` exists for axes. */
function rupiah(n: number, id: boolean): string {
  return `Rp ${n.toLocaleString(id ? 'id-ID' : 'en-GB')}`
}

const CONTROL: React.CSSProperties = {
  border: '1px solid var(--control-border)',
  borderRadius: 'var(--radius)',
  background: 'transparent',
  color: 'var(--foreground)',
  cursor: 'pointer',
  textAlign: 'left',
}

export function PayView({
  locale,
  initialPlan,
  onBack,
  onOpenBilling,
}: {
  locale: 'id' | 'en'
  initialPlan: Plan | null
  onBack: () => void
  onOpenBilling: () => void
}) {
  const id = locale === 'id'
  const t = (idText: string, enText: string) => (id ? idText : enText)

  /* Two ways a plan arrives on this screen, and they are not the same claim:
     `?plan=` is in the URL someone opened or shared, and the stored intent is the
     line the visitor tapped on the price sheet on their way through signup. The
     URL wins because it is what the address bar says. */
  const [plan, setPlan] = useState<Plan>(() => initialPlan ?? readPlanIntent() ?? 'monthly')
  const [path, setPath] = useState<'online' | 'transfer' | null>(null)

  /* The price, read on every mount. An install can change it while this page is
     open, and quoting a stale number to someone about to pay is not a rounding
     error — it is a different transaction. */
  const [price, setPrice] = useState<{
    loading: boolean
    error: boolean
    weekly: number | null
    monthly: number | null
    annual: number | null
  }>({ loading: true, error: false, weekly: null, monthly: null, annual: null })

  const priceController = useRef<AbortController | null>(null)
  const loadPrice = useCallback(async () => {
    priceController.current?.abort()
    const controller = new AbortController()
    priceController.current = controller
    setPrice((current) => ({ ...current, loading: true, error: false }))
    try {
      const res = await apiFetch(ENDPOINTS.pricing, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as {
        weekly: number
        monthly: number
        annual: number
      }
      if (controller.signal.aborted) return
      setPrice({
        loading: false,
        error: false,
        weekly: body.weekly,
        monthly: body.monthly,
        annual: body.annual,
      })
    } catch {
      if (controller.signal.aborted) return
      // Left as null rather than zero. "Rp 0" is a price nobody set, and printing
      // it here would quote a real customer for free.
      setPrice({
        loading: false,
        error: true,
        weekly: null,
        monthly: null,
        annual: null,
      })
    }
  }, [])

  useEffect(() => {
    void loadPrice()
    return () => priceController.current?.abort()
  }, [loadPrice])

  const options = usePaymentOptions()
  const payments = usePayments()

  /* The destination picked from the server's list, by account number. Held as the
     number rather than the label so the value that goes to the server is the one
     the screen showed. */
  const [account, setAccount] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [opened, setOpened] = useState<string | null>(null)
  // The declaration's own outcome, held here rather than inferred from the
  // absence of an error. "Nothing went wrong yet" and "the transfer is recorded"
  // are different sentences and the screen must not print the second one for the
  // first reason.
  const [declared, setDeclared] = useState<string | null>(null)

  const transferPossible = options.accounts.accounts.length > 0
  const channelsUnreadable = options.channels.error
  // Restricted with nothing in the list is the operator's own "no online payment",
  // not a read that failed. It gets its own sentence because the fix is theirs to
  // make, and "could not be read" would send the payer somewhere else entirely.
  const onlineSwitchedOff = options.channels.restricted && options.channels.channels.length === 0
  const onlinePossible = !channelsUnreadable && !onlineSwitchedOff
  // What the online path promises has to be what the list below will actually
  // show. "Kartu, QRIS, atau e-wallet" would name instruments this install may
  // not have enabled — and a payer who reads "kartu" and finds no card option
  // has been told the screen is broken. The labels are the server's, so the
  // sentence is built from them.
  const onlineNames = options.channels.channels.map((c) => c.label).join(', ')

  const amount = price[plan]

  useEffect(() => {
    // The intent has done its job the moment the screen shows a plan of its own;
    // from here the choice belongs to the payer, not to the price sheet.
    writePlanIntent(null)
  }, [])

  const payOnline = async (channel: string | null) => {
    const result = await payments.checkout(plan, channel)
    if (result?.redirectUrl) {
      // Redirect, never embed: the page belongs to the gateway and no key of
      // theirs belongs in this browser.
      window.open(result.redirectUrl, '_blank', 'noopener,noreferrer')
      setOpened(result.redirectUrl)
    }
  }

  const declare = async (event: React.FormEvent) => {
    event.preventDefault()
    setDeclared(null)
    const outcome = await payments.declare({
      plan,
      payment_method: 'bank_transfer',
      note: note.trim() || null,
      destination_account: account,
    })
    if (outcome === 'ok') {
      setDeclared(account)
      setNote('')
    }
  }

  const statusMessage =
    payments.declareError === 'network'
      ? t(
          'Server tidak terjangkau. Transfer tidak tercatat.',
          'The server could not be reached. The transfer was not recorded.',
        )
      : payments.declareError === 'unavailable'
        ? t(
            'Harga server ini sedang tidak terbaca, jadi transfer belum bisa dinyatakan.',
            'This server cannot read its price, so a transfer cannot be declared yet.',
          )
        : payments.declareError
          ? t(
              `Permintaan ditolak (${payments.declareError}). Periksa rekening yang dipilih.`,
              `The request was refused (${payments.declareError}). Check the account you selected.`,
            )
          : null

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--background)',
        color: 'var(--foreground)',
        fontFamily: 'var(--font-sans)',
        padding: '24px 16px 64px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 620,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              ...CONTROL,
              fontSize: 12,
              padding: '6px 12px',
              minHeight: 32,
            }}
          >
            {t('Kembali', 'Back')}
          </button>
          <h1 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
            {t('Bayar langganan', 'Pay for your subscription')}
          </h1>
        </div>

        {/* ── 1. What is being bought ─────────────────────────────────────── */}
        <section
          aria-labelledby="pay-plan"
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <h2 id="pay-plan" style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            {t('1. Pilih masa akses', '1. Choose how long')}
          </h2>
          {price.loading ? (
            <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
              {t('Memuat harga…', 'Loading the price…')}
            </p>
          ) : price.error ? (
            <div
              role="alert"
              style={{ ...CONTROL, padding: '10px 12px', cursor: 'default', fontSize: 12 }}
            >
              {t(
                'Harga tidak dapat dimuat dari server. Angka tidak ditampilkan sebagai nol, karena nol bukan harga yang ditetapkan.',
                'The price could not be loaded from the server. It is not shown as zero, because zero is not a price anyone set.',
              )}
              <button
                type="button"
                onClick={() => void loadPrice()}
                style={{
                  ...CONTROL,
                  fontSize: 12,
                  padding: '5px 10px',
                  minHeight: 32,
                  marginTop: 8,
                  display: 'block',
                }}
              >
                {t('Coba lagi', 'Try again')}
              </button>
            </div>
          ) : (
            <div
              role="radiogroup"
              aria-label={t('Masa akses', 'Subscription length')}
              style={{ display: 'grid', gap: 8 }}
            >
              {PLANS.map((option) => {
                const value = price[option.key]
                const selected = plan === option.key
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPlan(option.key)}
                    style={{
                      ...CONTROL,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'baseline',
                      padding: '10px 12px',
                      fontSize: 13,
                      background: selected ? 'var(--muted)' : 'transparent',
                      borderColor: selected ? 'var(--primary)' : 'var(--control-border)',
                    }}
                  >
                    <span>{id ? option.id : option.en}</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {value === null ? t('tidak terbaca', 'unreadable') : rupiah(value, id)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* ── 2. How ─────────────────────────────────────────────────────── */}
        <section
          aria-labelledby="pay-path"
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <h2 id="pay-path" style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            {t('2. Pilih cara bayar', '2. Choose how to pay')}
          </h2>
          <div
            role="radiogroup"
            aria-label={t('Cara bayar', 'Payment method')}
            style={{ display: 'grid', gap: 8 }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={path === 'online'}
              disabled={!onlinePossible}
              onClick={() => setPath('online')}
              style={{
                ...CONTROL,
                padding: '10px 12px',
                fontSize: 13,
                minHeight: 44,
                opacity: onlinePossible ? 1 : 0.55,
                cursor: onlinePossible ? 'pointer' : 'not-allowed',
                background: path === 'online' ? 'var(--muted)' : 'transparent',
                borderColor: path === 'online' ? 'var(--primary)' : 'var(--control-border)',
              }}
            >
              <div style={{ fontWeight: 600 }}>{t('Bayar online', 'Pay online')}</div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--muted-foreground)',
                  marginTop: 3,
                  fontWeight: 400,
                }}
              >
                {channelsUnreadable
                  ? t(
                      'Metode bayar online tidak dapat dibaca dari server.',
                      'The online payment methods could not be read from the server.',
                    )
                  : options.channels.loading
                    ? t('Memuat metode…', 'Loading methods…')
                    : onlineSwitchedOff
                      ? t(
                          'Pembayaran online sedang dimatikan di instalasi ini. Transfer langsung tetap bisa dipakai.',
                          'Online payment is switched off on this install. Direct transfer still works.',
                        )
                      : onlineNames
                        ? t(
                            `Yang tersedia di instalasi ini: ${onlineNames}. Halaman bayar dibuka di tab baru.`,
                            `Available on this install: ${onlineNames}. The payment page opens in a new tab.`,
                          )
                        : t(
                            'Metode yang tersedia didaftar di bawah. Halaman bayar dibuka di tab baru.',
                            'The methods available are listed below. The payment page opens in a new tab.',
                          )}
              </div>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={path === 'transfer'}
              disabled={!transferPossible}
              onClick={() => setPath('transfer')}
              style={{
                ...CONTROL,
                padding: '10px 12px',
                fontSize: 13,
                minHeight: 44,
                opacity: transferPossible ? 1 : 0.55,
                cursor: transferPossible ? 'pointer' : 'not-allowed',
                background: path === 'transfer' ? 'var(--muted)' : 'transparent',
                borderColor: path === 'transfer' ? 'var(--primary)' : 'var(--control-border)',
              }}
            >
              <div style={{ fontWeight: 600 }}>{t('Transfer langsung', 'Direct transfer')}</div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--muted-foreground)',
                  marginTop: 3,
                  fontWeight: 400,
                }}
              >
                {options.accounts.error
                  ? t(
                      'Rekening tujuan tidak dapat dibaca dari server, jadi jangan kirim ke nomor apa pun.',
                      'The destination accounts could not be read from the server, so do not send to any number.',
                    )
                  : options.accounts.loading
                    ? t('Memuat rekening…', 'Loading accounts…')
                    : transferPossible
                      ? t(
                          `Kirim ke satu rekening, lalu nyatakan. ${options.accounts.accounts.length} rekening tersedia.`,
                          `Send to one account, then declare it. ${options.accounts.accounts.length} destinations available.`,
                        )
                      : t(
                          'Belum ada rekening tujuan yang ditampilkan admin, jadi jalur transfer belum bisa dipakai.',
                          'No destination account is displayed, so the transfer path cannot be used yet.',
                        )}
              </div>
            </button>
          </div>
        </section>

        {path === 'online' && (
          <OnlineStep
            id={id}
            channels={options.channels}
            busy={payments.checkoutBusy}
            error={payments.checkoutError}
            opened={opened}
            onPick={(channel) => void payOnline(channel)}
            onRetry={() => void options.reload()}
          />
        )}

        {path === 'transfer' && (
          <TransferStep
            id={id}
            accounts={options.accounts}
            account={account}
            onPickAccount={setAccount}
            note={note}
            onNote={setNote}
            onSubmit={(event) => void declare(event)}
            busy={payments.declaring}
            message={statusMessage}
            declared={declared !== null && declared === account}
            amount={amount}
            planLabel={
              id
                ? (PLANS.find((p) => p.key === plan)?.id ?? '')
                : (PLANS.find((p) => p.key === plan)?.en ?? '')
            }
          />
        )}

        <section
          aria-labelledby="pay-history"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          <h2 id="pay-history" style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            {t('Riwayat pembayaran', 'Payment history')}
          </h2>
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}>
            {t(
              'Transfer yang dinyatakan diperiksa admin sebelum akses menyala. Status dan alasannya dibaca di halaman Tagihan.',
              'A declared transfer is checked by an administrator before access starts. The status and any reason are on the Billing page.',
            )}
          </p>
          <button
            type="button"
            onClick={onOpenBilling}
            style={{
              ...CONTROL,
              fontSize: 12,
              padding: '7px 12px',
              minHeight: 32,
              alignSelf: 'flex-start',
            }}
          >
            {t('Buka riwayat tagihan', 'Open billing history')}
          </button>
        </section>
      </div>
    </div>
  )
}

function OnlineStep({
  id,
  channels,
  busy,
  error,
  opened,
  onPick,
  onRetry,
}: {
  id: boolean
  channels: ReturnType<typeof usePaymentOptions>['channels']
  busy: boolean
  error: string | null
  opened: string | null
  onPick: (channel: string | null) => void
  onRetry: () => void
}) {
  const t = (idText: string, enText: string) => (id ? idText : enText)

  return (
    <section
      aria-labelledby="pay-online"
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h3 id="pay-online" style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>
        {t('Metode online', 'Online methods')}
      </h3>

      {channels.error ? (
        <div
          role="alert"
          style={{ ...CONTROL, padding: '10px 12px', cursor: 'default', fontSize: 12 }}
        >
          {t(
            'Daftar metode bayar tidak dapat dibaca dari server.',
            'The payment methods could not be read from the server.',
          )}
          <button
            type="button"
            onClick={onRetry}
            style={{
              ...CONTROL,
              fontSize: 12,
              padding: '5px 10px',
              minHeight: 32,
              marginTop: 8,
              display: 'block',
            }}
          >
            {t('Coba lagi', 'Try again')}
          </button>
        </div>
      ) : !channels.restricted ? (
        /* Nobody configured a list on this install, so its gateway decides what the
           page offers. Said plainly, because naming methods here would be naming
           this code's registry and calling it the install's configuration. */
        <>
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}>
            {t(
              'Yang memilih metode bayar di instalasi ini adalah sisi gateway, bukan daftar di layar ini. Halaman yang terbuka akan menampilkan metode yang sedang aktif.',
              'On this install the gateway side chooses which methods appear, not this screen. The page that opens will show what is currently enabled there.',
            )}
          </p>
          <PayButton
            label={t('Buka halaman bayar', 'Open the payment page')}
            disabled={busy}
            onClick={() => onPick(null)}
          />
        </>
      ) : channels.channels.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
          {t(
            'Pembayaran online sedang dimatikan di instalasi ini. Transfer langsung tetap bisa dipakai.',
            'Online payment is switched off on this install. Direct transfer still works.',
          )}
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label={t('Metode online', 'Online method')}
          style={{ display: 'grid', gap: 8 }}
        >
          {channels.channels.map((channel) => (
            <button
              key={channel.key}
              type="button"
              role="radio"
              aria-checked={false}
              disabled={busy}
              onClick={() => onPick(channel.key)}
              style={{
                ...CONTROL,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'baseline',
                padding: '10px 12px',
                fontSize: 13,
                minHeight: 44,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              <span>{channel.label}</span>
            </button>
          ))}
        </div>
      )}

      {error === 'unavailable' && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--warning)' }}>
          {t(
            'Pembayaran online belum aktif di server ini. Transfer langsung tetap bisa dipakai.',
            'Online payment is not enabled on this server. Direct transfer still works.',
          )}
        </div>
      )}
      {error === 'no-page' && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--warning)' }}>
          {t(
            'Server menjawab tanpa halaman bayar. Tidak ada yang dibuka; coba lagi beberapa saat.',
            'The server answered without a payment page. Nothing was opened; try again shortly.',
          )}
        </div>
      )}
      {error === 'network' && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--warning)' }}>
          {t(
            'Server tidak terjangkau. Halaman bayar tidak dibuka.',
            'The server could not be reached. No payment page was opened.',
          )}
        </div>
      )}
      {error && /^\d+$/.test(error) && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--warning)' }}>
          {t(`Permintaan ditolak (${error}).`, `The request was refused (${error}).`)}
        </div>
      )}
      {opened && (
        <p style={{ fontSize: 11, color: 'var(--gain)', margin: 0 }}>
          {t(
            'Halaman bayar dibuka di tab baru. Pembayaran di sana dicatat di riwayat ini begitu server menerimanya.',
            'The payment page opened in a new tab. A payment there lands in this history once the server has it.',
          )}
        </p>
      )}
    </section>
  )
}

function TransferStep({
  id,
  accounts,
  account,
  onPickAccount,
  note,
  onNote,
  onSubmit,
  busy,
  message,
  declared,
  amount,
  planLabel,
}: {
  id: boolean
  accounts: ReturnType<typeof usePaymentOptions>['accounts']
  account: string | null
  onPickAccount: (number: string) => void
  note: string
  onNote: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  busy: boolean
  message: string | null
  declared: boolean
  amount: number | null
  planLabel: string
}) {
  const t = (idText: string, enText: string) => (id ? idText : enText)
  const chosen = accounts.accounts.find((a) => a.accountNumber === account) ?? null
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    color: 'var(--foreground)',
    background: 'var(--input-background, #fff)',
    border: '1px solid var(--control-border)',
    borderRadius: 'var(--radius)',
    boxSizing: 'border-box',
  }

  if (accounts.error) {
    return (
      <div
        role="alert"
        style={{ ...CONTROL, padding: '10px 12px', cursor: 'default', fontSize: 12 }}
      >
        {t(
          'Daftar rekening tujuan tidak dapat dibaca dari server. Jangan kirim ke nomor yang diingat dari layar lain.',
          'The destination accounts could not be read from the server. Do not send to a number remembered from another screen.',
        )}
      </div>
    )
  }

  if (accounts.loading) {
    return (
      <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
        {t('Memuat rekening…', 'Loading accounts…')}
      </p>
    )
  }

  if (accounts.accounts.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
        {t(
          'Belum ada rekening tujuan di instalasi ini, jadi jalur transfer belum tersedia.',
          'This install has no destination account yet, so the transfer path is not available.',
        )}
      </p>
    )
  }

  return (
    <section
      aria-labelledby="pay-transfer"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <h3 id="pay-transfer" style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>
        {t('Pilih rekening, kirim, lalu nyatakan', 'Pick an account, send it, then declare it')}
      </h3>

      <div
        role="radiogroup"
        aria-label={t('Rekening tujuan', 'Destination account')}
        style={{ display: 'grid', gap: 8 }}
      >
        {accounts.accounts.map((entry) => {
          const selected = account === entry.accountNumber
          return (
            <button
              key={entry.accountNumber}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onPickAccount(entry.accountNumber)}
              style={{
                ...CONTROL,
                padding: '10px 12px',
                fontSize: 12,
                minHeight: 44,
                background: selected ? 'var(--muted)' : 'transparent',
                borderColor: selected ? 'var(--primary)' : 'var(--control-border)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.bank}</div>
              <div style={{ fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                {entry.accountNumber}
              </div>
              <div style={{ color: 'var(--muted-foreground)', marginTop: 3 }}>
                {t('a.n.', 'in the name of')} {entry.holderName}
              </div>
            </button>
          )
        })}
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label htmlFor="pay-note" style={{ fontSize: 11 }}>
          {t(
            'Catatan untuk yang memeriksa (nomor dan nama pengirim)',
            'A note for whoever checks (transfer number and sender name)',
          )}
        </label>
        <textarea
          id="pay-note"
          value={note}
          onChange={(event) => onNote(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder={t(
            'Contoh: 08/11 14:20 via mobile banking, a.n. Budi',
            'For example: 08/11 14:20 via mobile banking, from Budi',
          )}
          style={{ ...inputStyle, fontFamily: 'var(--font-sans)', resize: 'vertical' }}
        />

        {chosen && amount !== null && (
          <p style={{ fontSize: 12, margin: 0, color: 'var(--muted-foreground)' }}>
            {t('Nominal yang harus dikirim: ', 'The amount to send: ')}
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>
              {rupiah(amount, id)}
            </strong>{' '}
            {t(`untuk ${planLabel.toLowerCase()}.`, `for the ${planLabel.toLowerCase()}.`)}
          </p>
        )}

        <PayButton
          label={busy ? t('Mengirim…', 'Sending…') : t('Nyatakan transfer', 'Declare the transfer')}
          disabled={busy || account === null}
          type="submit"
          onClick={() => undefined}
        />
        {!chosen && (
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: 0 }}>
            {t('Pilih satu rekening lebih dulu.', 'Choose one account first.')}
          </p>
        )}
      </form>

      {message && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--warning)' }}>
          {message}
        </div>
      )}
      {declared && message === null && (
        <p style={{ fontSize: 11, color: 'var(--gain)', margin: 0 }}>
          {t(
            'Transfer dinyatakan ke rekening ini. Akses menyala setelah pembayaran diperiksa.',
            'The transfer is declared against this account. Access starts once the payment has been checked.',
          )}
        </p>
      )}
    </section>
  )
}

function PayButton({
  label,
  disabled,
  onClick,
  type = 'button',
}: {
  label: string
  disabled: boolean
  onClick: () => void
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 12,
        padding: '8px 16px',
        minHeight: 36,
        fontWeight: 600,
        color: 'var(--primary-foreground)',
        background: 'var(--primary)',
        border: '1px solid var(--primary)',
        borderRadius: 'var(--radius)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.7 : 1,
        alignSelf: 'flex-start',
      }}
    >
      {label}
    </button>
  )
}
