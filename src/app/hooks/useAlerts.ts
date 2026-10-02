import { useState, useCallback, useMemo, useEffect } from "react";
import { ENDPOINTS, USE_LIVE_API, apiFetch, FETCH_TIMEOUT_MS } from "../config/api";
import { ALERTS_DATA } from "../data/idxData";
import type { AlertItem } from "../components/AlertsView";

/**
 * Alerts state — live feed + persisted read/dismiss.
 *
 * The alert LIST comes from the backend `/v1/alerts`, derived at read time from
 * live signals, market movers, foreign flow, risk and news — so the Peringatan
 * panel reflects current conditions, not a frozen seed. When the API is off or
 * unreachable it falls back to the bundled `ALERTS_DATA`, clearly the same
 * fallback philosophy the rest of the app uses.
 *
 * Read/dismiss state is keyed on each alert's STABLE `key` (e.g.
 * "signal:BBRI:VERY_HIGH"), not a positional id, so it survives refetches: the
 * same condition stays read/dismissed, while a genuinely new condition shows up
 * unread. Both sets persist in localStorage.
 */

const READ_KEY = "aidss-alerts-read";
const DISMISSED_KEY = "aidss-alerts-dismissed";
const REFRESH_MS = 60_000;

function readKeySet(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((s): s is string => typeof s === "string"));
      }
    }
  } catch { /* sandboxed / corrupted — start empty */ }
  return new Set();
}

function persist(storageKey: string, keys: Set<string>): void {
  try { localStorage.setItem(storageKey, JSON.stringify([...keys])); } catch { /* ignore */ }
}

/** Bundled seed as the offline fallback, given stable keys so read/dismiss works. */
const SEED_ALERTS: AlertItem[] = ALERTS_DATA.map((a) => ({ ...a, key: `seed-${a.id}` }));

export interface UseAlertsResult {
  alerts: readonly AlertItem[];
  visibleAlerts: AlertItem[];
  unreadCount: number;
  isLive: boolean;
  markAllRead: () => void;
  dismiss: (key: string) => void;
  clearAll: () => void;
}

export function useAlerts(): UseAlertsResult {
  const [alerts, setAlerts] = useState<AlertItem[]>(SEED_ALERTS);
  const [isLive, setIsLive] = useState(false);
  const [readKeys, setReadKeys] = useState<Set<string>>(() => readKeySet(READ_KEY));
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => readKeySet(DISMISSED_KEY));

  // Fetch the live feed (and poll it), falling back to the seed on any failure.
  useEffect(() => {
    if (!USE_LIVE_API) return;
    let alive = true;

    const load = async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await apiFetch(ENDPOINTS.alerts, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const list: AlertItem[] = json.alerts ?? [];
        if (alive && list.length) {
          setAlerts(list);
          setIsLive(json.source === "live");
        }
      } catch {
        // Keep whatever we have (seed or last good live).
        if (alive) setIsLive(false);
      }
    };

    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const unreadCount = useMemo(
    () => alerts.filter((a) => !readKeys.has(a.key) && !dismissedKeys.has(a.key)).length,
    [alerts, readKeys, dismissedKeys],
  );

  const visibleAlerts = useMemo(
    () => alerts.filter((a) => !dismissedKeys.has(a.key)),
    [alerts, dismissedKeys],
  );

  const markAllRead = useCallback(() => {
    setReadKeys((prev) => {
      const missing = alerts.some((a) => !prev.has(a.key));
      if (!missing) return prev;  // idempotent — safe to call on every open
      const next = new Set(prev);
      alerts.forEach((a) => next.add(a.key));
      persist(READ_KEY, next);
      return next;
    });
  }, [alerts]);

  const dismiss = useCallback((key: string) => {
    setReadKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev).add(key);
      persist(READ_KEY, next);
      return next;
    });
    setDismissedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev).add(key);
      persist(DISMISSED_KEY, next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    const all = new Set(alerts.map((a) => a.key));
    setReadKeys((prev) => { const n = new Set(prev); all.forEach((k) => n.add(k)); persist(READ_KEY, n); return n; });
    setDismissedKeys((prev) => { const n = new Set(prev); all.forEach((k) => n.add(k)); persist(DISMISSED_KEY, n); return n; });
  }, [alerts]);

  return { alerts, visibleAlerts, unreadCount, isLive, markAllRead, dismiss, clearAll };
}
