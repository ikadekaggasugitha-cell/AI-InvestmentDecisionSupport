import { BarChart3, Waves, TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import type { VolumeInfo, AccumulationInfo } from "../hooks/useTechnicals";

/**
 * Volume intensity + volume-flow accumulation read, side by side.
 *
 * Volume answers "how many hands are trading this" (ramai/sepi); accumulation
 * answers "which side is winning" (akumulasi/distribusi), from OBV/ADL/CMF/MFI.
 * Every state pairs colour with an icon and a label so colour is never the only
 * cue, and the underlying indicators are shown so the read is auditable.
 */

export interface VolumeAccumulationPanelProps {
  volume: VolumeInfo | null;
  accumulation: AccumulationInfo | null;
  locale?: "id" | "en";
}

const SECTION_LABEL = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--foreground)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
} as const;

const VOL_CFG = {
  high: { color: "var(--gain)", id: "Ramai", en: "High" },
  normal: { color: "var(--muted-foreground)", id: "Normal", en: "Normal" },
  low: { color: "var(--warning)", id: "Sepi", en: "Low" },
} as const;

const PHASE_CFG = {
  accumulation: { color: "var(--gain)", bg: "var(--gain-bg)", id: "Akumulasi", en: "Accumulation" },
  distribution: { color: "var(--loss)", bg: "var(--loss-bg)", id: "Distribusi", en: "Distribution" },
  neutral: { color: "var(--muted-foreground)", bg: "var(--muted)", id: "Netral", en: "Neutral" },
} as const;

function TrendIcon({ trend, size = 11, color }: { trend: string; size?: number; color: string }) {
  const Icon = trend === "rising" ? TrendingUp : trend === "falling" ? TrendingDown : Minus;
  return <Icon size={size} style={{ color }} aria-hidden="true" />;
}

export function VolumeAccumulationPanel({
  volume,
  accumulation,
  locale = "id",
}: VolumeAccumulationPanelProps) {
  const isId = locale === "id";
  if (!volume && !accumulation) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Volume intensity ─────────────────────────────────────────────── */}
      {volume && (
        <div className="flex flex-col gap-2">
          <div style={SECTION_LABEL} className="flex items-center gap-1.5">
            <BarChart3 size={12} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            {isId ? "Volume" : "Volume"}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: VOL_CFG[volume.level].color,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {isId ? VOL_CFG[volume.level].id : VOL_CFG[volume.level].en}
              </span>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                {volume.ratio.toFixed(1)}× {isId ? "rata-rata" : "avg"}
              </span>
              {volume.spike && (
                <span className="flex items-center gap-0.5" style={{ fontSize: 9.5, color: "var(--warning)", fontWeight: 700 }}>
                  <Zap size={10} aria-hidden="true" />
                  {isId ? "LONJAKAN" : "SPIKE"}
                </span>
              )}
            </span>
            <span className="flex items-center gap-1" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
              <TrendIcon trend={volume.trend} color="var(--muted-foreground)" />
              {isId
                ? volume.trend === "rising" ? "menaik" : volume.trend === "falling" ? "menurun" : "datar"
                : volume.trend}
            </span>
          </div>

          {/* Ratio bar — how heavy trade is vs the 20-day baseline (1.0 = average). */}
          <div
            style={{ height: 6, background: "var(--muted)", borderRadius: 3, overflow: "hidden" }}
            role="img"
            aria-label={
              isId
                ? `Volume ${volume.ratio.toFixed(1)} kali rata-rata`
                : `Volume ${volume.ratio.toFixed(1)} times average`
            }
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, (volume.ratio / 2) * 100)}%`,
                background: VOL_CFG[volume.level].color,
                borderRadius: 3,
                transition: "width 300ms ease",
              }}
            />
          </div>
          {volume.note && (
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              {isId ? volume.note : volume.noteEn}
            </span>
          )}
        </div>
      )}

      {/* ── Accumulation / distribution ──────────────────────────────────── */}
      {accumulation && (
        <div className="flex flex-col gap-2">
          <div style={SECTION_LABEL} className="flex items-center gap-1.5">
            <Waves size={12} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            {accumulation.foreignAvailable
              ? isId ? "Akumulasi (Volume + Asing)" : "Accumulation (Volume + Foreign)"
              : isId ? "Akumulasi Volume" : "Volume Accumulation"}
          </div>

          {(() => {
            const cfg = PHASE_CFG[accumulation.phase] ?? PHASE_CFG.neutral;
            return (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span
                    className="flex items-center gap-1 rounded px-2 py-0.5"
                    style={{ background: cfg.bg, border: `1px solid ${cfg.color}25` }}
                  >
                    <Waves size={11} style={{ color: cfg.color }} aria-hidden="true" />
                    <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
                      {isId ? cfg.id : cfg.en}
                    </span>
                  </span>
                  <span style={{ fontSize: 11, color: cfg.color, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                    {accumulation.score > 0 ? "+" : ""}
                    {accumulation.score.toFixed(1)}
                  </span>
                </div>

                {/* Underlying indicators — makes the read auditable, not a black box. */}
                <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                  <IndicatorCell label="OBV" value={accumulation.obvTrend} kind="trend" isId={isId} />
                  <IndicatorCell label="CMF" value={accumulation.cmf} kind="signed" isId={isId} />
                  <IndicatorCell label="MFI" value={accumulation.mfi} kind="mfi" isId={isId} />
                </div>

                {accumulation.consistencyDays > 0 && (
                  <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                    {isId
                      ? `OBV naik ${accumulation.consistencyDays} hari beruntun`
                      : `OBV up ${accumulation.consistencyDays} sessions running`}
                  </span>
                )}

                {/* Foreign flow — the "who" behind the accumulation, from real
                    IDX foreign participation (the free bandarmology substitute). */}
                {accumulation.foreignAvailable && (() => {
                  const net5 = accumulation.netForeign5d ?? 0;
                  const net20 = accumulation.netForeign20d ?? 0;
                  const fdays = accumulation.foreignConsistencyDays ?? 0;
                  const fphase = accumulation.foreignPhase ?? "neutral";
                  const fcfg = PHASE_CFG[fphase] ?? PHASE_CFG.neutral;
                  const lotColor = (v: number) =>
                    v > 0 ? "var(--gain)" : v < 0 ? "var(--loss)" : "var(--muted-foreground)";
                  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("id-ID")}`;
                  return (
                    <div
                      className="flex flex-col gap-1 rounded px-2 py-1.5"
                      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                          {isId ? "Aliran Dana Asing" : "Foreign Flow"}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: fcfg.color, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
                          {isId ? fcfg.id : fcfg.en}
                        </span>
                      </div>
                      <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
                        <div className="flex flex-col gap-0.5" title={isId ? "Net beli/jual asing 5 sesi" : "Foreign net over 5 sessions"}>
                          <span style={{ fontSize: 9, color: "var(--muted-foreground)" }}>{isId ? "Net 5 Hari" : "Net 5D"}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)", color: lotColor(net5) }}>
                            {fmt(net5)} {isId ? "lot" : "lots"}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5" title={isId ? "Net beli/jual asing 20 sesi" : "Foreign net over 20 sessions"}>
                          <span style={{ fontSize: 9, color: "var(--muted-foreground)" }}>{isId ? "Net 20 Hari" : "Net 20D"}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)", color: lotColor(net20) }}>
                            {fmt(net20)} {isId ? "lot" : "lots"}
                          </span>
                        </div>
                      </div>
                      {fdays >= 3 && (
                        <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                          {isId
                            ? `Asing net ${net5 >= 0 ? "beli" : "jual"} ${fdays} hari beruntun`
                            : `Foreign net ${net5 >= 0 ? "buying" : "selling"} ${fdays} sessions running`}
                        </span>
                      )}
                    </div>
                  );
                })()}

                {(isId ? accumulation.signals : accumulation.signalsEn).length > 0 && (
                  <ul className="flex flex-col gap-1" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {(isId ? accumulation.signals : accumulation.signalsEn).slice(0, 4).map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5" style={{ fontSize: 10.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                        <span style={{ color: cfg.color, marginTop: 1 }} aria-hidden="true">•</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function IndicatorCell({
  label,
  value,
  kind,
  isId,
}: {
  label: string;
  value: number;
  kind: "trend" | "signed" | "mfi";
  isId: boolean;
}) {
  let color = "var(--muted-foreground)";
  if (kind === "mfi") {
    color = value >= 55 ? "var(--gain)" : value <= 45 ? "var(--loss)" : "var(--muted-foreground)";
  } else {
    color = value > 0 ? "var(--gain)" : value < 0 ? "var(--loss)" : "var(--muted-foreground)";
  }
  const display =
    kind === "signed" ? value.toFixed(3) : kind === "mfi" ? value.toFixed(0) : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

  const title = {
    OBV: isId ? "Arah On-Balance Volume" : "On-Balance Volume trend",
    CMF: isId ? "Chaikin Money Flow" : "Chaikin Money Flow",
    MFI: isId ? "Money Flow Index" : "Money Flow Index",
  }[label];

  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <span style={{ fontSize: 9, color: "var(--muted-foreground)", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color, fontFamily: "var(--font-mono)" }}>{display}</span>
    </div>
  );
}
