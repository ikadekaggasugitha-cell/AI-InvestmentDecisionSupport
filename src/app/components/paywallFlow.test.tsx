import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";

import { AppProvider, useApp } from "../context/AppContext";
import { PaywallNotice } from "./PaywallNotice";

/**
 * The combination that hid every other bug in this change.
 *
 * `AUTH_BYPASS=true` is the development default, so in a normal local run the
 * entitlement gate never fires, every paid route answers 200, and the refusal
 * paths are unreachable. A frontend that mishandles a 403 therefore looks
 * perfectly correct on the machine you develop on.
 *
 * These tests drive the refusal directly, which is the closest a frontend test
 * can get to the deployment that actually matters.
 */

const fetchMock = vi.fn();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("a refusal, with the gate actually firing", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("produces a banner that names the subscription and nothing else", async () => {
    // Rendered through the same gate the shell uses, so this exercises
    // refusal → AppContext → banner rather than just the component.
    respond(200, { active: false });
    const api = await import("../config/api");

    function Shell() {
      const { locked, subscription } = useApp();
      if (locked) return <PaywallNotice onOpenSettings={() => {}} />;
      if (subscription.kind === "unknown") {
        return <PaywallNotice reason="unknown" onOpenSettings={() => {}} />;
      }
      return null;
    }

    render(
      <AppProvider>
        <Shell />
      </AppProvider>,
    );
    // Nothing yet: the server has only said the account is not subscribed, and
    // no refusal has actually happened.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      api.signalPaywalled();
    });

    await waitFor(() =>
      expect(screen.getByText(/Langganan Anda belum aktif/i)).toBeInTheDocument(),
    );
    expect(within(screen.getByRole("status")).queryByText(/tidak terjangkau/i)).toBeNull();
  });

  it("offers no control that pretends there is a way to buy, today", () => {
    // Payments are Phase 2. A Buy button with nothing behind it is worse than
    // its absence — R-26, recorded in SettingsView.
    respond(200, { active: false });
    render(
      <AppProvider>
        <PaywallNotice onOpenSettings={() => {}} />
      </AppProvider>,
    );

    const banner = screen.getByRole("status");
    expect(within(banner).queryByRole("button", { name: /beli|buy|upgrade/i })).toBeNull();
    expect(within(banner).getByRole("button")).toBeInTheDocument();
  });

  it("shows nothing once a subscription exists", async () => {
    respond(200, {
      active: true,
      expiresAt: "2027-01-01T00:00:00Z",
      daysRemaining: 30,
    });
    const api = await import("../config/api");

    function Shell() {
      return useApp().locked ? <PaywallNotice onOpenSettings={() => {}} /> : null;
    }

    render(
      <AppProvider>
        <Shell />
      </AppProvider>,
    );
    act(() => {
      api.signalPaywalled();
    });

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("stays silent about the subscription when the server cannot be asked", async () => {
    // A 503 is not "you have none". Showing a billing message off a failed
    // lookup would be inventing a cause, which is the mistake this change exists
    // to stop making.
    respond(503, {});

    function Probe() {
      return <span data-testid="locked">{String(useApp().locked)}</span>;
    }

    render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("locked")).toHaveTextContent("false"));
  });

  it("does not sign the account out when a paid request is refused", async () => {
    const api = await import("../config/api");
    const authExpired = vi.fn();
    const off = api.onAuthExpired(authExpired);
    respond(200, { active: false });

    render(
      <AppProvider>
        <PaywallNotice onOpenSettings={() => {}} />
      </AppProvider>,
    );

    act(() => {
      api.signalPaywalled();
    });
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    expect(authExpired).not.toHaveBeenCalled();
    off();
  });
});
