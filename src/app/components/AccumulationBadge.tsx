import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { AccumulationBadgeData } from "../hooks/useAccumulationMap";

/**
 * Compact accumulation pill for dense list/table rows.
 *
 * Colour is paired with an icon AND an abbreviated word (Akum / Dist / Netral)
 * so it reads for colour-blind users too. The full score, strength and the
 * OBV-consistency streak live in the native tooltip, keeping the cell narrow.
 */

export interface AccumulationBadgeProps {
  data: AccumulationBadgeData | undefined;
  locale?: "id" | "en";
  loading?: boolean;
}

const CFG = {
  accumulation: { color: "var(--gain)", bg: "var(--gain-bg)", icon: TrendingUp, id: "Akum", en: "Acc" },
  distribution: { color: "var(--loss)", bg: "var(--loss-bg)", icon: TrendingDown, id: "Dist", en: "Dist" },
  neutral: { color: "var(--muted-foreground)", bg: "transparent", icon: Minus, id: "Netral", en: "Neutral" },
} as const;

export function AccumulationBadge({ data, locale = "id", loading = false }: AccumulationBadgeProps) {
  const isId = locale === "id";

  if (loading && !data) {
    // Reserve the cell so the column does not jump when data lands.
    return <span style={{ display: "inline-block", width: 52, height: 18 }} aria-hidden="true" />;
  }
  if (!data) {
    return <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>—</span>;
  }

  const cfg = CFG[data.phase] ?? CFG.neutral;
  const Icon = cfg.icon;
  const label = isId ? cfg.id : cfg.en;

  const foreign = data.method === "volume+foreign";
  const tip = isId
    ? `${data.phaseId} — skor ${data.score > 0 ? "+" : ""}${data.score.toFixed(1)}, ` +
      `kekuatan ${data.strength}/100` +
      (data.consistencyDays > 0 ? `, OBV naik ${data.consistencyDays} hari` : "") +
      (foreign ? ` · termasuk aliran dana asing (${data.foreignPhase})` : " · basis volume")
    : `${data.phaseId} — score ${data.score > 0 ? "+" : ""}${data.score.toFixed(1)}, ` +
      `strength ${data.strength}/100` +
      (data.consistencyDays > 0 ? `, OBV up ${data.consistencyDays}d` : "") +
      (foreign ? ` · incl. foreign flow (${data.foreignPhase})` : " · volume-based");

  if (data.phase === "neutral") {
    // Keep neutral rows quiet — a muted dash with the score in the tooltip.
    return (
      <span title={tip} style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
        —
      </span>
    );
  }

  return (
    <span
      title={tip}
      className="inline-flex items-center gap-1 rounded"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.color}30`,
        padding: "1px 5px",
        // Strength drives opacity: a weak signal reads fainter than a strong one.
        opacity: 0.55 + Math.min(1, data.strength / 60) * 0.45,
      }}
    >
      <Icon size={10} style={{ color: cfg.color }} aria-hidden="true" />
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: cfg.color,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </span>
    </span>
  );
}
