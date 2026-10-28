/**
 * The price, for a person who has no session.
 *
 * A price that can only be read after signing up is not a price — the person
 * deciding whether to subscribe is, by definition, not yet subscribed. This
 * page shows what that person can actually decide from: what the subscription
 * opens, and what it costs, read from the one public data endpoint the app has
 * (`GET /v1/subscriptions/pricing`).
 *
 * Rebuilt 2026-10-22 into a full page from the owner's fixed reference
 * (`referensi/design-harga-fix.png`, ronde 9): a topbar with page navigation
 * and the sign-in gate, a heading block, three plan cards, a caption, a
 * four-pillar feature band, and a navy footer with a live Jakarta clock. The
 * colours are page-scoped tokens (`--public-*` in theme.css), read from the
 * reference; the content sits in one ~1160px column. The logo is the owner's
 * traced mark used as-is — the one intentional departure from the artwork,
 * which carries its own illustrative mark that is not an asset we own.
 *
 * What it deliberately does not have:
 *
 * - No "Beli" button and no payment form. Deciding that a visitor starts a
 *   purchase from here would be a purchase path with no session behind it; the
 *   plan that built billing put the declaration inside the app, after signup.
 *   "Masuk" opens the sign-in form and "Buat akun" the signup form directly
 *   (owner, 2026-10-23); the card's own picks walk into signup carrying a
 *   plan intent, and nothing on this page is a purchase control.
 * - No market-data promises. The pillar band names exactly what the gate
 *   refuses (`/v1/signals`, `/v1/alerts`, the risk panel, optimisation) and
 *   claims nothing else; its four descriptions are the card lists' tails.
 * - No zero on failure. 503 means the install has no configured price, and
 *   printing "Rp 0" would quote a real customer for free — same rule the
 *   settings tab lives by. The price slots stay empty and the refusal
 *   sentence under the cards does the explaining.
 * - No private copy of a number. The annual card's "Setara … per bulan" is
 *   computed from the values the server just sent, so a price the admin
 *   changes tonight updates that fact tonight. The caption's tax sentence is
 *   not a computation: it is the owner's own word (confirmed 2026-10-22 that
 *   prices include tax).
 * - No image assets. The 2026-10-21 sheet leaned on two PNGs for its ground
 *   and its button; this page is flat colour and CSS only, so the assets
 *   directory keeps nothing but the logo.
 *
 * The radio is a control, on the owner's instruction:
 *
 * - clicking a radio or its card's button does the same thing: onPickPlan;
 * - the group starts with monthly checked — the fixed reference's pick
 *   (owner's answer, 2026-10-22), replacing annual from ronde enam;
 * - arrow keys move focus only — no keyboard press can throw the visitor into
 *   signup without them pressing Enter or Space first;
 * - the ronde 9 answer on the ronde 8 objection (a coloured dot marking the
 *   selection at rest): the picked radio IS visibly marked, in a monochrome
 *   navy dot that the artwork shows; the accent dot stays a hover garnish,
 *   never a state marker.
 */

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, ArrowUpRight, Bell, PieChart, ShieldCheck } from "lucide-react";
import { apiFetch, ENDPOINTS } from "../config/api";
import type { Locale } from "../i18n/translations";
import type { PlanKey } from "../planIntent";
import { PublicFooter, type NavColumn } from "./PublicFooter";
import { PublicNavMenu } from "./PublicNavMenu";
import logoUrl from "../../assets/aidss-logo.svg";

export interface PublicPricingProps {
  locale: Locale;
  /** The sign-in surface. Wiring decides where that is. */
  onEnter: () => void;
  /** The signup form itself: the topbar's Buat akun opens it directly
   *  (owner, 2026-10-23) instead of riding the same gate as Masuk. */
  onSignUp: () => void;
  /** The features screen: the topbar's Fitur walks there (owner, 2026-10-23).
   *  The sheet keeps #pilar for the footer's products column and deep links. */
  onViewFeatures: () => void;
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
  /** The period after the price, as the reference prints it ("/ minggu"). */
  suffixId: string;
  suffixEn: string;
  badgeId: string;
  badgeEn: string;
  /** The static commitment note under the price; the annual one is computed
   *  from the server's values instead, so this stays empty there. */
  noteId: string;
  noteEn: string;
}

const PLANS: PlanCopy[] = [
  {
    key: "weekly",
    id: "Mingguan",
    en: "Weekly",
    suffixId: "/ minggu",
    suffixEn: "/ week",
    badgeId: "FLEKSIBEL",
    badgeEn: "FLEXIBLE",
    noteId: "Tanpa komitmen jangka panjang",
    noteEn: "No long-term commitment",
  },
  {
    key: "monthly",
    id: "Bulanan",
    en: "Monthly",
    suffixId: "/ bulan",
    suffixEn: "/ month",
    badgeId: "POPULER",
    badgeEn: "POPULAR",
    noteId: "Perpanjangan otomatis, batalkan kapan saja",
    noteEn: "Auto-renews, cancel anytime",
  },
  {
    key: "annual",
    id: "Tahunan",
    en: "Annual",
    suffixId: "/ tahun",
    suffixEn: "/ year",
    badgeId: "Nilai Terbaik",
    badgeEn: "Best value",
    noteId: "",
    noteEn: "",
  },
];

/* The four pillars, in the reference's order. The descriptions are the
   card lists' tails — the same facts, said once each. lucide is the app's
   existing icon source; no new assets are invented here. */
const PILLARS = [
  { nameId: "Sinyal", nameEn: "Signals", descId: "Sinyal masuk dan keluar untuk saham yang Anda pantau, lengkap dengan alasannya.", descEn: "Entry and exit calls for the stocks you track, with the reasons attached." },
  { nameId: "Peringatan otomatis", nameEn: "Automatic alerts", descId: "Terbit saat kondisi pasar memenuhi aturan yang Anda tetapkan.", descEn: "Issued when market conditions meet the rules you set." },
  { nameId: "Panel risiko", nameEn: "Risk panel", descId: "Ringkasan risiko portofolio Anda dalam satu tampilan.", descEn: "A summary of your portfolio's risk in one view." },
  { nameId: "Optimasi portofolio", nameEn: "Portfolio optimisation", descId: "Alokasi ulang yang disarankan untuk portofolio Anda.", descEn: "Suggested reallocation for your portfolio." },
];

const ICONS = [Activity, Bell, ShieldCheck, PieChart];

/* The footer's link columns: everything anchors either to the pillar band,
   the cards, or the disclaimer inside this page — pointing at a page that
   does not exist yet would be a lie in the layout. "Hubungi kami" is held
   back until the owner names its channel ([OWNER TO NAME] is still open);
   an anchor without href renders like the rest but goes nowhere. */
const NAV_COLUMNS: NavColumn[] = [
  {
    headId: "PRODUK",
    headEn: "PRODUCT",
    items: PILLARS.map((pillar) => ({ id: pillar.nameId, en: pillar.nameEn, anchor: "#pilar" })),
  },
  {
    headId: "LANGGANAN",
    headEn: "PLANS",
    items: [
      ...PLANS.map((plan) => ({ id: plan.id, en: plan.en, anchor: "#harga" })),
      { id: "Bandingkan paket", en: "Compare plans", anchor: "#harga" },
    ],
  },
  {
    headId: "BANTUAN",
    headEn: "SUPPORT",
    items: [
      { id: "Hubungi kami", en: "Contact us", anchor: "", held: true },
      { id: "Catatan risiko", en: "Risk notes", anchor: "#catatan" },
      { id: "Pembaruan harga", en: "Price updates", anchor: "#harga" },
    ],
  },
];

export function PublicPricing({ locale, onEnter, onSignUp, onViewFeatures, onPickPlan }: PublicPricingProps) {
  const isId = locale === "id";
  const [price, setPrice] = useState<PriceState>({ kind: "loading" });
  /** The fixed reference's pre-checked pick. The user's choice moves it. */
  const [picked, setPicked] = useState<PlanKey>("monthly");
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

  // The one derived figure, keyed to its baseline and recomputed from what the
  // server just said. Hidden rather than printed when there is nothing real to
  // say: a saving of zero or a division by zero both mean "no fact".
  const annualSaving = price.kind === "ready" && price.monthly > 0
    ? Math.round(((price.monthly * 12 - price.annual) / (price.monthly * 12)) * 100)
    : null;
  const showSaving = annualSaving !== null && annualSaving > 0;

  const annualEquivalent = price.kind === "ready" && price.annual > 0
    ? Math.round(price.annual / 12)
    : null;

  const formatNumber = (value: number) => value.toLocaleString(localeTag(locale));

  const pillarRows = PILLARS.map((pillar) => ({
    name: isId ? pillar.nameId : pillar.nameEn,
    desc: isId ? pillar.descId : pillar.descEn,
  }));

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

  const pickPlanLabel = isId ? "Pilih paket" : "Choose plan";

  const priceSlot = (value: number | null) =>
    price.kind === "ready" && value !== null ? (
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontVariantNumeric: "tabular-nums",
          fontSize: "34px",
          fontWeight: 700,
          letterSpacing: "-0.01em",
          lineHeight: 1.1,
          color: "var(--public-ink)",
        }}
      >
        {`Rp ${formatNumber(value)}`}
      </span>
    ) : price.kind === "loading" ? (
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: "140px",
          height: "26px",
          borderRadius: 6,
          background: "rgba(47, 49, 51, 0.14)",
        }}
      />
    ) : null;

  return (
    <div className="pub-shell" style={{ fontFamily: "var(--font-sans)" }}>
      {/* The visitor's gate, rebuilt as the reference's topbar: the
          platform label, both enter controls, and the hamburger carrying
          the page links (owner, 2026-10-24). "Masuk" opens the sign-in
          form, "Buat akun" the signup form directly (owner, 2026-10-23) —
          the sheet itself stays a page that carries no purchase path, and
          neither gate ever hides behind the menu. */}
      <header className="pub-topbar">
        <div className="pub-container">
          <span className="pub-brand-chip">
            <img src={logoUrl} alt="AIDSS" className="pub-logo" />
          </span>
          <div className="pub-topbar-right">
            <span aria-hidden="true" className="pub-topbar-dot" />
            <span className="pub-topbar-label">Trading Intelligence Platform</span>
            <span aria-hidden="true" className="pub-topbar-sep" />
            <button type="button" className="pub-topbar-link" onClick={onEnter}>
              {isId ? "Masuk" : "Sign in"}
            </button>
            <button type="button" className="pub-enter" onClick={onSignUp}>
              {isId ? "Buat akun" : "Create account"}
              <ArrowUpRight size={14} aria-hidden="true" strokeWidth={2.2} />
            </button>
          </div>
          {/* Far right of the bar (owner, 2026-10-24): the page links in a
              small popup, the gates left standing beside it. The sheet has
              no Harga entry on purpose: the reader already sits on it. */}
          <PublicNavMenu
            locale={locale}
            ariaLabel={isId ? "Navigasi lembar harga" : "Pricing sheet navigation"}
            targets={[
              {
                href: "/fitur",
                label: isId ? "Fitur" : "Features",
                onNavigate: onViewFeatures,
              },
              { href: "#catatan", label: isId ? "Catatan" : "Notes" },
            ]}
          />
        </div>
      </header>

      <main>
        {/* The heading block and the cards: read the price, act on it. */}
        <section id="harga" className="pub-hero">
          <div className="pub-container">
            <p className="pub-eyebrow">{isId ? "LANGGANAN" : "SUBSCRIPTION"}</p>
            {/* The owner's headline (2026-10-23): one sentence in the display
                face for both locales, with the house name as its navy tail —
                sizing and the two-tone treatment live in auth.css. */}
            <h1>
              Subscription AI Investment Decision Support{" "}
              <span className="pub-hero-brand">by Meta Cash Asset.</span>
            </h1>
            <p className="pub-tagline">
              {isId
                ? "Sinyal berskala, peringatan otomatis, panel risiko, dan optimasi portofolio untuk keputusan yang lebih tenang."
                : "Scaled signals, automatic alerts, a risk panel, and portfolio optimisation for calmer decisions."}
            </p>

            <div
              role="radiogroup"
              aria-label={isId ? "Pilih paket" : "Choose plan"}
              className="pub-plans"
              onKeyDown={onGroupKeyDown}
            >
              {PLANS.map((plan, index) => {
                const label = isId ? plan.id : plan.en;
                const checked = picked === plan.key;
                const value = price.kind === "ready" ? price[plan.key] : null;
                const note = isId ? plan.noteId : plan.noteEn;
                const equivalentNote = plan.key === "annual" && annualEquivalent !== null
                  ? isId
                    ? `Setara Rp ${formatNumber(annualEquivalent)} per bulan`
                    : `Equivalent to Rp ${formatNumber(annualEquivalent)} per month`
                  : null;
                const cardNote = plan.key === "annual" ? equivalentNote : note || null;
                return (
                  <div key={plan.key} className="pub-card" data-checked={checked ? "true" : undefined}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      {/* The control the owner chose: same action as the card's
                          button, radiogroup semantics for the announcement;
                          the marking dot is CSS state, the meaning is
                          aria-checked. */}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        aria-label={`${pickPlanLabel} ${label}`}
                        ref={(el) => { radioRefs.current[index] = el; }}
                        onClick={() => pick(plan.key)}
                        className="pub-radio"
                      >
                        <span aria-hidden="true" className="pub-radio-dot" />
                      </button>
                      {/* Tone pills: solid navy marks the checked card (the
                          artwork's POPULER pill); data keeps its own casing. */}
                      <span
                        className="pub-badge"
                        data-tone={checked ? "solid" : plan.key === "annual" ? "mint" : "lavender"}
                      >
                        {isId ? plan.badgeId : plan.badgeEn}
                      </span>
                    </div>
                    <div style={{ margin: "18px 0 0" }}>
                      <div style={{ fontSize: "18px", fontWeight: 700 }}>{label}</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "10px" }}>
                        {priceSlot(value)}
                        {/* The period is a constant truth, so it stays beside
                            the skeleton too; on failure the price row empties
                            entirely — a period with no number would still be
                            honest, but an empty slot reads cleaner than a
                            decimal point of a sentence. */}
                        {price.kind !== "unavailable" && (
                          <span style={{ fontSize: "15px", color: "var(--public-muted-soft)" }}>
                            {isId ? plan.suffixId : plan.suffixEn}
                          </span>
                        )}
                      </div>
                      {cardNote && (
                        <div style={{ fontSize: "14px", color: "var(--public-muted-soft)", marginTop: "6px" }}>
                          {cardNote}
                        </div>
                      )}
                    </div>
                    {/* The saving strip: visible at rest now (data, not
                        decoration), only on the card whose server price
                        supports the claim — computed, never copied, and
                        seated between the commitment note and the rule, as
                        the fixed reference prints it. */}
                    {plan.key === "annual" && showSaving && annualSaving !== null && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginTop: "16px",
                          padding: "10px 12px",
                          background: "var(--public-mint)",
                          borderRadius: "10px",
                          fontSize: "14px",
                          fontWeight: 600,
                          lineHeight: 1.4,
                          color: "var(--public-green)",
                        }}
                      >
                        <Activity size={16} color="var(--public-green)" aria-hidden="true" strokeWidth={2.2} />
                        <span>
                          {isId
                            ? `Hemat ${annualSaving}% terhadap tarif bulanan.`
                            : `About ${annualSaving}% below the monthly rate.`}
                        </span>
                      </div>
                    )}
                    <span
                      aria-hidden="true"
                      style={{ display: "block", height: 1, background: "rgba(47, 49, 51, 0.12)", margin: "18px 0" }}
                    />
                    {/* The card's benefits: name-only rows — the pillar band
                        below carries each one's sentence, so the card stays a
                        price card. The label heading and its dot are gone
                        (ronde tujuh's rule, unchanged by the rebuild). */}
                    <ul
                      className="pub-opens"
                      aria-label={isId ? "Yang dibuka langganan" : "What a subscription opens"}
                      style={{ listStyle: "none", padding: 0, margin: 0 }}
                    >
                      {pillarRows.map((item, i) => {
                        const Icon = ICONS[i];
                        return (
                          <li key={item.name} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                            <Icon
                              aria-hidden="true"
                              size={20}
                              color="var(--public-navy)"
                              strokeWidth={2}
                              style={{ flex: "none" }}
                            />
                            <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--public-ink)" }}>
                              {item.name}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {/* One class, one shape for all three plans (owner, ronde
                        keempat): the flat navy fill and its hover live in
                        auth.css now, and no annual-specific rule remains. */}
                    <button
                      type="button"
                      className="pub-pick"
                      aria-label={`${pickPlanLabel} ${label}`}
                      onClick={() => pick(plan.key)}
                    >
                      {pickPlanLabel}
                      <ArrowRight size={16} aria-hidden="true" strokeWidth={2.2} />
                    </button>
                  </div>
                );
              })}
            </div>

            {price.kind === "loading" && (
              <p role="status" style={{ fontSize: "13px", color: "var(--public-muted-ground)", margin: "20px 0 0" }}>
                {isId ? "Memuat harga…" : "Loading price…"}
              </p>
            )}

            {price.kind === "unavailable" && (
              <p
                role="status"
                style={{
                  fontSize: "13px",
                  lineHeight: 1.6,
                  /* White status chip on the wide ground: the sentence reads
                     in the muted ink and keeps the paper's edge. */
                  color: "var(--public-muted)",
                  background: "var(--public-card)",
                  border: "1px solid rgba(47, 49, 51, 0.18)",
                  borderRadius: "16px",
                  padding: "12px 16px",
                  margin: "20px 0 0",
                  maxWidth: "560px",
                }}
              >
                {isId
                  ? "Harga tidak dapat dimuat. Tidak ditampilkan sebagai nol: nol bukan harga yang ditetapkan."
                  : "The price could not be loaded. Not shown as zero: zero is not a price anyone set."}
              </p>
            )}

            {/* The owner's confirmed facts, one line under the cards. The tax
                sentence is the owner's own word, not a computed claim. */}
            <p className="pub-caption">
              {isId
                ? "Semua paket mencakup sinyal, peringatan otomatis, panel risiko, dan optimasi portofolio. Harga dalam Rupiah dan sudah termasuk pajak."
                : "Every plan includes signals, automatic alerts, the risk panel, and portfolio optimisation. Prices are in Rupiah and already include tax."}
            </p>
          </div>
        </section>

        {/* The pillar band: what the gate opens, each pillar with its one
            sentence. It names exactly what the backend refuses and claims
            nothing else. */}
        <section id="pilar" className="pub-pillars">
          <div className="pub-container">
            <div className="pub-pillars-head">
              <h2>{isId ? "Yang Anda dapatkan" : "What you get"}</h2>
              <p className="pub-eyebrow">{isId ? "EMPAT PILAR AIDSS" : "THE FOUR PILLARS OF AIDSS"}</p>
            </div>
            <ul className="pub-pillar-grid">
              {pillarRows.map((item, i) => {
                const Icon = ICONS[i];
                return (
                  <li key={item.name} className="pub-pillar">
                    <Icon aria-hidden="true" size={22} color="var(--public-navy)" strokeWidth={2} />
                    <div style={{ fontSize: "16px", fontWeight: 700, marginTop: "14px", color: "var(--public-ink)" }}>
                      {item.name}
                    </div>
                    <p style={{ fontSize: "14px", lineHeight: 1.6, color: "var(--public-muted-soft)", margin: "6px 0 0" }}>
                      {item.desc}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </main>

      {/* The navy footer: brand, three link columns, the risk notes, and the
          bottom line with the live Jakarta clock. Shared with the features
          screen so the two pages cannot drift apart. */}
      <PublicFooter
        locale={locale}
        columns={NAV_COLUMNS}
        updatedAt={price.kind === "ready" ? price.updatedAt : null}
      />
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
