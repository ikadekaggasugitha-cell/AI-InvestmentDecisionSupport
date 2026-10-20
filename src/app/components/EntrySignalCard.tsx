import { Eye, Clock, Ban, Target, Shield, Scale } from "lucide-react";
import type { EntrySignal, TradePlanInfo } from "../hooks/useTechnicals";

/**
 * Actionable technical summary: WHEN to enter, WHERE the stop sits, and the R:R.
 *
 * Colour is never the only signal — every state carries an icon and a text
 * label, and the reason is spelled out below. Framed as a probabilistic watch
 * ("Pantau Beli"), never a bare buy instruction (OJK CMP-01).
 */

export interface EntrySignalCardProps {
  entry: EntrySignal | null;
  plan: TradePlanInfo | null;
  locale?: "id" | "en";
}

const SIGNAL_CFG: Record<
  EntrySignal["signal"],
  { color: string; bg: string; icon: typeof Eye }
> = {
  buy_watch: { color: "var(--gain)", bg: "var(--gain-bg)", icon: Eye },
  wait: { color: "var(--warning)", bg: "var(--warning-bg)", icon: Clock },
  avoid: { color: "var(--loss)", bg: "var(--loss-bg)", icon: Ban },
};

function fmtRp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

export function EntrySignalCard({ entry, plan, locale = "id" }: EntrySignalCardProps) {
  const isId = locale === "id";
  if (!entry) return null;

  const cfg = SIGNAL_CFG[entry.signal] ?? SIGNAL_CFG.wait;
  const Icon = cfg.icon;
  const hasPlan = plan && plan.entryPrice != null;

  return (
    <div
      className="flex flex-col gap-3 rounded"
      style={{ background: "var(--card)", border: "1px solid var(--border)", padding: 12 }}
    >
      {/* Signal badge + reason. The tint lives on the pill alone; the panel
          itself stays on card chrome like every other nested surface. */}
      <div className="flex items-start gap-2.5">
        <span
          className="flex items-center gap-1 rounded px-2 py-0.5"
          style={{ background: cfg.bg }}
        >
          <Icon size={11} style={{ color: cfg.color }} aria-hidden="true" />
          <span style={{ fontSize: 11, fontWeight: 600, color: cfg.color, fontFamily: "var(--font-sans)" }}>
            {isId ? entry.signalId : entry.signal.replace("_", " ")}
          </span>
        </span>
      </div>
      <span style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.5 }}>
        {isId ? entry.reason : entry.reasonEn}
      </span>

      {/* Trade plan: entry / stop / R:R */}
      {hasPlan && (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: "1fr 1fr 1fr", borderTop: "1px solid var(--border)", paddingTop: 10 }}
        >
          <PlanCell
            icon={Target}
            iconColor="var(--muted-foreground)"
            label={isId ? "Entry" : "Entry"}
            value={fmtRp(plan!.entryPrice!)}
            valueColor="var(--foreground)"
          />
          <PlanCell
            icon={Shield}
            iconColor="var(--loss)"
            label={isId ? "Stop Loss" : "Stop Loss"}
            value={plan!.stopLoss != null ? fmtRp(plan!.stopLoss) : "—"}
            sub={plan!.stopLossPct != null ? `${plan!.stopLossPct.toFixed(1)}%` : undefined}
            valueColor="var(--loss)"
          />
          <PlanCell
            icon={Scale}
            iconColor="var(--muted-foreground)"
            label={isId ? "Risk : Reward" : "Risk : Reward"}
            value={plan!.riskRewardRatio != null ? `1 : ${plan!.riskRewardRatio.toFixed(1)}` : "—"}
            valueColor={
              plan!.riskRewardRatio != null && plan!.riskRewardRatio >= 1.5
                ? "var(--gain)"
                : "var(--foreground)"
            }
          />
        </div>
      )}
    </div>
  );
}

function PlanCell({
  icon: Icon,
  iconColor,
  label,
  value,
  sub,
  valueColor,
}: {
  icon: typeof Target;
  iconColor: string;
  label: string;
  value: string;
  sub?: string;
  valueColor: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
        <Icon size={11} style={{ color: iconColor }} aria-hidden="true" />
        {label}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: valueColor, fontFamily: "var(--font-mono)" }}>
        {value}
        {sub && (
          <span style={{ fontSize: 11, color: valueColor, marginLeft: 4, fontWeight: 400 }}>{sub}</span>
        )}
      </span>
    </div>
  );
}
