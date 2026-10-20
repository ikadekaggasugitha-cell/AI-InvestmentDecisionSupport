import { memo } from "react";
import { ViewSkeleton } from "./ViewSkeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Activity, AlertTriangle,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";
import { useRiskMetrics, type RiskMetrics, type StressTest, type SectorExposureItem } from "../hooks/useRiskMetrics";
import { fmtIdr } from "../utils/formatting";
import type { LiveMarketData } from "../hooks/useLiveMarket";

interface Props { market: LiveMarketData; }

function RiskGauge({ value, label }: { value: number; label: string }) {
  /* Achromatic like every bar list on this sheet: the number is the identity
     and the caption carries the scale. Level was painted per bar before (amber
     mid, green low) — a six-bar colour ramp is category colour on data, and the
     overall figure still gets full attention in the tile. */
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 13, color: "var(--foreground)" }}>{label}</span>
        <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--foreground)" }}>{value}</span>
      </div>
      <div style={{ height: 6, background: "var(--muted)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: "var(--neutral)", borderRadius: 3, transition: "width 400ms ease" }} />
      </div>
    </div>
  );
}

/* ── Memoized static panels ──────────────────────────────────────────────── */

interface RadarPanelProps { isId: boolean; t: ReturnType<typeof useTranslation>["t"]; rd: RiskMetrics; }

const RiskRadarPanel = memo(function RiskRadarPanel({ isId, t, rd }: RadarPanelProps) {
  return (
    <div className="grid gap-4">
      {/* Risk gauges */}
      <div className="rounded p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>{isId ? "Skor Risiko" : "Risk Scores"}</div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 12 }}>{isId ? "0 = rendah, 100 = sangat tinggi" : "0 = low, 100 = very high"}</div>
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {[
            { label: t("risk_overall"),        value: rd.overallRisk },
            { label: t("risk_market"),         value: rd.marketRisk },
            { label: t("risk_concentration"),  value: rd.concentrationRisk },
            { label: t("risk_liquidity"),      value: rd.liquidityRisk },
            { label: t("risk_currency"),       value: rd.currencyRisk },
            { label: t("risk_credit"),         value: rd.creditRisk },
          ].map((g) => (
            <RiskGauge key={g.label} value={g.value} label={g.label} />
          ))}
        </div>
      </div>
    </div>
  );
});

/*
 * The six-axis radar is gone: it plotted exactly the six numbers the bar list
 * beside it printed, a second presentation of the same figures with less legible
 * values. Same reasoning the six-slice donut went out with in phase A.
 */

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
            <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="scenario" tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontFamily: "var(--font-sans)" }} axisLine={false} tickLine={false} width={140} />
            <Tooltip
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}
              formatter={(v: number) => [`${v.toFixed(1)}%`, isId ? "Dampak" : "Impact"]}
            />
            {/* Every scenario is a drawdown, so the colour-reversed decision has
                no contrast to make: one neutral shade for all six bars, signed
                figures live in the probability table below. */}
            <Bar dataKey="impact" fill="var(--neutral)" radius={[0, 2, 2, 0]} />
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
                <th key={h} style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 500, padding: "4px 8px", textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid var(--border)" }}>
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
                    <span style={{ fontSize: 11, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{row.portfolio.toFixed(1)}%</span>
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
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{item.label}</span>
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

  const { risk: rd, stressTests, sectorExposure, loading, failure, isLive, refetch } =
    useRiskMetrics();

  if (loading) {
    return <ViewSkeleton rows={4} label={isId ? "Memuat data risiko…" : "Loading risk data…"} />;
  }
  // A fetch error no longer blanks the page: the hook keeps the seed metrics in
  // state, so the view stays usable behind an offline badge and re-polls until
  // the backend recovers.

  const stressData = stressTests.map((s) => ({
    scenario: isId ? s.scenario : s.scenarioEn,
    impact: s.impact,
    probability: s.probability,
  }));

  const kpis = [
    // VaR is stored negative (losses are negative throughout the API, so they
    // compose with P&L). A risk tile reads as a magnitude, so take abs here —
    // the label carries the direction. Only numbers that actually signed keep
    // a colour: volatility and the ratios are statistics, so they print ink.
    { label: t("risk_var95"),        value: fmtIdr(Math.abs(rd.var95)), sub: isId ? "dengan keyakinan 95%" : "at 95% confidence", valueColor: "var(--foreground)" },
    { label: t("risk_volatility"),   value: `${rd.volatility}%`,        sub: isId ? "volatilitas tahunan" : "annualized volatility", valueColor: "var(--foreground)" },
    { label: t("risk_max_drawdown"), value: `${rd.maxDrawdown}%`,       sub: isId ? "dari puncak ke lembah" : "peak to trough", valueColor: rd.maxDrawdown < 0 ? "var(--loss)" : "var(--muted-foreground)" },
    { label: t("risk_beta"),         value: rd.beta.toFixed(2),         sub: "vs IHSG", valueColor: "var(--foreground)" },
    { label: t("risk_sharpe"),       value: rd.sharpe.toFixed(2),       sub: isId ? "rasio Sharpe" : "Sharpe ratio", valueColor: "var(--foreground)" },
    { label: t("risk_alpha"),        value: `${rd.alpha > 0 ? "+" : ""}${rd.alpha.toFixed(1)}%`, sub: "vs IHSG benchmark", valueColor: rd.alpha > 0 ? "var(--gain)" : rd.alpha < 0 ? "var(--loss)" : "var(--muted-foreground)" },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6 flex flex-col gap-5 [&>*]:shrink-0">

      {/* Toolbar: manual refresh (the view otherwise only auto-polls). */}
      <div className="flex items-center justify-end">
        <button
          onClick={refetch}
          className="flex items-center gap-2 px-3 py-1.5 rounded"
          style={{ background: "var(--muted)", border: "1px solid var(--control-border)", color: "var(--foreground)", fontSize: 12, cursor: "pointer" }}
        >
          <Activity size={13} />
          {isId ? "Segarkan" : "Refresh"}
        </button>
      </div>

      {/* Why the live figures are missing — the cause, not a guess.
          The banner used to fire on any error and always say the backend was
          unreachable. A 403 is not an outage: the backend is healthy and is
          declining to serve the paid data. Telling someone without a
          subscription to check their connection sends them to debug the wrong
          thing. The seed metrics below stay either way, still labelled — the
          simulated path is deliberate, only the explanation was wrong. */}
      {failure && !isLive && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded"
          role="alert"
          style={{
            background: failure.kind === "locked" ? "var(--warning-bg)" : "var(--loss-bg)",
            border: `1px solid ${failure.kind === "locked" ? "var(--warning)" : "var(--loss)"}`,
          }}
        >
          <AlertTriangle
            size={14}
            style={{ color: failure.kind === "locked" ? "var(--warning)" : "var(--loss)", flexShrink: 0 }}
          />
          <div style={{ fontSize: 13, color: "var(--foreground)", flex: 1, lineHeight: 1.5 }}>
            {failure.kind === "locked" ? (
              <>
                <span style={{ fontWeight: 600, color: "var(--warning)" }}>
                  {isId ? "Data tidak ditampilkan:" : "Data not shown:"}
                </span>{" "}
                {isId
                  ? "langganan belum aktif, jadi analisis risiko tidak dikirim. Ini bukan masalah koneksi, server berjalan baik. Angka di bawah tetap data simulasi."
                  : "the subscription is not active, so risk analysis is not served. This is not a connection problem, the server is healthy. The figures below remain simulated data."}
              </>
            ) : (
              <>
                <span style={{ fontWeight: 600, color: "var(--loss)" }}>
                  {isId ? "Mode simulasi:" : "Simulated mode:"}
                </span>{" "}
                {isId
                  ? "Backend tidak terjangkau, menampilkan data simulasi. Sistem mencoba menyambung kembali otomatis."
                  : "Backend unreachable, showing simulated data. The system is retrying automatically."}
              </>
            )}
          </div>
        </div>
      )}

      {/* KPI row — same anatomy the dashboard and portfolio carry: quiet label
          above, ink value, grey sub. Icon is gone; none of the study screens
          paint a glyph over a KPI. */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.4, marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: k.valueColor, fontFamily: "var(--font-mono)", lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.4 }}>{k.sub}</div>
          </div>
        ))}
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
                <th key={h} style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 500, padding: "7px 16px", textAlign: h === t("risk_col_scenario") ? "left" : "right", borderBottom: "1px solid var(--border)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stressData.map((row) => {
              const impactIdr = market.portfolioValue * (row.impact / 100);
              return (
                <tr key={row.scenario} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "9px 16px", fontSize: 12, color: "var(--foreground)" }}>{row.scenario}</td>
                  <td style={{ padding: "9px 16px", textAlign: "right" }}>
                    <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--loss)" }}>
                      {row.impact.toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ padding: "9px 16px", textAlign: "right", fontSize: 12, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                    {row.probability.toFixed(1)}%
                  </td>
                  <td style={{ padding: "9px 16px", textAlign: "right", fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
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
