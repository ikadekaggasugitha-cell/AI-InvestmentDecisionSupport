/**
 * API configuration.
 *
 * Flip USE_LIVE_API to true and set the correct BASE_URL to connect the app
 * to a real FastAPI backend.  All hooks check this flag at runtime so the UI
 * components need zero changes when switching from simulation to live data.
 */
/**
 * Fetch from the FastAPI backend rather than serving bundled seed data.
 *
 * Defaults to ON so the app shows real IDX prices. Set VITE_USE_LIVE_API=false
 * to force the offline seed path — useful for demos with no backend running, or
 * for UI work that should not depend on the network.
 *
 * The seed path is clearly labelled as simulated in the UI; it is a fallback,
 * not an equivalent source.
 */
export const USE_LIVE_API =
  (import.meta.env.VITE_USE_LIVE_API ?? "true").toLowerCase() !== "false";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

/**
 * WebSocket origin derived from API_BASE.
 *
 * A browser on an https:// page cannot open a ws:// socket — it must be wss://.
 * Deriving the scheme instead of hardcoding one means the same build works in
 * local dev and behind TLS.
 */
const WS_BASE = API_BASE.replace(/^http/, "ws");

export const ENDPOINTS = {
  /** LightGBM + SHAP signal recommendations */
  signals:        `${API_BASE}/v1/signals`,
  /** GARCH / CVaR portfolio risk metrics */
  riskMetrics:    `${API_BASE}/v1/risk/portfolio`,
  /** WebSocket stream for live tick data */
  marketSocket:   `${WS_BASE}/v1/ws/market`,
  /** Broker summary + accumulation phase (Phase 10) */
  broksum:        (symbol: string) => `${API_BASE}/v1/broksum/${symbol}`,
  broksumHistory: (symbol: string, days = 20) =>
    `${API_BASE}/v1/broksum/${symbol}/history?days=${days}`,
  /** Trend, S/R, candlestick patterns, gaps (Phase 10) */
  technicals:     (symbol: string) => `${API_BASE}/v1/technicals/${symbol}`,
  /** Batch accumulation read (OBV/CMF) for many symbols — one round trip */
  accumulation:   (symbols?: readonly string[]) =>
    symbols && symbols.length
      ? `${API_BASE}/v1/technicals/accumulation?symbols=${symbols.join(",")}`
      : `${API_BASE}/v1/technicals/accumulation`,
  /** Daily candles for the chart (Phase 10) */
  ohlcv:          (symbol: string, days = 120) =>
    `${API_BASE}/v1/technicals/${symbol}/ohlcv?days=${days}`,
  /** IDX keterbukaan informasi — primary filings, not aggregated news */
  news:           (limit = 20, daysBack = 7) =>
    `${API_BASE}/v1/news?limit=${limit}&daysBack=${daysBack}`,
  /** Black-Litterman + HRP portfolio weights */
  portfolio:      (uid = "default") =>
    `${API_BASE}/v1/portfolio/optimise?uid=${uid}`,
  /** Claude-powered Q&A, server-sent events */
  advisorChat:    `${API_BASE}/v1/advisor/chat`,
} as const;

/** Default request timeout in milliseconds */
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * Bearer token for the authenticated API, or null when none is available.
 *
 * The backend guards every data route with get_current_user. In local dev the
 * backend runs AUTH_BYPASS=true and needs no token. A deployed single-operator
 * build can bake one in at build time (VITE_API_TOKEN); an interactive login
 * can drop one into localStorage under `aidss_token`. Either source works, and
 * bypass-mode dev needs neither.
 */
export function authToken(): string | null {
  const fromEnv = import.meta.env.VITE_API_TOKEN as string | undefined;
  if (fromEnv) return fromEnv;
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem("aidss_token")
      : null;
  } catch {
    return null;
  }
}

/** Merge the Authorization header into any caller-supplied headers. */
export function authHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  const token = authToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/**
 * fetch() with the bearer token attached. Every hook goes through this so
 * enabling auth on the backend needs zero per-hook changes. In bypass-mode dev
 * it is a plain fetch — no token, no header.
 */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, headers: authHeaders(init.headers) });
}
