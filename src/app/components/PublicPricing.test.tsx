import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PublicPricing } from "./PublicPricing";

/**
 * The price a visitor reads with no session. The rules this suite pins:
 *
 *  - The numbers are the server's. Nothing anywhere in this repo is allowed to
 *    keep a private copy of a number the admin can change (plan-harga-admin).
 *  - A refused price is never printed as zero. 503 means the install has no
 *    configured price, and "Rp 0" quotes a real customer for free.
 *  - There is no purchase control. Deciding to pay starts inside the app,
 *    with a session behind it; this page only carries the decision's inputs.
 */
vi.mock("../config/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/api")>()),
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../config/api";

const mocked = vi.mocked(apiFetch);

function respond(status: number, body: unknown) {
  mocked.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);
}

describe("PublicPricing", () => {
  beforeEach(() => {
    mocked.mockReset();
    respond(200, { monthly: 15000, annual: 150000, updatedAt: null });
  });

  it("shows the two prices the server holds", async () => {
    render(<PublicPricing locale="id" onEnter={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Rp 15.000")).toBeInTheDocument());
    expect(screen.getByText("Rp 150.000")).toBeInTheDocument();
  });

  it("says it is loading rather than flashing a number nobody set", () => {
    mocked.mockReturnValue(new Promise(() => {}) as Promise<Response>);
    render(<PublicPricing locale="id" onEnter={vi.fn()} />);

    expect(screen.getByText(/Memuat harga/)).toBeInTheDocument();
    expect(screen.queryByText(/Rp /)).not.toBeInTheDocument();
  });

  it("answers a missing price in words, never as zero", async () => {
    respond(503, { detail: "No pricing is configured on this server." });
    render(<PublicPricing locale="id" onEnter={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/Tidak ditampilkan sebagai nol/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Rp 0/)).not.toBeInTheDocument();
  });

  it("keeps the same promise when the backend is unreachable", async () => {
    mocked.mockRejectedValue(new TypeError("failed to fetch"));
    render(<PublicPricing locale="id" onEnter={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/Harga tidak dapat dimuat/)).toBeInTheDocument(),
    );
  });

  it("names exactly what the gate opens, and sells nothing here", async () => {
    render(<PublicPricing locale="id" onEnter={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Rp 15.000")).toBeInTheDocument());

    expect(screen.getByText("Sinyal")).toBeInTheDocument();
    expect(screen.getByText("Peringatan otomatis")).toBeInTheDocument();
    expect(screen.getByText("Panel risiko")).toBeInTheDocument();
    expect(screen.getByText("Optimasi portofolio")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Beli|Bayar/i })).not.toBeInTheDocument();
  });

  it("sends the visitor to the auth surface with its one control", async () => {
    const onEnter = vi.fn();
    const user = userEvent.setup();
    render(<PublicPricing locale="id" onEnter={onEnter} />);
    await waitFor(() => expect(screen.getByText("Rp 15.000")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Masuk atau buat akun/ }));
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("speaks English to an English visitor", async () => {
    render(<PublicPricing locale="en" onEnter={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Rp 15,000")).toBeInTheDocument());
    expect(screen.getByText("Rp 150,000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in or create an account/ })).toBeInTheDocument();
  });
});
