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
 * - No private copy of a number. The comparison under the annual row is
 *   computed from the three values the server just sent, so a price the admin
 *   changes tonight updates this fact tonight.
 */

import { useEffect, useState } from "react";
import { apiFetch, ENDPOINTS } from "../config/api";
import type { Locale } from "../i18n/translations";
import type { PlanKey } from "../planIntent";

export interface PublicPricingProps {
  locale: Locale;
  /** The sign-in / sign-up surface. Wiring decides where that is. */
  onEnter: () => void;
  /** A price line was picked: the walk-in to signup carries it along. */
  onPickPlan: (plan: PlanKey) => void;
}

type PriceState =
  | { kind: "loading" }
  | { kind: "ready"; weekly: number; monthly: number; annual: number; updatedAt: string | null }
  | { kind: "unavailable" };

const localeTag = (locale: Locale) => (locale === "id" ? "id-ID" : "en-GB");

export function PublicPricing({ locale, onEnter, onPickPlan }: PublicPricingProps) {
  const isId = locale === "id";
  const [price, setPrice] = useState<PriceState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await apiFetch(ENDPOINTS.pricing, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          weekly: number;
          monthly: number;
          annual: number;
          updatedAt: string | null;
        };
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
          updatedAt: body.updatedAt ?? null,
        });
      } catch {
        if (controller.signal.aborted) return;
        setPrice({ kind: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, []);

  const opens: { name: string; desc: string }[] = isId
    ? [
        { name: "Sinyal", desc: "Rekomendasi per saham dengan skor dan alasannya." },
        { name: "Peringatan otomatis", desc: "Terbit saat kondisi pasar memenuhinya." },
        { name: "Panel risiko", desc: "Ringkasan risiko portofolio Anda." },
        { name: "Optimasi portofolio", desc: "Alokasi ulang yang disarankan untuk portofolio Anda." },
      ]
    : [
        { name: "Signals", desc: "Scored calls per stock, with the reasons." },
        { name: "Automatic alerts", desc: "Issued when market conditions meet them." },
        { name: "Risk panel", desc: "A summary of your portfolio's risk." },
        { name: "Portfolio optimisation", desc: "Suggested reallocation for your portfolio." },
      ];

  // The one derived figure, keyed to its baseline and recomputed from what the
  // server just said. Hidden rather than printed when there is nothing real to
  // say: a saving of zero or a division by zero both mean "no fact".
  const annualSaving = price.kind === "ready" && price.monthly > 0
    ? Math.round(((price.monthly * 12 - price.annual) / (price.monthly * 12)) * 100)
    : null;
  const showSaving = annualSaving !== null && annualSaving > 0;

  const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "16px",
    padding: "24px 20px",
    borderBottom: "1px solid var(--border)",
  };
  const rowLabelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    minWidth: 0,
  };
  const rowValueStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums",
    fontSize: "20px",
    whiteSpace: "nowrap",
  };

  /* Quiet branded-border button per price line: picking is an intent, not a
     payment, so it stays hairline-muted rather than primary. */
  const pickStyle: React.CSSProperties = {
    minHeight: 36,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "var(--font-sans)",
    color: "var(--foreground)",
    background: "transparent",
    border: "1px solid var(--control-border)",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const skeletonBar = (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "96px",
        height: "18px",
        borderRadius: 3,
        background: "var(--muted)",
      }}
    />
  );

  return (
    <div className="pub-shell" style={{ background: "var(--background)", color: "var(--foreground)", fontFamily: "var(--font-sans)" }}>
      <div className="pub-frame">
        {/* No-sidebar shell: the name on the column's left edge, nothing else
            in the bar. The bar holds one real thing, so it is not filler. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: "32px",
            marginBottom: "32px",
          }}
        >
          <span style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, letterSpacing: "0.02em" }}>
            AIDSS
          </span>
        </div>

        <div style={{ marginBottom: "40px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 600, margin: 0, fontFamily: "var(--font-display)" }}>
            {isId ? "Harga langganan" : "Subscription price"}
          </h1>
          <p style={{ fontSize: "15px", color: "var(--muted-foreground)", margin: "12px 0 0", maxWidth: "620px", lineHeight: 1.6 }}>
            {isId
              ? "Apa yang dibuka langganan, dan berapa harganya."
              : "What a subscription opens, and what it costs."}
          </p>
        </div>

        <div className="pub-grid">
          <section>
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
              }}
            >
              {price.kind === "ready" && (
                <>
                  {([
                    ["weekly",  isId ? "Mingguan" : "Weekly",  isId ? "per minggu" : "per week",  price.weekly],
                    ["monthly", isId ? "Bulanan" : "Monthly", isId ? "per bulan" : "per month", price.monthly],
                    ["annual",  isId ? "Tahunan" : "Annual",  isId ? "per tahun" : "per year",  price.annual],
                  ] as const).map(([key, label, sub, value], index) => (
                    <div
                      key={key}
                      style={{ ...rowStyle, borderBottom: index === 2 && !showSaving ? "none" : "1px solid var(--border)" }}
                    >
                      <div style={rowLabelStyle}>
                        <span style={{ fontSize: "15px", fontWeight: 500 }}>{label}</span>
                        <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>{sub}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <div style={rowValueStyle}>{`Rp ${value.toLocaleString(localeTag(locale))}`}</div>
                        <button
                          type="button"
                          onClick={() => onPickPlan(key)}
                          aria-label={`${isId ? "Pilih paket" : "Choose plan"} ${label}`}
                          style={pickStyle}
                        >
                          {isId ? "Pilih paket" : "Choose plan"}
                        </button>
                      </div>
                    </div>
                  ))}
                  {/* The saving reads full-width under the annual row, not inside
                      its label column: at phone width that column is too narrow
                      and the sentence wraps onto two lines. */}
                  {showSaving && (
                    <div style={{ padding: "12px 20px", fontSize: "12px", color: "var(--accent-foreground)" }}>
                      {isId
                        ? `Hemat ${annualSaving}% terhadap tarif bulanan.`
                        : `About ${annualSaving}% below the monthly rate.`}
                    </div>
                  )}
                </>
              )}

              {price.kind === "loading" && (
                <>
                  <div style={rowStyle}>
                    <div style={rowLabelStyle}>
                      <span style={{ fontSize: "15px", fontWeight: 500 }}>{isId ? "Mingguan" : "Weekly"}</span>
                      <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>{isId ? "per minggu" : "per week"}</span>
                    </div>
                    {skeletonBar}
                  </div>
                  <div style={rowStyle}>
                    <div style={rowLabelStyle}>
                      <span style={{ fontSize: "15px", fontWeight: 500 }}>{isId ? "Bulanan" : "Monthly"}</span>
                      <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>{isId ? "per bulan" : "per month"}</span>
                    </div>
                    {skeletonBar}
                  </div>
                  <div style={{ ...rowStyle, borderBottom: "none" }}>
                    <div style={rowLabelStyle}>
                      <span style={{ fontSize: "15px", fontWeight: 500 }}>{isId ? "Tahunan" : "Annual"}</span>
                      <span style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>{isId ? "per tahun" : "per year"}</span>
                    </div>
                    {skeletonBar}
                  </div>
                </>
              )}
            </div>

            {price.kind === "loading" && (
              <p role="status" style={{ fontSize: "13px", color: "var(--muted-foreground)", margin: "12px 0 0" }}>
                {isId ? "Memuat harga…" : "Loading price…"}
              </p>
            )}

            {price.kind === "unavailable" && (
              <p
                role="status"
                style={{
                  fontSize: "13px",
                  lineHeight: 1.6,
                  color: "var(--muted-foreground)",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "12px 16px",
                  margin: 0,
                }}
              >
                {isId
                  ? "Harga tidak dapat dimuat. Tidak ditampilkan sebagai nol: nol bukan harga yang ditetapkan."
                  : "The price could not be loaded. Not shown as zero: zero is not a price anyone set."}
              </p>
            )}

            {/* The step that follows the three prices, and the payment facts:
                read the prices, then act, then read how the payment reaches
                this install. All directly under the answer they belong to. */}
            <button
              type="button"
              className="auth-control"
              onClick={onEnter}
              style={{
                width: "100%",
                minHeight: "48px",
                marginTop: "20px",
                padding: "12px 16px",
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
            <p style={{ fontSize: "13px", color: "var(--muted-foreground)", marginTop: "18px", lineHeight: 1.6, maxWidth: "54ch" }}>
              {isId
                ? "Pembayaran lewat transfer manual yang diperiksa admin, atau Midtrans, keduanya dari dalam aplikasi."
                : "Pay by manual transfer reviewed by an admin, or Midtrans, both from inside the app."}
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 14px" }}>
              {isId ? "Yang dibuka langganan" : "What a subscription opens"}
            </h2>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                fontSize: "15px",
                color: "var(--foreground)",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {opens.map((item) => (
                <li key={item.name} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  <span style={{ fontWeight: 500 }}>{item.name}</span>
                  <span style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>{item.desc}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* The rest that closes the canvas: the name returns at full width, and
            beside it the only provenance fact the price has, when the server
            timestamps one. */}
        <div style={{ flex: 1, minHeight: "48px" }} />
        <footer
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "16px",
            borderTop: "1px solid var(--border)",
            paddingTop: "14px",
          }}
        >
          <span style={{ fontFamily: "var(--font-display)", fontSize: "13px", fontWeight: 700, letterSpacing: "0.02em" }}>
            AIDSS
          </span>
          {price.kind === "ready" && price.updatedAt && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted-foreground)" }}>
              {isId ? "Harga diperbarui " : "Prices updated "}
              {new Date(price.updatedAt).toLocaleDateString(localeTag(locale), {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          )}
        </footer>
      </div>
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
