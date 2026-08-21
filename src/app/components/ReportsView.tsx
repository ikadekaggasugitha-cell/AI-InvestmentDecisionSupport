import { FileBarChart2, Download, Calendar, TrendingUp, Loader2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useReports, type ReportType } from "../hooks/useReports";

/**
 * Reports module.
 *
 * Every report is generated on demand as a real PDF from live data (backend
 * /v1/reports). "Buat Laporan" generates+downloads the headline performance
 * report; each row's "Unduh" downloads that type. Buttons disable while their
 * request is in flight, and errors surface inline — no inert/placeholder
 * controls.
 */

const typeColors: Record<ReportType, string> = {
  performance: "var(--neutral)",
  quarterly: "var(--chart-4)",
  risk: "var(--loss)",
  tax_loss: "var(--warning)",
  signal_audit: "var(--gain)",
};

export function ReportsView() {
  const { locale } = useApp();
  const isId = locale === "id";
  const { reports, loading, error, generating, downloading, generate, download } = useReports();

  const stats = [
    { label: isId ? "Jenis Laporan" : "Report Types", value: String(reports.length || 5), icon: FileBarChart2, color: "var(--neutral)" },
    { label: isId ? "Format" : "Format", value: "PDF", icon: Calendar, color: "var(--chart-4)" },
    { label: isId ? "Sumber Data" : "Data Source", value: isId ? "Langsung" : "Live", icon: TrendingUp, color: "var(--gain)" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
      {/* Stats */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        {stats.map((card) => (
          <div key={card.label} className="rounded p-5 flex items-center gap-4"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-center rounded flex-shrink-0"
              style={{ width: 44, height: 44, background: "var(--muted)", border: "1px solid var(--border)" }}>
              <card.icon size={20} style={{ color: card.color }} />
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                {card.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded px-4 py-2" style={{ background: "var(--loss-bg)", border: "1px solid var(--loss)", color: "var(--loss)", fontSize: 12 }}>
          {isId ? "Gagal memproses laporan: " : "Report action failed: "}{error}
        </div>
      )}

      {/* Reports list */}
      <div className="rounded overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
            {isId ? "Laporan Tersedia" : "Available Reports"}
          </div>
          <button
            onClick={() => generate("performance")}
            disabled={generating !== null}
            className="flex items-center gap-2 px-3 py-1.5 rounded"
            style={{
              background: "var(--gain-bg)", border: "1px solid var(--gain)", color: "var(--gain)",
              fontSize: 12, cursor: generating !== null ? "not-allowed" : "pointer",
              opacity: generating !== null ? 0.6 : 1,
            }}
          >
            {generating === "performance"
              ? <Loader2 size={13} className="animate-spin" />
              : <FileBarChart2 size={13} />}
            {isId ? "Buat Laporan" : "Generate Report"}
          </button>
        </div>

        <div className="flex flex-col gap-0">
          {loading && reports.length === 0 && (
            <div className="px-5 py-6" style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              {isId ? "Memuat daftar laporan…" : "Loading reports…"}
            </div>
          )}
          {reports.map((report, i) => {
            const color = typeColors[report.type] ?? "var(--neutral)";
            const isDownloading = downloading === report.type;
            const isGenerating = generating === report.type;
            const busy = isDownloading || isGenerating;
            return (
              <div key={report.type} className="flex items-center gap-4 px-5 py-4"
                style={{ borderBottom: i < reports.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="flex items-center justify-center rounded flex-shrink-0"
                  style={{ width: 40, height: 40, background: "var(--muted)", border: "1px solid var(--border)" }}>
                  <FileBarChart2 size={18} style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                      {isId ? report.titleId : report.titleEn}
                    </span>
                    <span className="px-2 py-0.5 rounded" style={{
                      fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", background: "var(--muted)",
                      color, border: `1px solid ${color}40`, letterSpacing: "0.04em",
                    }}>
                      {(isId ? report.labelId : report.labelEn).toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                    {isId ? report.descId : report.descEn}
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                      {report.sizeKb ? `${report.sizeKb.toFixed(0)} KB` : "PDF"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                      {isId ? "Sesuai permintaan" : "On demand"}
                    </div>
                  </div>
                  <button
                    onClick={() => download(report.type)}
                    disabled={busy}
                    className="flex items-center gap-2 px-3 py-1.5 rounded"
                    style={{
                      background: "var(--neutral-bg)", border: "1px solid var(--neutral)", color: "var(--neutral)",
                      fontSize: 12, cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {isDownloading
                      ? <><Loader2 size={13} className="animate-spin" />{isId ? "Mengunduh…" : "Downloading…"}</>
                      : <><Download size={13} />{isId ? "Unduh" : "Download"}</>}
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
