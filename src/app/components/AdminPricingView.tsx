import { useCallback, useEffect, useRef, useState } from "react";

import { ENDPOINTS, apiFetch } from "../config/api";

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
  monthly: number;
  annual: number;
  updatedAt: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; pricing: PricingState }
  | { kind: "unavailable" }
  | { kind: "forbidden" };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  fontFamily: "var(--font-mono)",
  color: "var(--foreground)",
  background: "var(--input-background, #fff)",
  // --control-border, not --border: ADR-0007 gives interactive boundaries a
  // contrast floor that the divider token deliberately sits below.
  border: "1px solid var(--control-border)",
  borderRadius: "var(--radius)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "var(--foreground)",
  marginBottom: "6px",
};

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

export function AdminPricingView() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [monthly, setMonthly] = useState("");
  const [annual, setAnnual] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  /**
   * Put the fields back to the last price the server confirmed.
   *
   * A ref, not state: `save` reads it at the moment a re-read fails, and holding
   * it in state would re-create every consumer on each keystroke for no benefit.
   */
  const lastKnown = useRef<PricingState | null>(null);

  const restoreFields = useCallback(() => {
    const pricing = lastKnown.current;
    if (!pricing) return;
    setMonthly(String(pricing.monthly));
    setAnnual(String(pricing.annual));
  }, []);

  /**
   * `quiet` is a re-read after a refused save.
   *
   * A loud reload there would blank the form on exactly the request that failed,
   * taking the current price off the screen at the moment someone needed to see
   * that it had not changed. Returns whether the server answered, because the
   * caller has to do something different when it did not.
   */
  const load = useCallback(async (quiet = false): Promise<boolean> => {
    if (!quiet) setState({ kind: "loading" });
    try {
      const res = await apiFetch(ENDPOINTS.adminPricing);
      if (res.status === 403) {
        if (!quiet) setState({ kind: "forbidden" });
        return false;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pricing = (await res.json()) as PricingState;
      if (!Number.isFinite(pricing.monthly) || !Number.isFinite(pricing.annual)) {
        throw new Error("price payload is not two numbers");
      }
      lastKnown.current = pricing;
      setState({ kind: "ready", pricing });
      setMonthly(String(pricing.monthly));
      setAnnual(String(pricing.annual));
      return true;
    } catch {
      // 503, a transport failure, and a body that is not a price all land here.
      // Either way the screen must not fall back to an empty field, which would
      // read as "free".
      if (!quiet) setState({ kind: "unavailable" });
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const m = Number(monthly);
    const a = Number(annual);
    setSaving(true);
    setSaveError(null);
    setSavedAt(null);
    try {
      const res = await apiFetch(ENDPOINTS.adminPricing, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthly: m, annual: a }),
      });
      if (!res.ok) {
        setSaveError(String(res.status));
        // Re-read, so the fields go back to what the server still holds rather
        // than sitting there showing a number it refused.
        //
        // If the re-read cannot answer either, put the fields back by hand from
        // what we last read. Leaving the rejected number on screen would be the
        // exact failure this component exists to prevent, and it would be worse
        // here than nowhere, because the banner would be claiming "unchanged"
        // directly above a field showing something else.
        if (!(await load(true))) restoreFields();
        return;
      }
      const saved = (await res.json()) as PricingState;
      if (!Number.isFinite(saved.monthly) || !Number.isFinite(saved.annual)) {
        throw new Error("price payload is not two numbers");
      }
      lastKnown.current = saved;
      setState({ kind: "ready", pricing: saved });
      setMonthly(String(saved.monthly));
      setAnnual(String(saved.annual));
      setSavedAt(Date.now());
    } catch {
      setSaveError("network");
      if (!(await load(true))) restoreFields();
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
        Memuat harga…
      </p>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <div role="alert" style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
        Hanya administrator yang bisa mengubah harga. Ini bukan masalah langganan.
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div role="alert" style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
        Harga tidak dapat dimuat. Formulir sengaja dikosongkan di sini: kolom kosong
        terbaca sebagai gratis, dan gratis bukan harga yang pernah ditetapkan.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 460 }}>
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Harga Langganan</h3>
        <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>
          Satu-satunya tempat harga ini ditulis. Angka di dokumen tidak mengikat —
          nilai di bawah adalah yang dibaca publik.
        </p>
      </div>

      {saveError && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--warning)",
            background: "var(--warning-bg)",
            border: "1px solid var(--warning)",
            borderRadius: "var(--radius)",
            padding: "8px 10px",
          }}
        >
          {saveError === "network"
            ? "Server tidak terjangkau. Harga tidak berubah."
            : `Permintaan ditolak (${saveError}). Harga tidak berubah.`}
        </div>
      )}

      {savedAt !== null && (
        <div style={{ fontSize: 11, color: "var(--gain)" }}>
          Tersimpan. Endpoint publik sekarang melaporkan nilai ini.
        </div>
      )}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
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
          <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>
            Sekarang: {rupiah(state.pricing.monthly)}
          </p>
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
          <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>
            Sekarang: {rupiah(state.pricing.annual)}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={{
            fontSize: 12,
            padding: "8px 16px",
            minHeight: 36,
            fontWeight: 600,
            color: "var(--primary-foreground)",
            background: "var(--primary)",
            border: "1px solid var(--primary)",
            borderRadius: "var(--radius)",
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
        {state.pricing.updatedAt && (
          <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
            Diperbarui {new Date(state.pricing.updatedAt).toLocaleString("id-ID")}
          </span>
        )}
      </div>
    </div>
  );
}