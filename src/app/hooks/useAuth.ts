import { useCallback, useEffect, useState } from "react";
import { ENDPOINTS, apiFetch } from "../config/api";

/** What /v1/auth/me returns. Mirrors AccountResponse on the backend. */
export interface Account {
  id: string;
  email: string;
  full_name: string;
  phone_number: string;
  role: "user" | "admin";
  blocked: boolean;
}

export type AuthStatus = "checking" | "signed-in" | "signed-out";

export interface AuthState {
  status: AuthStatus;
  account: Account | null;
  error: string | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    full_name: string;
    phone_number: string;
    password: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (input: { full_name: string; phone_number: string }) => Promise<void>;
}

/**
 * Who is signed in.
 *
 * "checking" is a real third state, not a formality: until /v1/auth/me answers,
 * the truth is unknown, and treating unknown as signed-out would bounce a
 * signed-in person to the login page on every refresh. Treating it as signed-in
 * would flash the dashboard at a stranger first.
 *
 * There is no token in JavaScript to keep, and nothing to synchronise. The
 * HttpOnly cookie is the session, so this hook only ever asks the server.
 */
export function useAuth(): AuthState {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(ENDPOINTS.authMe);
      if (res.ok) {
        setAccount((await res.json()) as Account);
        setStatus("signed-in");
        setError(null);
        return;
      }
      // 403 means the account exists but is blocked. That is not the same as
      // "nobody is signed in", and the login page has to be able to say so.
      if (res.status === 403) {
        setStatus("signed-out");
        setAccount(null);
        setError("blocked");
        return;
      }
      setStatus("signed-out");
      setAccount(null);
    } catch {
      // The server is unreachable. Unknown is not signed-out: reporting it as one
      // would sign people out every time the API blips.
      setError("unreachable");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(
    async (path: string, payload: unknown) => {
      const res = await apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await readError(res);
      const body = (await res.json()) as { account: Account };
      setAccount(body.account);
      setStatus("signed-in");
      setError(null);
    },
    [],
  );

  const signIn = useCallback(
    (email: string, password: string) => submit(ENDPOINTS.authLogin, { email, password }),
    [submit],
  );

  const signUp = useCallback(
    (input: { email: string; full_name: string; phone_number: string; password: string }) =>
      submit(ENDPOINTS.authSignup, input),
    [submit],
  );

  const updateProfile = useCallback(
    async (input: { full_name: string; phone_number: string }) => {
      const res = await apiFetch(ENDPOINTS.authMe, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await readError(res);
      setAccount((await res.json()) as Account);
      setError(null);
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await apiFetch(ENDPOINTS.authLogout, { method: "POST" });
    } finally {
      // Local state clears even if the request failed, because the cookie is
      // gone either way once the response lands. Leaving someone looking at a
      // dashboard they can no longer use is worse than an optimistic clear.
      setAccount(null);
      setStatus("signed-out");
    }
  }, []);

  return { status, account, error, refresh, signIn, signUp, signOut, updateProfile };
}

/** Turn a non-2xx response into something a person can act on. */
export async function readError(res: Response): Promise<string> {
  const detail = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  const raw = detail?.detail;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) {
    // FastAPI validation errors arrive as a list of field problems.
    const first = raw[0] as { loc?: unknown[]; msg?: string };
    const field = Array.isArray(first.loc) ? String(first.loc[first.loc.length - 1]) : "";
    const msg = first.msg ?? "invalid value";
    return field ? `${field}: ${msg}` : msg;
  }
  if (res.status === 0) return "Cannot reach the server.";
  return `Request failed (${res.status}).`;
}