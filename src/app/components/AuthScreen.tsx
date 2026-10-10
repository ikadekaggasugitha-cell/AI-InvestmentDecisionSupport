/**
 * The signed-out surface: create an account, or sign in to an existing one.
 *
 * Two forms on one screen rather than two routes, because the decision between
 * them is made once and never again by anyone who remembers either. The toggle is
 * a real control, not a tab bar: there is nothing to browse on either side.
 *
 * Nothing here is decorative. No brand mark, because DESIGN.md has the product
 * name as an open owner decision and an invented one would be worse than none. No
 * icons, for the same reason: the icon set is also unnamed, so a glyph would be
 * borrowed from somewhere without saying why. Text carries it.
 */

import { useId, useState, type FormEvent } from "react";
import type { AuthState } from "../hooks/useAuth";
import { useTranslation, type Locale } from "../i18n/translations";

export interface AuthScreenProps {
  auth: AuthState;
  locale: Locale;
  onAuthed: () => void;
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
  fontSize: "13px",
  color: "var(--foreground)",
  marginBottom: "6px",
};

export function AuthScreen({ auth, locale, onAuthed }: AuthScreenProps) {
  const { t } = useTranslation(locale);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginHeading = useId();
  const errorId = useId();

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

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
      <main style={{ width: "100%", maxWidth: "360px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 500, margin: "0 0 4px" }}>
          {mode === "login" ? t("auth_signin_title") : t("auth_signup_title")}
        </h1>
        <p style={{ fontSize: "13px", color: "var(--muted-foreground)", margin: "0 0 24px" }}>
          {mode === "login" ? t("auth_signin_sub") : t("auth_signup_sub")}
        </p>

        {error && (
          <p
            id={errorId}
            role="alert"
            style={{
              fontSize: "13px",
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
            <div style={{ marginBottom: "14px" }}>
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
            <div style={{ marginBottom: "14px" }}>
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
            <div style={{ marginBottom: "14px" }}>
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
            <div style={{ marginBottom: "14px" }}>
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
              <p id="signup-phone-hint" style={{ fontSize: "12px", color: "var(--muted-foreground)", margin: "6px 0 0" }}>
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
              <p id="signup-password-hint" style={{ fontSize: "12px", color: "var(--muted-foreground)", margin: "6px 0 0" }}>
                {t("auth_password_hint")}
              </p>
            </div>
            <SubmitButton busy={busy} label={t("auth_signup_action")} busyLabel={t("auth_working")} />
          </form>
        )}

        <p style={{ fontSize: "13px", color: "var(--muted-foreground)", marginTop: "20px" }}>
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
              fontSize: "13px",
              color: "var(--link)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {mode === "login" ? t("auth_signup_action") : t("auth_signin_action")}
          </button>
        </p>

        <p style={{ fontSize: "12px", color: "var(--muted-foreground)", marginTop: "28px" }}>
          {t("auth_beta_note")}
        </p>
      </main>
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

