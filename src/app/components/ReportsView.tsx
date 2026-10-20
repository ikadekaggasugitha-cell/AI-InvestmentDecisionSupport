import { Download, Loader2, Plus } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useReports } from "../hooks/useReports";

/**
 * Reports module.
 *
 * Every report is generated on demand as a real PDF from live data (backend
 * /v1/reports). "Buat Laporan" generates+downloads the headline performance
 * report; each row's "Unduh" downloads that type. Buttons disable while their
 * request is in flight, and errors surface inline — no inert/placeholder
 * controls.
 */

export function ReportsView() {
  const { locale } = useApp();
  const isId = locale === "id";
  const {
    reports, loading, error, failure, isLive, generating, downloading, generate, download,
  } = useReports();

  /*
   * The three stat tiles are gone: "5 report types" counted the list printed
   * right below it, "PDF" repeated the format every row already states, and
   * the data-source tile was the only tile carrying real information — that
   * one fact now lives in the list header as a quiet line.
   */

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6 flex flex-col gap-5 [&>*]:shrink-0">

      {/* Never the raw status. "Gagal memproses laporan: reports HTTP 402" tells
          the reader nothing about whether to retry or to subscribe. */}
      {error && (
        <div
          role="alert"
          className="rounded px-4 py-2"
          style={{
            background: failure?.kind === "locked" ? "var(--warning-bg)" : "var(--loss-bg)",
            border: `1px solid ${failure?.kind === "locked" ? "var(--warning)" : "var(--loss)"}`,
            color: failure?.kind === "locked" ? "var(--warning)" : "var(--loss)",
            fontSize: 13,
          }}
        >
          {failure?.kind === "locked"
            ? (isId
                ? "Laporan tidak dibuat: langganan belum aktif. Ini bukan masalah koneksi."
                : "No report generated: the subscription is not active. This is not a connection problem.")
            : (isId
                ? "Gagal memproses laporan. Periksa koneksi dan coba lagi."
                : "Could not process the report. Check your connection and try again.")}
        </div>
      )}

      {/* Reports list */}
      <div className="rounded overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
              {isId ? "Laporan Tersedia" : "Available Reports"}
            </div>
            {/* Provenance, not a tile: whether the catalogue came from the
                backend or is the shipped sample, stated where it belongs. */}
            <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>
              {isLive ? (isId ? "Langsung dari API" : "Live from the API") : (isId ? "Data contoh" : "Sample data")} · PDF
            </div>
          </div>
          <button
            onClick={() => generate("performance")}
            disabled={generating !== null}
            className="flex items-center gap-2 px-3 py-1.5 rounded"
            style={{
              background: "var(--foreground)", border: "1px solid var(--foreground)", color: "var(--card)",
              fontSize: 12, cursor: generating !== null ? "not-allowed" : "pointer",
              opacity: generating !== null ? 0.6 : 1,
            }}
          >
            {generating === "performance"
              ? <Loader2 size={13} className="animate-spin" />
              : <Plus size={13} />}
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
            const isDownloading = downloading === report.type;
            const isGenerating = generating === report.type;
            const busy = isDownloading || isGenerating;
            return (
              <div key={report.type} className="flex items-center gap-4 px-5 py-4"
                style={{ borderBottom: i < reports.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                      {isId ? report.titleId : report.titleEn}
                    </span>
                    {/* Classification, quiet: a taxonomy label is not a state, so
                        it loses its per-type colour and prints as a neutral pill. */}
                    <span className="px-2 py-0.5 rounded" style={{
                      fontSize: 11, fontWeight: 500, background: "var(--muted)", color: "var(--muted-foreground)",
                    }}>
                      {isId ? report.labelId : report.labelEn}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>
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
                      background: "var(--card)", border: "1px solid var(--control-border)", color: "var(--foreground)",
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
