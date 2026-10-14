import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PaywallNotice } from "./PaywallNotice";

/**
 * What the app says when the paid data is being refused.
 *
 * The rule this screen exists to keep: a refusal has to name its cause and offer
 * somewhere to go. "Something went wrong, try again" is a sentence that is true
 * every time the backend is down and every time an account has not subscribed,
 * and a person reading it has no way to tell which one they are looking at.
 *
 * There is deliberately no Buy button. Payments are Phase 2 and there is no path
 * to one — a control that looks live and does nothing is worse than its absence
 * (R-26, recorded in SettingsView).
 */
describe("PaywallNotice", () => {
  it("names the subscription rather than the connection", () => {
    render(<PaywallNotice onOpenSettings={() => {}} />);

    expect(screen.getByText(/langganan/i)).toBeInTheDocument();
    expect(screen.queryByText(/tidak terjangkau/i)).not.toBeInTheDocument();
  });

  it("points at Settings, which is where the status can be read", async () => {
    const onOpenSettings = vi.fn();
    render(<PaywallNotice onOpenSettings={onOpenSettings} />);

    await userEvent.click(screen.getByRole("button"));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("offers nothing that pretends to be a purchase", () => {
    render(<PaywallNotice onOpenSettings={() => {}} />);

    // R-26: no control may look live without a path behind it.
    expect(screen.queryByRole("button", { name: /beli|buy|upgrade/i })).toBeNull();
  });

  it("says nothing is known when the server could not be asked", () => {
    render(<PaywallNotice reason="unknown" onOpenSettings={() => {}} />);

    expect(screen.getByText(/tidak dapat dipastikan/i)).toBeInTheDocument();
  });

  it("renders in English when the interface is", () => {
    render(<PaywallNotice locale="en" onOpenSettings={() => {}} />);

    expect(screen.getByText(/subscription/i)).toBeInTheDocument();
  });
});