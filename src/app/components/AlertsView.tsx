import { Zap, ShieldAlert, Landmark, Scale, Bell, X, Check, FlaskConical } from "lucide-react";

/**
 * Alerts ("Peringatan") panel.
 *
 * Renders the alert feed grouped by severity (high → medium → low), each with a
 * type icon, a severity chip, and a relative time. Alerts can be dismissed
 * (local state) and cleared. This is the destination the sidebar bell now
 * navigates to — previously the bell was a dead control with no view behind it.
 */

export type AlertItem = {
  id: number;
  /** Stable identity for read/dismiss persistence across refetches. */
  key: string;
  type: "signal" | "risk" | "macro" | "rebalance";
  severity: "high" | "medium" | "low";
  msgId: string;
  msgEn: string;
  timeId: string;
  timeEn: string;
  symbol?: string | null;
};

export interface AlertsViewProps {
  /** Non-dismissed alerts to render (read/unread state is owned by useAlerts). */
  alerts: readonly AlertItem[];
  onDismiss: (key: string) => void;
  onClearAll: () => void;
  locale?: "id" | "en";
  /**
   * False when the feed is the bundled seed rather than conditions derived from
   * live signals, movers, foreign flow, risk and news. The seed alerts are shaped
   * exactly like real ones, so without this the view cannot tell a quiet market
   * from a backend that is down.
   */
  isLive?: boolean;
}

const TYPE_ICON = {
  signal: Zap,
  risk: ShieldAlert,
  macro: Landmark,
  rebalance: Scale,
} as const;

const SEVERITY = {
  // --loss, not the dark-theme hex: severity is a semantic, and the token
  // keeps its 4.5:1 on a white card where the fixed value did not.
  high:   { color: "var(--loss)", bg: "var(--loss-bg)", id: "Tinggi", en: "High" },
  medium: { color: "var(--warning)", bg: "var(--warning-bg)", id: "Sedang", en: "Medium" },
  low:    { color: "var(--muted-foreground)", bg: "var(--muted)", id: "Rendah", en: "Low" },
} as const;

const ORDER: Array<AlertItem["severity"]> = ["high", "medium", "low"];

export function AlertsView({ alerts, onDismiss, onClearAll, locale = "id", isLive = false }: AlertsViewProps) {
  const isId = locale === "id";

  // `alerts` is already the non-dismissed set (owned by useAlerts and persisted),
  // so the list, the header count, and the sidebar badge all read from one source.
  const visible = alerts;
  const dismiss = onDismiss;
  const clearAll = onClearAll;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6 flex flex-col gap-5 [&>*]:shrink-0">
      {!isLive && alerts.length > 0 && (
        <div
          className="flex items-center gap-2 rounded p-3"
          style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)", color: "var(--warning)", fontSize: 13 }}
        >
          <FlaskConical size={13} style={{ flexShrink: 0 }} />
          <span>
            {isId
              ? "Peringatan contoh: feed langsung tidak dapat dihubungi. Sistem mencoba menyambung kembali otomatis."
              : "Sample alerts: the live feed could not be reached. The system reconnects automatically."}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          {visible.length > 0
            ? (isId ? `${visible.length} peringatan aktif` : `${visible.length} active alert(s)`)
            : (isId ? "Tidak ada peringatan" : "No alerts")}
        </div>
        {visible.length > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded"
            style={{ background: "var(--muted)", border: "1px solid var(--control-border)", color: "var(--muted-foreground)", fontSize: 12, cursor: "pointer" }}
          >
            <Check size={13} />
            {isId ? "Tandai semua dibaca" : "Mark all read"}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded flex flex-col items-center justify-center gap-3 py-16"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <Bell size={32} style={{ color: "var(--muted-foreground)" }} />
          <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            {isId ? "Semua peringatan telah dibaca." : "All alerts cleared."}
          </div>
        </div>
      ) : (
        ORDER.map((sev) => {
          const group = visible.filter((a) => a.severity === sev);
          if (group.length === 0) return null;
          const cfg = SEVERITY[sev];
          return (
            <div key={sev} className="flex flex-col gap-2">
              <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>
                {isId ? cfg.id : cfg.en} · {group.length}
              </div>
              {group.map((a) => {
                const Icon = TYPE_ICON[a.type] ?? Bell;
                return (
                  // No left accent bar and no tinted icon square: severity is
                  // carried by the tag and the icon colour alone. None of the
                  // twenty-three study screens paints a colour bar down rows.
                  <div key={a.key} className="flex items-start gap-3 rounded px-4 py-3"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                    <Icon size={15} style={{ color: cfg.color, flexShrink: 0, marginTop: 3 }} />
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.5 }}>
                        {isId ? a.msgId : a.msgEn}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 11, fontWeight: 600, background: cfg.bg, color: cfg.color }}>
                          {(isId ? cfg.id : cfg.en)}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                          {isId ? a.timeId : a.timeEn}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => dismiss(a.key)}
                      aria-label={isId ? "Tutup peringatan" : "Dismiss alert"}
                      className="flex items-center justify-center rounded flex-shrink-0"
                      style={{ width: 26, height: 26, background: "transparent", border: "none", color: "var(--muted-foreground)", cursor: "pointer" }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}
