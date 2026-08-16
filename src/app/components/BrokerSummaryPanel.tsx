import { TrendingUp, TrendingDown, Minus, FlaskConical } from "lucide-react";
import type { BrokerSummarySnapshot } from "../hooks/useAISignals";
import type { BrokerSummaryDay } from "../hooks/useBrokerSummary";

/**
 * Accumulation / distribution panel.
 *
 * Renders the phase badge, the dominant buyers and sellers, and a net-lot
 * history strip. When `source` is "mock" it says so, prominently: the broker
 * codes here name real Indonesian securities firms, and simulated flow shown
 * without a label would read as a claim about how those firms actually traded.
 */

export interface BrokerSummaryPanelProps {
  snapshot: BrokerSummarySnapshot | null;
  history?: readonly BrokerSummaryDay[];
  source?: "live" | "mock" | null;
  locale?: "id" | "en";
  loading?: boolean;
}

const PHASE_CFG = {
  accumulation: { color: "var(--gain)", bg: "var(--gain-bg)", icon: TrendingUp },
  distribution: { color: "var(--loss)", bg: "var(--loss-bg)", icon: TrendingDown },
  neutral: { color: "var(--muted-foreground)", bg: "var(--muted)", icon: Minus },
} as const;

function phaseLabel(phase: string, isId: boolean): string {
  const map: Record<string, [string, string]> = {
    accumulation: ["AKUMULASI", "ACCUMULATION"],
    distribution: ["DISTRIBUSI", "DISTRIBUTION"],
    neutral: ["NETRAL", "NEUTRAL"],
  };
  return (map[phase] ?? map.neutral)[isId ? 0 : 1];
}

function formatLots(lots: number): string {
  const sign = lots > 0 ? "+" : "";
  return `${sign}${lots.toLocaleString("id-ID")}`;
}

/** Net-lot history strip — one cell per session, opacity scaled to magnitude. */
function HistoryStrip({ history, isId }: { history: readonly BrokerSummaryDay[]; isId: boolean }) {
  if (history.length === 0) return null;
  const peak = Math.max(...history.map((d) => Math.abs(d.netLot)), 1);

  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 5 }}>
        {isId ? `Net Lot ${history.length} Sesi Terakhir` : `Net Lot — Last ${history.length} Sessions`}
      </div>
      <div className="flex items-end gap-0.5" style={{ height: 34 }}>
        {history.map((day) => {
          const magnitude = Math.abs(day.netLot) / peak;
          const positive = day.netLot >= 0;
          return (
            <div
              key={day.date}
              title={`${day.date}: ${formatLots(day.netLot)} lot`}
              style={{
                flex: 1,
                minWidth: 3,
                height: `${Math.max(8, magnitude * 100)}%`,
                alignSelf: positive ? "flex-end" : "flex-start",
                background: positive ? "var(--gain)" : "var(--loss)",
                opacity: 0.35 + magnitude * 0.65,
                borderRadius: 1,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function BrokerList({
  title,
  brokers,
  color,
}: {
  title: string;
  brokers: readonly { broker: string; netLot5d: number; netLot20d: number }[];
  color: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 5 }}>{title}</div>
      {brokers.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>—</div>
      ) : (
        <div className="flex flex-col gap-1">
          {brokers.map((b) => (
            <div key={b.broker} className="flex items-center justify-between gap-2">
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--foreground)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {b.broker}
              </span>
              <span style={{ fontSize: 11, color, fontFamily: "var(--font-mono)" }}>
                {formatLots(b.netLot5d)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BrokerSummaryPanel({
  snapshot,
  history = [],
  source = null,
  locale = "id",
  loading = false,
}: BrokerSummaryPanelProps) {
  const isId = locale === "id";

  if (loading) {
    return (
      <div style={{ fontSize: 11, color: "var(--muted-foreground)", padding: "8px 0" }}>
        {isId ? "Memuat data broker…" : "Loading broker data…"}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div style={{ fontSize: 11, color: "var(--muted-foreground)", padding: "8px 0" }}>
        {isId ? "Data broker belum tersedia." : "Broker data not available."}
      </div>
    );
  }

  const cfg = PHASE_CFG[snapshot.phase] ?? PHASE_CFG.neutral;
  const PhaseIcon = cfg.icon;

  return (
    <div className="flex flex-col gap-3">
      {/* Header: phase badge + score */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1 rounded px-2 py-0.5"
            style={{ background: cfg.bg, border: `1px solid ${cfg.color}25` }}
          >
            <PhaseIcon size={11} style={{ color: cfg.color }} />
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: cfg.color,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.04em",
              }}
            >
              {phaseLabel(snapshot.phase, isId)}
            </span>
          </span>
          {snapshot.consistencyDays > 0 && (
            <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
              {isId
                ? `${snapshot.consistencyDays} hari konsisten`
                : `${snapshot.consistencyDays} days consistent`}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: cfg.color, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
          {snapshot.score > 0 ? "+" : ""}
          {snapshot.score.toFixed(1)}
        </span>
      </div>

      {/* Simulated-data notice. Broker codes name real firms — never present
          generated flow as observed activity. */}
      {source === "mock" && (
        <div
          className="flex items-center gap-2 rounded px-2 py-1"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
        >
          <FlaskConical size={11} style={{ color: "var(--warning)", flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: "var(--foreground)", lineHeight: 1.4 }}>
            {isId
              ? "Data simulasi — bukan aktivitas broker sebenarnya."
              : "Simulated data — not actual broker activity."}
          </span>
        </div>
      )}

      {/* Rolling net lots */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
            {isId ? "Net Lot 5 Hari" : "Net Lot 5D"}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              color: snapshot.netLot5d >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            {formatLots(snapshot.netLot5d)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
            {isId ? "Net Lot 20 Hari" : "Net Lot 20D"}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              color: snapshot.netLot20d >= 0 ? "var(--gain)" : "var(--loss)",
            }}
          >
            {formatLots(snapshot.netLot20d)}
          </div>
        </div>
      </div>

      {/* Top buyers / sellers */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <BrokerList
          title={isId ? "Pembeli Dominan" : "Top Buyers"}
          brokers={snapshot.topBuyers}
          color="var(--gain)"
        />
        <BrokerList
          title={isId ? "Penjual Dominan" : "Top Sellers"}
          brokers={snapshot.topSellers}
          color="var(--loss)"
        />
      </div>

      <HistoryStrip history={history} isId={isId} />
    </div>
  );
}
