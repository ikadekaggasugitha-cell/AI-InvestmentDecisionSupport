import { FileBarChart2, Download, Calendar, TrendingUp } from "lucide-react";
import { useApp } from "../context/AppContext";

interface ReportItem {
  id: number;
  titleId: string;
  titleEn: string;
  descriptionId: string;
  descriptionEn: string;
  date: string;
  type: "Performance" | "Quarterly" | "Risk" | "Tax" | "AI Audit";
  typeLabelId: string;
  typeLabelEn: string;
  size: string;
  status: "Ready" | "Generating...";
}

const reports: ReportItem[] = [
  {
    id: 1,
    titleId: "Laporan Kinerja Bulanan",
    titleEn: "Monthly Performance Report",
    descriptionId: "Ringkasan kinerja portofolio bulan Juni 2026 termasuk analisis atribusi faktor",
    descriptionEn: "Portfolio performance summary for June 2026 including attribution analysis",
    date: "1 Jul 2026",
    type: "Performance",
    typeLabelId: "Kinerja",
    typeLabelEn: "Performance",
    size: "2.4 MB",
    status: "Ready",
  },
  {
    id: 2,
    titleId: "Tinjauan Investasi Q2 2026",
    titleEn: "Q2 2026 Investment Review",
    descriptionId: "Tinjauan kuartalan atas keputusan alokasi investasi, hasil, dan proyeksi ke depan",
    descriptionEn: "Quarterly review of investment decisions, outcomes, and forward outlook",
    date: "5 Jul 2026",
    type: "Quarterly",
    typeLabelId: "Kuartalan",
    typeLabelEn: "Quarterly",
    size: "5.8 MB",
    status: "Ready",
  },
  {
    id: 3,
    titleId: "Laporan Penilaian Risiko — Juli",
    titleEn: "Risk Assessment Report — July",
    descriptionId: "Metrik risiko komprehensif, analisis VaR/CVaR, dan hasil simulasi stress test",
    descriptionEn: "Comprehensive risk metrics, VaR analysis, and stress test results",
    date: "15 Jul 2026",
    type: "Risk",
    typeLabelId: "Risiko",
    typeLabelEn: "Risk",
    size: "1.9 MB",
    status: "Ready",
  },
  {
    id: 4,
    titleId: "Peluang Tax-Loss Harvesting",
    titleEn: "Tax Loss Harvesting Opportunities",
    descriptionId: "Posisi yang diidentifikasi AI memenuhi syarat untuk efisiensi pajak akhir tahun",
    descriptionEn: "AI-identified positions eligible for tax-loss harvesting before year-end",
    date: "20 Jul 2026",
    type: "Tax",
    typeLabelId: "Pajak",
    typeLabelEn: "Tax",
    size: "0.8 MB",
    status: "Ready",
  },
  {
    id: 5,
    titleId: "Audit Kinerja Sinyal AI",
    titleEn: "AI Signal Performance Audit",
    descriptionId: "Hasil backtesting dan metrik akurasi rekomendasi model LightGBM YTD",
    descriptionEn: "Backtesting results and accuracy metrics for AI recommendations YTD",
    date: "22 Jul 2026",
    type: "AI Audit",
    typeLabelId: "Audit AI",
    typeLabelEn: "AI Audit",
    size: "3.2 MB",
    status: "Generating...",
  },
];

const typeColors: Record<string, string> = {
  Performance: "var(--neutral)",
  Quarterly: "var(--chart-4)",
  Risk: "var(--loss)",
  Tax: "var(--warning)",
  "AI Audit": "var(--gain)",
};

export function ReportsView() {
  const { locale } = useApp();
  const isId = locale === "id";

  const stats = [
    {
      label: isId ? "Laporan Dibuat YTD" : "Reports Generated YTD",
      value: "47",
      icon: FileBarChart2,
      color: "var(--neutral)",
    },
    {
      label: isId ? "Laporan Terjadwal" : "Scheduled Reports",
      value: "12",
      icon: Calendar,
      color: "var(--chart-4)",
    },
    {
      label: isId ? "Sumber Data Terintegrasi" : "Data Sources Integrated",
      value: "24",
      icon: TrendingUp,
      color: "var(--gain)",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
      {/* Stats */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        {stats.map((card) => (
          <div
            key={card.label}
            className="rounded p-5 flex items-center gap-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div
              className="flex items-center justify-center rounded flex-shrink-0"
              style={{
                width: 44,
                height: 44,
                background: "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              <card.icon size={20} style={{ color: card.color }} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "var(--foreground)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {card.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                {card.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Reports list */}
      <div
        className="rounded overflow-hidden"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
            {isId ? "Laporan Terbaru" : "Recent Reports"}
          </div>
          <button
            className="flex items-center gap-2 px-3 py-1.5 rounded"
            style={{
              background: "var(--gain-bg)",
              border: "1px solid var(--gain)",
              color: "var(--gain)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <FileBarChart2 size={13} />
            {isId ? "Buat Laporan" : "Generate Report"}
          </button>
        </div>
        <div className="flex flex-col gap-0">
          {reports.map((report, i) => {
            const typeColor = typeColors[report.type] || "var(--neutral)";
            const isReady = report.status === "Ready";

            return (
              <div
                key={report.id}
                className="flex items-center gap-4 px-5 py-4"
                style={{
                  borderBottom:
                    i < reports.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <div
                  className="flex items-center justify-center rounded flex-shrink-0"
                  style={{
                    width: 40,
                    height: 40,
                    background: "var(--muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <FileBarChart2 size={18} style={{ color: typeColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--foreground)",
                      }}
                    >
                      {isId ? report.titleId : report.titleEn}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded"
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                        background: "var(--muted)",
                        color: typeColor,
                        border: `1px solid ${typeColor}40`,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {(isId ? report.typeLabelId : report.typeLabelEn).toUpperCase()}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted-foreground)",
                      marginTop: 2,
                    }}
                  >
                    {isId ? report.descriptionId : report.descriptionEn}
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted-foreground)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {report.date}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {report.size}
                    </div>
                  </div>
                  <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded"
                    style={{
                      background: isReady ? "var(--neutral-bg)" : "var(--muted)",
                      border: `1px solid ${isReady ? "var(--neutral)" : "var(--border)"}`,
                      color: isReady ? "var(--neutral)" : "var(--muted-foreground)",
                      fontSize: 12,
                      cursor: isReady ? "pointer" : "default",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isReady ? (
                      <>
                        <Download size={13} />
                        {isId ? "Unduh" : "Download"}
                      </>
                    ) : (
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {isId ? "Memproses..." : "Generating..."}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
