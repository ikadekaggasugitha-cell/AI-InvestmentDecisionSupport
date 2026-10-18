import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminBankAccountsView } from "./AdminBankAccountsView";

/**
 * The form that sets where a manual transfer goes.
 *
 * Four rules this screen exists to keep:
 *
 *  - It shows what the **server** holds — after a save it re-reads, so what the
 *    public endpoint will publish is what the form ends up displaying.
 *  - A refused save changes nothing on screen. The list goes back to the last
 *    list the server confirmed, and the refusal is shown, not swallowed.
 *  - An empty stored list is said out loud ("belum ada rekening tujuan"), not
 *    rendered as a quiet empty table that looks like a list that lost data.
 *  - No control claims to verify a bank account. Nobody verified anything, and
 *    a button implying otherwise would be the lie this change exists to remove.
 */
vi.mock("../config/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/api")>()),
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../config/api";

const mocked = vi.mocked(apiFetch);

const ON_SERVER = {
  accounts: [{ bank: "BCA", accountNumber: "1234567890", holderName: "PT AIDSS" }],
  updatedAt: "2026-10-14T10:00:00+00:00",
};

const EMPTY = { accounts: [], updatedAt: null };

function respond(status: number, body: unknown) {
  mocked.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response);
}

function writes() {
  return mocked.mock.calls.filter(
    (c) =>
      String(c[0]).endsWith("/v1/admin/settings/bank-accounts") &&
      (c[1] as RequestInit)?.method === "PUT",
  );
}

function bankField() {
  return screen.getByLabelText(/^Bank$/);
}

describe("AdminBankAccountsView", () => {
  beforeEach(() => {
    mocked.mockReset();
    respond(200, ON_SERVER);
  });

  it("shows the destinations the server holds, not rows it made up", async () => {
    render(<AdminBankAccountsView />);

    await waitFor(() => expect(bankField()).toHaveValue("BCA"));
    expect(screen.getByLabelText(/Nomor rekening/i)).toHaveValue("1234567890");
    expect(screen.getByLabelText(/Nama pemilik/i)).toHaveValue("PT AIDSS");
    // The rows rendered are the ones read back, exactly one each.
    expect(screen.getAllByLabelText(/^Bank$/)).toHaveLength(1);
  });

  it("says there is no destination yet rather than rendering a quiet empty list", async () => {
    respond(200, EMPTY);
    render(<AdminBankAccountsView />);

    expect(await screen.findByText(/belum ada rekening tujuan/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Bank$/)).not.toBeInTheDocument();
  });

  it("sends the whole list in one request", async () => {
    render(<AdminBankAccountsView />);
    await waitFor(() => expect(bankField()).toHaveValue("BCA"));

    const number = screen.getByLabelText(/Nomor rekening/i);
    await userEvent.clear(number);
    await userEvent.type(number, "9998887776");
    await userEvent.click(screen.getByRole("button", { name: /Simpan/i }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [, init] = writes()[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      accounts: [{ bank: "BCA", accountNumber: "9998887776", holderName: "PT AIDSS" }],
    });
  });

  it("shows the server's answer after saving, not what was typed", async () => {
    const SAVED = {
      accounts: [{ bank: "BNI", accountNumber: "5555444433", holderName: "PT AIDSS" }],
      updatedAt: "2026-10-15T08:00:00+00:00",
    };
    let served = 0;
    mocked.mockImplementation(async () => {
      served += 1;
      // Call 1 is the initial load and call 2 is the PUT, which changes
      // nothing; call 3 is the re-read, and what it holds is what shows.
      const body = served === 3 ? SAVED : ON_SERVER;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    });

    render(<AdminBankAccountsView />);
    await waitFor(() => expect(bankField()).toHaveValue("BCA"));
    await userEvent.click(screen.getByRole("button", { name: /Simpan/i }));

    await waitFor(() => expect(bankField()).toHaveValue("BNI"));
    expect(screen.getByLabelText(/Nomor rekening/i)).toHaveValue("5555444433");
  });

  it("keeps the confirmed list on screen when the save is refused", async () => {
    render(<AdminBankAccountsView />);
    await waitFor(() => expect(bankField()).toHaveValue("BCA"));

    respond(422, { detail: "an empty list is refused" });
    const holder = screen.getByLabelText(/Nama pemilik/i);
    await userEvent.clear(holder);
    await userEvent.type(holder, "Nama yang tidak tersimpan");
    await userEvent.click(screen.getByRole("button", { name: /Simpan/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ditolak \(422\)/);
    // The typed text was never accepted, so it is not on the screen.
    expect(await screen.findByLabelText(/Nama pemilik/i)).toHaveValue("PT AIDSS");
  });

  it("forwards the empty-list refusal instead of pretending it saved", async () => {
    // GET succeeds; every PUT is refused, exactly as the endpoint refuses it.
    mocked.mockImplementation(async (_url, init) => {
      if ((init as RequestInit | undefined)?.method === "PUT") {
        return {
          ok: false,
          status: 422,
          json: async () => ({ detail: "an empty list is refused" }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ON_SERVER } as unknown as Response;
    });
    render(<AdminBankAccountsView />);
    await waitFor(() => expect(bankField()).toHaveValue("BCA"));

    await userEvent.click(screen.getByRole("button", { name: /Hapus rekening ke-1/i }));
    await userEvent.click(screen.getByRole("button", { name: /Simpan/i }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [, init] = writes()[0];
    // The attempt is real — the server's refusal is what the form renders, not a
    // client-side rule that could drift from the one the endpoint enforces.
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ accounts: [] });

    expect(await screen.findByRole("alert")).toHaveTextContent(/ditolak \(422\)/);
    // The server still holds the one destination, so it comes back on re-read.
    expect(await screen.findByLabelText(/^Bank$/)).toHaveValue("BCA");
  });

  it("has no control that claims to verify a bank account", async () => {
    render(<AdminBankAccountsView />);
    await waitFor(() => expect(bankField()).toBeInTheDocument());

    // Nothing anywhere verifies a bank account number. A button saying so would
    // promise the exact thing nobody does (R-26).
    expect(screen.queryByRole("button", { name: /verifikasi/i })).toBeNull();
    expect(screen.queryByText(/terverifikasi/i)).toBeNull();
  });

  it("adds a row with empty fields for a new destination", async () => {
    render(<AdminBankAccountsView />);
    await waitFor(() => expect(bankField()).toHaveValue("BCA"));

    await userEvent.click(screen.getByRole("button", { name: /Tambah rekening/i }));

    const banks = screen.getAllByLabelText(/^Bank$/);
    expect(banks).toHaveLength(2);
    expect(banks[1]).toHaveValue("");
    expect(screen.getAllByLabelText(/Nomor rekening/i)[1]).toHaveValue("");
  });

  it("is not a form at all when the viewer is not an administrator", async () => {
    respond(403, {});
    render(<AdminBankAccountsView />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Simpan/i })).not.toBeInTheDocument();
  });

  it("renders nothing editable when the server cannot be asked", async () => {
    mocked.mockRejectedValue(new Error("offline"));
    render(<AdminBankAccountsView />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Simpan/i })).not.toBeInTheDocument();
  });
});
