import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * useLiveMarket owns the app's only market-data transport, and it is the one
 * hook that was reading past the offline switch. When VITE_USE_LIVE_API=false
 * every other hook serves labelled seed data, yet this one still opened a socket
 * to the real backend — so a build declared offline could display live prices
 * and a LIVE/DELAYED badge beside a dozen seed panels.
 *
 * The switch is a build-time string compare evaluated once at module load
 * (config/api.ts), so each mode needs its own module registry.
 */

type SocketState = "connecting" | "open" | "closed";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset() {
    FakeWebSocket.instances = [];
  }

  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
  }

  /* helpers for driving the socket from a test */
  emitOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  emitClose(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  emitSnapshot(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type: "snapshot", data: payload }) });
  }

  get state(): SocketState {
    return this.readyState === 1 ? "open" : this.readyState === 3 ? "closed" : "connecting";
  }
}

function loadHook(useLiveApi: boolean) {
  vi.resetModules();
  vi.stubEnv("VITE_USE_LIVE_API", String(useLiveApi));
  return import("./useLiveMarket");
}

const SNAPSHOT = {
  stocks: {
    BBCA: {
      symbol: "BBCA",
      price: 9850,
      prevClose: 9700,
      change: 150,
      changePct: 1.55,
      name: "Bank Central Asia",
      sector: "Keuangan",
      tier: 1,
      mktCap: "Rp 1.212T",
      pe: 21.4,
      history: [9700, 9750, 9800, 9850],
      volume: 1_000_000,
      foreignNet: 12.5,
    },
  },
  intradayChart: [],
  portfolioValue: 14_000_000_000,
  portfolioPrevClose: 13_900_000_000,
  dailyPnL: 100_000_000,
  dailyPnLPct: 0.72,
  ihsg: { value: 7448, prevClose: 7391, change: 57, changePct: 0.77 },
  fx: null,
  isMarketOpen: true,
  lastUpdated: "2026-08-16T08:00:00Z",
  dataSource: "yahoo",
  dataAsOf: "2026-08-16T07:50:00Z",
  dataAgeSeconds: 600,
  delaySeconds: 600,
  isDelayed: true,
  sourceLabel: "Delayed Quote",
  isIntradaySimulated: false,
};

describe("useLiveMarket — offline switch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("never constructs a socket when VITE_USE_LIVE_API is false", async () => {
    const { useLiveMarket } = await loadHook(false);
    const { result } = renderHook(() => useLiveMarket());

    // Give the effect and any retry a chance to fire.
    await vi.advanceTimersByTimeAsync(5_000);

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.source).toBe("offline_baseline");
    expect(result.current.stocks.BBCA.price).toBeGreaterThan(0); // seed baseline intact
  });

  it("constructs a socket when VITE_USE_LIVE_API is true", async () => {
    const { useLiveMarket } = await loadHook(true);
    renderHook(() => useLiveMarket());

    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("/v1/ws/market");
  });

  it("adopts the snapshot and flips source once a message arrives", async () => {
    const { useLiveMarket } = await loadHook(true);
    const { result } = renderHook(() => useLiveMarket());
    await vi.advanceTimersByTimeAsync(100);

    FakeWebSocket.instances[0].emitSnapshot(SNAPSHOT);

    await waitFor(() => expect(result.current.source).toBe("backend_ws"));
    expect(result.current.stocks.BBCA.price).toBe(9850);
    expect(result.current.freshness.isDelayed).toBe(true);
    expect(result.current.freshness.delaySeconds).toBe(600);
  });

  it("reconnects after an ordinary close, backing off", async () => {
    const { useLiveMarket } = await loadHook(true);
    renderHook(() => useLiveMarket());
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].emitClose(1006);
    // First backoff step is 1000ms plus up to 25% jitter, so 1.5s clears it.
    await vi.advanceTimersByTimeAsync(1_500);

    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });

  it("does NOT reconnect on an auth-rejecting close (1008)", async () => {
    const { useLiveMarket } = await loadHook(true);
    renderHook(() => useLiveMarket());
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].emitClose(1008);
    // Long enough to exhaust several backoff steps had a retry been scheduled.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
