import { useState } from 'react'

import { AdminDialogActions, AdminModal } from '@/app/features/admin/AdminModal'
import { ENDPOINTS, apiFetch } from '@/app/config/api'

/**
 * Grant an account more time, without a payment in front of it.
 *
 * `POST /v1/admin/accounts/{id}/subscription` has existed since the payment work
 * and had no screen: an operator could only open access by approving a transfer
 * that never happened. This is the path for a trial, a correction, or the
 * operator's own account.
 *
 * Two things the dialog says out loud, because both surprise people:
 *
 *  - The expiry is the server's answer, not `today + days`. The endpoint returns
 *    the period it wrote and the row shows that, so the screen cannot claim an
 *    end date the database disagrees with.
 *  - Repeating the action grants again. There is no idempotency key on this path
 *    (no payment row exists to key on), so a double click buys two periods.
 *
 * A blocked account can still be granted: the block decides access, not what the
 * account is entitled to (CONTEXT.md rule 8), so this dialog does not hide
 * itself behind the block state.
 */

/** Whole days of access. The bound the service enforces is the real one; this
 *  only stops an obvious typo from reaching the network. */
const DAYS_MAX = 3650

export function GrantPeriodDialog({
  accountId,
  accountLabel,
  currentExpiresAt,
  onGranted,
  onCancel,
}: {
  accountId: string
  accountLabel: string
  /** What the account's period ends at now, if it has one. */
  currentExpiresAt: string | null
  onGranted: (expiresAt: string) => void
  onCancel: () => void
}) {
  const [days, setDays] = useState('30')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = Number(days)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= DAYS_MAX

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch(`${ENDPOINTS.adminAccounts}/${accountId}/subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: parsed, reason: reason.trim() || null }),
      })
      if (!res.ok) {
        // The row was not written; say so and leave the dialog open with what
        // was typed still in it, rather than closing on a failure.
        setError(
          res.status === 422
            ? 'Server menolak panjang periode itu.'
            : res.status === 403
              ? 'Hanya administrator yang bisa memberi langganan.'
              : 'Pemberian masa aktif tidak selesai. Akun tidak berubah.',
        )
        setBusy(false)
        return
      }
      const body = (await res.json()) as { expiresAt?: string }
      onGranted(body.expiresAt ?? '')
    } catch {
      setError('Server tidak terjangkau. Akun tidak berubah.')
      setBusy(false)
    }
  }

  return (
    <AdminModal labelledBy="grant-title" onDismiss={busy ? () => {} : onCancel}>
      <h3 id="grant-title" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
        Beri masa aktif: {accountLabel}
      </h3>
      {currentExpiresAt && (
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '8px 0 0' }}>
          Sekarang berakhir{' '}
          {new Date(currentExpiresAt).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          . Memberi periode baru tidak menggeser yang lama; keduanya tercatat.
        </p>
      )}
      <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 10, color: 'var(--foreground)' }}>
        Tidak ada pembayaran di jalur ini, jadi mengulang aksinya memberi lagi. Tanggal berakhir
        dihitung server, bukan dari angka di layar ini.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--loss)',
            background: 'var(--loss-bg)',
            padding: '8px 10px',
            borderRadius: 4,
            marginTop: 12,
          }}
        >
          {error}
        </div>
      )}

      <label
        htmlFor="grant-days"
        style={{ display: 'block', fontSize: 11, marginTop: 14, marginBottom: 4 }}
      >
        Jumlah hari
      </label>
      <input
        id="grant-days"
        value={days}
        type="number"
        inputMode="numeric"
        min={1}
        max={DAYS_MAX}
        step={1}
        onChange={(e) => setDays(e.target.value)}
        style={{
          width: 140,
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          color: 'var(--foreground)',
          background: 'var(--input-background, #fff)',
          border: '1px solid var(--control-border)',
          borderRadius: 'var(--radius)',
          boxSizing: 'border-box',
        }}
      />

      <label
        htmlFor="grant-reason"
        style={{ display: 'block', fontSize: 11, marginTop: 14, marginBottom: 4 }}
      >
        Catatan (opsional)
      </label>
      <input
        id="grant-reason"
        value={reason}
        maxLength={280}
        placeholder="Uji coba untuk pemilik, perpanjangan karena gangguan layanan."
        onChange={(e) => setReason(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 13,
          color: 'var(--foreground)',
          background: 'var(--input-background, #fff)',
          border: '1px solid var(--control-border)',
          borderRadius: 'var(--radius)',
          boxSizing: 'border-box',
        }}
      />

      <AdminDialogActions
        confirmLabel="Beri masa aktif"
        busy={busy}
        disabled={!valid}
        onConfirm={() => void submit()}
        onCancel={onCancel}
      />
    </AdminModal>
  )
}
