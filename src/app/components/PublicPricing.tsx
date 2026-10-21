/**
 * The price, for a person who has no session.
 *
 * A price that can only be read after signing up is not a price — the person
 * deciding whether to subscribe is, by definition, not yet subscribed. This
 * page shows what that person can actually decide from: what the subscription
 * opens, and what it costs, read from the one public data endpoint the app has
 * (`GET /v1/subscriptions/pricing`).
 *
 * Redesigned 2026-10-21 from the owner's reference artwork
 * (`referensi/design-harga.png`): an always-dark sheet, a row of three plan
 * cards with badges and an interactive radio group, a saving strip on the
 * annual card, a gradient entry control, and the opens panel with icon tiles.
 * The sheet's colors are page-scoped tokens (`--public-*` in theme.css), read
 * from the reference; the logo is the owner's traced mark with the background
 * path removed (`src/assets/aidss-logo.svg`).
 *
 * What it deliberately does not have:
 *
 * - No "Beli" button and no payment form. Deciding that a visitor starts a
 *   purchase from here would be a purchase path with no session behind it; the
 *   plan that built billing put the declaration inside the app, after signup.
 * - No market-data promises. The panel names exactly what the gate refuses
 *   (`/v1/signals`, `/v1/alerts`, the risk panel, optimisation) and claims
 *   nothing else.
 * - No zero on failure. 503 means the install has no configured price, and
 *   printing "Rp 0" would quote a real customer for free — same rule the
 *   settings tab lives by. The card's price slot stays empty and the refusal
 *   sentence below the cards does the explaining.
 * - No private copy of a number. The comparison inside the annual card is
 *   computed from the three values the server just sent, so a price the admin
 *   changes tonight updates this fact tonight.
 *
 * The radio is a control, on the owner's instruction. The reference shows the
 * annual card pre-checked as the recommended pick, and the owner chose "the
 * radio picks the plan like its card's button does", so:
 *
 * - clicking a radio or its card's button does the same thing: onPickPlan;
 * - the group starts with annual checked (the reference's recommended look);
 * - arrow keys move focus only — no keyboard press can throw the visitor into
 *   signup without them pressing Enter or Space first.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bell, PieChart, Play, ShieldCheck, Zap } from "lucide-react";
import { apiFetch, ENDPOINTS } from "../config/api";
import type { Locale } from "../i18n/translations";
import type { PlanKey } from "../planIntent";
import logoUrl from "../../assets/aidss-logo.svg";

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

interface PlanCopy {
  key: PlanKey;
  id: string;
  en: string;
  subId: string;
  subEn: string;
  badgeId: string;
  badgeEn: string;
  /** The reference's raised card: gradient top edge, green pill, filled button. */
  raised: boolean;
}

const PLANS: PlanCopy[] = [
  {
    key: "weekly",
    id: "Mingguan",
    en: "Weekly",
    subId: "per minggu",
    subEn: "per week",
    badgeId: "FLEKSIBEL",
    badgeEn: "FLEXIBLE",
    raised: false,
  },
  {
    key: "monthly",
    id: "Bulanan",
    en: "Monthly",
    subId: "per bulan",
    subEn: "per month",
    badgeId: "POPULER",
    badgeEn: "POPULAR",
    raised: false,
  },
  {
    key: "annual",
    id: "Tahunan",
    en: "Annual",
    subId: "per tahun",
    subEn: "per year",
    badgeId: "Nilai Terbaik",
    badgeEn: "Best value",
    raised: true,
  },
];

/* The panel tiles, in the same order as the opens list below. lucide is the
   app's existing icon source; no new assets are invented here. */
const ICONS = [Zap, Bell, ShieldCheck, PieChart];

export function PublicPricing({ locale, onEnter, onPickPlan }: PublicPricingProps) {
  const isId = locale === "id";
  const [price, setPrice] = useState<PriceState>({ kind: "loading" });
  /** The reference's pre-checked recommendation. The user's choice moves it. */
  const [picked, setPicked] = useState<PlanKey>("annual");
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  const pick = (key: PlanKey) => {
    setPicked(key);
    onPickPlan(key);
  };

  /* Arrows move focus around the group, wrapping. They never activate, so a
     press of an arrow key can never commit the visitor to signup. Space and
     Enter come from the button itself, which is the activation the owner
     asked for. */
  const moveFocus = (from: number, step: 1 | -1) => {
    const radios = radioRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    if (radios.length === 0) return;
    radios[(from + step + radios.length) % radios.length].focus();
  };

  const onGroupKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const radios = radioRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    const index = radios.indexOf(target);
    if (index === -1) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(index, 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(index, -1);
    }
  };

  /* Card surfaces use the page tokens, not the app theme, because this sheet
     is always dark no matter which theme mode the app is in. */
  const cardStyle = (raised: boolean): React.CSSProperties => ({
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minHeight: "318px",
    padding: "22px 22px 22px",
    background: raised ? "var(--public-card-raised)" : "var(--public-card)",
    border: "1px solid var(--public-border)",
    borderRadius: "16px",
    boxShadow:
      "0 18px 40px rgba(5, 8, 16, 0.35)",
  });

  const radioStyle = (checked: boolean): React.CSSProperties => ({
    width: "22px",
    height: "22px",
    flex: "none",
    display: "grid",
    placeItems: "center",
    padding: 0,
    background: "transparent",
    border: `2px solid ${checked ? "var(--public-accent)" : "var(--public-border-strong)"}`,
    borderRadius: "50%",
    cursor: "pointer",
  });

  const ghostPickStyle: React.CSSProperties = {
    width: "100%",
    minHeight: "42px",
    padding: "9px 14px",
    fontSize: "14px",
    fontWeight: 600,
    fontFamily: "var(--font-sans)",
    color: "var(--public-foreground)",
    background: "transparent",
    border: "1px solid var(--public-border-strong)",
    borderRadius: "10px",
    cursor: "pointer",
  };

  const solidPickStyle: React.CSSProperties = {
    ...ghostPickStyle,
    minHeight: "44px",
    color: "var(--public-bg)",
    background: "var(--public-accent)",
    border: "1px solid var(--public-accent)",
    borderRadius: "999px",
    boxShadow: "0 10px 30px rgba(125, 211, 252, 0.22)",
  };

  const priceStyle: React.CSSProperties = {
    fontFamily: "var(--font-sans)",
    fontVariantNumeric: "tabular-nums",
    fontSize: "26px",
    fontWeight: 700,
    letterSpacing: "-0.01em",
    lineHeight: 1.2,
  };

  const priceSlot = (value: number) =>
    price.kind === "ready" ? (
      <span style={priceStyle}>{`Rp ${value.toLocaleString(localeTag(locale))}`}</span>
    ) : price.kind === "loading" ? (
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: "120px",
          height: "22px",
          borderRadius: 4,
          background: "rgba(140, 163, 199, 0.18)",
        }}
      />
    ) : null;

  return (
    <div className="pub-shell" style={{ background: "var(--public-bg)", color: "var(--public-foreground)", fontFamily: "var(--font-sans)" }}>
      <div className="pub-frame">
        {/* The bar: the owner's mark (background removed) on the left, the one
            reference line on the right. Text next to it stays out; the mark
            already says the name. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            borderBottom: "1px solid var(--public-border)",
            paddingBottom: "16px",
            marginBottom: "36px",
          }}
        >
          <img src={logoUrl} alt="AIDSS" style={{ height: "26px", width: "auto", display: "block" }} />
          <span style={{ fontSize: "13px", color: "var(--public-muted)" }}>
            Trading Intelligence Platform
          </span>
        </div>

        <div style={{ marginBottom: "28px" }}>
          <h1
            style={{
              fontSize: "38px",
              fontWeight: 700,
              letterSpacing: "-0.01em",
              lineHeight: 1.15,
              margin: 0,
              fontFamily: "var(--font-display)",
            }}
          >
            {isId ? "Harga langganan" : "Subscription price"}
          </h1>
          <p style={{ fontSize: "15px", color: "var(--public-muted)", margin: "10px 0 0", maxWidth: "620px", lineHeight: 1.6 }}>
            {isId
              ? "Apa yang dibuka langganan, dan berapa harganya."
              : "What a subscription opens, and what it costs."}
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label={isId ? "Pilih paket" : "Choose plan"}
          className="pub-plans"
          onKeyDown={onGroupKeyDown}
          style={{ marginBottom: "28px" }}
        >
          {PLANS.map((plan, index) => {
            const label = isId ? plan.id : plan.en;
            const checked = picked === plan.key;
            const value = price.kind === "ready" ? price[plan.key] : null;
            return (
              <div key={plan.key} style={cardStyle(plan.raised)}>
                {plan.raised && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: "3px",
                      background: "linear-gradient(90deg, var(--public-accent), var(--public-green))",
                    }}
                  />
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  {/* The control the owner chose: same action as the card's
                      button, radiogroup semantics for the announcement. */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={`${isId ? "Pilih paket" : "Choose plan"} ${label}`}
                    ref={(el) => { radioRefs.current[index] = el; }}
                    onClick={() => pick(plan.key)}
                    style={radioStyle(checked)}
                  >
                    {checked && (
                      <span
                        aria-hidden="true"
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: "var(--public-accent)",
                        }}
                      />
                    )}
                  </button>
                  {plan.raised ? (
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        lineHeight: 1,
                        color: "var(--public-green)",
                        background: "var(--public-green-bg)",
                        border: "1px solid var(--public-green-border)",
                        borderRadius: "999px",
                        padding: "6px 12px",
                      }}
                    >
                      {isId ? plan.badgeId : plan.badgeEn}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: "0.12em",
                        color: "var(--public-muted)",
                      }}
                    >
                      {isId ? plan.badgeId : plan.badgeEn}
                    </span>
                  )}
                </div>
                <div style={{ margin: "20px 0 0" }}>
                  <div style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>{label}</div>
                  <div style={{ fontSize: "12px", color: "var(--public-muted)", margin: "4px 0 0" }}>
                    {isId ? plan.subId : plan.subEn}
                  </div>
                </div>
                <span aria-hidden="true" style={{ display: "block", height: "1px", background: "var(--public-border)", margin: "16px 0 18px" }} />
                <div style={{ minHeight: "32px" }}>{value !== null && priceSlot(value)}</div>
                {plan.key === "annual" && showSaving && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginTop: "16px",
                      padding: "10px 12px",
                      background: "var(--public-green-bg)",
                      border: "1px solid var(--public-green-border)",
                      borderRadius: "10px",
                      fontSize: "12px",
                      lineHeight: 1.4,
                      color: "var(--public-green)",
                    }}
                  >
                    <Play size={12} color="var(--public-green)" fill="var(--public-green)" aria-hidden="true" />
                    <span>
                      {isId
                        ? `Hemat ${annualSaving}% terhadap tarif bulanan.`
                        : `About ${annualSaving}% below the monthly rate.`}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className={plan.raised ? "pub-pick-solid" : "pub-pick"}
                  aria-label={`${isId ? "Pilih paket" : "Choose plan"} ${label}`}
                  onClick={() => pick(plan.key)}
                  style={{ ...ghostPickStyle, ...plan.raised ? solidPickStyle : {}, marginTop: "auto" }}
                >
                  {isId ? "Pilih paket" : "Choose plan"}
                </button>
              </div>
            );
          })}
        </div>

        {price.kind === "loading" && (
          <p role="status" style={{ fontSize: "13px", color: "var(--public-muted)", margin: "0 0 8px" }}>
            {isId ? "Memuat harga…" : "Loading price…"}
          </p>
        )}

        {price.kind === "unavailable" && (
          <p
            role="status"
            style={{
              fontSize: "13px",
              lineHeight: 1.6,
              color: "var(--public-muted)",
              background: "var(--public-card)",
              border: "1px solid var(--public-border)",
              borderRadius: "16px",
              padding: "12px 16px",
              margin: "0 0 8px",
            }}
          >
            {isId
              ? "Harga tidak dapat dimuat. Tidak ditampilkan sebagai nol: nol bukan harga yang ditetapkan."
              : "The price could not be loaded. Not shown as zero: zero is not a price anyone set."}
          </p>
        )}

        <div className="pub-grid" style={{ flex: 1 }}>
          {/* The step that follows the three prices, and the payment facts:
              read the prices, then act, then read how the payment reaches
              this install. All directly under the answer they belong to. */}
          <section>
            <button
              type="button"
              className="pub-pick-solid"
              onClick={onEnter}
              style={{
                width: "100%",
                minHeight: "52px",
                padding: "12px 20px",
                fontSize: "17px",
                fontWeight: 700,
                fontFamily: "var(--font-sans)",
                color: "var(--public-bg)",
                background: "linear-gradient(90deg, var(--public-accent), var(--public-accent-deep))",
                border: "none",
                borderRadius: "12px",
                cursor: "pointer",
                boxShadow: "0 12px 32px rgba(64, 196, 248, 0.22)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
              }}
            >
              <span>{isId ? "Masuk atau buat akun" : "Sign in or create an account"}</span>
              <ArrowRight size={18} aria-hidden="true" strokeWidth={2.2} />
            </button>
            <p style={{ fontSize: "13px", color: "var(--public-muted)", marginTop: "16px", lineHeight: 1.6, maxWidth: "54ch" }}>
              {isId
                ? "Pembayaran lewat transfer manual yang diperiksa admin, atau Midtrans, keduanya dari dalam aplikasi."
                : "Pay by manual transfer reviewed by an admin, or Midtrans, both from inside the app."}
            </p>
          </section>

          <section
            style={{
              background: "var(--public-card)",
              border: "1px solid var(--public-border)",
              borderRadius: "16px",
              padding: "22px 24px",
            }}
          >
            <h2
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                margin: 0,
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              <span
                aria-hidden="true"
                style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--public-accent)", flex: "none" }}
              />
              {isId ? "Yang dibuka langganan" : "What a subscription opens"}
            </h2>
            <ul className="pub-opens" style={{ listStyle: "none", padding: 0, margin: "20px 0 0" }}>
              {opens.map((item, i) => {
                const Icon = ICONS[i];
                return (
                  <li key={item.name} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                    <span
                      aria-hidden="true"
                      style={{
                        flex: "none",
                        width: "40px",
                        height: "40px",
                        display: "grid",
                        placeItems: "center",
                        background: "var(--public-tile-bg)",
                        border: "1px solid var(--public-border)",
                        borderRadius: "10px",
                      }}
                    >
                      <Icon size={18} color="var(--public-accent)" strokeWidth={2} />
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                      <span style={{ fontSize: "14px", fontWeight: 600 }}>{item.name}</span>
                      <span style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--public-muted)" }}>{item.desc}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* The rest that closes the canvas: the name returns at full width, and
            beside it the only provenance fact the price has, when the server
            timestamps one. */}
        <footer
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "16px",
            borderTop: "1px solid var(--public-border)",
            paddingTop: "14px",
            marginTop: "24px",
          }}
        >
          <span style={{ fontFamily: "var(--font-display)", fontSize: "13px", fontWeight: 700, letterSpacing: "0.02em" }}>
            AIDSS
          </span>
          {price.kind === "ready" && price.updatedAt && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--public-muted)" }}>
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
