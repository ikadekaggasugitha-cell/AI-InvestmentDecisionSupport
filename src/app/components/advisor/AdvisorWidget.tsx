import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PieChart, Pie,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Interactive visual widgets for AI Advisor answers.
 *
 * The model emits ```aidss:widget``` JSON blocks (see advisor_service._WIDGET_SPEC);
 * AdvisorMessage parses them and renders the matching component here. Every
 * widget reuses the app's chart stack (recharts) so hover tooltips, colours, and
 * typography match the rest of the dashboard. Unknown or malformed widgets
 * render nothing rather than dumping raw JSON at the reader.
 */

type Tone = "gain" | "loss" | "neutral" | "warning";

const TONE_COLOR: Record<Tone, string> = {
  gain: "var(--gain)",
  loss: "var(--loss)",
  neutral: "var(--neutral)",
  warning: "var(--warning)",
};

function toneColor(tone: unknown): string {
  return TONE_COLOR[(tone as Tone)] ?? "var(--foreground)";
}

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  color: "var(--foreground)",
} as const;

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)",
      textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
    }}
  >
    {children}
  </div>
);

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div
    className="rounded"
    style={{ background: "var(--muted)", border: "1px solid var(--border)", padding: 12, margin: "8px 0" }}
  >
    {children}
  </div>
);

/* ── 1. Key-metric tiles ─────────────────────────────────────────────────── */

function MetricTiles({ w }: { w: any }) {
  const items: any[] = Array.isArray(w.items) ? w.items : [];
  if (!items.length) return null;
  return (
    <Frame>
      {w.title && <SectionTitle>{w.title}</SectionTitle>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8 }}>
        {items.map((it, i) => (
          <div
            key={i}
            title={String(it.label ?? "")}
            className="rounded"
            style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "8px 10px" }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: toneColor(it.tone), fontFamily: "var(--font-mono)", lineHeight: 1.2 }}>
              {String(it.value ?? "—")}
            </div>
            <div style={{ fontSize: 9.5, color: "var(--muted-foreground)", marginTop: 2 }}>
              {String(it.label ?? "")}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ── 2. Probability gauge for one stock ──────────────────────────────────── */

const TIER_ICON: Record<string, typeof TrendingUp> = {
  VERY_HIGH: TrendingUp, HIGH: TrendingUp, NEUTRAL: Minus, LOW: TrendingDown,
};

function SignalGauge({ w }: { w: any }) {
  const uprob = Number(w.uprob);
  if (!Number.isFinite(uprob)) return null;
  const tier = String(w.tier ?? "NEUTRAL");
  const isDown = tier === "LOW";
  const display = isDown ? 100 - uprob : uprob;
  const color = isDown ? "var(--loss)" : uprob >= 70 ? "var(--gain)" : uprob >= 55 ? "var(--warning)" : "var(--muted-foreground)";
  const bg = isDown ? "var(--loss-bg)" : uprob >= 70 ? "var(--gain-bg)" : "rgba(245,158,11,0.08)";
  const Icon = TIER_ICON[tier] ?? Minus;
  const upside = Number(w.upside);

  return (
    <Frame>
      <div className="flex items-center gap-4">
        <div style={{ textAlign: "center", minWidth: 64 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: "50%", border: `3px solid ${color}`,
              background: bg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto",
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>{display}%</span>
          </div>
          <div style={{ fontSize: 9, color: "var(--muted-foreground)", marginTop: 3 }}>
            {isDown ? "Prob. Turun" : "Prob. Naik"}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
              {String(w.symbol ?? "")}
            </span>
            {w.name && <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{String(w.name)}</span>}
            <span className="flex items-center gap-1 rounded px-1.5 py-0.5" style={{ background: bg, border: `1px solid ${color}25` }}>
              <Icon size={10} style={{ color }} />
              <span style={{ fontSize: 9.5, fontWeight: 600, color, fontFamily: "var(--font-mono)" }}>{tier}</span>
            </span>
          </div>
          <div className="flex gap-4" style={{ marginTop: 6 }}>
            {Number.isFinite(Number(w.target)) && (
              <div>
                <div style={{ fontSize: 9, color: "var(--muted-foreground)" }}>Target</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                  {Number(w.target).toLocaleString("id-ID")}
                </div>
              </div>
            )}
            {Number.isFinite(upside) && (
              <div>
                <div style={{ fontSize: 9, color: "var(--muted-foreground)" }}>Potensi</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: upside >= 0 ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>
                  {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}

/* ── 3. SHAP factor bars ─────────────────────────────────────────────────── */

function ShapWidget({ w }: { w: any }) {
  const raw: any[] = Array.isArray(w.factors) ? w.factors : [];
  const data = raw
    .filter((f) => Number.isFinite(Number(f.value)))
    .map((f) => ({ name: String(f.label ?? ""), value: Number(f.value) }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (!data.length) return null;

  return (
    <Frame>
      <SectionTitle>Faktor Penentu (SHAP){w.symbol ? ` — ${w.symbol}` : ""}</SectionTitle>
      <ResponsiveContainer width="100%" height={Math.max(90, data.length * 26)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }}>
          <XAxis type="number" tick={{ fontSize: 9, fill: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`} />
          <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v: number) => [`${v > 0 ? "+" : ""}${v}`, "Kontribusi"]} />
          <Bar dataKey="value" radius={[0, 2, 2, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value >= 0 ? "var(--gain)" : "var(--loss)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

/* ── 4. Risk radar ───────────────────────────────────────────────────────── */

function RiskRadar({ w }: { w: any }) {
  const data = (Array.isArray(w.items) ? w.items : [])
    .filter((it: any) => Number.isFinite(Number(it.value)))
    .map((it: any) => ({ subject: String(it.label ?? ""), value: Number(it.value), fullMark: 100 }));
  if (data.length < 3) return null;

  return (
    <Frame>
      <SectionTitle>{w.title ?? "Profil Risiko"}</SectionTitle>
      <ResponsiveContainer width="100%" height={220}>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
          <Radar dataKey="value" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.35} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}/100`, "Skor"]} />
        </RadarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

/* ── 5. Allocation donut ─────────────────────────────────────────────────── */

const PIE_COLORS = [
  "var(--primary)", "var(--gain)", "var(--warning)", "var(--neutral)",
  "var(--loss)", "#8b5cf6", "#06b6d4", "#f472b6", "#a3e635", "#fb923c",
];

function Allocation({ w }: { w: any }) {
  const data = (Array.isArray(w.items) ? w.items : [])
    .filter((it: any) => Number.isFinite(Number(it.value)))
    .map((it: any) => ({ name: String(it.label ?? ""), value: Number(it.value) }));
  if (!data.length) return null;

  return (
    <Frame>
      <SectionTitle>{w.title ?? "Alokasi Portofolio"}</SectionTitle>
      <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
        <ResponsiveContainer width={160} height={160}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={70} paddingAngle={2} stroke="var(--card)">
              {data.map((_: unknown, i: number) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n: string) => [`${v.toFixed(1)}%`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 120 }}>
          {data.map((d: { name: string; value: number }, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5" style={{ fontSize: 11, color: "var(--foreground)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], display: "inline-block" }} />
                {d.name}
              </span>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}>{d.value.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/* ── Dispatcher ──────────────────────────────────────────────────────────── */

export function AdvisorWidget({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const w = data as any;
  switch (w.type) {
    case "metric_tiles": return <MetricTiles w={w} />;
    case "signal_gauge": return <SignalGauge w={w} />;
    case "shap":         return <ShapWidget w={w} />;
    case "risk_radar":   return <RiskRadar w={w} />;
    case "allocation":   return <Allocation w={w} />;
    default:             return null;
  }
}
