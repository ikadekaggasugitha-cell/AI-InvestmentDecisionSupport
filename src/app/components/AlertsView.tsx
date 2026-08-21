import { useState } from "react";
import { Zap, ShieldAlert, Landmark, Scale, Bell, X, Check } from "lucide-react";

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
  type: "signal" | "risk" | "macro" | "rebalance";
  severity: "high" | "medium" | "low";
  msgId: string;
  msgEn: string;
  timeId: string;
  timeEn: string;
};

export interface AlertsViewProps {
  alerts: readonly AlertItem[];
  locale?: "id" | "en";
}

const TYPE_ICON = {
  signal: Zap,
  risk: ShieldAlert,
  macro: Landmark,
  rebalance: Scale,
} as const;

const SEVERITY = {
  high:   { color: "#ff4757", bg: "rgba(255,71,87,0.10)", id: "TINGGI", en: "HIGH" },
  medium: { color: "var(--warning)", bg: "rgba(245,158,11,0.10)", id: "SEDANG", en: "MEDIUM" },
  low:    { color: "var(--muted-foreground)", bg: "var(--muted)", id: "RENDAH", en: "LOW" },
} as const;

const ORDER: Array<AlertItem["severity"]> = ["high", "medium", "low"];

export function AlertsView({ alerts, locale = "id" }: AlertsViewProps) {
  const isId = locale === "id";
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  const dismiss = (id: number) => setDismissed((s) => new Set(s).add(id));
  const clearAll = () => setDismissed(new Set(alerts.map((a) => a.id)));

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
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
            style={{ background: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)", fontSize: 12, cursor: "pointer" }}
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
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: cfg.color, textTransform: "uppercase" }}>
                {isId ? cfg.id : cfg.en} · {group.length}
              </div>
              {group.map((a) => {
                const Icon = TYPE_ICON[a.type] ?? Bell;
                return (
                  <div key={a.id} className="flex items-start gap-3 rounded px-4 py-3"
                    style={{ background: "var(--card)", border: "1px solid var(--border)", borderLeft: `3px solid ${cfg.color}` }}>
                    <div className="flex items-center justify-center rounded flex-shrink-0"
                      style={{ width: 32, height: 32, background: cfg.bg }}>
                      <Icon size={16} style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.5 }}>
                        {isId ? a.msgId : a.msgEn}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 8.5, fontWeight: 700, fontFamily: "var(--font-mono)", background: cfg.bg, color: cfg.color, letterSpacing: "0.04em" }}>
                          {(isId ? cfg.id : cfg.en)}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                          {isId ? a.timeId : a.timeEn}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => dismiss(a.id)}
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
