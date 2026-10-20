/**
 * The signed-out surface: create an account, or sign in to an existing one.
 *
 * Two zones. A Midnight Navy brand panel, whose value is the same --sidebar
 * surface the signed-in app uses, so a person who lands here recognises the
 * house; and the form column. The panel carries only facts the owner has
 * named: the product name (decided in DESIGN.md, transcribed 2026-10-10) and
 * one sentence about what the product does. No invented imagery, no market
 * numbers, nothing decorative.
 *
 * Two forms on one screen rather than two routes, because the decision between
 * them is made once and never again by anyone who remembers either. The toggle
 * is a real control, not a tab bar: there is nothing to browse on either side.
 *
 * DOM order note: everything focusable sits after the form fields, in the
 * order the tests pin down (email, password, submit, mode toggle; the signup
 * form inserts its plan chooser before the submit), so the brand panel
 * deliberately holds no interactive element at all.
 */

import { useEffect, useId, useState, type FormEvent } from "react";
import type { AuthState } from "../hooks/useAuth";
import type { PlanKey } from "../planIntent";
import { readPlanIntent, writePlanIntent } from "../planIntent";
import { useTranslation, type Locale } from "../i18n/translations";
import { PricingLink } from "./PublicPricing";

export interface AuthScreenProps {
  auth: AuthState;
  locale: Locale;
  onAuthed: () => void;
  /** The read-the-price surface. Absent → no link rendered. */
  onViewPricing?: () => void;
  /** Which of the two forms opens first. `/daftar` opens signup. */
  initialMode?: Mode;
  /** Plan the visitor picked on the price sheet, carried by `?plan=`. */
  initialPlan?: PlanKey | null;
}

type Mode = "login" | "signup";

// --control-border, not --border. --border measures 1.20:1 against the input
// surface and WCAG 1.4.11 wants 3:1 for an interactive component boundary: a
// field you cannot see is a field nobody fills in. The same token is used by the
// position modal, the advisor chat and the header toggles, so the app has one
// rule rather than a form that is careful and the rest that is not.
const CONTROL_BORDER = "var(--control-border)";

// Focus rings come from auth.css: a pseudo-class cannot live in an inline style.

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  fontFamily: "var(--font-sans)",
  color: "var(--foreground)",
  background: "var(--input-background, #ffffff)",
  border: `1px solid ${CONTROL_BORDER}`,
  borderRadius: "var(--radius)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "14px",
  fontWeight: 500,
  color: "var(--foreground)",
  marginBottom: "8px",
};

const hintStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--muted-foreground)",
  margin: "6px 0 0",
};

/* The plan chooser carries the price sheet's sentence-level affordances over:
 * quiet borderless pills (active surface + ink), the same anatomy as the
 * Settings view choice groups, so one rule covers all of them. */
const planPill = (active: boolean): React.CSSProperties => ({
  minHeight: "32px",
  padding: "6px 12px",
  borderRadius: "var(--radius)",
  cursor: "pointer",
  background: active ? "var(--muted)" : "transparent",
  border: "none",
  color: active ? "var(--foreground)" : "var(--muted-foreground)",
  fontSize: "12px",
  fontWeight: active ? 500 : 400,
});

const clearPlanStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  fontSize: "12px",
  color: "var(--link)",
  cursor: "pointer",
  textDecoration: "underline",
};

export function AuthScreen({ auth, locale, onAuthed, onViewPricing, initialMode, initialPlan }: AuthScreenProps) {
  const { t } = useTranslation(locale);
  const [mode, setMode] = useState<Mode>(initialMode ?? "login");
  // The chosen price line: from the URL the sheet's click sent, else what this
  // same visitor stored earlier. Login never reads it.
  const [plan, setPlan] = useState<PlanKey | null>(
    initialPlan ?? (initialMode === "signup" ? readPlanIntent() : null),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginHeading = useId();
  const errorId = useId();
  const isId = locale === "id";

  // A direct link to `/daftar?plan=…` shares the same intent the sheet's
  // click wrote; keep storage in step so the billing tab sees it after signup.
  useEffect(() => {
    if (initialPlan) writePlanIntent(initialPlan);
  }, [initialPlan]);

  // Changing the plan here rewrites the intent; clearing it throws the old
  // one away — a carried plan is only ever the person's own latest word.
  const choosePlan = (next: PlanKey | null) => {
    setPlan(next);
    writePlanIntent(next);
  };
  const clearPlan = () => choosePlan(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  // Sentence labels for the three server plan names. The amounts stay on the
  // price sheet and the billing tab: no private copy of any number here.
  const planLabels: { key: PlanKey; label: string }[] = isId
    ? [
        { key: "weekly",  label: "Mingguan" },
        { key: "monthly", label: "Bulanan" },
        { key: "annual",  label: "Tahunan" },
      ]
    : [
        { key: "weekly",  label: "Weekly" },
        { key: "monthly", label: "Monthly" },
        { key: "annual",  label: "Annual" },
      ];
  const chosen = plan ? planLabels.find((p) => p.key === plan) : undefined;

  const onLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth_error_generic"));
    } finally {
      setBusy(false);
    }
  };

  const onSignup = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await auth.signUp({
        email: String(data.get("email") ?? ""),
        full_name: String(data.get("full_name") ?? ""),
        phone_number: String(data.get("phone_number") ?? ""),
        password: String(data.get("password") ?? ""),
      });
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth_error_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <div>
          <p className="auth-brand-name">AIDSS</p>
          <p className="auth-brand-sub">AI Investment Decision Support System</p>
          <p className="auth-brand-claim" style={{ marginTop: "20px" }}>
            {isId
              ? "Nilai beli, tahan, atau jual yang terskor, lengkap dengan alasan dan data di baliknya."
              : "A scored buy, hold, or sell, with the reasoning and the data behind it."}
          </p>
        </div>

        {/* The one operational fact this surface owns: deciding to pay starts
            inside the app, never here. Said where the eyes rest, not on the form. */}
        <p className="auth-foot">{t("auth_beta_note")}</p>
      </aside>

      <div className="auth-form-col">
        <main>
          <h1 style={{ fontSize: "24px", fontWeight: 600, margin: "0 0 6px", fontFamily: "var(--font-display)" }}>
            {mode === "login" ? t("auth_signin_title") : t("auth_signup_title")}
          </h1>
          <p style={{ fontSize: "14px", color: "var(--muted-foreground)", margin: "0 0 24px", lineHeight: 1.6 }}>
            {mode === "login" ? t("auth_signin_sub") : t("auth_signup_sub")}
          </p>

          {/* The server's own verdict, not the form's: auth/me answered 403 for
              this account, which is an administrator's closure. Stated here and
              only here — a ban has no payment path, and the login form must not
              hint at one. */}
          {auth.error === "blocked" && (
            <p
              role="alert"
              style={{
                fontSize: "13px",
                lineHeight: 1.6,
                color: "var(--foreground)",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "10px 12px",
                margin: "0 0 16px",
              }}
            >
              {locale === "id"
                ? "Akun ini ditutup oleh administrator. Pembayaran tidak dapat membukanya kembali."
                : "This account was closed by an administrator. A payment cannot reopen it."}
            </p>
          )}

          {error && (
            <p
              id={errorId}
              role="alert"
              style={{
                fontSize: "13px",
                lineHeight: 1.6,
                color: "var(--destructive)",
                // --card, not --loss-bg: the tinted surface over --background
                // measures 4.23:1, which fails 4.5:1 for 13px text. The border
                // carries the red; the surface stays quiet enough to read on.
                background: "var(--card)",
                border: "1px solid var(--destructive)",
                borderRadius: "var(--radius)",
                padding: "10px 12px",
                margin: "0 0 16px",
              }}
            >
              {error}
            </p>
          )}

          {mode === "login" ? (
            <form onSubmit={onLogin} noValidate>
              <div style={{ marginBottom: "16px" }}>
                <label htmlFor="login-email" style={labelStyle}>
                  {t("auth_email")}
                </label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="auth-control"
                  aria-describedby={error ? errorId : undefined}
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: "20px" }}>
                <label htmlFor="login-password" style={labelStyle}>
                  {t("auth_password")}
                </label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="auth-control"
                  aria-describedby={error ? errorId : undefined}
                  style={inputStyle}
                />
              </div>
              <SubmitButton busy={busy} label={t("auth_signin_action")} busyLabel={t("auth_working")} />
            </form>
          ) : (
            <form onSubmit={onSignup} noValidate aria-labelledby={loginHeading}>
              <h2 id={loginHeading} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                {t("auth_signup_title")}
              </h2>
              <div style={{ marginBottom: "16px" }}>
                <label htmlFor="signup-name" style={labelStyle}>
                  {t("auth_full_name")}
                </label>
                <input
                  id="signup-name"
                  name="full_name"
                  type="text"
                  autoComplete="name"
                  required
                  className="auth-control"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label htmlFor="signup-email" style={labelStyle}>
                  {t("auth_email")}
                </label>
                <input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="auth-control"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label htmlFor="signup-phone" style={labelStyle}>
                  {t("auth_phone")}
                </label>
                <input
                  id="signup-phone"
                  name="phone_number"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="081234567890"
                  required
                  aria-describedby="signup-phone-hint"
                  style={inputStyle}
                />
                <p id="signup-phone-hint" style={hintStyle}>
                  {t("auth_phone_hint")}
                </p>
              </div>
              <div style={{ marginBottom: "20px" }}>
                <label htmlFor="signup-password" style={labelStyle}>
                  {t("auth_password")}
                </label>
                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  aria-describedby="signup-password-hint"
                  style={inputStyle}
                />
                <p id="signup-password-hint" style={hintStyle}>
                  {t("auth_password_hint")}
                </p>
              </div>
              {/* The plan the sheet's click carried in, editable in place.
                  Pills over a select: three named options, all visible. */}
              <div role="group" aria-label={isId ? "Paket yang dipilih" : "Selected plan"} style={{ marginBottom: "20px" }}>
                <div style={labelStyle}>
                  {isId ? "Paket" : "Plan"}
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  {planLabels.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={plan === p.key}
                      onClick={() => choosePlan(plan === p.key ? null : p.key)}
                      style={planPill(plan === p.key)}
                    >
                      {p.label}
                    </button>
                  ))}
                  {plan && (
                    <button type="button" onClick={clearPlan} style={clearPlanStyle}>
                      {isId ? "kosongkan" : "clear"}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: "13px", color: "var(--foreground)", marginTop: "8px" }}>
                  {plan
                    ? `${isId ? "Paket terpilih" : "Selected plan"}: ${chosen?.label ?? ""}`
                    : (isId ? "Paket belum dipilih" : "No plan chosen yet")}
                </div>
                <p style={hintStyle}>
                  {plan
                    ? (isId
                        ? "Pilihan ini menyertai pendaftaran; harga final tetap dari server saat menentukan pembayaran."
                        : "The choice follows the registration; the final price still comes from the server at payment time.")
                    : (isId
                        ? "Bisa dipilih sekarang atau ditunda sampai di Pengaturan."
                        : "You can pick now or decide later under Settings.")}
                </p>
              </div>
              <SubmitButton busy={busy} label={t("auth_signup_action")} busyLabel={t("auth_working")} />
            </form>
          )}

          {/* Everything interactive sits after the form, in the order the
              keyboard tests pin: mode toggle first, then the pricing surface. */}
          <p style={{ fontSize: "14px", color: "var(--muted-foreground)", marginTop: "20px" }}>
            {mode === "login" ? t("auth_no_account") : t("auth_have_account")}{" "}
            <button
              type="button"
              className="auth-link"
              onClick={() => switchMode(mode === "login" ? "signup" : "login")}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                font: "inherit",
                fontSize: "14px",
                color: "var(--link)",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {mode === "login" ? t("auth_signup_action") : t("auth_signin_action")}
            </button>
          </p>

          {onViewPricing && (
            <p style={{ fontSize: "14px", color: "var(--muted-foreground)", marginTop: "14px" }}>
              {isId ? "Berapa harganya?" : "What does it cost?"}{" "}
              <PricingLink
                label={isId ? "Lihat harga" : "See the price"}
                onClick={onViewPricing}
              />
            </p>
          )}

          <p style={{ fontSize: "14px", color: "var(--muted-foreground)", marginTop: "14px" }}>
            {isId ? "Anda operator?" : "An operator?"}{" "}
            {/* /admin is a real URL the shell serves with no sidebar entry;
                a non-admin gets the gate screen, not a broken page. */}
            <a
              href="/admin"
              className="auth-link"
              style={{ font: "inherit", fontSize: "14px", color: "var(--link)", textDecoration: "underline" }}
            >
              {isId ? "Buka konsol operator" : "Open the operator console"}
            </a>
          </p>
        </main>
      </div>
    </div>
  );
}

function SubmitButton({
  busy,
  label,
  busyLabel,
}: {
  busy: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="auth-control"
      style={{
        width: "100%",
        minHeight: "44px",
        padding: "10px 16px",
        fontSize: "14px",
        fontFamily: "var(--font-sans)",
        fontWeight: 500,
        color: "var(--primary-foreground)",
        background: "var(--primary)",
        border: "1px solid var(--primary)",
        borderRadius: "var(--radius)",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      {busy ? busyLabel : label}
    </button>
  );
}
