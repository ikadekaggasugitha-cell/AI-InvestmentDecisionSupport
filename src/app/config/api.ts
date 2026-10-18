/**
 * API configuration.
 *
 * Set API_BASE to reach a running FastAPI backend. All hooks check USE_LIVE_API
 * at runtime, so components need no changes when it flips.
 */

/**
 * Fetch from the FastAPI backend rather than serving bundled seed data.
 *
 * Defaults to ON, so a normal build talks to the backend and shows real IDX
 * prices.
 *
 * ── What VITE_USE_LIVE_API=false actually is ───────────────────────────────
 *
 * An OFFLINE UI HARNESS for layout and component work with no backend running.
 * It is deliberately not a demo mode and must not be presented as one: there is
 * no scripted walkthrough to perform and no data behind most of the screens.
 *
 * Five call sites honour this flag, so the build loses more than it looks:
 *
 *   useNews          no filings at all. The bundled sample news was deleted in
 *                    2026-10 because it named real publications (Kontan,
 *                    Bisnis.com, Reuters, CNBC, Bloomberg) for events that never
 *                    happened, and was appended to the live feed. The page now
 *                    shows its Empty state.
 *   useAISignals     seed signals, labelled "Data contoh". No provenance and no
 *                    timestamp, because no model ran.
 *   useAlerts        seed alerts, labelled "Data contoh".
 *   useAdvisorChat   disabled; the chat endpoint is required.
 *   StockDetailPanel no per-symbol technicals, charts or broker summary.
 *
 * Every remaining fallback is labelled in the UI. If a screen here looks
 * plausible but empty, that is the harness working as intended, not a bug.
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
  /** Signal recommendations with per-factor explanations */
  signals:        `${API_BASE}/v1/signals`,
  /** AI signal for a single symbol (stock detail panel) */
  signalFor:      (symbol: string) => `${API_BASE}/v1/signals/${symbol}`,
  /** Full listed IDX board — browse/search/filter (~960 securities) */
  symbols:        (params?: {
    q?: string; sector?: string; sort?: string; limit?: number; offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.sector) qs.set("sector", params.sector);
    if (params?.sort) qs.set("sort", params.sort);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const s = qs.toString();
    return `${API_BASE}/v1/symbols${s ? `?${s}` : ""}`;
  },
  /** IDX-IC sectors with active-instrument counts */
  sectors:        `${API_BASE}/v1/symbols/sectors`,
  /** Live Peringatan feed (signals, movers, foreign flow, risk, news) */
  alerts:         `${API_BASE}/v1/alerts`,
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
  /** Pullable foreign-flow accumulation history (net foreign per session) */
  accumulationHistory: (symbol: string, days = 30) =>
    `${API_BASE}/v1/technicals/${symbol}/accumulation-history?days=${days}`,
  /** On-demand PDF reports (Phase 13) */
  reports:         `${API_BASE}/v1/reports`,
  reportGenerate:  (type: string) => `${API_BASE}/v1/reports/${type}/generate`,
  reportDownload:  (type: string) => `${API_BASE}/v1/reports/${type}/download`,
  /** IDX keterbukaan informasi — primary filings, not aggregated news */
  news:           (limit = 20, daysBack = 7) =>
    `${API_BASE}/v1/news?limit=${limit}&daysBack=${daysBack}`,
  /** Black-Litterman + HRP portfolio weights */
  // No portfolio id in the path or query. The backend resolves the portfolio
  // from the caller's token and checks ownership; a client-supplied id is both
  // redundant and the vector for reading another portfolio's allocation.
  portfolio:      () => `${API_BASE}/v1/portfolio/optimise`,
  portfolioEquity: (days = 252) => `${API_BASE}/v1/portfolio/equity?days=${days}`,
  /** The caller's positions. PUT replaces the whole list; an empty list clears it. */
  positions:      `${API_BASE}/v1/portfolio/positions`,
  /** The caller's own subscription state. Read-only; there is no way to buy one. */
  subscription:   `${API_BASE}/v1/subscription/current`,
  /** The caller's own attempts to pay — denials included, newest first. */
  payments:       `${API_BASE}/v1/payments/me`,
  /** Declare a manual transfer. The amount is the server's price, never the body's. */
  paymentsDeclare: `${API_BASE}/v1/payments/manual`,
  /**
   * What a subscription costs. The only unauthenticated data endpoint in the app:
   * a price that can only be read after signing up is not a price.
   */
  pricing:        `${API_BASE}/v1/subscriptions/pricing`,
  /**
   * Where a manual transfer goes. Public with the price, for the same reason:
   * someone who has not signed up yet still needs the destination.
   */
  bankAccounts:   `${API_BASE}/v1/subscriptions/bank-accounts`,
  /** Admin account list. Block/unblock: POST then DELETE on `${adminAccounts}/{id}/block`. */
  adminAccounts:  `${API_BASE}/v1/admin/accounts`,
  /** Admin-only. Writes both prices in one request; a partial body is refused. */
  adminPricing:   `${API_BASE}/v1/admin/settings/pricing`,
  /** Admin-only. Replaces the transfer destinations; the server refuses an empty list. */
  adminBankAccounts: `${API_BASE}/v1/admin/settings/bank-accounts`,
  /** Claude-powered Q&A, server-sent events */
  advisorChat:    `${API_BASE}/v1/advisor/chat`,

  // Auth. The session is the HttpOnly cookie, so none of these returns a token
  // and none of them can be read back by JavaScript. login and signup answer
  // with the account; me answers with the current one; logout discards the row.
  authMe:         `${API_BASE}/v1/auth/me`,
  authLogin:      `${API_BASE}/v1/auth/login`,
  authSignup:     `${API_BASE}/v1/auth/signup`,
  authLogout:     `${API_BASE}/v1/auth/logout`,
  authWsTicket:   `${API_BASE}/v1/auth/ws-ticket`,
  authChangePassword: `${API_BASE}/v1/auth/change-password`,
  /** Gate 2 acceptance. POST records it server-side; GET reads what is recorded. */
  authConsent:      `${API_BASE}/v1/auth/consent`,
} as const;

/** Default request timeout in milliseconds */
export const FETCH_TIMEOUT_MS = 10_000;

/**
 * The session lives in an HttpOnly cookie the browser attaches on its own.
 *
 * There is deliberately no token in JavaScript any more. It used to be read from
 * VITE_API_TOKEN or localStorage and sent as `Authorization: Bearer`, which meant
 * any cross-site script could read it and replay it — the exact thing an HttpOnly
 * cookie prevents. The server sets the cookie on login and clears it on logout;
 * the one thing the client must do is send credentials on cross-origin requests.
 */
export function authHeaders(base?: HeadersInit): Headers {
  return new Headers(base);
}

/**
 * Auth-expiry signal.
 *
 * A 401 means the session cookie is missing, expired, or rejected. Without
 * handling it here every hook simply threw and fell back to seed data — so an
 * ended session showed simulated prices that looked live, which is the one
 * failure this app must never present silently. There is nothing to clear on the
 * client: the cookie is HttpOnly, so only the server can discard it, and it does
 * when the session is revoked or the password changes. All this can do is say so.
 */
export const AUTH_EXPIRED_EVENT = "aidss:auth-expired";

/**
 * Subscription-required signal.
 *
 * A 403 means the server knows exactly who is asking and is refusing the paid
 * data anyway. That is a different event from an expired session and it must not
 * be reported as one: signing the account out would throw away a session that is
 * still perfectly good, and the person would have to sign in again to be told
 * the same thing.
 *
 * Nothing is cleared on the client for this either. The fix, if there is one,
 * belongs in the account's own subscription — which is a server fact, not
 * something a browser can hold.
 */
export const PAYWALL_EVENT = "aidss:paywalled";

/** The status the entitlement gate answers with. 402 = understood, pay first. */
export const HTTP_PAYWALL_REFUSED = 402;

/**
 * Close codes the market WebSocket ends a handshake with.
 *
 * These are literals in the tests on the hook that consumes them, so renaming a
 * constant here without changing `backend/api/routers/market_ws.py` shows up as a
 * failing test rather than as a silently mis-signed-out account.
 *
 * 1008 is the protocol's "policy violation" and stays on identity refusals, which
 * is what clients already understand. 4403 and 4404 are in the 4000-4999 range
 * the protocol reserves for applications, so neither can collide with a
 * transport failure.
 */
export const WS_CLOSE_AUTH_REFUSED = 1008;
export const WS_CLOSE_ENTITLEMENT_REQUIRED = 4403;
/**
 * The session is valid but the account's subscription has ended — the beat has
 * suspended it. Payment reopens it, so like 4403 this belongs to the paywall's
 * door, not to the "dead session" door: raise the paywall signal, keep the slow
 * subscription cadence alive, and never re-handshake against the closed door.
 */
export const WS_CLOSE_SUBSCRIPTION_ENDED = 4404;

// Dedupe: many hooks fire concurrently, so a single expiry would otherwise
// dispatch a dozen identical events. Latch on the first 401 and release once a
// request succeeds again.
let authExpiredSignalled = false;
let paywallSignalled = false;

function handleAuthFailure(): void {
  if (authExpiredSignalled) return;
  authExpiredSignalled = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  }
}

function handlePaywall(): void {
  if (paywallSignalled) return;
  paywallSignalled = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PAYWALL_EVENT));
  }
}

/**
 * Manually raise the auth-expiry signal. The WebSocket path uses this: a 1008
 * "policy violation" close from the backend means the handshake carried no valid
 * session, but a socket never goes through apiFetch, so it must report expiry
 * itself instead of reconnecting forever.
 */
export function signalAuthExpired(): void {
  handleAuthFailure();
}

/**
 * Manually raise the subscription-required signal, for the same reason as
 * `signalAuthExpired`: a socket does not go through `apiFetch`.
 *
 * The backend closes with 4403 when the handshake carried a valid session and the
 * account has no active subscription, and with 4404 when that account's
 * subscription has ended — both are doors payment opens, so both raise this.
 * It used to close with 1008 for that too, which is why this had to exist —
 * the client was signing people out.
 */
export function signalPaywalled(): void {
  handlePaywall();
}

/**
 * Subscribe to auth-expiry. Returns an unsubscribe function for cleanup in a
 * React effect. Safe to call in non-browser environments (returns a no-op).
 */
export function onAuthExpired(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(AUTH_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
}

/** Subscribe to the subscription-required signal. Same shape as `onAuthExpired`. */
export function onPaywalled(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PAYWALL_EVENT, handler);
  return () => window.removeEventListener(PAYWALL_EVENT, handler);
}

/**
 * fetch() with the session cookie attached. Every hook goes through this so the
 * backend needing a session needs zero per-hook changes.
 *
 * `credentials: "include"` is required and easy to lose. The API is a different
 * origin from the dev server, and without it the browser drops the cookie on the
 * way out — the request goes out unauthenticated and comes back 401, which looks
 * like a broken backend rather than a missing fetch option.
 *
 * A 401 is intercepted centrally and broadcast once. The response is still
 * returned unchanged so each hook's existing error/fallback path runs as before.
 *
 * A 402 is treated the same way and for the same reason, but on a separate latch:
 * it means the server knows who is asking, the request was understood, and the
 * answer is "pay first". It is deliberately not 403 — a blocked account and a
 * non-admin are also refused, and both are 403. Reading 403 as "needs a
 * subscription" told a banned person to check their billing and told an ordinary
 * user that billing was why an admin page would not open.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: authHeaders(init.headers),
    credentials: "include",
  });
  if (res.status === 401) {
    handleAuthFailure();
  } else if (res.status === HTTP_PAYWALL_REFUSED) {
    handlePaywall();
  } else if (res.ok) {
    // recovered — allow a future refusal to signal again
    authExpiredSignalled = false;
    paywallSignalled = false;
  }
  return res;
}

/**
 * Why a load failed, in the words a screen can use.
 *
 * A 403 is not a broken server. The backend knows exactly who is asking and is
 * refusing the paid data anyway, which is a fact about the account with a
 * different fix — and it used to be reported as an unreachable backend, which
 * sent people to check their network instead of their subscription.
 */
export type LoadFailure = { kind: "locked" } | { kind: "unreachable" };


/** A response that came back with a status the caller could not use. */
export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}

export function classifyLoadError(err: unknown): LoadFailure {
  return err instanceof HttpStatusError && err.status === HTTP_PAYWALL_REFUSED
    ? { kind: "locked" }
    : { kind: "unreachable" };
}
