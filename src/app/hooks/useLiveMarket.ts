import { useState, useEffect, useRef } from "react";
import { ENDPOINTS } from "../config/api";
import { IDX_STOCKS, PORTFOLIO_HOLDINGS } from "../data/idxData";
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
  /** Exchange timestamp of the oldest quote in the snapshot. */
  asOf: Date | null;
  /** Vendor-declared feed delay, in seconds. 0 = real time. */
  delaySeconds: number;
  isDelayed: boolean;
  /** True when the numbers are generated rather than observed. */
  isSimulated: boolean;
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

/* ─── Compute portfolio value from holdings + live prices ────────────────── */
function computePortfolioValue(prices: Record<string, number>): number {
  return PORTFOLIO_HOLDINGS.reduce((sum, h) => {
    const price = prices[h.symbol] ?? h.avgPrice;
    return sum + h.lots * 100 * price;
  }, 0);
}

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

export function useLiveMarket(): LiveMarketData {
  const initPrices = useRef<Record<string, number>>(
    Object.fromEntries(IDX_STOCKS.map((s) => [s.symbol, s.basePrice]))
  );
  const initPortfolio = computePortfolioValue(initPrices.current);
  const portfolioPrevClose = useRef(initPortfolio * 0.993);

  const [data, setData] = useState<LiveMarketData>(() => {
    const stocks = buildInitialStocks(initPrices.current);
    const portfolioValue = computePortfolioValue(initPrices.current);
    return {
      stocks,
      intradayChart: [
        { time: "09:00", value: Math.round(portfolioPrevClose.current), ihsg: 7391 },
        { time: "10:00", value: Math.round(portfolioValue * 0.998), ihsg: 7420 },
        { time: "12:00", value: Math.round(portfolioValue * 1.002), ihsg: 7435 },
        { time: "14:00", value: Math.round(portfolioValue), ihsg: 7448 },
      ],
      portfolioValue: Math.round(portfolioValue),
      portfolioPrevClose: portfolioPrevClose.current,
      dailyPnL: Math.round(portfolioValue - portfolioPrevClose.current),
      dailyPnLPct: (portfolioValue - portfolioPrevClose.current) / portfolioPrevClose.current,
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
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let isUnmounted = false;

    function connectWs() {
      if (isUnmounted) return;
      try {
        // From config, not hardcoded: a deployed frontend does not talk to
        // localhost, and wss:// is required from an https:// origin.
        const wsUrl = ENDPOINTS.marketSocket;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          isWsConnected.current = true;
          console.log("[useLiveMarket] Connected to Backend WebSocket (Real IDX Feed)");
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

                const portVal = snapshot.portfolioValue ?? computePortfolioValue(priceMap);
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
                  },
                };
              });
            }
          } catch (e) {
            console.error("[useLiveMarket] Error parsing WS message:", e);
          }
        };

        ws.onerror = () => {
          isWsConnected.current = false;
        };

        ws.onclose = () => {
          isWsConnected.current = false;
          if (!isUnmounted) {
            reconnectTimeout = setTimeout(connectWs, 5000);
          }
        };
      } catch (err) {
        isWsConnected.current = false;
        if (!isUnmounted) {
          reconnectTimeout = setTimeout(connectWs, 5000);
        }
      }
    }

    connectWs();

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
