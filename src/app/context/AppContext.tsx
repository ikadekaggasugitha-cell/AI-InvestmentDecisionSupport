import { createContext, useContext, useState, useLayoutEffect, type ReactNode } from "react";
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

interface AppContextValue {
  isDark: boolean;
  toggleTheme: () => void;
  locale: Locale;
  toggleLocale: () => void;
  setLocale: (l: Locale) => void;
}

const AppContext = createContext<AppContextValue>({
  isDark: false,
  toggleTheme: () => {},
  locale: "id",
  toggleLocale: () => {},
  setLocale: () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark]         = useState<boolean>(readTheme);
  const [locale, setLocaleState]    = useState<Locale>(readLocale);

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
    <AppContext.Provider value={{ isDark, toggleTheme, locale, toggleLocale, setLocale }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
