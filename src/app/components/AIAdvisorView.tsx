import { Suspense, lazy, useState, type ElementType } from "react";
import {
  Brain, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp,
  Clock, AlertTriangle, BarChart2, ShieldCheck, X, MoveRight,
} from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";
import { useAISignals, type AISignal } from "../hooks/useAISignals";
import { useBrokerSummary } from "../hooks/useBrokerSummary";
import { useTechnicals } from "../hooks/useTechnicals";
import { AdvisorChat } from "./AdvisorChat";
import { BrokerSummaryPanel } from "./BrokerSummaryPanel";
import { EntrySignalCard } from "./EntrySignalCard";
import { VolumeAccumulationPanel } from "./VolumeAccumulationPanel";
import { ViewSkeleton } from "./ViewSkeleton";
import { ViewError } from "./ViewError";

// Lightweight Charts is ~45KB and only an expanded card ever renders one, so
// it is code-split rather than shipped in the initial bundle.
const CandlestickChart = lazy(() =>
  import("./CandlestickChart").then((m) => ({ default: m.CandlestickChart })),
);

// ── OJK disclaimer gate persistence (GAP-16) ──────────────────────────────────
// The acceptance is remembered across reloads so the modal does not reappear on
// every mount. localStorage access is wrapped because it throws in private-mode
// Safari and when storage is disabled; a failure degrades to "not accepted"
// (re-prompt), which is the safe direction for a compliance gate.
const DISCLAIMER_KEY = "aidss.disclaimerAcceptedAt";

function readDisclaimerAccepted(): boolean {
  try {
    return !!window.localStorage.getItem(DISCLAIMER_KEY);
  } catch {
    return false;
  }
}

function writeDisclaimerAccepted(): void {
  try {
    window.localStorage.setItem(DISCLAIMER_KEY, new Date().toISOString());
  } catch {
    /* storage unavailable — the gate falls back to per-session state */
  }
}

function clearDisclaimerAccepted(): void {
  try {
    window.localStorage.removeItem(DISCLAIMER_KEY);
  } catch {
    /* nothing to clear */
  }
}

type Tier = "VERY_HIGH" | "HIGH" | "NEUTRAL" | "LOW";

const TIER_CFG: Record<Tier, { color: string; bg: string; icon: ElementType }> = {
  "VERY_HIGH": { color: "var(--gain)",    bg: "var(--gain-bg)",           icon: TrendingUp   },
  "HIGH":      { color: "var(--gain)",    bg: "var(--gain-bg)",           icon: TrendingUp   },
  "NEUTRAL":   { color: "var(--warning)", bg: "rgba(245,158,11,0.08)",   icon: Minus        },
  "LOW":       { color: "var(--loss)",    bg: "var(--loss-bg)",           icon: TrendingDown },
};

// Probability-band wording (REC-01). Replaces the former BELI/JUAL labels,
// whose imperative reading conflicted with OJK rule CMP-01 (GAP-01).
function tierLabel(tier: Tier, isId: boolean): string {
  const map: Record<Tier, [string, string]> = {
    "VERY_HIGH": ["Probabilitas Sangat Tinggi", "Very High Probability"],
    "HIGH":      ["Probabilitas Tinggi",        "High Probability"     ],
    "NEUTRAL":   ["Probabilitas Netral",        "Neutral Probability"  ],
    "LOW":       ["Probabilitas Rendah",        "Low Probability"      ],
  };
  return isId ? map[tier][0] : map[tier][1];
}

/* OJK-compliant probability gauge */
function ProbabilityGauge({ uprob, tier }: { uprob: number; tier: Tier }) {
  const isDown = tier === "LOW";
  const displayProb = isDown ? (100 - uprob) : uprob;
  const color = isDown ? "var(--loss)" : uprob >= 70 ? "var(--gain)" : uprob >= 55 ? "var(--warning)" : "var(--muted-foreground)";
  const bgColor = isDown ? "var(--loss-bg)" : uprob >= 70 ? "var(--gain-bg)" : "rgba(245,158,11,0.08)";

  return (
    <div style={{ textAlign: "center", minWidth: 72 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: `3px solid ${color}`,
          background: bgColor,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 4px",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
          {displayProb}%
        </div>
      </div>
      <div style={{ fontSize: 9, color: "var(--muted-foreground)", textAlign: "center", lineHeight: 1.3 }}>
        {isDown ? "Prob. Turun" : "Prob. Naik"}
      </div>
    </div>
  );
}

/* Trend direction badge — omitted entirely when no trend data is present. */
function TrendBadge({ trend, isId }: { trend: AISignal["trend"]; isId: boolean }) {
  if (!trend) return null;

  const cfg = {
    uptrend:   { color: "var(--gain)", bg: "var(--gain-bg)", icon: TrendingUp,   id: "Uptrend",  en: "Uptrend"  },
    downtrend: { color: "var(--loss)", bg: "var(--loss-bg)", icon: TrendingDown, id: "Downtrend", en: "Downtrend" },
    sideways:  { color: "var(--muted-foreground)", bg: "var(--muted)", icon: MoveRight, id: "Sideways", en: "Sideways" },
  }[trend.trend] ?? null;

  if (!cfg) return null;
  const Icon = cfg.icon;

  return (
    <span
      className="flex items-center gap-1 rounded px-2 py-0.5"
      style={{ background: cfg.bg, border: `1px solid ${cfg.color}25` }}
      title={isId ? `Kekuatan tren: ${trend.strength}/100` : `Trend strength: ${trend.strength}/100`}
    >
      <Icon size={10} style={{ color: cfg.color }} />
      <span style={{ fontSize: 10, fontWeight: 600, color: cfg.color, fontFamily: "var(--font-mono)" }}>
        {isId ? cfg.id : cfg.en}
      </span>
    </span>
  );
}

/**
 * Entry / stop-loss badge.
 *
 * Renders nothing when there is no trade plan. The backend omits the plan when
 * no support level sits at a usable distance — showing a placeholder or a
 * guessed level here would be worse than showing nothing, because the reader
 * cannot tell a derived stop from an invented one.
 */
function TradePlanBadge({ plan, isId }: { plan: AISignal["tradePlan"]; isId: boolean }) {
  if (!plan || plan.entryPrice == null || plan.stopLoss == null) return null;

  return (
    <span
      className="flex items-center gap-1.5 rounded px-2 py-0.5"
      style={{ background: "var(--muted)", border: "1px solid var(--border)" }}
    >
      <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
        {isId ? "Entry" : "Entry"}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
        {plan.entryPrice.toLocaleString("id-ID")}
      </span>
      <span style={{ fontSize: 10, color: "var(--border)" }}>|</span>
      <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>SL</span>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--loss)", fontFamily: "var(--font-mono)" }}>
        {plan.stopLoss.toLocaleString("id-ID")}
        {plan.stopLossPct != null && ` (${plan.stopLossPct.toFixed(1)}%)`}
      </span>
      {plan.riskRewardRatio != null && (
        <>
          <span style={{ fontSize: 10, color: "var(--border)" }}>|</span>
          <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>R/R</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
            {plan.riskRewardRatio.toFixed(1)}
          </span>
        </>
      )}
    </span>
  );
}

/* SHAP waterfall bar chart */
function ShapChart({ shap, isId }: { shap: AISignal["shap"]; isId: boolean }) {
  const data = [...shap].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const chartData = data.map((d) => ({
    name: isId ? d.factor : d.factorEn,
    value: d.value,
    fill: d.value >= 0 ? "var(--gain)" : "var(--loss)",
  }));

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {isId ? "Faktor Penentu (SHAP)" : "SHAP Factor Analysis"}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 10 }}>
        {isId ? "Kontribusi fitur terhadap probabilitas" : "Feature contributions to probability"}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
          <XAxis
            type="number"
            tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={78}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}
            formatter={(v: number) => [`${v > 0 ? "+" : ""}${v}`, isId ? "Kontribusi" : "Contribution"]}
          />
          <Bar dataKey="value" radius={[0, 2, 2, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={`shap-${i}`} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* OJK Legal Disclaimer Modal */
function DisclaimerModal({ isId, onAccept }: { isId: boolean; onAccept: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          maxWidth: 520,
          width: "100%",
          padding: 32,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 4,
              background: "rgba(245,158,11,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={18} style={{ color: "var(--warning)" }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
              {isId ? "Disclaimer — Kepatuhan OJK" : "Disclaimer — OJK Compliance"}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              {isId ? "Baca sebelum menggunakan fitur AI" : "Read before using AI features"}
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            background: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div className="flex flex-col gap-3">
            {(isId ? [
              "Platform ini adalah Sistem Pendukung Keputusan berbasis AI (AIDSS) dan BUKAN merupakan nasihat investasi resmi.",
              "Seluruh output disajikan sebagai Probabilitas Skor (contoh: \"Prob. Naik: 78%\") dan BUKAN sebagai instruksi Beli/Jual yang pasti.",
              "Keputusan investasi sepenuhnya menjadi tanggung jawab Anda. AIDSS tidak bertanggung jawab atas kerugian investasi.",
              "Pastikan Anda telah memahami profil risiko dan kemampuan finansial Anda sebelum menggunakan fitur ini.",
            ] : [
              "This platform is an AI-based Decision Support System (AIDSS) and does NOT constitute official investment advice.",
              "All outputs are presented as Probability Scores (e.g., \"Prob. Up: 78%\") and NOT as definitive Buy/Sell instructions.",
              "Investment decisions are entirely your responsibility. AIDSS bears no liability for investment losses.",
              "Ensure you understand your risk profile and financial capacity before using this feature.",
            ]).map((text, i) => (
              <div key={i} className="flex items-start gap-2">
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "rgba(245,158,11,0.15)",
                    color: "var(--warning)",
                    fontSize: 10,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {i + 1}
                </div>
                <span style={{ fontSize: 12, color: "var(--foreground)", lineHeight: 1.6 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
            {isId ? "Diatur oleh: OJK & Peraturan Pasar Modal Indonesia" : "Governed by: OJK & Indonesian Capital Market Regulations"}
          </div>
          <button
            onClick={onAccept}
            style={{
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              border: "none",
              borderRadius: 4,
              padding: "8px 20px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
            }}
          >
            {isId ? "Saya Mengerti & Setuju" : "I Understand & Agree"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One recommendation card.
 *
 * Extracted from the list body because it owns hooks: `useTechnicals` and
 * `useBrokerSummary` cannot be called from inside a `.map()` callback. Both are
 * gated on `isOpen`, so a collapsed card issues no requests — otherwise every
 * page load would fire two round trips per symbol for panels nobody has opened.
 */
function SignalCard({
  rec,
  isOpen,
  onToggle,
  isId,
  t,
}: {
  rec: AISignal;
  isOpen: boolean;
  onToggle: () => void;
  isId: boolean;
  // Derived from the hook rather than widened to (key: string), so a typo in a
  // translation key fails the type check instead of rendering the key itself.
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const cfg = TIER_CFG[rec.probabilityTier as Tier];
  const Icon = cfg.icon;
  const upPos = rec.upside >= 0;

  const technicals = useTechnicals(rec.symbol, 120, isOpen);
  const broksum = useBrokerSummary(rec.symbol, 20, isOpen);

  // Prefer live technicals once loaded; fall back to whatever the signal
  // payload carried. Both may be absent, and every consumer below guards.
  const srLevels = technicals.supportResistance.length
    ? technicals.supportResistance
    : (rec.supportResistance ?? []);
  const gaps = technicals.gaps.length ? technicals.gaps : (rec.openGaps ?? []);
  const trend = technicals.trend ?? rec.trend ?? null;
  const snapshot = broksum.snapshot ?? rec.brokerSummary ?? null;
  // Prefer the live technicals trade plan / note (computed on fresh bars) over
  // whatever the signal payload carried at generation time.
  const plan = technicals.tradePlan ?? rec.tradePlan ?? null;
  const note =
    (isId ? technicals.technicalNote : technicals.technicalNoteEn) ||
    (isId ? rec.technicalNote : rec.technicalNoteEn);
  const patterns = (isId ? rec.activePatterns : rec.activePatternsEn) ?? [];
  const unfilledGaps = gaps.filter((g) => !g.isFilled);

  return (
    <div
      className="rounded overflow-hidden"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      {/* Card header */}
      <div
        className="flex items-start gap-4 p-5 cursor-pointer"
        onClick={onToggle}
        style={{ userSelect: "none" }}
      >
        {/* Probability gauge — OJK compliant (replaces absolute buy/sell badge) */}
        <ProbabilityGauge uprob={rec.uprob} tier={rec.probabilityTier as Tier} />

        {/* Name + symbol + thesis */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
              {rec.symbol}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{rec.name}</span>
            {/* Signal label — for display context only, not trading instruction */}
            <span
              className="flex items-center gap-1 rounded px-2 py-0.5"
              style={{ background: cfg.bg, border: `1px solid ${cfg.color}25` }}
            >
              <Icon size={10} style={{ color: cfg.color }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: cfg.color, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
                {tierLabel(rec.probabilityTier as Tier, isId)}
              </span>
            </span>
            <TrendBadge trend={trend} isId={isId} />
          </div>

          {/* Entry / stop loss — absent when no usable support level exists */}
          {plan && (
            <div className="flex mt-1.5">
              <TradePlanBadge plan={plan} isId={isId} />
            </div>
          )}

          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.5 }}>
            {isId ? rec.thesis.substring(0, 100) + "…" : rec.thesisEn.substring(0, 100) + "…"}
          </div>
        </div>

        {/* Right metrics */}
        <div className="flex items-start gap-6 flex-shrink-0">
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 2 }}>{t("ai_target")}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
              {rec.targetPrice.toLocaleString("id-ID")}
            </div>
            <div style={{ fontSize: 11, color: upPos ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>
              {upPos ? "+" : ""}{rec.upside.toFixed(1)}%
            </div>
          </div>
          <div style={{ minWidth: 80 }}>
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{t("ai_model_score")}</span>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: cfg.color }}>{rec.modelScore}</span>
            </div>
            {/* Confidence bar */}
            <div style={{ width: "100%", height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${rec.confidence}%`, height: "100%", background: cfg.color, borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 3 }}>{t("ai_confidence")}: {rec.confidence}%</div>
          </div>
          <div style={{ color: "var(--muted-foreground)", marginTop: 4 }}>
            {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {isOpen && (
        <div
          className="px-5 pb-5 flex flex-col gap-5"
          style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}
        >
          {/* Interactive candlestick chart with S/R, entry and stop lines */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("ai_price_action")}
            </div>
            <Suspense
              fallback={
                <div
                  style={{
                    height: 280, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, color: "var(--muted-foreground)", background: "var(--muted)", borderRadius: 4,
                  }}
                >
                  {isId ? "Memuat grafik…" : "Loading chart…"}
                </div>
              }
            >
              <CandlestickChart
                ohlcv={technicals.ohlcv}
                supportResistance={srLevels}
                entryPrice={plan?.entryPrice ?? null}
                stopLoss={plan?.stopLoss ?? null}
                gaps={gaps}
                height={280}
                locale={isId ? "id" : "en"}
              />
            </Suspense>
          </div>

          {/* Actionable technical read: when to enter, where the stop is, R:R */}
          <EntrySignalCard entry={technicals.entrySignal} plan={plan} locale={isId ? "id" : "en"} />

          <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {/* Left: thesis + technical note + catalysts + meta */}
            <div className="flex flex-col gap-4">
              {/* Full thesis — the hand-written narrative, never replaced by a template */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {t("ai_thesis")}
                </div>
                <p style={{ fontSize: 12, color: "var(--foreground)", lineHeight: 1.6 }}>
                  {isId ? rec.thesis : rec.thesisEn}
                </p>
              </div>

              {/* Generated technical commentary — additive to the thesis above */}
              {note && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {t("ai_technical_note")}
                  </div>
                  <p
                    style={{
                      fontSize: 12, color: "var(--foreground)", lineHeight: 1.6,
                      background: "var(--muted)", borderRadius: 4, padding: 10,
                    }}
                  >
                    {note}
                  </p>
                </div>
              )}

              {/* Stop loss rationale */}
              {plan?.stopLoss != null && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {t("ai_stop_loss")}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--loss)", fontFamily: "var(--font-mono)" }}>
                      Rp {plan.stopLoss.toLocaleString("id-ID")}
                    </span>
                    {plan.stopLossPct != null && (
                      <span style={{ fontSize: 11, color: "var(--loss)", fontFamily: "var(--font-mono)" }}>
                        {plan.stopLossPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>
                    {isId ? plan.stopLossReason : plan.stopLossReasonEn}
                  </div>
                </div>
              )}

              {/* Candlestick patterns */}
              {patterns.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {t("ai_patterns")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {patterns.map((p, i) => (
                      <span
                        key={`${p}-${i}`}
                        className="rounded px-2 py-0.5"
                        style={{ background: "var(--muted)", border: "1px solid var(--border)", fontSize: 10, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Open gaps */}
              {unfilledGaps.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {t("ai_open_gaps")}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {unfilledGaps.slice(0, 3).map((g, i) => (
                      <div key={`${g.date}-${i}`} className="flex items-center justify-between gap-2">
                        <span style={{ fontSize: 11, color: "var(--foreground)" }}>
                          {g.type === "gap_up" ? (isId ? "Gap naik" : "Gap up") : (isId ? "Gap turun" : "Gap down")}
                          {" "}
                          <span style={{ fontFamily: "var(--font-mono)" }}>{g.gapPct.toFixed(1)}%</span>
                        </span>
                        <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                          {isId ? "prob. tutup" : "fill prob."} {Math.round(g.fillProbability * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Catalysts */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {t("ai_catalysts")}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {(isId ? rec.catalysts : rec.catalystsEn).map((cat, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <div style={{ width: 4, height: 4, borderRadius: "50%", background: cfg.color, marginTop: 5, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "var(--foreground)", lineHeight: 1.5 }}>{cat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Meta row */}
              <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 2 }}>{t("ai_horizon")}</div>
                  <div className="flex items-center gap-1">
                    <Clock size={11} style={{ color: "var(--muted-foreground)" }} />
                    <span style={{ fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                      {isId ? rec.horizon : rec.horizonEn}
                    </span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 2 }}>{t("ai_risk_level")}</div>
                  <div className="flex items-center gap-1">
                    <AlertTriangle size={11} style={{ color: "var(--warning)" }} />
                    <span style={{ fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                      {isId ? rec.risk : rec.riskEn}
                    </span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 2 }}>{t("ai_upside")}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: upPos ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>
                    {upPos ? "+" : ""}{rec.upside.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Analyst consensus */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {t("ai_analyst_consensus")}
                </div>
                <div style={{ fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)", lineHeight: 1.8 }}>
                  {(isId ? rec.analystConsensus : rec.analystConsensusEn)
                    .split(" | ")
                    .map((line, i) => <div key={i}>{line}</div>)
                  }
                </div>
              </div>
            </div>

            {/* Right: SHAP chart + broker summary */}
            <div className="flex flex-col gap-4">
              <div style={{ background: "var(--muted)", borderRadius: 4, padding: 16 }}>
                <ShapChart shap={rec.shap} isId={isId} />
                <div
                  className="flex items-center justify-between mt-3 pt-3"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                    {isId ? "Sumber: LightGBM + SHAP v4.2" : "Source: LightGBM + SHAP v4.2"}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color, fontFamily: "var(--font-mono)" }}>
                    {t("ai_model_score")}: {rec.modelScore}
                  </div>
                </div>
              </div>

              {(technicals.volume || technicals.accumulation) && (
                <div style={{ background: "var(--muted)", borderRadius: 4, padding: 16 }}>
                  <VolumeAccumulationPanel
                    volume={technicals.volume}
                    accumulation={technicals.accumulation}
                    locale={isId ? "id" : "en"}
                  />
                </div>
              )}

              <div style={{ background: "var(--muted)", borderRadius: 4, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {t("ai_broker_summary")}
                </div>
                <BrokerSummaryPanel
                  snapshot={snapshot}
                  history={broksum.history}
                  source={broksum.source}
                  locale={isId ? "id" : "en"}
                  loading={broksum.loading}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AIAdvisorView() {
  const { locale } = useApp();
  const { t } = useTranslation(locale);
  const isId = locale === "id";
  const [expanded, setExpanded] = useState<number | null>(null);
  // Persisted so the gate survives a reload or navigating away and back — the
  // previous plain useState(false) reset on every mount, which made the OJK
  // disclaimer gate cosmetic rather than a real gate (GAP-16). Server-side
  // recording of the acceptance for audit is a separate concern (GAP-03).
  const [disclaimerAccepted, setDisclaimerAccepted] = useState<boolean>(
    () => readDisclaimerAccepted()
  );
  const { signals, loading, error } = useAISignals();

  const avgUprob = signals.length
    ? Math.round(signals.reduce((s, r) => s + r.uprob, 0) / signals.length)
    : 0;
  const activeSignals = signals.filter((r) => r.probabilityTier !== "NEUTRAL").length;

  if (loading) {
    return <ViewSkeleton rows={5} label={isId ? "Memuat sinyal AI…" : "Loading AI signals…"} />;
  }
  if (error) {
    return <ViewError message={error} locale={locale} />;
  }

  return (
    <>
      {!disclaimerAccepted && (
        <DisclaimerModal
          isId={isId}
          onAccept={() => {
            writeDisclaimerAccepted();
            setDisclaimerAccepted(true);
          }}
        />
      )}

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

        {/* OJK compliance notice banner */}
        <div
          className="flex items-center gap-3 px-4 py-3 rounded"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
        >
          <ShieldCheck size={14} style={{ color: "var(--warning)", flexShrink: 0 }} />
          <div style={{ fontSize: 11, color: "var(--foreground)", flex: 1 }}>
            <span style={{ fontWeight: 600, color: "var(--warning)" }}>
              {isId ? "Kepatuhan OJK:" : "OJK Compliance:"}
            </span>
            {" "}
            {isId
              ? "Seluruh output berupa Probabilitas Skor — bukan nasihat investasi atau instruksi beli/jual yang pasti."
              : "All outputs are Probability Scores — not investment advice or definitive buy/sell instructions."}
          </div>
          <button
            onClick={() => {
              clearDisclaimerAccepted();
              setDisclaimerAccepted(false);
            }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 0 }}
          >
            <X size={12} />
          </button>
        </div>

        {/* Header metrics */}
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {[
            { label: t("ai_model_accuracy"),  value: "84.7%",          color: "var(--gain)",             icon: Brain     },
            { label: t("ai_active_signals"),  value: String(activeSignals), color: "var(--neutral)",      icon: TrendingUp },
            { label: t("ai_avg_confidence"),  value: `${avgUprob}%`,    color: "var(--warning)",          icon: BarChart2  },
            { label: t("ai_last_updated"),    value: "14:47 WIB",       color: "var(--muted-foreground)", icon: Clock      },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.label} className="rounded p-4 flex items-center gap-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div style={{ width: 32, height: 32, borderRadius: 4, background: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={15} style={{ color: m.color }} />
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{m.value}</div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 1 }}>{m.label}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Portfolio Q&A — streams from /v1/advisor/chat */}
        <AdvisorChat locale={isId ? "id" : "en"} />

        {/* Recommendation cards */}
        <div className="flex flex-col gap-3">
          {signals.map((rec) => (
            <SignalCard
              key={rec.id}
              rec={rec}
              isOpen={expanded === rec.id}
              onToggle={() => setExpanded(expanded === rec.id ? null : rec.id)}
              isId={isId}
              t={t}
            />
          ))}
        </div>
      </div>
    </>
  );
}
