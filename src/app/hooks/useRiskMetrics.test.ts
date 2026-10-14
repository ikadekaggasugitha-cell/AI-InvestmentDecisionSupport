import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Risk metrics that did not arrive, and why.
 *
 * The hook used to hand the view one `error: string`, and RiskView answered every
 * string with "backend unreachable, showing simulated data". An account with no
 * subscription was told to check its connection while the backend was perfectly
 * healthy. The distinction the view needs is exactly one bit — refused or not —
 * so that is what the hook carries.
 */
const fetchMock = vi.fn();

async function loadHook() {
  vi.resetModules();
  vi.stubGlobal("fetch", fetchMock);
  return import("./useRiskMetrics");
}

function respond(status: number) {
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => ({}) });
}

describe("useRiskMetrics — why the load failed", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("reports a refusal as a lock, not as a broken server", async () => {
    respond(402);
    const { useRiskMetrics } = await loadHook();

    const { result } = renderHook(() => useRiskMetrics());

    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.failure).toEqual({ kind: "locked" });
    expect(result.current.isLive).toBe(false);
  });

  it("reports an unreachable server as unreachable", async () => {
    respond(500);
    const { useRiskMetrics } = await loadHook();

    const { result } = renderHook(() => useRiskMetrics());

    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.failure).toEqual({ kind: "unreachable" });
  });

  it("reports no failure at all once the metrics arrive", async () => {
    // Shaped from the response schema rather than from the hook, so a change to
    // what the backend must send shows up here instead of being absorbed.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        risk: {
          overallRisk: 42, marketRisk: 50, concentrationRisk: 30, liquidityRisk: 20,
          currencyRisk: 10, creditRisk: 25, var95: -2.5, cvar95: -4, volatility: 18,
          maxDrawdown: -12, beta: 0.95, sharpe: 1.2, sortino: 1.6, alpha: 0.4,
          informationRatio: 0.8,
        },
        stressTests: [],
        sectorExposure: [],
      }),
    });
    const { useRiskMetrics } = await loadHook();

    const { result } = renderHook(() => useRiskMetrics());

    await waitFor(() => expect(result.current.isLive).toBe(true));
    expect(result.current.failure).toBeNull();
  });

  it("keeps the seed figures standing, so the screen has something labelled to show", async () => {
    respond(402);
    const { useRiskMetrics } = await loadHook();

    const { result } = renderHook(() => useRiskMetrics());

    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.risk).toBeTruthy();
    expect(result.current.isLive).toBe(false);
  });
});