import {
  createContext, useCallback, useContext, useEffect,
  useLayoutEffect, useState, type ReactNode,
} from "react";
import { ENDPOINTS, apiFetch, onPaywalled } from "../config/api";
import type { Locale } from "../i18n/translations";

const STORAGE_THEME  = "aidss-theme";
const STORAGE_LOCALE = "aidss-locale";

function readTheme(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_THEME);
    if (saved === "light") return false;
    if (saved === "dark")  return true;
  } catch { /* localStorage may be unavailable in sandboxed iframes */ }
  // DESIGN.md Theme: light is the default. Dark is a deliberate user choice,
  // never the state a first-time visitor lands in.
  return false;
}

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_LOCALE);
    if (saved === "en" || saved === "id") return saved;
  } catch { /* ignore */ }
  return "id"; // default: Bahasa Indonesia
}

/**
 * What the server knows about this account's subscription.
 *
 * `none` and `unknown` are deliberately different states. They look identical
 * from outside a boolean and they mean opposite things: one is a billing fact
 * and the other is a lookup that failed. Collapsing them would let a 503 tell
 * someone with an active subscription that they have none.
 */
export type SubscriptionStatus =
  | { kind: "loading" }
  | { kind: "active"; expiresAt: string; daysRemaining: number }
  | { kind: "none" }
  | { kind: "unknown" };

interface AppContextValue {
  isDark: boolean;
  toggleTheme: () => void;
  locale: Locale;
  toggleLocale: () => void;
  setLocale: (l: Locale) => void;
  /**
   * Whether a paid request is currently being refused.
   *
   * Derived from `subscription` rather than a flag that latches on the first 403.
   * A flag and a subscription status are two records of one fact and they drift:
   * a period that ends while the tab is open leaves the flag saying "fine" long
   * after the server started refusing. CONTEXT.md rule 5, in the shell.
   */
  locked: boolean;
  subscription: SubscriptionStatus;
  /** Re-ask the server. Fired by a refusal, and by the tab regaining focus. */
  refreshSubscription: () => void;
}

const AppContext = createContext<AppContextValue>({
  isDark: false,
  toggleTheme: () => {},
  locale: "id",
  toggleLocale: () => {},
  setLocale: () => {},
  locked: false,
  subscription: { kind: "loading" },
  refreshSubscription: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark]         = useState<boolean>(readTheme);
  const [locale, setLocaleState]    = useState<Locale>(readLocale);
  const [subscription, setSubscription] = useState<SubscriptionStatus>({ kind: "loading" });
  const [askToken, setAskToken]       = useState(0);
  const refreshSubscription = useCallback(() => setAskToken((n) => n + 1), []);

  /* Ask the server, and keep "answered" apart from "could not ask".

     This endpoint is deliberately behind the session rather than behind the
     paywall: the question cannot be asked by someone the gate has already
     refused, and without this the app has no honest way to explain why the paid
     data is missing. */
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await apiFetch(ENDPOINTS.subscription, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          active: boolean;
          expiresAt?: string | null;
          daysRemaining?: number | null;
        };
        setSubscription(
          body.active && body.expiresAt && typeof body.daysRemaining === "number"
            ? { kind: "active", expiresAt: body.expiresAt, daysRemaining: body.daysRemaining }
            : { kind: "none" },
        );
      } catch {
        if (controller.signal.aborted) return;
        setSubscription({ kind: "unknown" });
      }
    })();
    return () => controller.abort();
  }, [askToken]);

  /* A refusal is not the answer, it is the reason to ask again. */
  useEffect(() => onPaywalled(refreshSubscription), [refreshSubscription]);

  /* And a tab that sat in the background may have missed a purchase made in
     another one. Re-ask when it comes back, so the lock does not outlive the
     thing that caused it. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSubscription();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshSubscription]);

  /* Apply .dark class synchronously before paint — prevents flash of wrong theme */
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem(STORAGE_THEME, isDark ? "dark" : "light");
    } catch { /* ignore */ }
  }, [isDark]);

  /* Persist locale changes */
  useLayoutEffect(() => {
    try {
      localStorage.setItem(STORAGE_LOCALE, locale);
    } catch { /* ignore */ }
  }, [locale]);

  /* Keep the document language in step with the interface language. A page
     that renders Indonesian while declaring lang="en" makes screen readers
     pronounce it with English phonetics. */
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function toggleTheme() {
    setIsDark((prev) => !prev);
  }

  function toggleLocale() {
    setLocaleState((prev) => (prev === "id" ? "en" : "id"));
  }

  function setLocale(l: Locale) {
    setLocaleState(l);
  }

  return (
    <AppContext.Provider
      value={{
        isDark, toggleTheme, locale, toggleLocale, setLocale,
        locked: subscription.kind === "none",
        subscription,
        refreshSubscription,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
