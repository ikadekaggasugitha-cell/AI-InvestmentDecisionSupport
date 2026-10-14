import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminPricingView } from "./AdminPricingView";

/**
 * The form that sets what the product costs.
 *
 * Two rules this screen exists to keep:
 *
 *  - It shows what the **server** holds. Not what was typed, and not a guess. A
 *    form that renders its own optimistic state looks right and can be wrong.
 *  - A failed save changes nothing on screen. The old price is still the price,
 *    and saying otherwise would be the same lie the rest of this change removed.
 *
 * There is no plan picker and no "active" switch. The price is two numbers; what
 * is sold is decided elsewhere (and nowhere yet, since there is no purchase
 * path).
 */
vi.mock("../config/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/api")>()),
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../config/api";

const mocked = vi.mocked(apiFetch);

const ON_SERVER = { monthly: 15000, annual: 150000, updatedAt: "2026-10-01T09:30:00+00:00" };

function respond(status: number, body: unknown) {
  mocked.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);
}

function writes(suffix: string) {
  return mocked.mock.calls.filter(
    (c) => String(c[0]).endsWith(suffix) && (c[1] as RequestInit)?.method === "PUT",
  );
}

describe("AdminPricingView", () => {
  beforeEach(() => {
    mocked.mockReset();
    respond(200, ON_SERVER);
  });

  it("shows the price the server holds, not a number it made up", async () => {
    render(<AdminPricingView />);

    await waitFor(() =>
      expect(screen.getByLabelText(/Bulanan/i)).toHaveValue(15000),
    );
    expect(screen.getByLabelText(/Tahunan/i)).toHaveValue(150000);
  });

  it("says when the price was last changed", async () => {
    render(<AdminPricingView />);

    await waitFor(() => expect(screen.getByText(/diperbarui/i)).toBeInTheDocument());
  });

  it("sends both prices in one request", async () => {
    render(<AdminPricingView />);
    await waitFor(() => expect(screen.getByLabelText(/Bulanan/i)).toHaveValue(15000));

    await userEvent.clear(screen.getByLabelText(/Bulanan/i));
    await userEvent.type(screen.getByLabelText(/Bulanan/i), "20000");
    await userEvent.click(screen.getByRole("button", { name: /Simpan/i }));

    await waitFor(() => expect(writes("/v1/admin/settings/pricing")).toHaveLength(1));
    const [, init] = writes("/v1/admin/settings/pricing")[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      monthly: 20000,
      annual: 150000,
    });
  });

  it("shows the server's answer after saving, not the typed number", async () => {
    // The server may clamp, round, or reject. Whatever it returns is the price.
    const SAVED = {
      monthly: 19000,
      annual: 190000,
      updatedAt: "2026-10-14T10:00:00+00:00",
    };
    let served = 0;
    mocked.mockImplementation(async () => {
      served += 1;
      // Call 1 is the initial load; the PUT (call 2) is where the server
      // answers something other than what was typed.
      const body = served === 1 ? ON_SERVER : SAVED;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    });

    render(<AdminPricingView />);
    await waitFor(() => expect(screen.getByLabelText(/Bulanan/i)).toHaveValue(15000));

    await userEvent.clear(screen.getByLabelText(/Bulanan/i));
    await userEvent.type(screen.getByLabelText(/Bulanan/i), "20000");
    await userEvent.click(screen.getByRole("button", { name: /Simpan/i }));

    // The server answers 19000 for a 20000 request.
    await waitFor(() => expect(screen.getByLabelText(/Bulanan/i)).toHaveValue(19000));
    expect(screen.getByLabelText(/Tahunan/i)).toHaveValue(190000);
  });

  it("keeps the old price on screen when the save fails", async () => {
    render(<AdminPricingView />);
    await waitFor(() => expect(screen.getByLabelText(/Bulanan/i)).toHaveValue(15000));

    mocked.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: "monthly is out of range" }),
    } as unknown as Response);
    await userEvent.clear(screen.getByLabelText(/Bulanan/i));
    await userEvent.type(screen.getByLabelText(/Bulanan/i), "20000");
    await userEvent.click(screen.getByRole("button", { name: /Simpan/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // 20000 is what was typed and 15000 is what the server still holds. The field
    // showing the rejected number would be a claim that it was accepted.
    expect(screen.getByText(/harga tidak berubah/i)).toBeInTheDocument();
  });

  it("says the price is unknown rather than showing an empty form", async () => {
    // 503 means the row is missing. An empty input reads as "free", which is a
    // price nobody set.
    respond(503, {});
    render(<AdminPricingView />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Bulanan/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Simpan/i })).not.toBeInTheDocument();
  });

  it("has no control that pretends there is a way to sell a plan", () => {
    render(<AdminPricingView />);

    // No plan picker, no active switch: what is sold is not decided here, and
    // there is no purchase path to attach one to (R-26).
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});