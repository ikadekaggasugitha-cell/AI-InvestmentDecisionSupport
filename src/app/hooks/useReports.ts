import { useState, useEffect, useCallback } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";

/* ── Public types ────────────────────────────────────────────────────────── */

export type ReportType =
  | "performance" | "quarterly" | "risk" | "tax_loss" | "signal_audit";

export type ReportMeta = {
  type: ReportType;
  titleId: string;
  titleEn: string;
  descId: string;
  descEn: string;
  labelId: string;
  labelEn: string;
  status: string;
  /** Populated after a successful generate/download. */
  sizeKb?: number;
  generatedAt?: string;
};

export interface ReportsResult {
  reports: ReportMeta[];
  loading: boolean;
  error: string | null;
  /** type currently generating (Buat Laporan), or null. */
  generating: ReportType | null;
  /** type currently downloading (Unduh), or null. */
  downloading: ReportType | null;
  generate: (type: ReportType) => Promise<void>;
  download: (type: ReportType) => Promise<void>;
}

/* Offline catalogue so the view still renders without a backend. */
const OFFLINE: ReportMeta[] = [
  { type: "performance", titleId: "Laporan Kinerja Portofolio", titleEn: "Portfolio Performance Report", descId: "Alokasi optimal, bobot, dan ekspektasi imbal hasil per posisi.", descEn: "Optimal allocation, weights, and expected return per position.", labelId: "Kinerja", labelEn: "Performance", status: "ready" },
  { type: "quarterly", titleId: "Tinjauan Investasi Kuartalan", titleEn: "Quarterly Investment Review", descId: "Ringkasan alokasi, metrik portofolio, dan proyeksi.", descEn: "Allocation summary, portfolio metrics, and outlook.", labelId: "Kuartalan", labelEn: "Quarterly", status: "ready" },
  { type: "risk", titleId: "Laporan Penilaian Risiko", titleEn: "Risk Assessment Report", descId: "VaR/CVaR, volatilitas, beta, dan hasil stress test.", descEn: "VaR/CVaR, volatility, beta, and stress-test results.", labelId: "Risiko", labelEn: "Risk", status: "ready" },
  { type: "tax_loss", titleId: "Peluang Tax-Loss Harvesting", titleEn: "Tax-Loss Harvesting Opportunities", descId: "Posisi dengan ekspektasi imbal hasil negatif — kandidat efisiensi pajak.", descEn: "Positions with negative expected return — tax-efficiency candidates.", labelId: "Pajak", labelEn: "Tax", status: "ready" },
  { type: "signal_audit", titleId: "Audit Kinerja Sinyal AI", titleEn: "AI Signal Performance Audit", descId: "Probabilitas naik, tier, dan skor model per saham.", descEn: "Upside probability, tier, and model score per stock.", labelId: "Audit AI", labelEn: "AI Audit", status: "ready" },
];

/* ── Hook ────────────────────────────────────────────────────────────────── */

/** Lists on-demand PDF reports and drives generate/download. */
export function useReports(): ReportsResult {
  const [reports, setReports] = useState<ReportMeta[]>(USE_LIVE_API ? [] : OFFLINE);
  const [loading, setLoading] = useState(USE_LIVE_API);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<ReportType | null>(null);
  const [downloading, setDownloading] = useState<ReportType | null>(null);

  useEffect(() => {
    if (!USE_LIVE_API) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    (async () => {
      try {
        const res = await apiFetch(ENDPOINTS.reports, { signal: controller.signal });
        if (!res.ok) throw new Error(`reports HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setReports(Array.isArray(data?.reports) ? data.reports : OFFLINE);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setReports(OFFLINE); // still render the catalogue
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(timeout);
      }
    })();

    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, []);

  const triggerDownload = useCallback(async (type: ReportType) => {
    // Blob download so the bearer token rides the request (a plain <a href>
    // could not send Authorization). Object URL is revoked after the click.
    const res = await apiFetch(ENDPOINTS.reportDownload(type));
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aidss-${type}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const download = useCallback(async (type: ReportType) => {
    if (!USE_LIVE_API) { setError("Live API disabled — cannot download."); return; }
    setDownloading(type); setError(null);
    try {
      await triggerDownload(type);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }, [triggerDownload]);

  const generate = useCallback(async (type: ReportType) => {
    if (!USE_LIVE_API) { setError("Live API disabled — cannot generate."); return; }
    setGenerating(type); setError(null);
    try {
      const res = await apiFetch(ENDPOINTS.reportGenerate(type), { method: "POST" });
      if (!res.ok) throw new Error(`generate HTTP ${res.status}`);
      const meta = await res.json();
      setReports((rs) => rs.map((r) =>
        r.type === type ? { ...r, sizeKb: meta?.sizeKb, generatedAt: meta?.generatedAt } : r));
      // A generated report is immediately downloaded so the click has a result.
      await triggerDownload(type);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setGenerating(null);
    }
  }, [triggerDownload]);

  return { reports, loading, error, generating, downloading, generate, download };
}
