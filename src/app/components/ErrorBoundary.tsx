import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Locale from the nearest AppContext consumer — used to render the fallback in the correct language. */
  locale?: "id" | "en";
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* In production this would report to Sentry / Datadog */
    console.error("[AIDSS ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--background)",
          padding: 40,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 32,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "var(--loss-bg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <AlertTriangle size={22} style={{ color: "var(--loss)" }} />
          </div>

          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)", marginBottom: 8 }}>
            {this.props.locale === "en" ? "Something went wrong" : "Terjadi Kesalahan"}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 20, lineHeight: 1.6 }}>
            {this.props.locale === "en"
              ? "This component encountered an unexpected error. Your data is safe — try reloading this view."
              : "Komponen ini mengalami error yang tidak terduga. Data tidak hilang — coba muat ulang tampilan ini."
            }
          </div>

          {this.state.error && (
            <div
              style={{
                background: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "8px 12px",
                marginBottom: 20,
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--loss)", wordBreak: "break-all" }}>
                {this.state.error.message}
              </span>
            </div>
          )}

          <button
            onClick={this.reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
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
            <RefreshCw size={13} />
            {this.props.locale === "en" ? "Reload" : "Muat Ulang"}
          </button>
        </div>
      </div>
    );
  }
}
