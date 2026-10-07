/**
 * Gate 2 — the in-app OJK compliance consent.
 *
 * The legal terms put this on first access to the AI signals *or* the AI Advisor,
 * so it lives here rather than inside either view: the advisor had its own modal
 * while the stock detail panel, which shows the same model's probability score and
 * tier, had none. A person could read a scored call from the markets table without
 * ever being asked.
 *
 * The acceptance is namespaced by account (see ./consent) and is a local marker
 * only. The legal document also promises a server-side log, and there is no table
 * for one, so nothing here claims to be that.
 */

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { useTranslation, type Locale } from "../i18n/translations";
import { hasAcceptedConsent, reportConsent, writeConsent } from "./consent";

export interface ConsentGateProps {
  locale: Locale;
  children: ReactNode;
}

/**
 * Wrap any surface that shows a model output. Renders children once accepted,
 * otherwise the consent modal.
 */
export function ConsentGate({ locale, children }: ConsentGateProps) {
  const { account } = useAuth();
  const accountId = account?.id ?? null;
  const [accepted, setAccepted] = useState(() => hasAcceptedConsent(accountId));

  // Re-read when the signed-in account changes, so signing out and back in as
  // someone else asks that person rather than inheriting an acceptance.
  useEffect(() => {
    setAccepted(hasAcceptedConsent(accountId));
  }, [accountId]);

  const accept = useCallback(() => {
    // Local first, then the server. The person pressed the button; the modal has
    // served its purpose either way, and refusing to close it because the network
    // is down would be a worse failure than a missing server-side record. The
    // record can still be added later, whereas consent has to be given deliberately.
    writeConsent(accountId);
    setAccepted(true);
    void reportConsent(accountId);
  }, [accountId]);

  if (accepted) return <>{children}</>;
  return <ConsentModal locale={locale} onAccept={accept} />;
}

/** The gate's modal on its own, for a view that wants it inline. */
export function ConsentModal({ locale, onAccept }: { locale: Locale; onAccept: () => void }) {
  const { t } = useTranslation(locale);
  const headingId = useId();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 16px",
        background: "color-mix(in srgb, var(--background) 92%, transparent)",
        color: "var(--foreground)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--card)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius)",
          padding: "20px",
        }}
      >
        <h2 id={headingId} style={{ fontSize: 15, fontWeight: 500, margin: "0 0 10px" }}>
          {t("consent_title")}
        </h2>
        <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "0 0 14px" }}>
          {t("consent_body")}
        </p>
        <p style={{ fontSize: 13, margin: "0 0 18px" }}>{t("consent_not_advice")}</p>
        <button
          type="button"
          className="auth-control"
          onClick={onAccept}
          style={{
            width: "100%",
            minHeight: "44px",
            padding: "10px 16px",
            fontSize: 14,
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            color: "var(--primary-foreground)",
            background: "var(--primary)",
            border: "1px solid var(--primary)",
            borderRadius: "var(--radius)",
            cursor: "pointer",
          }}
        >
          {t("consent_accept")}
        </button>
        <p style={{ fontSize: 11, color: "var(--muted-foreground)", margin: "12px 0 0" }}>
          {t("consent_local_only")}
        </p>
      </div>
    </div>
  );
}