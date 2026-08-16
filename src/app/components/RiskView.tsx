import { memo } from "react";
import { ViewSkeleton } from "./ViewSkeleton";
import { ViewError } from "./ViewError";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { Shield, Activity, TrendingDown, BarChart2, DollarSign } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";
import { useRiskMetrics, type RiskMetrics, type StressTest, type SectorExposureItem } from "../hooks/useRiskMetrics";
import { fmtIdr } from "../utils/formatting";
import type { LiveMarketData } from "../hooks/useLiveMarket";

interface Props { market: LiveMarketData; }

function RiskGauge({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600, color }}>{value}</span>
      </div>
      <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 2, transition: "width 400ms ease" }} />
      </div>
    </div>
  );
}

/* ── Memoized static panels ──────────────────────────────────────────────── */

interface RadarPanelProps { isId: boolean; t: ReturnType<typeof useTranslation>["t"]; rd: RiskMetrics; }

const RiskRadarPanel = memo(function RiskRadarPanel({ isId, t, rd }: RadarPanelProps) {
  const radarData = [
    { subject: isId ? "Pasar" : "Market",              value: rd.marketRisk,        fullMark: 100 },
    { subject: isId ? "Konsentrasi" : "Concentration", value: rd.concentrationRisk, fullMark: 100 },
    { subject: isId ? "Likuiditas" : "Liquidity",      value: rd.liquidityRisk,     fullMark: 100 },
    { subject: isId ? "Mata Uang" : "Currency",        value: rd.currencyRisk,      fullMark: 100 },
    { subject: isId ? "Kredit" : "Credit",             value: rd.creditRisk,        fullMark: 100 },
    { subject: isId ? "Keseluruhan" : "Overall",       value: rd.overallRisk,       fullMark: 100 },
  ];

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      {/* Risk gauges */}
      <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>{isId ? "Skor Risiko" : "Risk Scores"}</div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 16 }}>{isId ? "0 = rendah, 100 = sangat tinggi" : "0 = low, 100 = very high"}</div>
        <div className="flex flex-col gap-3">
          {[
            { label: t("risk_overall"),        value: rd.overallRisk,       color: rd.overallRisk > 60 ? "var(--loss)" : rd.overallRisk > 35 ? "var(--warning)" : "var(--gain)" },
            { label: t("risk_market"),          value: rd.marketRisk,        color: "var(--warning)" },
            { label: t("risk_concentration"),  value: rd.concentrationRisk, color: "var(--warning)" },
            { label: t("risk_liquidity"),       value: rd.liquidityRisk,     color: "var(--gain)"    },
            { label: t("risk_currency"),        value: rd.currencyRisk,      color: "var(--gain)"    },
            { label: t("risk_credit"),          value: rd.creditRisk,        color: "var(--gain)"    },
          ].map((g) => (
            <RiskGauge key={g.label} value={g.value} label={g.label} color={g.color} />
          ))}
        </div>
      </div>

      {/* Radar */}
      <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>{t("risk_radar")}</div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 8 }}>{t("risk_radar_sub")}</div>
        <ResponsiveContainer width="100%" height={220}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "var(--muted-foreground)", fontFamily: "var(--font-sans)" }} />
            <Radar
              name={isId ? "Risiko" : "Risk"}
              dataKey="value"
              stroke="var(--loss)"
              fill="var(--loss)"
              fillOpacity={0.12}
              strokeWidth={1.5}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

interface StressPanelProps { isId: boolean; t: ReturnType<typeof useTranslation>["t"]; stressTests: StressTest[]; sectorExposure: SectorExposureItem[]; }

const StressTestsPanel = memo(function StressTestsPanel({ isId, t, stressTests, sectorExposure }: StressPanelProps) {
  const stressData = stressTests.map((s) => ({
    scenario: isId ? s.scenario : s.scenarioEn,
    impact: s.impact,
    probability: s.probability,
  }));
  const exposureData = sectorExposure.map((s) => ({
    sector: isId ? s.sector : s.sectorEn,
    portfolio: s.weight,
    benchmark: s.benchmark,
    overUnder: s.overUnder,
  }));

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      {/* Stress tests chart */}
      <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>{t("risk_stress")}</div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 16 }}>{t("risk_stress_sub")}</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={stressData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="scenario" tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "var(--font-sans)" }} axisLine={false} tickLine={false} width={140} />
            <Tooltip
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}
              formatter={(v: number) => [`${v.toFixed(1)}%`, isId ? "Dampak" : "Impact"]}
            />
            <Bar dataKey="impact" radius={[0, 2, 2, 0]}>
              {stressData.map((_, i) => <Cell key={`stress-${i}`} fill="var(--loss)" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Sector exposure */}
      <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>{t("risk_sector_exp")}</div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 12 }}>{t("risk_sector_sub")}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {[t("risk_col_portfolio"), t("risk_col_benchmark"), t("risk_col_over_under")].map((h, i) => (
                <th key={h} style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 500, padding: "4px 8px", textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid var(--border)" }}>
                  {i === 0 ? t("risk_col_portfolio") : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exposureData.map((row) => (
              <tr key={row.sector} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "7px 8px" }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "var(--foreground)" }}>{row.sector}</div>
                  <div className="flex items-center gap-1 mt-1">
                    <div style={{ height: 3, width: `${row.portfolio * 2}px`, background: "var(--neutral)", borderRadius: 2 }} />
                    <span style={{ fontSize: 10, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{row.portfolio.toFixed(1)}%</span>
                  </div>
                </td>
                <td style={{ padding: "7px 8px", textAlign: "right", fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                  {row.benchmark.toFixed(1)}%
                </td>
                <td style={{ padding: "7px 8px", textAlign: "right" }}>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: row.overUnder > 0 ? "var(--gain)" : row.overUnder < 0 ? "var(--loss)" : "var(--muted-foreground)" }}>
                    {row.overUnder > 0 ? "+" : ""}{row.overUnder.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-4 mt-4">
          {[
            { label: isId ? "Portofolio" : "Portfolio", color: "var(--neutral)" },
            { label: "Benchmark (IHSG)", color: "var(--muted-foreground)" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div style={{ width: 24, height: 3, background: item.color, borderRadius: 2 }} />
              <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

/* ── Main component ──────────────────────────────────────────────────────── */

export function RiskView({ market }: Props) {
  const { locale } = useApp();
  const { t } = useTranslation(locale);
  const isId = locale === "id";

  const { risk: rd, stressTests, sectorExposure, loading, error } = useRiskMetrics();

  if (loading) {
    return <ViewSkeleton rows={4} label={isId ? "Memuat data risiko…" : "Loading risk data…"} />;
  }
  if (error) {
    return <ViewError message={error} locale={locale} />;
  }

  const stressData = stressTests.map((s) => ({
    scenario: isId ? s.scenario : s.scenarioEn,
    impact: s.impact,
    probability: s.probability,
  }));

  const kpis = [
    // VaR is stored negative (losses are negative throughout the API, so they
    // compose with P&L). A risk tile reads as a magnitude, so take abs here —
    // the label and the loss colour already carry the direction.
    { label: t("risk_var95"),        value: fmtIdr(Math.abs(rd.var95)), sub: isId ? "dengan keyakinan 95%" : "at 95% confidence",   icon: Shield,       color: "var(--loss)"    },
    { label: t("risk_volatility"),   value: `${rd.volatility}%`,        sub: isId ? "volatilitas tahunan" : "annualized volatility", icon: Activity,     color: "var(--warning)" },
    { label: t("risk_max_drawdown"), value: `${rd.maxDrawdown}%`,       sub: isId ? "dari puncak ke lembah" : "peak to trough",      icon: TrendingDown, color: "var(--loss)"    },
    { label: t("risk_beta"),         value: rd.beta.toFixed(2),         sub: "vs IHSG",                                              icon: BarChart2,    color: "var(--neutral)" },
    { label: t("risk_sharpe"),       value: rd.sharpe.toFixed(2),       sub: isId ? "rasio Sharpe" : "Sharpe ratio",                 icon: Shield,       color: "var(--gain)"    },
    { label: t("risk_alpha"),        value: `+${rd.alpha.toFixed(1)}%`, sub: "vs IHSG benchmark",                                    icon: DollarSign,   color: "var(--gain)"    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

      {/* KPI row */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-2">
                <Icon size={13} style={{ color: k.color }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)", lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.4 }}>{k.label}</div>
              <div style={{ fontSize: 9, color: k.color, marginTop: 2 }}>{k.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Risk gauges + radar — memoized, do not re-render on market ticks */}
      <RiskRadarPanel isId={isId} t={t} rd={rd} />

      {/* Stress tests + sector exposure — memoized */}
      <StressTestsPanel isId={isId} t={t} stressTests={stressTests} sectorExposure={sectorExposure} />

      {/* Stress probability table — uses market.portfolioValue, re-renders on tick */}
      <div className="rounded overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
            {isId ? "Rincian Probabilitas Skenario" : "Scenario Probability Detail"}
          </span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--muted)" }}>
              {[t("risk_col_scenario"), t("risk_col_impact"), t("risk_col_probability"), isId ? "Dampak IDR" : "IDR Impact"].map((h) => (
                <th key={h} style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 500, padding: "7px 16px", textAlign: h === t("risk_col_scenario") ? "left" : "right", borderBottom: "1px solid var(--border)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stressData.map((row, i) => {
              const impactIdr = market.portfolioValue * (row.impact / 100);
              return (
                <tr key={row.scenario} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--muted)" }}>
                  <td style={{ padding: "9px 16px", fontSize: 12, color: "var(--foreground)" }}>{row.scenario}</td>
                  <td style={{ padding: "9px 16px", textAlign: "right" }}>
                    <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--loss)" }}>
                      {row.impact.toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ padding: "9px 16px", textAlign: "right", fontSize: 12, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                    {row.probability.toFixed(1)}%
                  </td>
                  <td style={{ padding: "9px 16px", textAlign: "right", fontSize: 12, color: "var(--loss)", fontFamily: "var(--font-mono)" }}>
                    {fmtIdr(Math.abs(impactIdr))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
