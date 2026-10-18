import { useState, useEffect, useRef } from "react";
import {
  ENDPOINTS, USE_LIVE_API, WS_CLOSE_AUTH_REFUSED, WS_CLOSE_ENTITLEMENT_REQUIRED,
  WS_CLOSE_SUBSCRIPTION_ENDED,
  apiFetch, signalAuthExpired, signalPaywalled,
} from "../config/api";
import { IDX_STOCKS } from "../data/idxData";
import type { LiveFxRate } from "./useExchangeRate";

/* ─── Types ──────────────────────────────────────────────────────────────── */
export interface StockTick {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
  mktCap: string;
  pe: number | null;
  sector: string;
  sectorEn: string;
  tier: 1 | 2 | 3;
  foreignNet: number;  // Net Foreign Buy (positive) / Sell (negative), in IDR billions
  history: number[];   // last 60 ticks for sparkline
}

export interface IntradayPoint {
  time: string;    // "09:00", "09:01" …
  value: number;   // portfolio IDR
  ihsg: number;    // index value
}

export type ConnectionSource = "backend_ws" | "direct_yahoo" | "offline_baseline";

/**
 * Where the numbers came from and how old they are.
 *
 * `lastUpdated` is when the client received the payload. `asOf` is the exchange
 * timestamp of the quote itself. They differ by the vendor delay, and only the
 * second one answers "how old is this price" — which matters because the free
 * IDX feed is delayed ten minutes and a price shown without its age reads as
 * the current one.
 */
export interface DataFreshness {
  /** Backend provider id ("yahoo"), or "placeholder"/"simulated" when not live. */
  provider: string;
  /** Vendor's own wording, e.g. "Delayed Quote". */
  label: string;
  /**
   * Exchange timestamp describing the batch. This is the *median* quote, not the
   * oldest: the board retains delisted names so history resolves, and one of them
   * was 607 days old among quotes whose median was 1.7 hours. Using the oldest
   * made the badge claim two-year-old data from a healthy feed.
   */
  asOf: Date | null;
  /** Vendor-declared feed delay, in seconds. 0 = real time. */
  delaySeconds: number;
  isDelayed: boolean;
  /** True when the numbers are generated rather than observed. */
  isSimulated: boolean;
  /**
   * True when intraday movement between real polls is a bounded simulation
   * anchored to the last real price (market hours). The prices are real at each
   * ~60s re-sync; the "breathing" in between is an estimate, so the UI labels it.
   */
  isIntradaySimulated: boolean;
  /**
   * Why the feed is not connected, when the backend said so.
   *
   * The socket is refused for want of a subscription just as it is for a dead
   * session, and the badge used to call both "backend unreachable" — pointing at
   * the reader's network when their server was answering perfectly well.
   * "suspended" is its own word because an ended subscription is not the same
   * headline as "no subscription yet": the account held one and the clock ran
   * out.
   */
  streamRefused: "entitlement" | "auth" | "suspended" | null;
  /**
   * Symbols whose quote trails the batch by more than a trading week —
   * long-suspended or delisted names. Surfaced so the robust age above is not
   * read as "nothing is stale".
   */
  outdatedSymbols: string[];
}

export interface LiveMarketData {
  stocks: Record<string, StockTick>;
  intradayChart: IntradayPoint[];
  portfolioValue: number;
  portfolioPrevClose: number;
  dailyPnL: number;
  dailyPnLPct: number;
  ihsg: { value: number; prevClose: number; change: number; changePct: number };
  /** USD/IDR from the feed. Null until the first snapshot arrives. */
  fx: LiveFxRate | null;
  isMarketOpen: boolean;
  lastUpdated: Date;
  isError: boolean;
  source: ConnectionSource;
  freshness: DataFreshness;
}

/** Default state: nothing has been fetched, so nothing may claim to be live. */
export const SIMULATED_FRESHNESS: DataFreshness = {
  provider: "simulated",
  label: "",
  asOf: null,
  delaySeconds: 0,
  isDelayed: false,
  isSimulated: true,
  isIntradaySimulated: false,
  streamRefused: null,
  outdatedSymbols: [],
};

export type MarketDataProvider = () => LiveMarketData;

/* ─── Market hours ───────────────────────────────────────────────────────── */
const OPEN_MINUTE  = 9 * 60;       // 09:00 WIB
const CLOSE_MINUTE = 16 * 60;      // 16:00 WIB

function wibMinuteOfDay(): number {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const wib = new Date(utcMs + 7 * 3_600_000);
  const day = wib.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return -1; // Weekend closed
  return wib.getHours() * 60 + wib.getMinutes();
}

function isMarketOpen(): boolean {
  const m = wibMinuteOfDay();
  if (m === -1) return false;
  // Pause 12:00–13:30 (lunch break for session 2)
  if (m >= 12 * 60 && m < 13 * 60 + 30) return false;
  return m >= OPEN_MINUTE && m <= CLOSE_MINUTE;
}

function minuteToLabel(minute: number): string {
  const h = Math.floor(minute / 60).toString().padStart(2, "0");
  const m = (minute % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/* ─── Portfolio value ─────────────────────────────────────────────────────
 *
 * Not computed here. This hook used to total PORTFOLIO_HOLDINGS against the live
 * price map, which meant the running portfolio total came from a seed nobody
 * owned while every other figure came from the feed. The portfolio total now
 * arrives on the WebSocket, already valued against the signed-in account's own
 * positions, so it is passed through rather than re-derived.
 *
 * The offline baseline below therefore starts at zero, which is the honest value
 * for "not connected yet" — the previous fallback drew a day's curve from a
 * portfolio that did not exist.
 */

/* ─── Build initial stock ticks from baseline data ───────────────────────── */
function buildInitialStocks(prices: Record<string, number>): Record<string, StockTick> {
  const result: Record<string, StockTick> = {};
  IDX_STOCKS.forEach((meta) => {
    const price  = prices[meta.symbol] ?? meta.basePrice;
    const pClose = price;
    const history = Array.from({ length: 60 }, () => price);

    result[meta.symbol] = {
      symbol:     meta.symbol,
      name:       meta.name,
      price:      +price.toFixed(0),
      prevClose:  pClose,
      open:       price,
      high:       price,
      low:        price,
      change:     0,
      changePct:  0,
      volume:     25_000_000,
      mktCap:     meta.mktCap,
      pe:         meta.pe ?? null,
      sector:     meta.sector,
      sectorEn:   meta.sectorEn,
      tier:       meta.tier,
      foreignNet: 0,
      history,
    };
  });
  return result;
}

/* ─── Direct Yahoo Finance Fetcher (Frontend Fallback) ──────────────────── */
/**
 * The direct browser fetch to Yahoo was removed.
 *
 * It called `v7/finance/quote` through the public CORS proxy allorigins.win.
 * That proxy now returns a GitHub Pages 404, so `res.ok` was false on every
 * call and the function returned null — a fallback that silently did nothing
 * while appearing to exist. The endpoint it targeted is also crumb-gated, so it
 * would have failed even with a working proxy.
 *
 * Beyond being broken, routing market data for an investment tool through an
 * anonymous third-party proxy that can rewrite responses is not a defensible
 * source. The backend provider (ingestor/providers/) is the single source of
 * truth: it holds the crumb session, validates bars, and reports the vendor's
 * declared delay. When it is unreachable the UI now says so via
 * `freshness.isSimulated` instead of quietly showing generated numbers.
 */

/**
 * The WebSocket URL, with a single-use ticket when one is needed.
 *
 * A browser cannot set headers on a WebSocket upgrade, so the session cookie is
 * either sent automatically (same-site) or not at all (cross-site, where
 * SameSite=Lax withholds it). The second case asks the backend for a ticket that
 * is valid for thirty seconds and one connection. Fetched over ordinary HTTP with
 * credentials, so it uses the same session as everything else.
 */
async function resolveSocketUrl(): Promise<string> {
  if (typeof location !== "undefined" && location.protocol === "https:") {
    // An https page opening a wss:// socket to another origin is the cross-site
    // case SameSite will withhold the cookie for.
    try {
      const res = await apiFetch(ENDPOINTS.authWsTicket, { method: "POST" });
      if (res.ok) {
        const body = (await res.json()) as { ticket?: string };
        if (body.ticket) return `${ENDPOINTS.marketSocket}?ticket=${encodeURIComponent(body.ticket)}`;
      }
    } catch {
      /* fall back to the plain URL; the server will close the socket if unauthenticated */
    }
  }
  return ENDPOINTS.marketSocket;
}

export function useLiveMarket(): LiveMarketData {
  const initPrices = useRef<Record<string, number>>(
    Object.fromEntries(IDX_STOCKS.map((s) => [s.symbol, s.basePrice]))
  );
  const portfolioPrevClose = useRef(0);

  const [data, setData] = useState<LiveMarketData>(() => {
    const stocks = buildInitialStocks(initPrices.current);
    return {
      stocks,
      // No invented intraday line. The server sends this account's own series,
      // and a fabricated one would sit beside real prices until the first tick.
      intradayChart: [],
      portfolioValue: 0,
      portfolioPrevClose: 0,
      dailyPnL: 0,
      dailyPnLPct: 0,
      ihsg: { value: 7448, prevClose: 7391, change: 57, changePct: 0.77 },
      fx: null,
      isMarketOpen: isMarketOpen(),
      lastUpdated: new Date(),
      freshness: SIMULATED_FRESHNESS,
      isError: false,
      source: "offline_baseline",
    };
  });

  const wsRef = useRef<WebSocket | null>(null);
  const isWsConnected = useRef<boolean>(false);

  /* 1. WebSocket Connect & Reconnect loop to FastAPI backend */
  useEffect(() => {
    // VITE_USE_LIVE_API=false means "serve the labelled seed path". This hook
    // is the one transport that was ignoring it: it opened a socket to the real
    // backend anyway, so an offline build could show live prices and a LIVE or
    // DELAYED badge sitting next to twelve panels of seed data. Short-circuit
    // before the socket is ever constructed and the state stays on its
    // `offline_baseline` value, which the badge reports as SIMULATED.
    if (!USE_LIVE_API) return;

    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let isUnmounted = false;
    // Backoff so a downed backend is not hammered every 5s forever. Grows
    // 1s→2s→4s… capped at 30s, with jitter to avoid a thundering herd of tabs
    // reconnecting in lockstep. Reset to 0 on a successful open.
    let attempt = 0;
    const BASE_DELAY_MS = 1_000;
    const MAX_DELAY_MS = 30_000;
    const SUBSCRIPTION_RETRY_MS = 60_000;

    function scheduleReconnect() {
      if (isUnmounted) return;
      const backoff = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      const jitter = backoff * 0.25 * Math.random();
      attempt += 1;
      reconnectTimeout = setTimeout(() => void connectWs(), backoff + jitter);
    }

    /**
     * Back off slowly while the feed refuses us for want of a subscription.
     *
     * Deliberately not the 1s ramp a transport failure gets. Nothing about the
     * account changes on a 1s cadence, so retrying hard is just asking a server
     * to refuse us repeatedly; a minute is enough to notice a purchase made
     * elsewhere and cheap enough to leave running all day.
     */
    function scheduleSubscriptionRetry() {
      if (isUnmounted) return;
      reconnectTimeout = setTimeout(() => void connectWs(), SUBSCRIPTION_RETRY_MS);
    }

    async function connectWs() {
      if (isUnmounted) return;
      try {
        // From config, not hardcoded: a deployed frontend does not talk to
        // localhost, and wss:// is required from an https:// origin.
        //
        // No token goes in the query string. The session cookie is HttpOnly and
        // the browser attaches it to the handshake on its own, which is the whole
        // reason it moved out of localStorage: a token in a URL lands in proxy
        // and server access logs. Where SameSite=Lax withholds the cookie — a
        // cross-site frontend — the backend also accepts a single-use ticket,
        // which is short-lived enough for a query string to be harmless.
        const ws = new WebSocket(await resolveSocketUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          isWsConnected.current = true;
          attempt = 0; // recovered — reset the backoff ramp
          if (import.meta.env.DEV) {
            console.log("[useLiveMarket] Connected to Backend WebSocket (Real IDX Feed)");
          }
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "snapshot" && msg.data) {
              const snapshot = msg.data;
              setData((prev) => {
                const nextStocks = { ...prev.stocks };
                const priceMap: Record<string, number> = {};

                Object.keys(snapshot.stocks || {}).forEach((sym) => {
                  const s = snapshot.stocks[sym];
                  const old = prev.stocks[sym];
                  const newHist = old ? [...old.history.slice(-59), s.price] : [s.price];
                  nextStocks[sym] = {
                    ...s,
                    history: newHist,
                  };
                  priceMap[sym] = s.price;
                });

                const portVal = snapshot.portfolioValue ?? 0;
                const prevCloseVal = snapshot.portfolioPrevClose ?? portfolioPrevClose.current;
                const dPnL = portVal - prevCloseVal;

                return {
                  stocks: nextStocks,
                  intradayChart: snapshot.intradayChart?.length ? snapshot.intradayChart : prev.intradayChart,
                  portfolioValue: Math.round(portVal),
                  portfolioPrevClose: prevCloseVal,
                  dailyPnL: Math.round(dPnL),
                  dailyPnLPct: prevCloseVal ? dPnL / prevCloseVal : 0,
                  ihsg: snapshot.ihsg ?? prev.ihsg,
                  fx: snapshot.fx ?? prev.fx,
                  isMarketOpen: snapshot.isMarketOpen ?? isMarketOpen(),
                  lastUpdated: new Date(),
                  isError: false,
                  source: "backend_ws",
                  // Provenance straight from the backend. `dataAsOf` is the
                  // exchange timestamp, not our receive time — the two differ
                  // by the vendor delay and only the former is the price's age.
                  freshness: {
                    provider: snapshot.dataSource ?? "unknown",
                    label: snapshot.sourceLabel ?? "",
                    asOf: snapshot.dataAsOf ? new Date(snapshot.dataAsOf) : null,
                    delaySeconds: snapshot.delaySeconds ?? 0,
                    isDelayed: Boolean(snapshot.isDelayed),
                    isSimulated:
                      snapshot.dataSource === "placeholder" ||
                      snapshot.dataSource === "mock",
                    isIntradaySimulated: Boolean(snapshot.isIntradaySimulated),
                    // Cleared here, not on connect: the socket opening is not
                    // evidence the data is flowing.
                    streamRefused: null,
                    outdatedSymbols: Array.isArray(snapshot.outdatedSymbols)
                      ? (snapshot.outdatedSymbols as string[])
                      : [],
                  },
                };
              });
            }
          } catch (e) {
            if (import.meta.env.DEV) {
              console.error("[useLiveMarket] Error parsing WS message:", e);
            }
          }
        };

        ws.onerror = () => {
          isWsConnected.current = false;
        };

        ws.onclose = (event) => {
          isWsConnected.current = false;
          // Three refusals, and they do not all mean the same thing.
          //
          // 1008 = the session is not usable (never authenticated, or blocked).
          // Retrying with the same credentials just loops, and the session really
          // has to be re-established, so raise the app-wide expiry signal and stop.
          //
          // 4403 = the session is fine and the data is simply not theirs. Retrying
          // cannot help and retrying *is* what used to happen: this used to close
          // with 1008 too, so the paywall signed out accounts that were perfectly
          // valid, and told them their session had ended when their only real
          // problem was that they had not subscribed.
          if (event.code === WS_CLOSE_AUTH_REFUSED) {
            setData((prev) => ({ ...prev, freshness: { ...prev.freshness, streamRefused: "auth" } }));
            signalAuthExpired();
            return;
          }
          if (event.code === WS_CLOSE_ENTITLEMENT_REQUIRED) {
            setData((prev) => ({ ...prev, freshness: { ...prev.freshness, streamRefused: "entitlement" } }));
            signalPaywalled();
            // Retry once the account's subscription changes. The refusal is
            // terminal for this connection, but the *reason* is not: someone can
            // subscribe in another tab, and without this the badge would keep
            // reading TERKUNCI long after the server would have let us in — which
            // is the flag-and-status drift this whole change exists to remove.
            scheduleSubscriptionRetry();
            return;
          }
          if (event.code === WS_CLOSE_SUBSCRIPTION_ENDED) {
            setData((prev) => ({ ...prev, freshness: { ...prev.freshness, streamRefused: "suspended" } }));
            signalPaywalled();
            // Same fix as the 4403 refusal — payment — so the same slow retry
            // notices when it settles. What it must never get is the transport
            // ramp: a suspension is lifted by a payment or an admin, and
            // neither changes on a one-second cadence. The default branch
            // below used to catch this and re-handshake against the closed
            // door on that ramp, forever.
            scheduleSubscriptionRetry();
            return;
          }
          scheduleReconnect();
        };
      } catch {
        isWsConnected.current = false;
        scheduleReconnect();
      }
    }

    void connectWs();

    return () => {
      isUnmounted = true;
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return data;
}
