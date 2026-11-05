import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ENDPOINTS, apiFetch } from '@/app/config/api'
import { usePayments } from '@/app/features/settings/usePayments'
import { Panel, Unavailable } from '@/app/features/settings/tabPrimitives'

/* Exported because the suspension screen reuses it: a lapsed account reaches
   this same billing pane on its own screen, where every endpoint it reads —
   status, price, bank accounts, payment history — is one the access gate still
   answers (backend/api/main.py keeps the payment router ungated). Rendering a
   second copy of the form there would be two places claiming to bill. */

export function TabSubscription({ id }: { id: boolean }) {
  // `/bayar` is a real route, so this is a navigation rather than a view switch:
  // the pay screen survives a refresh and can be linked from the price sheet.
  const navigate = useNavigate()
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

  /* The account's own attempts to pay: the waiting money and the refusals. */
  const payments = usePayments()

  const emptyBody = state.error
    ? id
      ? 'Status langganan tidak dapat dimuat. Itu tidak berarti langganan Anda habis.'
      : 'Subscription status could not be loaded. That does not mean your subscription has ended.'
    : id
      ? 'Bayar lewat tombol di bawah: pilih masa akses, bayar online atau nyatakan transfer ke satu rekening. Akses menyala setelah pembayaran diperiksa admin.'
      : 'Pay with the button below: choose the length, pay online, or declare a transfer to one account. Access starts once the payment has been reviewed.'

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
          ? 'Kedaluwarsa antrian, masih bisa disetujui'
          : 'Aged out of the queue, still approvable'
        : status === 'deny'
          ? id
            ? 'Ditolak'
            : 'Refused'
          : status === 'settlement'
            ? id
              ? 'Disetujui'
              : 'Approved'
            : status

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
              ? 'Harga tidak dapat dimuat. Tidak ditampilkan sebagai nol, karena nol bukan harga yang ditetapkan.'
              : 'The price could not be loaded. Not shown as zero, because zero is not a price anyone set.'}
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
                  ? 'Akses datanya belum aktif sampai admin memeriksa pembayaran ini, tidak ada yang menyala otomatis dari baris ini.'
                  : 'Data access stays inactive until an administrator reviews this payment, and nothing turns on by itself.'}
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

          {/* A history that would not load is said. Empty lists above are not
              evidence that there is none: `rows` is null until a read lands, so
              silence here would be the tab claiming an account has never paid when
              all it knows is that the request failed. */}
          {payments.error && (
            <div role="alert" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
              {id
                ? 'Riwayat pembayaran tidak dapat dimuat. Daftar di atas bukan bukti bahwa belum ada pembayaran.'
                : 'The payment history could not be loaded. The list above is not evidence that nothing was ever paid.'}
              <button
                type="button"
                onClick={() => void payments.reload()}
                style={{
                  display: 'block',
                  marginTop: 8,
                  fontSize: 12,
                  padding: '5px 10px',
                  minHeight: 32,
                  color: 'var(--foreground)',
                  background: 'transparent',
                  border: '1px solid var(--control-border)',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                {id ? 'Coba lagi' : 'Try again'}
              </button>
            </div>
          )}

          {/* The forms that used to sit here moved to one screen. Two blocks in
              Settings wrote the same fact — a declaration and a checkout — and a
              payer had to work out which one they were in. `/bayar` asks once,
              offers the methods this install allows, and names the destination the
              money went to. This tab keeps the record: what was declared, what was
              refused, and what it cost. */}
          <div
            style={{
              border: '1px solid var(--control-border)',
              borderRadius: 'var(--radius)',
              padding: '14px 16px',
              background: 'var(--card)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                {id ? 'Bayar langganan' : 'Pay for your subscription'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 3 }}>
                {id
                  ? 'Pilih masa akses, lalu bayar online atau nyatakan transfer ke salah satu rekening.'
                  : 'Choose the length, then pay online or declare a transfer to one of the listed accounts.'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/bayar')}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '9px 16px',
                minHeight: 32,
                borderRadius: 'var(--radius)',
                border: '1px solid var(--primary)',
                color: 'var(--primary-foreground)',
                background: 'var(--primary)',
                cursor: 'pointer',
              }}
            >
              {id ? 'Bayar' : 'Pay'}
            </button>
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
                      {/* Which account the payer said they used, when they said
                          one. The operator matching money reads this line. */}
                      {row.destination ? ` · ${row.destination}` : ''}
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
