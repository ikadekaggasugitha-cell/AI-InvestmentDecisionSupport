import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { AppProvider, useApp } from "./AppContext";

/**
 * The shell needs one fact about the account: whether the paid data is locked,
 * and if it is, whether that is known or merely unasked.
 *
 * "You have no subscription" and "we could not find out" look the same from
 * outside a boolean, and they mean opposite things — the first is a billing
 * state, the second is something to retry. That distinction is the whole reason
 * this is a discriminated union rather than a flag.
 */

function Consumer({ onRender }: { onRender?: (v: ReturnType<typeof useApp>) => void }) {
  const app = useApp();
  onRender?.(app);
  return (
    <div>
      <span data-testid="locked">{String(app.locked)}</span>
      <span data-testid="status">{app.subscription.kind}</span>
    </div>
  );
}

const fetchMock = vi.fn();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("AppContext — subscription status", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an active subscription from the server, not from a guess", async () => {
    respond(200, { active: true, expiresAt: "2027-01-01T00:00:00Z", daysRemaining: 45 });

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("active"));
    expect(screen.getByTestId("locked")).toHaveTextContent("false");
  });

  it("keeps 'the server says you have none' apart from 'we could not ask'", async () => {
    respond(200, { active: false });

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("none"));
  });

  it("does not report a failed lookup as no subscription", async () => {
    // This is the failure that would leave someone with an active subscription
    // being told, in the shell of their own app, that they do not have one.
    respond(503, {});

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unknown"));
  });

  it("starts out not knowing, rather than asserting an account has no subscription", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>,
    );

    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    expect(screen.getByTestId("locked")).toHaveTextContent("false");
  });

  it("re-reads the server when a paid request is refused", async () => {
    // The lock is not a flag that latches on the first 403. It is the server's
    // answer, re-asked, because a refusal can mean "your period ended a minute
    // ago" and the screen should say so rather than keep showing a stale no.
    respond(200, { active: false });
    const api = await import("../config/api");

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("none"));

    // The subscription is bought in another tab while this one sits open.
    respond(200, { active: true, expiresAt: "2027-01-01T00:00:00Z", daysRemaining: 30 });
    act(() => {
      api.signalPaywalled();
    });

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("active"));
    expect(screen.getByTestId("locked")).toHaveTextContent("false");
  });

  it("does not claim a lock it cannot support", async () => {
    // A refusal arrived but the server will not say why. Showing "subscribe" here
    // would be guessing at a cause, which is the mistake this whole change is about.
    respond(503, {});
    const api = await import("../config/api");

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unknown"));

    act(() => {
      api.signalPaywalled();
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));

    expect(screen.getByTestId("status")).toHaveTextContent("unknown");
    expect(screen.getByTestId("locked")).toHaveTextContent("false");
  });

  it("asks the server once no matter how many refusals arrive together", async () => {
    // Eight hooks ask for paid data on first paint. The apiFetch latch is
    // released by any successful request, and a running tab makes those to
    // ungated routes constantly — so without coalescing here, every poll cycle
    // re-fires and re-asks, and this endpoint gets hit once a minute for no new
    // information.
    respond(200, { active: false });
    const api = await import("../config/api");

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("none"));
    const before = fetchMock.mock.calls.length;

    // A burst, which is what a first paint looks like: eight hooks refused
    // within milliseconds of each other.
    act(() => {
      for (let i = 0; i < 5; i += 1) api.signalPaywalled();
    });

    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before),
    );
    expect(fetchMock.mock.calls.length - before).toBe(1);
  });

  it("re-reads the server when the tab comes back, in case the state moved", async () => {
    respond(200, { active: false });

    render(
      <AppProvider>
        <Consumer />
      </AppProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("none"));
    const before = fetchMock.mock.calls.length;

    respond(200, { active: true, expiresAt: "2027-01-01T00:00:00Z", daysRemaining: 30 });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("active"));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });
});
