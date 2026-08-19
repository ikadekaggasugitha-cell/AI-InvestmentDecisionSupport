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
  source?: "live" | "mock" | "volume" | null;
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

  // Volume-derived history carries a per-day accumulation `score`; broker-flow
  // history carries `netLot`. Plot whichever this series actually has, so the
  // "history that detects accumulation" reads correctly in both modes.
  const isScore = history.some((d) => typeof d.score === "number" && d.score !== 0);
  const value = (d: BrokerSummaryDay) => (isScore ? d.score ?? 0 : d.netLot);
  const peak = Math.max(...history.map((d) => Math.abs(value(d))), 1);

  const title = isScore
    ? isId
      ? `Skor Akumulasi — ${history.length} Sesi Terakhir`
      : `Accumulation Score — Last ${history.length} Sessions`
    : isId
    ? `Net Lot ${history.length} Sesi Terakhir`
    : `Net Lot — Last ${history.length} Sessions`;

  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 5 }}>
        {title}
      </div>
      {/* Zero baseline in the middle: bars grow up (buying) or down (selling). */}
      <div className="flex gap-0.5" style={{ height: 40, alignItems: "center" }}>
        {history.map((day) => {
          const v = value(day);
          const magnitude = Math.abs(v) / peak;
          const positive = v >= 0;
          const tip = isScore
            ? `${day.date}: ${v > 0 ? "+" : ""}${v.toFixed(1)}`
            : `${day.date}: ${formatLots(day.netLot)} lot`;
          return (
            <div key={day.date} className="flex flex-col justify-center" style={{ flex: 1, minWidth: 3, height: "100%" }} title={tip}>
              <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
                {positive && (
                  <div style={{ width: "100%", height: `${Math.max(8, magnitude * 100)}%`, background: "var(--gain)", opacity: 0.35 + magnitude * 0.65, borderRadius: "1px 1px 0 0" }} />
                )}
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "flex-start" }}>
                {!positive && (
                  <div style={{ width: "100%", height: `${Math.max(8, magnitude * 100)}%`, background: "var(--loss)", opacity: 0.35 + magnitude * 0.65, borderRadius: "0 0 1px 1px" }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** OBV / CMF / MFI / volume-level row shown when the snapshot is volume-derived. */
function VolumeMetrics({ snapshot, isId }: { snapshot: BrokerSummarySnapshot; isId: boolean }) {
  const cell = (label: string, value: string, color: string, tip: string) => (
    <div className="flex flex-col gap-0.5" title={tip}>
      <span style={{ fontSize: 9, color: "var(--muted-foreground)", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color, fontFamily: "var(--font-mono)" }}>{value}</span>
    </div>
  );
  const obv = snapshot.obvTrend ?? 0;
  const cmf = snapshot.cmf ?? 0;
  const mfi = snapshot.mfi ?? 50;
  const sign = (v: number) => (v > 0 ? "var(--gain)" : v < 0 ? "var(--loss)" : "var(--muted-foreground)");
  const volLevel = snapshot.volumeLevel ?? "normal";
  const volColor = volLevel === "high" ? "var(--gain)" : volLevel === "low" ? "var(--warning)" : "var(--muted-foreground)";

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
      {cell("OBV", `${obv > 0 ? "+" : ""}${obv.toFixed(1)}%`, sign(obv), isId ? "Arah On-Balance Volume" : "On-Balance Volume trend")}
      {cell("CMF", cmf.toFixed(3), sign(cmf), "Chaikin Money Flow")}
      {cell("MFI", mfi.toFixed(0), mfi >= 55 ? "var(--gain)" : mfi <= 45 ? "var(--loss)" : "var(--muted-foreground)", "Money Flow Index")}
      {cell(
        isId ? "Volume" : "Volume",
        isId ? (volLevel === "high" ? "Ramai" : volLevel === "low" ? "Sepi" : "Normal") : volLevel,
        volColor,
        isId ? "Intensitas volume vs rata-rata 20 hari" : "Volume intensity vs 20-day average",
      )}
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

      {/* Volume-derived accumulation. Honest about the source: this is computed
          from real OHLCV+volume (OBV/CMF), not licensed per-broker flow. */}
      {source === "volume" && (
        <div
          className="flex items-center gap-2 rounded px-2 py-1"
          style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}
        >
          <FlaskConical size={11} style={{ color: "var(--info, #3b82f6)", flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: "var(--foreground)", lineHeight: 1.4 }}>
            {isId
              ? "Akumulasi dari analisis volume (OBV/CMF) data pasar nyata — bukan data flow broker berlisensi."
              : "Accumulation from real volume analysis (OBV/CMF) — not licensed broker flow."}
          </span>
        </div>
      )}

      {snapshot.method === "volume" ? (
        <>
          {/* Volume-flow indicators (no per-broker split without a licensed feed) */}
          <VolumeMetrics snapshot={snapshot} isId={isId} />
          {(isId ? snapshot.signals : snapshot.signalsEn ?? snapshot.signals)?.length ? (
            <ul className="flex flex-col gap-1" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {(isId ? snapshot.signals! : (snapshot.signalsEn ?? snapshot.signals)!)
                .slice(0, 3)
                .map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5" style={{ fontSize: 10.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                    <span style={{ color: cfg.color, marginTop: 1 }} aria-hidden="true">•</span>
                    <span>{s}</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          {/* Rolling net lots */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                {isId ? "Net Lot 5 Hari" : "Net Lot 5D"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)", color: snapshot.netLot5d >= 0 ? "var(--gain)" : "var(--loss)" }}>
                {formatLots(snapshot.netLot5d)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                {isId ? "Net Lot 20 Hari" : "Net Lot 20D"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)", color: snapshot.netLot20d >= 0 ? "var(--gain)" : "var(--loss)" }}>
                {formatLots(snapshot.netLot20d)}
              </div>
            </div>
          </div>

          {/* Top buyers / sellers */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <BrokerList title={isId ? "Pembeli Dominan" : "Top Buyers"} brokers={snapshot.topBuyers} color="var(--gain)" />
            <BrokerList title={isId ? "Penjual Dominan" : "Top Sellers"} brokers={snapshot.topSellers} color="var(--loss)" />
          </div>
        </>
      )}

      <HistoryStrip history={history} isId={isId} />
    </div>
  );
}
