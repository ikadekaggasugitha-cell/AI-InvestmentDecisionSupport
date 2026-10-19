/**
 * The price, for a person who has no session.
 *
 * A price that can only be read after signing up is not a price — the person
 * deciding whether to subscribe is, by definition, not yet subscribed. This
 * page shows what that person can actually decide from: what the subscription
 * opens, and what it costs, read from the one public data endpoint the app has
 * (`GET /v1/subscriptions/pricing`).
 *
 * What it deliberately does not have:
 *
 * - No "Beli" button and no payment form. Deciding that a visitor starts a
 *   purchase from here would be a purchase path with no session behind it; the
 *   plan that built billing put the declaration inside the app, after signup.
 * - No market-data promises. Posters here would go stale the first time the
 *   entitlement gate changed; the list below names exactly what the gate
 *   refuses (`/v1/signals`, `/v1/alerts`, the risk panel, optimisation) and
 *   claims nothing else.
 * - No zero on failure. 503 means the install has no configured price, and
 *   printing "Rp 0" would quote a real customer for free — same rule the
 *   settings tab lives by.
 */

import { useEffect, useState } from "react";
import { apiFetch, ENDPOINTS } from "../config/api";
import type { Locale } from "../i18n/translations";

export interface PublicPricingProps {
  locale: Locale;
  /** The sign-in / sign-up surface. Wiring decides where that is. */
  onEnter: () => void;
}

type PriceState =
  | { kind: "loading" }
  | { kind: "ready"; weekly: number; monthly: number; annual: number }
  | { kind: "unavailable" };

const localeTag = (locale: Locale) => (locale === "id" ? "id-ID" : "en-GB");

export function PublicPricing({ locale, onEnter }: PublicPricingProps) {
  const isId = locale === "id";
  const [price, setPrice] = useState<PriceState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await apiFetch(ENDPOINTS.pricing, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { weekly: number; monthly: number; annual: number };
        if (
          !Number.isFinite(body.weekly) ||
          !Number.isFinite(body.monthly) ||
          !Number.isFinite(body.annual)
        ) {
          throw new Error("pricing body is not three numbers");
        }
        if (controller.signal.aborted) return;
        setPrice({
          kind: "ready",
          weekly: body.weekly,
          monthly: body.monthly,
          annual: body.annual,
        });
      } catch {
        if (controller.signal.aborted) return;
        setPrice({ kind: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, []);

  const opens: string[] = isId
    ? ["Sinyal", "Peringatan otomatis", "Panel risiko", "Optimasi portofolio"]
    : ["Signals", "Automatic alerts", "Risk panel", "Portfolio optimisation"];

  const priceRow = (label: string, per: string, amount: number | null) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "12px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div>
        <div style={{ fontSize: "14px", fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginTop: 2 }}>
          {per}
        </div>
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "16px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {amount === null ? "—" : `Rp ${amount.toLocaleString(localeTag(locale))}`}
      </div>
    </div>
  );

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        background: "var(--background)",
        color: "var(--foreground)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <main style={{ width: "100%", maxWidth: "420px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 500, margin: "0 0 4px" }}>
          {isId ? "Harga langganan" : "Subscription price"}
        </h1>
        <p style={{ fontSize: "13px", color: "var(--muted-foreground)", margin: "0 0 24px" }}>
          {isId
            ? "Apa yang dibuka langganan, dan berapa harganya."
            : "What a subscription opens, and what it costs."}
        </p>

        {price.kind === "loading" && (
          <p style={{ fontSize: "13px", color: "var(--muted-foreground)" }} role="status">
            {isId ? "Memuat harga…" : "Loading price…"}
          </p>
        )}

        {price.kind === "unavailable" && (
          <p
            role="status"
            style={{
              fontSize: "13px",
              color: "var(--muted-foreground)",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "10px 12px",
              margin: "0 0 16px",
            }}
          >
            {isId
              ? "Harga tidak dapat dimuat. Tidak ditampilkan sebagai nol — nol bukan harga yang ditetapkan."
              : "The price could not be loaded. Not shown as zero — zero is not a price anyone set."}
          </p>
        )}

        {price.kind === "ready" && (
          <>
            {priceRow(isId ? "Mingguan" : "Weekly", isId ? "setiap minggu" : "every week", price.weekly)}
            {priceRow(isId ? "Bulanan" : "Monthly", isId ? "setiap bulan" : "every month", price.monthly)}
            {priceRow(isId ? "Tahunan" : "Annual", isId ? "setiap tahun" : "every year", price.annual)}
          </>
        )}

        <section style={{ marginTop: "24px" }}>
          <h2 style={{ fontSize: "13px", fontWeight: 500, margin: "0 0 8px" }}>
            {isId ? "Yang dibuka langganan" : "What a subscription opens"}
          </h2>
          <ul
            style={{
              listStyle: "none",
              padding: "0",
              margin: "0",
              fontSize: "13px",
              color: "var(--muted-foreground)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            {opens.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <p style={{ fontSize: "12px", color: "var(--muted-foreground)", margin: "20px 0 0" }}>
          {isId
            ? "Pembayaran lewat transfer manual yang diperiksa admin, atau Midtrans — keduanya dari dalam aplikasi."
            : "Pay by manual transfer reviewed by an admin, or Midtrans — both from inside the app."}
        </p>

        <button
          type="button"
          className="auth-control"
          onClick={onEnter}
          style={{
            width: "100%",
            minHeight: "44px",
            marginTop: "24px",
            padding: "10px 16px",
            fontSize: "14px",
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            color: "var(--primary-foreground)",
            background: "var(--primary)",
            border: "1px solid var(--primary)",
            borderRadius: "var(--radius)",
            cursor: "pointer",
          }}
        >
          {isId ? "Masuk atau buat akun" : "Sign in or create an account"}
        </button>
      </main>
    </div>
  );
}

/**
 * The link from the sign-in surface to the price above. Optional prop, styled
 * like the login/signup switch: one honest affordance, no banner.
 */
export function PricingLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="auth-link"
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        font: "inherit",
        fontSize: "13px",
        color: "var(--link)",
        cursor: "pointer",
        textDecoration: "underline",
      }}
    >
      {label}
    </button>
  );
}
