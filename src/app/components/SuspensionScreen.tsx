import { useState } from "react";
import { TabSubscription } from "./SettingsView";
import { useApp } from "../context/AppContext";

/**
 * The screen an account with a `blocked_reason` sees instead of the app.
 *
 * The two reasons get entirely different screens, and that is the point of
 * carrying the reason to the client:
 *
 *   'subscription_expired' — the person paid once and the clock ran out. The
 *   billing pane is rendered right here rather than somewhere behind a link,
 *   because the app is replaced by this screen: every data route refuses a
 *   suspended caller (HTTP 402, WebSocket 4404), so a link into the shell
 *   would arrive at a room full of dead controls. Everything on this screen is
 *   an endpoint the gate still answers — price, destination accounts, the
 *   declaration form, the payment history. A settled payment reopens the
 *   account (backend settlement path), `Periksa status` re-asks /v1/auth/me,
 *   and the app takes over again.
 *
 *   'admin' — an administrator closed the account. No price, no destination,
 *   no payment control: a payment cannot open this kind of block, so the
 *   screen must not pretend one could. The person contacts the operator.
 */
export function SuspensionScreen({
  reason,
  onRefresh,
}: {
  reason: "admin" | "subscription_expired";
  /** Re-ask /v1/auth/me: when a settled payment reopens the account, this is
   * how the person notices without guessing. It returns a promise — the button
   * stays busy until the answer lands. */
  onRefresh: () => Promise<void>;
}) {
  const { locale } = useApp();
  const id: boolean = locale === "id";
  const [busy, setBusy] = useState(false);
  const recheck = async () => {
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  if (reason === "admin") {
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--background)", padding: 24 }}>
        <div
          role="alert"
          style={{
            maxWidth: 464,
            width: "100%",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            background: "var(--card)",
            padding: "24px 28px",
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: "var(--foreground)" }}>
            {id ? "Akun dinonaktifkan" : "Account disabled"}
          </h1>
          <p style={{ fontSize: 14, color: "var(--foreground)", margin: "10px 0 0" }}>
            {id
              ? "Akun ini ditutup oleh administrator. Pembayaran tidak dapat membukanya kembali — hubungi operator untuk membahas pembukaannya."
              : "This account was closed by an administrator. A payment cannot reopen it — contact the operator about restoring access."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--background)",
        padding: "32px 20px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          role="alert"
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            background: "var(--card)",
            padding: "20px 24px",
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: "var(--foreground)" }}>
            {id ? "Langganan berakhir" : "Subscription ended"}
          </h1>
          <p style={{ fontSize: 14, color: "var(--foreground)", margin: "10px 0 0" }}>
            {id
              ? "Masa aktif langganan Anda sudah lewat, jadi seluruh analisis tertutup sampai ada pembayaran baru. Sesi ini tetap sah — harga, rekening tujuan, dan formulir deklarasi transfer ada di bawah."
              : "Your subscription period has ended, so the analysis is closed until a new payment lands. This session is still valid — the price, destination accounts and the transfer declaration are below."}
          </p>
          <button
            type="button"
            onClick={recheck}
            disabled={busy}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "9px 16px",
              minHeight: 32,
              borderRadius: "var(--radius)",
              border: "1px solid var(--control-border)",
              background: "var(--card)",
              color: "var(--foreground)",
              cursor: busy ? "default" : "pointer",
              marginTop: 14,
            }}
          >
            {busy
              ? (id ? "Memeriksa…" : "Checking…")
              : (id ? "Periksa apakah akses sudah dibuka" : "Check whether access is back")}
          </button>
        </div>

        {/* The billing pane, reused rather than retyped: same price read, same
            destination list, same declaration form the app's settings tab
            serves. Suspended callers are refused on data routes — not here. */}
        <TabSubscription id={id} />
      </div>
    </div>
  );
}

export type SuspensionReason = "admin" | "subscription_expired";
