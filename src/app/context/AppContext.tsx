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
  return true; // default: dark
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
  isDark: true,
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
