import { useCallback, useEffect, useRef, useState } from 'react'

import { ENDPOINTS, apiFetch } from '@/app/config/api'
import {
  alertStyle,
  buttonStyle,
  labelStyle,
  controlStyle as inputStyle,
  statusLineStyle,
  savedStyle,
  sectionNoteStyle,
} from '@/app/features/admin/consoleStyles'

/**
 * Sets what a subscription costs.
 *
 * The price used to live in a document. It could not be read by the app and could
 * only be changed by editing prose, which meant the number on the page and the
 * number anyone remembered could drift apart with nothing to notice. It is in
 * `system_settings` now; this is the form that writes it.
 *
 * Two rules, both learned from the paywall work in the same tree:
 *
 *  - **The screen shows what the server holds.** After a save it re-reads rather
 *    than trusting the field, because the server may reject, clamp or round and
 *    a form that renders its own optimistic state looks right while being wrong.
 *  - **A failed save changes nothing.** The old price is still the price, and the
 *    screen says so instead of leaving the rejected number sitting in the field.
 *
 * No plan picker and no on/off switch. What is *sold* is a different decision and
 * has no purchase path behind it yet; a control that looks live and does nothing
 * is worse than its absence (R-26).
 */

interface PricingState {
  weekly: number
  monthly: number
  annual: number
  updatedAt: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; pricing: PricingState }
  | { kind: 'unavailable' }
  | { kind: 'forbidden' }

const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

export function AdminPricingView() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [weekly, setWeekly] = useState('')
  const [monthly, setMonthly] = useState('')
  const [annual, setAnnual] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  /**
   * Put the fields back to the last price the server confirmed.
   *
   * A ref, not state: `save` reads it at the moment a re-read fails, and holding
   * it in state would re-create every consumer on each keystroke for no benefit.
   */
  const lastKnown = useRef<PricingState | null>(null)

  const restoreFields = useCallback(() => {
    const pricing = lastKnown.current
    if (!pricing) return
    setWeekly(String(pricing.weekly))
    setMonthly(String(pricing.monthly))
    setAnnual(String(pricing.annual))
  }, [])

  /**
   * `quiet` is a re-read after a refused save.
   *
   * A loud reload there would blank the form on exactly the request that failed,
   * taking the current price off the screen at the moment someone needed to see
   * that it had not changed. Returns whether the server answered, because the
   * caller has to do something different when it did not.
   */
  const load = useCallback(async (quiet = false): Promise<boolean> => {
    if (!quiet) setState({ kind: 'loading' })
    try {
      const res = await apiFetch(ENDPOINTS.adminPricing)
      if (res.status === 403) {
        if (!quiet) setState({ kind: 'forbidden' })
        return false
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const pricing = (await res.json()) as PricingState
      if (
        !Number.isFinite(pricing.weekly) ||
        !Number.isFinite(pricing.monthly) ||
        !Number.isFinite(pricing.annual)
      ) {
        throw new Error('price payload is not three numbers')
      }
      lastKnown.current = pricing
      setState({ kind: 'ready', pricing })
      setWeekly(String(pricing.weekly))
      setMonthly(String(pricing.monthly))
      setAnnual(String(pricing.annual))
      return true
    } catch {
      // 503, a transport failure, and a body that is not a price all land here.
      // Either way the screen must not fall back to an empty field, which would
      // read as "free".
      if (!quiet) setState({ kind: 'unavailable' })
      return false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    const w = Number(weekly)
    const m = Number(monthly)
    const a = Number(annual)
    setSaving(true)
    setSaveError(null)
    setSavedAt(null)
    try {
      const res = await apiFetch(ENDPOINTS.adminPricing, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekly: w, monthly: m, annual: a }),
      })
      if (!res.ok) {
        setSaveError(String(res.status))
        // Re-read, so the fields go back to what the server still holds rather
        // than sitting there showing a number it refused.
        //
        // If the re-read cannot answer either, put the fields back by hand from
        // what we last read. Leaving the rejected number on screen would be the
        // exact failure this component exists to prevent, and it would be worse
        // here than nowhere, because the banner would be claiming "unchanged"
        // directly above a field showing something else.
        if (!(await load(true))) restoreFields()
        return
      }
      const saved = (await res.json()) as PricingState
      if (
        !Number.isFinite(saved.weekly) ||
        !Number.isFinite(saved.monthly) ||
        !Number.isFinite(saved.annual)
      ) {
        throw new Error('price payload is not three numbers')
      }
      lastKnown.current = saved
      setState({ kind: 'ready', pricing: saved })
      setWeekly(String(saved.weekly))
      setMonthly(String(saved.monthly))
      setAnnual(String(saved.annual))
      setSavedAt(Date.now())
    } catch {
      setSaveError('network')
      if (!(await load(true))) restoreFields()
    } finally {
      setSaving(false)
    }
  }

  if (state.kind === 'loading') {
    return <p style={statusLineStyle}>Memuat harga…</p>
  }

  if (state.kind === 'forbidden') {
    return (
      <div role="alert" style={statusLineStyle}>
        Hanya administrator yang bisa mengubah harga. Ini bukan masalah langganan.
      </div>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <div role="alert" style={statusLineStyle}>
        Harga tidak dapat dimuat. Formulir sengaja dikosongkan di sini: kolom kosong terbaca sebagai
        gratis, dan gratis bukan harga yang pernah ditetapkan.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        {/* No section title; the h1 above already says Harga, so the title
            only repeated it (owner direction). */}
        <p style={sectionNoteStyle}>
          Harga inilah yang berlaku dan ditampilkan ke calon pelanggan. Simpan untuk langsung
          menerapkannya.
        </p>
      </div>

      {saveError && (
        <div role="alert" style={alertStyle('warning')}>
          {saveError === 'network'
            ? 'Server tidak terjangkau. Harga tidak berubah.'
            : `Permintaan ditolak (${saveError}). Harga tidak berubah.`}
        </div>
      )}

      {savedAt !== null && (
        <div style={savedStyle}>Tersimpan. Endpoint publik sekarang melaporkan nilai ini.</div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="pricing-weekly" style={labelStyle}>
            Mingguan (Rp)
          </label>
          <input
            id="pricing-weekly"
            type="number"
            inputMode="numeric"
            value={weekly}
            onChange={(e) => setWeekly(e.target.value)}
            style={inputStyle}
          />
          <p style={sectionNoteStyle}>Sekarang: {rupiah(state.pricing.weekly)}</p>
        </div>

        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="pricing-monthly" style={labelStyle}>
            Bulanan (Rp)
          </label>
          <input
            id="pricing-monthly"
            type="number"
            inputMode="numeric"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            style={inputStyle}
          />
          <p style={sectionNoteStyle}>Sekarang: {rupiah(state.pricing.monthly)}</p>
        </div>

        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="pricing-annual" style={labelStyle}>
            Tahunan (Rp)
          </label>
          <input
            id="pricing-annual"
            type="number"
            inputMode="numeric"
            value={annual}
            onChange={(e) => setAnnual(e.target.value)}
            style={inputStyle}
          />
          <p style={sectionNoteStyle}>Sekarang: {rupiah(state.pricing.annual)}</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={buttonStyle('primary')}
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
        {state.pricing.updatedAt && (
          <span style={statusLineStyle}>
            Diperbarui {new Date(state.pricing.updatedAt).toLocaleString('id-ID')}
          </span>
        )}
      </div>
    </div>
  )
}
