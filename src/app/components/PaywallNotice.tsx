import { Lock } from "lucide-react";

import type { Locale } from "../i18n/translations";

/**
 * Why the paid data is not arriving.
 *
 * Deliberately three states. "Your subscription" and "the backend" and "we could
 * not find out" are different problems with different fixes, and a single
 * generic error collapses them into one — which is how an account without a
 * subscription ends up being told to check their connection.
 */
export type PaywallReason = "subscription" | "unknown";

interface Props {
  /** Which failure to report. Defaults to the subscription case. */
  reason?: PaywallReason;
  locale?: Locale;
  /** Opens Settings, where the subscription status can actually be read. */
  onOpenSettings: () => void;
}

/**
 * One banner in the shell, not a modal per view.
 *
 * Every paid panel refusing at once is one fact about the account, and saying it
 * eight times is a different kind of noise from saying it once. It links to
 * Settings because that is the only place the status can be read — it offers no
 * purchase control, because there is no path to purchase yet (R-26).
 */
export function PaywallNotice({ reason = "subscription", locale = "id", onOpenSettings }: Props) {
  const isId = locale === "id";

  const copy: Record<PaywallReason, { title: string; body: string }> = {
    subscription: isId
      ? {
          title: "Analisis berbayar tidak aktif",
          body: "Langganan Anda belum aktif, jadi sinyal, risiko, dan optimasi tidak ditampilkan. Data pasar tetap berjalan.",
        }
      : {
          title: "Paid analysis is not active",
          body: "Your subscription is not active, so signals, risk and optimisation are not shown. Market data keeps running.",
        },
    unknown: isId
      ? {
          title: "Status tidak dapat dipastikan",
          body: "Server tidak menjawab apakah langganan aktif. Angka di bawah berlabel simulasi sampai hal itu diketahui.",
        }
      : {
          title: "Status could not be confirmed",
          body: "The server did not say whether a subscription is active. Figures below stay labelled as simulated until that is known.",
        },
  };

  const { title, body } = copy[reason];

  return (
    <div
      role="status"
      className="flex items-center gap-3"
      style={{
        background: "var(--warning-bg)",
        border: "1px solid var(--warning)",
        borderRadius: "var(--radius)",
        padding: "10px 14px",
        margin: "0 24px 12px",
      }}
    >
      <Lock size={14} style={{ color: "var(--warning)", flexShrink: 0 }} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>{body}</div>
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        style={{
          fontSize: 11,
          padding: "5px 10px",
          minHeight: 28,
          flexShrink: 0,
          color: "var(--foreground)",
          background: "transparent",
          // --control-border, not --border: ADR-0007 gives interactive boundaries a
          // contrast floor and --border is a divider token that sits below it.
          border: "1px solid var(--control-border)",
          borderRadius: 3,
          cursor: "pointer",
        }}
      >
        {isId ? "Pengaturan" : "Settings"}
      </button>
    </div>
  );
}