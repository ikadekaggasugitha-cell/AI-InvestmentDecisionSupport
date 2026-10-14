import { AlertTriangle, RefreshCw } from "lucide-react";

import type { LoadFailure } from "../config/api";

interface Props {
  message?: string | null;
  /**
   * Why the load failed, when the caller knows.
   *
   * Without it every failure gets the same paragraph — "check your connection" —
   * which is wrong advice for a refusal. A locked screen cannot be retried away
   * and a Retry button on one is a control that appears live and does nothing.
   */
  failure?: LoadFailure | null;
  onRetry?: () => void;
  locale?: "id" | "en";
}

/**
 * Inline error state for views whose data hook returns an error.
 * Replaces view content without crashing the ErrorBoundary.
 */
export function ViewError({ message, failure, onRetry, locale = "id" }: Props) {
  const isId = locale === "id";
  const locked = failure?.kind === "locked";
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="flex flex-col items-center gap-4 text-center" style={{ maxWidth: 360 }}>
        <div
          className="flex items-center justify-center rounded-full"
          style={{ width: 44, height: 44, background: "var(--loss-bg)" }}
        >
          <AlertTriangle size={20} style={{ color: "var(--loss)" }} />
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>
            {isId ? "Gagal memuat data" : "Failed to load data"}
          </p>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.6 }}>
            {locked
              ? (isId
                  ? "Langganan belum aktif, jadi data ini tidak dikirim. Server berjalan baik — ini bukan masalah koneksi."
                  : "The subscription is not active, so this data is not served. The server is healthy — this is not a connection problem.")
              : (message ?? (isId
                  ? "Terjadi kesalahan saat mengambil data. Periksa koneksi dan coba lagi."
                  : "An error occurred while fetching data. Check your connection and try again."
                ))}
          </p>
        </div>
        {onRetry && !locked && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2"
            style={{
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              border: "none",
              borderRadius: 4,
              padding: "7px 16px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={12} />
            {isId ? "Coba Lagi" : "Retry"}
          </button>
        )}
      </div>
    </div>
  );
}
