import { useCallback, useEffect, useRef, useState } from "react";

import { ENDPOINTS, apiFetch } from "../config/api";

/**
 * One attempt to pay, exactly as GET /v1/payments/me carries it.
 *
 * Status names are the server's vocabulary — `pending`, `settlement`, `expire`,
 * `deny` — and this interface renames none of them: a client that translated
 * statuses would be a second place deciding what words mean. `notes` is the
 * record left on the row (the payer's declaration, plus an administrator's
 * refusal reason when one exists).
 */
export interface PaymentRow {
  id: string;
  invoiceCode: string;
  amount: number;
  plan: string;
  paymentGateway: string;
  paymentMethod: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  expiresAt?: string | null;
}

/** What a declaration sends. No amount field: the server prices the plan. */
export interface DeclareInput {
  plan: string;
  payment_method: string;
  note?: string | null;
}

/**
 * What a successful checkout returns: the page Midtrans minted for one
 * order — opened in another tab, not embedded. No Midtrans client key
 * crosses this boundary, which is the point of the redirect handover.
 */
export interface CheckoutPage {
  redirectUrl: string;
}

/**
 * The account's own money history and the one way to add to it.
 *
 * Reading is the point: a declared transfer sits `pending` until a human
 * matches the money, and showing that state — including a denial, which would
 * otherwise look exactly like an accepted one's successor — is what keeps
 * "where is my payment" answerable. Nothing in the returned state gates
 * anything: money status never decides access (CONTEXT.md rule 3).
 *
 * `declare` posts and then re-reads, so the row on screen is the row the
 * server holds, not the one the client predicted. `checkout` is the same
 * shape of honesty aimed at the gateway: the page it returns belongs to an
 * order the server already wrote, so the pending row is on screen in the
 * very request that opened the tab.
 */
export function usePayments() {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [declareError, setDeclareError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const read = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const res = await apiFetch(ENDPOINTS.payments, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as PaymentRow[];
      if (controller.signal.aborted) return true;
      setRows(Array.isArray(body) ? body : []);
      setError(null);
      return true;
    } catch {
      if (controller.signal.aborted) return true;
      setError("network");
      return false;
    }
  }, []);

  useEffect(() => {
    void read();
    return () => inFlight.current?.abort();
  }, [read]);

  const declare = useCallback(
    async (input: DeclareInput): Promise<"ok" | "refused" | "network"> => {
      setDeclaring(true);
      setDeclareError(null);
      try {
        const res = await apiFetch(ENDPOINTS.paymentsDeclare, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const failure = res.status === 503 ? "unavailable" : String(res.status);
          setDeclareError(failure);
          return "refused";
        }
        // The list on screen becomes the server's list again, with the new
        // pending row wherever the server put it.
        await read();
        return "ok";
      } catch {
        setDeclareError("network");
        return "network";
      } finally {
        setDeclaring(false);
      }
    },
    [read],
  );

  const resetDeclareError = useCallback(() => setDeclareError(null), []);

  /**
   * Ask the server to open a Midtrans page. Returns the page or null; the
   * error names went with the cause the way `declareError` does —
   * `unavailable` for an install with no gateway wired (503), `network`
   * for the transport, `no-page` when the server answered its own missing
   * page. The re-read happens before returning: the pending row is on the
   * server by then, so an open tab never looks at nothing.
   */
  const checkout = useCallback(
    async (plan: "monthly" | "annual"): Promise<CheckoutPage | null> => {
      setCheckoutBusy(true);
      setCheckoutError(null);
      try {
        const res = await apiFetch(ENDPOINTS.paymentsCheckout, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        if (!res.ok) {
          setCheckoutError(res.status === 503 ? "unavailable" : String(res.status));
          return null;
        }
        const body = (await res.json()) as { redirectUrl?: string };
        if (!body.redirectUrl) {
          // A checkout without a page is a server bug said out loud, not an
          // `ok` to open nothing with.
          setCheckoutError("no-page");
          return null;
        }
        await read();
        return { redirectUrl: body.redirectUrl };
      } catch {
        setCheckoutError("network");
        return null;
      } finally {
        setCheckoutBusy(false);
      }
    },
    [read],
  );

  return {
    /** Null until the first read lands; [] is a fact, null is not yet. */
    rows,
    loading: rows === null && error === null,
    error,
    declare,
    declaring,
    declareError,
    resetDeclareError,
    checkout,
    checkoutBusy,
    checkoutError,
    reload: read,
  };
}
