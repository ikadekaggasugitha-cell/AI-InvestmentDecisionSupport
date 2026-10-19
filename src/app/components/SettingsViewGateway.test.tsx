/**
 * The Midtrans card in the billing tab — the tab's second door for money.
 *
 * Each test drives the real control: the page opens only after the server
 * named one, every failure answers in sentence form, and no failure opens a
 * window. The mocked transport is the same boundary the manual-declaration
 * tests mock; nothing here knows Midtrans' own address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView } from "./SettingsView";
import { AppProvider } from "../context/AppContext";
import { SIMULATED_FRESHNESS } from "../hooks/useLiveMarket";
import type { ExchangeRateData } from "../hooks/useExchangeRate";
import type { AuthState } from "../hooks/useAuth";

const priceState = {
  body: { monthly: 15000, annual: 150000 } as unknown,
  throws: false,
};
const payState = {
  rows: [] as unknown[],
  throws: false,
};
const gateState = {
  status: 200,
  body: { redirectUrl: "https://app.sandbox.midtrans.com/snap/v2/vt/INV-GW-01" } as unknown,
  throws: false,
};
const checkouts: unknown[] = [];

// Only the transport is faked; the error classification in the hook stays real.
vi.mock("../config/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/api")>()),
  ENDPOINTS: {
    subscription: "/v1/subscription/current",
    pricing: "/v1/subscriptions/pricing",
    authMe: "/v1/auth/me",
    payments: "/v1/payments/me",
    paymentsDeclare: "/v1/payments/manual",
    paymentsCheckout: "/v1/payments/checkout",
    bankAccounts: "/v1/subscriptions/bank-accounts",
  },
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/v1/subscriptions/pricing")) {
      if (priceState.throws) throw new Error("offline");
      return { ok: true, status: 200, json: async () => priceState.body } as unknown as Response;
    }
    if (url.includes("/v1/subscription/current")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          active: false,
          expiresAt: null,
          daysRemaining: null,
          startDate: null,
        }),
      } as unknown as Response;
    }
    if (url.includes("/v1/payments/me")) {
      if (payState.throws) throw new Error("offline");
      return { ok: true, status: 200, json: async () => payState.rows } as unknown as Response;
    }
    if (url.includes("/v1/subscriptions/bank-accounts")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ accounts: [] }),
      } as unknown as Response;
    }
    if (url.includes("/v1/payments/checkout")) {
      if (gateState.throws) throw new Error("offline");
      checkouts.push(JSON.parse(String(init?.body ?? "{}")));
      return {
        ok: gateState.status < 400,
        status: gateState.status,
        json: async () => (gateState.status < 400 ? gateState.body : {}),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }),
}));

const TEST_ACCOUNT = {
  id: "3f2a6c11-0d5e-4a1b-9c77-1f0b2d3e4a55",
  email: "pengguna@aidss.id",
  full_name: "Nama Pengguna",
  phone_number: "081234567890",
  role: "user" as const,
  blocked: false,
  blockedReason: null,
};

function auth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    status: "signed-in",
    account: TEST_ACCOUNT,
    error: null,
    refresh: async () => {},
    signIn: async () => {},
    signUp: async () => {},
    signOut: async () => {},
    updateProfile: async () => {},
    ...overrides,
  };
}

function fx(): ExchangeRateData {
  return {
    usdIdr: 15420,
    change: -85,
    changePct: -0.551,
    isLive: true,
    showUsd: false,
    toggleCurrency: () => {},
  } as ExchangeRateData;
}

function renderSettings() {
  return render(
    <AppProvider>
      <SettingsView
        fx={fx()}
        freshness={SIMULATED_FRESHNESS}
        auth={auth()}
        onSignedOut={() => {}}
      />
    </AppProvider>,
  );
}

async function openBillingTab() {
  const view = renderSettings();
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /Langganan & Tagihan/ }));
  // The gateway card's own button is unique through the tab; the plan ramble
  // around it appears in both cards and cannot carry a wait by itself.
  await screen.findByRole("button", { name: /Buka halaman bayar Midtrans/ });
  return { view, user };
}

async function openGatewayPage(user: ReturnType<typeof userEvent.setup>) {
  // The gateway card carries its own plan radios; the manual form above it
  // shares the visible words, so the input is reached by name, not by text.
  const inputs = document.querySelectorAll<HTMLInputElement>('input[name="gateway-plan"]');
  expect(inputs.length).toBe(2);
  await user.click(inputs[1] as HTMLElement); // annual
  await user.click(screen.getByRole("button", { name: /Buka halaman bayar Midtrans/ }));
}

describe("SettingsView — bayar lewat Midtrans (redirect_url)", () => {
  // window.open is watched through a recorder rather than a mock variable's
  // generics: what the button asked for, if anything, arrives as plain data.
  const openedWith: Array<Parameters<typeof window.open>> = [];

  beforeEach(() => {
    priceState.throws = false;
    payState.throws = false;
    gateState.status = 200;
    gateState.throws = false;
    checkouts.length = 0;
    openedWith.length = 0;
    vi.spyOn(window, "open").mockImplementation(
      ((url?: string | URL, target?: string, features?: string) => {
        openedWith.push([url as string, target as string, features as string]);
        return null;
      }) as typeof window.open,
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the page the server minted, in a new tab, at that plan's price", async () => {
    const { user } = await openBillingTab();

    await openGatewayPage(user);

    expect(checkouts).toEqual([{ plan: "annual" }]);
    expect(openedWith).toEqual([
      ["https://app.sandbox.midtrans.com/snap/v2/vt/INV-GW-01", "_blank", expect.stringContaining("noopener")],
    ]);
  });

  it("refuses the button with a sentence and opens nothing when the gateway is not wired", async () => {
    gateState.status = 503;
    const { user } = await openBillingTab();

    await openGatewayPage(user);

    expect(checkouts).toEqual([{ plan: "annual" }]); // the attempt was real
    expect(openedWith).toEqual([]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Pembayaran online belum aktif di server ini/u,
    );
  });

  it("names the transport for what it is when the server cannot be reached", async () => {
    gateState.throws = true;
    const { user } = await openBillingTab();

    await openGatewayPage(user);

    expect(checkouts).toEqual([]); // nothing was sent; nothing is claimed
    expect(openedWith).toEqual([]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Server tidak terjangkau/u,
    );
  });
});
