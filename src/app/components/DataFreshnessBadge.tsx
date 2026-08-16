import { useEffect, useState } from "react";
import { Radio, Clock, FlaskConical, WifiOff } from "lucide-react";
import type { DataFreshness } from "../hooks/useLiveMarket";

/**
 * States what the prices on screen actually are.
 *
 * The free IDX feed is delayed by ten minutes and Yahoo labels it "Delayed
 * Quote". A price rendered without that context reads as the current market
 * price, which is the one thing it is not. This badge distinguishes four cases
 * a user genuinely needs to tell apart:
 *
 *   LIVE       real time, zero declared delay (a licensed feed)
 *   DELAYED    real prices, delayed by the vendor's declared interval
 *   SIMULATED  generated numbers — the offline seed path
 *   OFFLINE    backend unreachable; whatever is shown is the last known state
 *
 * The age counter ticks so a stalled feed becomes visible rather than frozen at
 * a plausible-looking number.
 */

export interface DataFreshnessBadgeProps {
  freshness: DataFreshness;
  isConnected: boolean;
  locale?: "id" | "en";
  compact?: boolean;
}

function formatAge(seconds: number, isId: boolean): string {
  if (seconds < 60) return isId ? `${Math.floor(seconds)} dtk` : `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return isId ? `${minutes} mnt` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isId ? `${hours} jam` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return isId ? `${days} hr` : `${days}d`;
}

export function DataFreshnessBadge({
  freshness,
  isConnected,
  locale = "id",
  compact = false,
}: DataFreshnessBadgeProps) {
  const isId = locale === "id";

  // Re-render on a timer so the displayed age advances. Without this a frozen
  // feed keeps showing the age it had when the last snapshot arrived.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const ageSeconds = freshness.asOf
    ? Math.max(0, (Date.now() - freshness.asOf.getTime()) / 1000)
    : null;

  let icon = Radio;
  let color = "var(--gain)";
  let bg = "var(--gain-bg)";
  let title = isId ? "LANGSUNG" : "LIVE";
  let detail = "";

  if (!isConnected) {
    icon = WifiOff;
    color = "var(--loss)";
    bg = "var(--loss-bg)";
    title = isId ? "TERPUTUS" : "OFFLINE";
    detail = isId ? "backend tidak terjangkau" : "backend unreachable";
  } else if (freshness.isSimulated) {
    icon = FlaskConical;
    color = "var(--warning)";
    bg = "rgba(245,158,11,0.08)";
    title = isId ? "SIMULASI" : "SIMULATED";
    detail = isId ? "bukan harga pasar" : "not market prices";
  } else if (freshness.isDelayed) {
    icon = Clock;
    color = "var(--warning)";
    bg = "rgba(245,158,11,0.08)";
    const mins = Math.round(freshness.delaySeconds / 60);
    title = isId ? `TERTUNDA ${mins} MNT` : `DELAYED ${mins} MIN`;
    detail = ageSeconds !== null
      ? (isId ? `data ${formatAge(ageSeconds, true)} lalu` : `${formatAge(ageSeconds, false)} old`)
      : freshness.label;
  } else {
    detail = ageSeconds !== null
      ? (isId ? `${formatAge(ageSeconds, true)} lalu` : `${formatAge(ageSeconds, false)} ago`)
      : "";
  }

  const Icon = icon;

  const tooltip = [
    isId ? `Sumber: ${freshness.provider}` : `Source: ${freshness.provider}`,
    freshness.label && `"${freshness.label}"`,
    freshness.asOf &&
      (isId
        ? `Waktu bursa: ${freshness.asOf.toLocaleString("id-ID")}`
        : `Exchange time: ${freshness.asOf.toLocaleString("en-GB")}`),
    freshness.isDelayed &&
      (isId
        ? `Feed tertunda ${Math.round(freshness.delaySeconds / 60)} menit. Realtime memerlukan feed berlisensi.`
        : `Feed delayed ${Math.round(freshness.delaySeconds / 60)} minutes. Real time requires a licensed feed.`),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      className="flex items-center gap-1.5 rounded px-2 py-0.5"
      style={{ background: bg, border: `1px solid ${color}25` }}
      title={tooltip}
    >
      <Icon size={11} style={{ color, flexShrink: 0 }} />
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      {!compact && detail && (
        <span
          style={{
            fontSize: 10,
            color: "var(--muted-foreground)",
            whiteSpace: "nowrap",
          }}
        >
          {detail}
        </span>
      )}
    </span>
  );
}
