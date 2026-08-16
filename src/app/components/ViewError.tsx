import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  message?: string | null;
  onRetry?: () => void;
  locale?: "id" | "en";
}

/**
 * Inline error state for views whose data hook returns an error.
 * Replaces view content without crashing the ErrorBoundary.
 */
export function ViewError({ message, onRetry, locale = "id" }: Props) {
  const isId = locale === "id";
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
            {message ?? (isId
              ? "Terjadi kesalahan saat mengambil data. Periksa koneksi dan coba lagi."
              : "An error occurred while fetching data. Check your connection and try again."
            )}
          </p>
        </div>
        {onRetry && (
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
