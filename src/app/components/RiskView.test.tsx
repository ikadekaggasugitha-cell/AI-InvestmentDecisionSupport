import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { RiskView } from "./RiskView";
import { RISK_DATA } from "../data/idxData";

/**
 * The seed figures stay on screen; the sentence above them has to be true.
 *
 * This view showed "Backend tidak terjangkau, menampilkan data simulasi" for
 * *any* error, including a 403. The backend was perfectly healthy — it had just
 * declined to serve the paid data — and the screen told the reader to check
 * their connection. People then debugged their network instead of their
 * subscription.
 *
 * The numbers are kept, and still labelled. Markets and Risk have an intentional
 * simulated path; what was wrong was not that seed was shown but that it was
 * explained with a cause that never happened.
 */
vi.mock("../hooks/useRiskMetrics", () => ({ useRiskMetrics: vi.fn() }));

import { useRiskMetrics } from "../hooks/useRiskMetrics";

const mocked = vi.mocked(useRiskMetrics);

function viewWith(overrides: Partial<ReturnType<typeof useRiskMetrics>> = {}) {
  mocked.mockReturnValue({
    // The hook keeps the bundled seed in state on failure; this mirrors that so
    // the view is exercised the way it actually renders when a load fails.
    risk: RISK_DATA as ReturnType<typeof useRiskMetrics>["risk"],
    stressTests: [],
    sectorExposure: [],
    loading: false,
    error: null,
    failure: null,
    isLive: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useRiskMetrics>);
  // `market` only feeds the header strip here; the failure banner under test
  // depends on nothing from it.
  return render(<RiskView market={{} as never} />);
}

describe("RiskView — why the live figures are missing", () => {
  beforeEach(() => mocked.mockReset());

  it("blames the connection when the backend is the problem", () => {
    viewWith({ failure: { kind: "unreachable" }, error: "HTTP 500" });

    expect(screen.getByText(/tidak terjangkau/i)).toBeInTheDocument();
    expect(screen.queryByText(/langganan/i)).not.toBeInTheDocument();
  });

  it("blames the subscription when the data was refused", () => {
    viewWith({ failure: { kind: "locked" }, error: "HTTP 402" });

    expect(screen.queryByText(/tidak terjangkau/i)).not.toBeInTheDocument();
    expect(screen.getByText(/langganan/i)).toBeInTheDocument();
  });

  it("says the backend is fine when it is — a refusal is not an outage", () => {
    // The distinction the whole change exists for, stated as the user reads it.
    viewWith({ failure: { kind: "locked" }, error: "HTTP 402" });

    expect(screen.getByText(/bukan.*masalah koneksi/i)).toBeInTheDocument();
  });

  it("keeps showing the seed figures underneath, still labelled simulated", () => {
    viewWith({ failure: { kind: "locked" }, error: "HTTP 402" });

    // Not an empty page: the simulated path is deliberate and labelled.
    expect(screen.getAllByText(/simulasi/i).length).toBeGreaterThan(0);
  });

  it("shows no failure banner at all when the metrics arrived", () => {
    viewWith({ failure: null, error: null, isLive: true });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/tidak terjangkau/i)).not.toBeInTheDocument();
  });
});