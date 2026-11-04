import { useEffect, useState } from 'react'

import { AdminDialogActions, AdminModal } from '@/app/features/admin/AdminModal'
import {
  usePaymentQueue,
  QUEUE_PAGE_SIZE,
  QUEUE_STATUSES,
  type QueueStatus,
  type AdminQueueRow,
  type QueueActionFailure,
} from '@/app/features/admin/usePaymentQueue'

/**
 * The payment verification queue: the operator's work list.
 *
 * Every column here traces to a column the server already stores. Two things
 * this screen deliberately does not have, both because the code cannot support
 * them:
 *
 *  - **No receipt preview.** `transactions.proof_image_url` is never populated
 *    (ADR-0011); the evidence an operator can act on is the text the payer left
 *    in `admin_notes`, and that is what is shown. An image viewer would imply a
 *    file exists and pressure the project to start writing one, reversing a
 *    recorded decision.
 *  - **No "notification sent" claim.** Approve writes money and access. There is
 *    no email or WhatsApp transport in this codebase, so nothing is sent to
 *    anyone, and the screen says the row's state instead of promising a message.
 *
 * Statuses are printed as the server spells them. The words `pending`,
 * `settlement`, `expire`, `deny` and `cancel` are the ledger's vocabulary and a
 * translation layer here would be a second place deciding what they mean.
 */

const th: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left' as const,
  fontSize: 12,
  color: 'var(--muted-foreground)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '12px',
  fontSize: 13,
  color: 'var(--foreground)',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
}

const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
}

/** A row is actionable only while it is money that has not become a decision. */
const ACTIONABLE = new Set(['pending', 'expire'])

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  expire: 'Kedaluwarsa',
  settlement: 'Selesai',
  deny: 'Ditolak',
  cancel: 'Batal',
  all: 'Semua',
}

/**
 * Why an action did not happen, in the operator's words. The server's own
 * sentence is shown beside these when it sent one; this names the *kind* of
 * thing that went wrong, because "409" tells an operator nothing about the money.
 */
const FAILURE_LABEL: Record<QueueActionFailure, string> = {
  conflict: 'Baris ini tidak lagi dalam keadaan yang bisa Anda putuskan.',
  gone: 'Baris itu sudah tidak ada di antrean.',
  refused: 'Isian yang dikirim tidak diterima server.',
  unavailable: 'Server tidak bisa menyelesaikan aksi ini.',
  network: 'Server tidak terjangkau.',
}

/**
 * The one thing the server guarantees about a failed adjudication, repeated
 * here because an operator who thinks approve half-worked is worse off than one
 * who knows it did not: `transactions.py` promises a failed approve or deny
 * leaves the transaction unchanged.
 */
const UNCHANGED = 'Transaksi tidak berubah.'

function formatRp(n: number): string {
  // Exact, not compact: `fmtIdr` would print "Rp 44Rb", and matching a bank
  // transfer to a rounded figure is how a wrong row gets approved.
  return `Rp ${n.toLocaleString('id-ID')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Hours and minutes left before the queue stops offering this row.
 *
 * Computed when the list was read, and refreshed by "Muat ulang" rather than by
 * a ticking timer: the beat that expires rows owns that state, so a countdown
 * reaching 00:00 on screen would show a change that has not happened. The
 * absolute deadline sits beside it, so nothing here is an estimate pretending to
 * be a fact.
 */
function remainingFrom(expiresAt: string): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (!Number.isFinite(ms)) return null
  if (ms <= 0) return 'sudah lewat'
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours} j ${minutes % 60} m lagi` : `${minutes} m lagi`
}

export function AdminTransactionsView() {
  const [status, setStatus] = useState<QueueStatus>('pending')
  const [offset, setOffset] = useState(0)
  const queue = usePaymentQueue(status, offset)
  const [confirming, setConfirming] = useState<AdminQueueRow | null>(null)
  const [denying, setDenying] = useState<AdminQueueRow | null>(null)

  const rows = queue.rows ?? []

  function chooseStatus(next: QueueStatus) {
    queue.clearResult()
    setStatus(next)
    // A different working set is a different list, so page one of it. Keeping
    // the offset would show the third page of a set that has two.
    setOffset(0)
  }

  function pageBy(delta: number) {
    queue.clearResult()
    setOffset((prev) => Math.max(0, prev + delta))
  }

  // A pending action's dialog belongs to the row it was opened from. When that
  // row leaves the working set after a re-read, the dialog goes with it rather
  // than adjudicating a row the operator can no longer see.
  useEffect(() => {
    if (!confirming) return
    if (!queue.rows?.some((r) => r.id === confirming.id)) setConfirming(null)
  }, [queue.rows, confirming])

  useEffect(() => {
    if (!denying) return
    if (!queue.rows?.some((r) => r.id === denying.id)) setDenying(null)
  }, [queue.rows, denying])

  async function runApprove(row: AdminQueueRow) {
    await queue.approve(row.id)
    setConfirming(null)
  }

  async function runDeny(row: AdminQueueRow, reason: string) {
    await queue.deny(row.id, reason)
    setDenying(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Antrean Pembayaran</h2>
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>
          Transfer yang dideklarasikan orang, dan baris gateway. Menyetujui menulis status
          <em> settlement</em> dan masa aktifnya dalam satu transaksi database; menolak meninggalkan
          uangnya utuh dan mencatat alasannya. Kalau instalasi ini punya jalur email, keputusan itu
          juga mengantrekan surat untuk pembayar — layar ini tidak pernah mengatakan pesannya sudah
          terkirim, dan status jalurnya ada di tab Integrasi.
        </p>
      </div>

      {/* The working set, chosen from the server's own vocabulary. */}
      <div
        role="group"
        aria-label="Pilih isi antrean"
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
      >
        {QUEUE_STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => chooseStatus(value)}
            style={{
              fontSize: 12,
              padding: '5px 10px',
              minHeight: 32,
              color: status === value ? 'var(--primary-foreground)' : 'var(--foreground)',
              background: status === value ? 'var(--primary)' : 'transparent',
              // --control-border, not --border: ADR-0007 gives an interactive
              // boundary a contrast floor, and --border is a divider token that
              // sits below it on purpose.
              border: `1px solid ${status === value ? 'var(--primary)' : 'var(--control-border)'}`,
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            {STATUS_LABEL[value]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void queue.reload(true)}
          style={{
            marginLeft: 'auto',
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
          Muat ulang
        </button>
        {/* Exports the whole selected working set, not the page on screen, and
            says which set that is. The file itself declares it if the server had
            to stop early. */}
        <button
          type="button"
          onClick={() => void queue.exportCsv()}
          disabled={queue.exporting}
          aria-label={`Ekspor CSV baris berstatus ${STATUS_LABEL[status]}`}
          style={{
            fontSize: 12,
            padding: '5px 10px',
            minHeight: 32,
            color: 'var(--foreground)',
            background: 'transparent',
            border: '1px solid var(--control-border)',
            borderRadius: 3,
            cursor: queue.exporting ? 'default' : 'pointer',
            opacity: queue.exporting ? 0.5 : 1,
          }}
        >
          {queue.exporting ? 'Menyiapkan…' : 'Ekspor CSV'}
        </button>
      </div>

      {queue.exportError && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--loss)',
            background: 'var(--loss-bg)',
            padding: '8px 10px',
            borderRadius: 4,
          }}
        >
          {queue.exportError === 'network'
            ? 'Server tidak terjangkau. Berkas tidak dibuat.'
            : `Ekspor ditolak (${queue.exportError}). Berkas tidak dibuat.`}
        </div>
      )}

      {queue.result && (
        <div
          role="status"
          style={{
            fontSize: 12,
            color: 'var(--gain)',
            background: 'var(--gain-bg)',
            padding: '8px 10px',
            borderRadius: 4,
          }}
        >
          {queue.result.kind === 'approved'
            ? queue.result.expiresAt
              ? `Disetujui. Masa aktif berlaku sampai ${formatDate(queue.result.expiresAt)}.`
              : 'Disetujui.'
            : /* The refusal is as much a decision as an approval, and before this
                 the only sign it had happened was a row quietly leaving the list —
                 which looks exactly like a reload. It names the invoice and the
                 reason that was written, and stops there: no claim about what the
                 payer was told. */
              `Ditolak: ${queue.result.invoiceCode}. Alasan tercatat di barisnya.`}
        </div>
      )}

      {queue.failure && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--loss)',
            background: 'var(--loss-bg)',
            padding: '8px 10px',
            borderRadius: 4,
          }}
        >
          {FAILURE_LABEL[queue.failure.failure]} {UNCHANGED}
          {queue.failure.detail && (
            <span style={{ display: 'block', marginTop: 4, color: 'var(--muted-foreground)' }}>
              Server: {queue.failure.detail}
            </span>
          )}
        </div>
      )}

      <div
        role="region"
        aria-label="Tabel antrean, dapat digulir ke samping"
        tabIndex={0}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflowX: 'auto',
          // Nine columns do not fit a phone. A scrollable region that cannot take
          // focus cannot be scrolled without a mouse or a thumb, so the
          // right-hand columns are unreachable for a keyboard operator.
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Faktur</th>
              <th style={{ ...th, textAlign: 'right' }}>Nominal</th>
              <th style={th}>Paket</th>
              <th style={th}>Gerbang</th>
              <th style={th}>Metode</th>
              <th style={th}>Pembayar</th>
              <th style={th}>Deklarasi</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {queue.loading && (
              <tr>
                <td colSpan={9} style={{ ...td, color: 'var(--muted-foreground)' }}>
                  Memuat…
                </td>
              </tr>
            )}

            {queue.error && (
              <tr>
                <td colSpan={9} style={{ ...td, color: 'var(--muted-foreground)' }}>
                  Antrean tidak dapat dimuat. Ini bukan berarti tidak ada pembayaran menunggu.
                </td>
              </tr>
            )}

            {!queue.loading && !queue.error && queue.rows?.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...td, color: 'var(--muted-foreground)' }}>
                  {status === 'pending'
                    ? 'Tidak ada yang menunggu keputusan.'
                    : `Tidak ada baris berstatus ${STATUS_LABEL[status]}.`}
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ ...td, ...mono }}>{row.invoiceCode}</td>
                <td style={{ ...td, ...mono, textAlign: 'right', fontWeight: 600 }}>
                  {formatRp(row.amount)}
                </td>
                <td style={{ ...td, ...mono }}>{row.plan}</td>
                <td style={{ ...td, ...mono }}>{row.paymentGateway}</td>
                <td style={td}>{row.paymentMethod}</td>
                <td style={{ ...td, color: 'var(--muted-foreground)' }}>{row.payerEmail ?? '—'}</td>
                <td style={{ ...td, ...mono, whiteSpace: 'nowrap' }}>
                  {formatDate(row.createdAt)}
                  {/* The queue's own deadline, and how much of it is left as of
                      the read that put this row on screen. */}
                  {row.expiresAt && (
                    <div style={{ fontSize: 11, marginTop: 3, color: 'var(--muted-foreground)' }}>
                      tenggat {formatDate(row.expiresAt)}
                      <div>
                        sisa {remainingFrom(row.expiresAt)}{' '}
                        <button
                          type="button"
                          onClick={() => void queue.reload(true)}
                          style={{
                            fontSize: 11,
                            padding: 0,
                            background: 'none',
                            border: 'none',
                            color: 'var(--link, var(--primary))',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          hitung ulang
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Which published account the payer named, before the note.
                      Two pending rows for the same plan and the same amount are
                      indistinguishable without it, and matching the money is the
                      whole job of this screen. Rows written before migration 0016
                      have nothing here, and say nothing rather than "-". */}
                  {row.destination && (
                    <div
                      style={{
                        marginTop: 6,
                        maxWidth: 320,
                        // Wrapping, not nowrap. This line is a bank name, thirteen
                        // digits and a holder name in a monospace face; on one line it
                        // is wider than the column, and the table pushed the reject
                        // button off the visible area to make room for it.
                        whiteSpace: 'normal',
                        overflowWrap: 'anywhere',
                        fontSize: 12,
                        lineHeight: 1.5,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--foreground)',
                      }}
                    >
                      ke {row.destination}
                    </div>
                  )}
                  {/* Evidence, as text. This is all the install keeps. */}
                  {row.notes && (
                    <div
                      style={{
                        marginTop: 6,
                        maxWidth: 320,
                        whiteSpace: 'normal',
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: 'var(--muted-foreground)',
                      }}
                    >
                      {row.notes}
                    </div>
                  )}
                </td>
                <td style={{ ...td, ...mono }}>
                  {row.status}
                  {row.status === 'expire' && (
                    <div style={{ fontSize: 11, marginTop: 3, color: 'var(--muted-foreground)' }}>
                      uangnya tetap ada, masih bisa disetujui
                    </div>
                  )}
                  {row.status === 'settlement' && row.approvedAt && (
                    <div style={{ fontSize: 11, marginTop: 3, color: 'var(--muted-foreground)' }}>
                      disetujui {formatDate(row.approvedAt)}
                    </div>
                  )}
                  {row.status === 'settlement' && row.subscriptionId && (
                    <div style={{ fontSize: 11, marginTop: 3, color: 'var(--muted-foreground)' }}>
                      masa aktif {row.subscriptionId.slice(0, 8)}
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {ACTIONABLE.has(row.status) ? (
                    <>
                      <button
                        type="button"
                        disabled={queue.busyId !== null}
                        onClick={() => setConfirming(row)}
                        aria-label={`Setujui ${row.invoiceCode}`}
                        style={{
                          fontSize: 11,
                          padding: '4px 8px',
                          minHeight: 28,
                          marginRight: 6,
                          color: 'var(--primary-foreground)',
                          background: 'var(--primary)',
                          border: '1px solid var(--primary)',
                          borderRadius: 3,
                          cursor: queue.busyId !== null ? 'default' : 'pointer',
                          opacity: queue.busyId !== null ? 0.5 : 1,
                        }}
                      >
                        Setujui
                      </button>
                      <button
                        type="button"
                        disabled={queue.busyId !== null}
                        onClick={() => setDenying(row)}
                        aria-label={`Tolak ${row.invoiceCode}`}
                        style={{
                          fontSize: 11,
                          padding: '4px 8px',
                          minHeight: 28,
                          color: 'var(--loss)',
                          background: 'transparent',
                          border: '1px solid var(--loss)',
                          borderRadius: 3,
                          cursor: queue.busyId !== null ? 'default' : 'pointer',
                          opacity: queue.busyId !== null ? 0.5 : 1,
                        }}
                      >
                        Tolak
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                      {queue.busyId === row.id ? 'Menyimpan…' : 'final'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paging, and the count that makes it legible. `hasMore` is the whole
          point: without it a full page is indistinguishable from the entire
          queue, and the rows past it are the oldest ones. */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => pageBy(-QUEUE_PAGE_SIZE)}
            disabled={offset === 0}
            style={{
              fontSize: 12,
              padding: '5px 10px',
              minHeight: 32,
              color: 'var(--foreground)',
              background: 'transparent',
              border: '1px solid var(--control-border)',
              borderRadius: 3,
              cursor: offset === 0 ? 'default' : 'pointer',
              opacity: offset === 0 ? 0.5 : 1,
            }}
          >
            Sebelumnya
          </button>
          <button
            type="button"
            onClick={() => pageBy(QUEUE_PAGE_SIZE)}
            disabled={!queue.hasMore}
            style={{
              fontSize: 12,
              padding: '5px 10px',
              minHeight: 32,
              color: 'var(--foreground)',
              background: 'transparent',
              border: '1px solid var(--control-border)',
              borderRadius: 3,
              cursor: queue.hasMore ? 'pointer' : 'default',
              opacity: queue.hasMore ? 1 : 0.5,
            }}
          >
            Berikutnya
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
            {offset + 1}–{offset + rows.length}
            {queue.hasMore ? ' (masih ada lagi)' : ''}
          </span>
        </div>
      )}

      {confirming && (
        <ApproveDialog
          row={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={runApprove}
        />
      )}

      {denying && <DenyDialog row={denying} onCancel={() => setDenying(null)} onDeny={runDeny} />}
    </div>
  )
}

/**
 * Approve, after a confirmation that names what the click does.
 *
 * The granted length is deliberately not an input here: it comes from the plan
 * on the row (`PLAN_DAYS`), and an operator who could type a number of days
 * would be approving a different transaction than the one the payer declared.
 */
function ApproveDialog({
  row,
  onConfirm,
  onCancel,
}: {
  row: AdminQueueRow
  onConfirm: (row: AdminQueueRow) => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <AdminModal labelledBy="approve-title" onDismiss={onCancel}>
      <h3 id="approve-title" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
        Setujui pembayaran {row.invoiceCode}
      </h3>
      {/* What the click actually does, in the order it does it. The length is not
          a choice this screen offers: it comes from the plan on the row. */}
      <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 10, color: 'var(--foreground)' }}>
        Ini menulis <em>settlement</em> dan satu masa aktif langganan dalam satu transaksi database,
        lewat penulis yang sama dengan callback gateway. Panjangnya mengikuti paket di baris ini,
        bukan angka yang bisa Anda isi di sini.
      </p>
      <dl
        style={{
          margin: '12px 0 0',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '4px 12px',
          fontSize: 13,
        }}
      >
        <dt style={{ color: 'var(--muted-foreground)' }}>Nominal</dt>
        <dd style={{ ...mono, margin: 0 }}>{formatRp(row.amount)}</dd>
        <dt style={{ color: 'var(--muted-foreground)' }}>Paket</dt>
        <dd style={{ ...mono, margin: 0 }}>{row.plan}</dd>
        <dt style={{ color: 'var(--muted-foreground)' }}>Pembayar</dt>
        <dd style={{ margin: 0 }}>{row.payerEmail ?? '—'}</dd>
      </dl>
      <AdminDialogActions
        confirmLabel="Ya, setujui"
        busy={busy}
        onConfirm={() => {
          setBusy(true)
          void onConfirm(row)
        }}
        onCancel={onCancel}
      />
    </AdminModal>
  )
}

/**
 * Refuse one row's evidence, with the reason the ledger requires.
 *
 * The reason is not optional and this screen will not send nothing: a denial
 * without a reason gives the account nothing to argue with and the operator
 * nothing to audit (`DenyPaymentRequest`, min_length=1). The client only checks
 * the field is not blank; what counts as a reason stays the server's rule to
 * refuse.
 */
function DenyDialog({
  row,
  onDeny,
  onCancel,
}: {
  row: AdminQueueRow
  onDeny: (row: AdminQueueRow, reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const trimmed = reason.trim()

  return (
    <AdminModal labelledBy="deny-title" onDismiss={onCancel}>
      <h3 id="deny-title" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
        Tolak pembayaran {row.invoiceCode}
      </h3>
      <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 10, color: 'var(--foreground)' }}>
        Menolak tidak menyentuh apa pun yang akun sudah punya: yang ditolak adalah bukti ini.
        Alasannya wajib, dan tercatat di barisnya supaya akun bisa membaca mengapa.
      </p>
      <label
        htmlFor="deny-reason"
        style={{ display: 'block', fontSize: 11, marginTop: 12, marginBottom: 4 }}
      >
        Alasan
      </label>
      <textarea
        id="deny-reason"
        value={reason}
        rows={3}
        maxLength={1000}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Nomor rekening tujuan tidak cocok dengan mutasi yang kami terima."
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 13,
          color: 'var(--foreground)',
          background: 'var(--input-background, #fff)',
          border: '1px solid var(--control-border)',
          borderRadius: 'var(--radius)',
          boxSizing: 'border-box',
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
      <AdminDialogActions
        confirmLabel="Tolak dengan alasan ini"
        busy={busy}
        disabled={trimmed === ''}
        danger
        onConfirm={() => {
          setBusy(true)
          void onDeny(row, trimmed)
        }}
        onCancel={onCancel}
      />
    </AdminModal>
  )
}
