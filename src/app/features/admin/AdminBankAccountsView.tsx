import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'
import {
  alertStyle,
  buttonStyle,
  controlStyle as inputStyle,
  labelStyle,
  savedStyle,
  sectionNoteStyle,
  sectionTitleStyle,
  statusLineStyle,
  selectStyle,
  text,
} from '@/app/features/admin/consoleStyles'

/**
 * Sets where a manual transfer is paid to.
 *
 * The destinations live in `system_settings`; this is the form that writes the
 * list. Two rules are imported straight from the pricing form next door:
 *
 *  - **The screen shows what the server holds.** After a save it re-reads rather
 *    than trusting the fields, so what the payment page will publish is what this
 *    form ends up displaying.
 *  - **A failed save changes nothing.** The list goes back to the last list the
 *    server confirmed, and the screen says the save was refused rather than
 *    leaving an edited row sitting there as if it were stored.
 *
 * The empty list is refused by the server: saving one and deleting every
 * destination are the same action. The form does not second-guess that locally —
 * it submits and renders the refusal, one source of truth for one rule.
 *
 * There is no "verify account" button. Nothing here verifies anything: the
 * operator types where the money goes, and a control that implies the server
 * checked the number would promise the exact thing no one has done.
 *
 * The bank is chosen from a list the server supplies, not typed. A mistyped bank
 * name still produces a payable-looking row on the payment page, and the person
 * who pays to it is the one who finds out. `Lainnya` exists because any curated
 * list is incomplete; choosing it hands the name back to the operator to type.
 */

interface ServerAccount {
  bank: string
  accountNumber: string
  holderName: string
  code: string
  enabled: boolean
}

interface BankOption {
  code: string
  name: string
}

/** The code that means "the operator typed the bank themselves". */
const OTHER_CODE = 'other'

interface DraftAccount extends ServerAccount {
  // Local render key. Draft rows have no server identity until the save, so a
  // stable key per row is how React tracks focus while typing.
  key: number
}

interface ServerList {
  accounts: ServerAccount[]
  updatedAt: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; updatedAt: string | null }
  | { kind: 'unavailable' }
  | { kind: 'forbidden' }

export function AdminBankAccountsView() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  //	keyRef hands every draft row a unique key; rows themselves stay the truth.
  const [rows, setRows] = useState<DraftAccount[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Fetched, not hardcoded: the server is what rejects an unknown code, so a
  // list kept here would be a second opinion about which banks exist.
  const [bankOptions, setBankOptions] = useState<BankOption[]>([])
  const keyRef = useRef(1)
  const lastKnown = useRef<ServerList | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch(ENDPOINTS.adminBankOptions)
        if (!res.ok) return
        const body = (await res.json()) as { options?: BankOption[] }
        if (!cancelled && Array.isArray(body.options)) setBankOptions(body.options)
      } catch {
        // The form still works on the list it has. Failing to load the choices
        // is not a reason to refuse an operator who is only reading the list.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const restoreRows = useCallback(() => {
    const known = lastKnown.current
    if (!known) return
    setRows(known.accounts.map((a) => ({ ...a, key: keyRef.current++ })))
  }, [])

  /**
   * A re-read (`quiet`) still lands in a ready state: what the form shows after
   * a save — refused or accepted — is whatever the server just confirmed,
   * including the "diperbarui" timestamp, which is the server's to state.
   */
  const load = useCallback(async (quiet = false): Promise<boolean> => {
    if (!quiet) setState({ kind: 'loading' })
    try {
      const res = await apiFetch(ENDPOINTS.adminBankAccounts)
      if (res.status === 403) {
        if (!quiet) setState({ kind: 'forbidden' })
        return false
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const list = (await res.json()) as ServerList
      lastKnown.current = list
      setState({ kind: 'ready', updatedAt: list.updatedAt })
      setRows(list.accounts.map((a) => ({ ...a, key: keyRef.current++ })))
      return true
    } catch {
      if (!quiet) setState({ kind: 'unavailable' })
      return false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function editRow(key: number, field: keyof ServerAccount, value: string | boolean) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        bank: '',
        accountNumber: '',
        holderName: '',
        code: OTHER_CODE,
        enabled: true,
        key: keyRef.current++,
      },
    ])
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((row) => row.key !== key))
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    setSavedAt(null)
    try {
      const res = await apiFetch(ENDPOINTS.adminBankAccounts, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accounts: rows.map(({ bank, accountNumber, holderName, code, enabled }) => ({
            bank,
            accountNumber,
            holderName,
            code,
            enabled,
          })),
        }),
      })
      if (!res.ok) {
        setSaveError(String(res.status))
        // Whatever the server still holds is the list — including the refusal of
        // an empty one, which is why the refusal text is honest instead of a
        // client-side rule that could drift from the server's.
        if (!(await load(true))) restoreRows()
        return
      }
      // Re-read rather than rendering the PUT's echo: what the form shows after
      // saving is what the server confirms it now holds.
      if (await load(true)) setSavedAt(Date.now())
      else restoreRows()
    } catch {
      setSaveError('network')
      if (!(await load(true))) restoreRows()
    } finally {
      setSaving(false)
    }
  }

  if (state.kind === 'loading') {
    return <p style={statusLineStyle}>Memuat rekening tujuan…</p>
  }

  if (state.kind === 'forbidden') {
    return (
      <div role="alert" style={statusLineStyle}>
        Hanya administrator yang bisa mengubah rekening tujuan. Ini bukan masalah langganan.
      </div>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <div role="alert" style={statusLineStyle}>
        Daftar rekening tidak dapat dimuat. Formulir sengaja dikosongkan, karena menyimpan dadakan
        berarti menimpa daftar yang sedang berlaku.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
      <div>
        <h3 style={sectionTitleStyle}>Rekening Tujuan</h3>
        <p style={sectionNoteStyle}>
          Satu-satunya tempat daftar ini ditulis. Daftar di bawah yang dibaca publik oleh endpoint
          rekening, pembaruan mengganti seluruh daftar. Rekening yang disembunyikan tetap tersimpan
          di sini dan tidak dikirim ke halaman pembayaran.
        </p>
      </div>

      {saveError && (
        <div role="alert" style={alertStyle('warning')}>
          {saveError === 'network'
            ? 'Server tidak terjangkau. Daftar tidak berubah.'
            : `Permintaan ditolak (${saveError}). Daftar tidak berubah${
                saveError === '422' ? ' — daftar kosong atau ada isian yang tidak sah.' : '.'
              }`}
        </div>
      )}

      {savedAt !== null && (
        <div style={savedStyle}>
          {rows.some((r) => r.enabled)
            ? 'Tersimpan. Endpoint publik sekarang melaporkan rekening yang ditampilkan.'
            : 'Tersimpan. Semua rekening sedang disembunyikan, jadi endpoint publik mengirim daftar kosong.'}
        </div>
      )}

      {rows.length === 0 && (
        <p style={{ ...statusLineStyle, margin: 0 }}>
          Belum ada rekening tujuan. Tambahkan satu supaya pembayaran manual punya alamat transfer;
          menyimpan daftar kosong ditolak server.
        </p>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((row, index) => (
            <div
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'minmax(140px, 1fr) minmax(150px, 1.1fr) minmax(130px, 1fr) auto auto',
                gap: 8,
                alignItems: 'end',
              }}
            >
              <div>
                <label htmlFor={`acct-bank-${row.key}`} style={labelStyle}>
                  Bank
                </label>
                <select
                  id={`acct-bank-${row.key}`}
                  value={row.code}
                  onChange={(e) => {
                    const code = e.target.value
                    // Choosing a named bank fills in its display name too, so the
                    // row the public reads cannot hold a name the operator typed
                    // while a different bank was selected.
                    const named = bankOptions.find((o) => o.code === code)
                    setRows((prev) =>
                      prev.map((r) =>
                        r.key === row.key
                          ? {
                              ...r,
                              code,
                              bank: code === OTHER_CODE ? r.bank : (named?.name ?? r.bank),
                            }
                          : r,
                      ),
                    )
                  }}
                  style={selectStyle}
                >
                  {bankOptions.length === 0 && <option value={row.code}>{row.code}</option>}
                  {bankOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name}
                    </option>
                  ))}
                </select>
                {row.code === OTHER_CODE && (
                  <input
                    aria-label={`Nama bank untuk rekening ke-${index + 1}`}
                    value={row.bank}
                    onChange={(e) => editRow(row.key, 'bank', e.target.value)}
                    placeholder="Tulis nama banknya"
                    style={{ ...inputStyle, marginTop: 6 }}
                  />
                )}
              </div>
              <div>
                <label htmlFor={`acct-number-${row.key}`} style={labelStyle}>
                  Nomor rekening
                </label>
                <input
                  id={`acct-number-${row.key}`}
                  value={row.accountNumber}
                  inputMode="numeric"
                  onChange={(e) => editRow(row.key, 'accountNumber', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor={`acct-holder-${row.key}`} style={labelStyle}>
                  Nama pemilik
                </label>
                <input
                  id={`acct-holder-${row.key}`}
                  value={row.holderName}
                  onChange={(e) => editRow(row.key, 'holderName', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={row.enabled}
                onClick={() => editRow(row.key, 'enabled', !row.enabled)}
                aria-label={`Tampilkan rekening ke-${index + 1} ke user`}
                title={
                  row.enabled
                    ? 'Ditampilkan di halaman pembayaran. Klik untuk menyembunyikan.'
                    : 'Disembunyikan dari halaman pembayaran. Klik untuk menampilkan.'
                }
                style={{
                  fontSize: text.meta,
                  padding: '6px 10px',
                  minHeight: 32,
                  marginBottom: 1,
                  color: row.enabled ? 'var(--foreground)' : 'var(--console-secondary)',
                  background: 'transparent',
                  // The same contrast floor every other control here uses: a
                  // toggle the operator must read at a glance is a control, not
                  // a divider.
                  border: '1px solid var(--control-border)',
                  borderRadius: 3,
                  cursor: 'pointer',
                  opacity: row.enabled ? 1 : 0.65,
                }}
              >
                {row.enabled ? 'Ditampilkan' : 'Disembunyikan'}
              </button>
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label={`Hapus rekening ke-${index + 1}`}
                style={{
                  fontSize: text.meta,
                  padding: '6px 10px',
                  minHeight: 32,
                  color: 'var(--loss)',
                  background: 'transparent',
                  border: '1px solid var(--loss)',
                  borderRadius: 3,
                  cursor: 'pointer',
                  marginBottom: 1,
                }}
              >
                Hapus
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={addRow}
          style={{
            fontSize: text.body,
            padding: '7px 12px',
            minHeight: 32,
            color: 'var(--foreground)',
            background: 'transparent',
            border: '1px solid var(--control-border)',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
          }}
        >
          Tambah rekening
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={buttonStyle('primary')}
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
        {state.updatedAt && (
          <span style={statusLineStyle}>
            Diperbarui {new Date(state.updatedAt).toLocaleString('id-ID')}
          </span>
        )}
      </div>
    </div>
  )
}
