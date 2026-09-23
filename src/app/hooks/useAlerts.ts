import { useState, useCallback, useMemo } from "react";
import { ALERTS_DATA } from "../data/idxData";
import type { AlertItem } from "../components/AlertsView";

/**
 * Alert read/dismiss state, lifted out of AlertsView and persisted.
 *
 * The sidebar badge and the alerts list used to track state separately: the
 * badge counted high-severity items in the constant array (always 2), while
 * "mark all read" only mutated local state inside AlertsView that was thrown
 * away on navigation. So the badge never cleared and never matched the real
 * number of alerts.
 *
 * This hook is the single source of truth for both:
 *   • `unreadCount` drives the badge — it is the count of alerts not yet seen,
 *     so it equals the real number of alerts (5) until they are read, then 0.
 *   • `visibleAlerts` drives the list — dismissed items are hidden.
 * Both `readIds` and `dismissedIds` persist in localStorage, so opening the
 * view or marking all read clears the badge for good, surviving navigation and
 * reloads.
 */

const READ_KEY = "aidss-alerts-read";
const DISMISSED_KEY = "aidss-alerts-dismissed";

function readIdSet(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((n): n is number => typeof n === "number"));
      }
    }
  } catch { /* sandboxed / corrupted — start empty */ }
  return new Set();
}

function persist(key: string, ids: Set<number>): void {
  try { localStorage.setItem(key, JSON.stringify([...ids])); } catch { /* ignore */ }
}

export interface UseAlertsResult {
  alerts: readonly AlertItem[];
  visibleAlerts: AlertItem[];
  unreadCount: number;
  markAllRead: () => void;
  dismiss: (id: number) => void;
  clearAll: () => void;
}

export function useAlerts(): UseAlertsResult {
  const [readIds, setReadIds] = useState<Set<number>>(() => readIdSet(READ_KEY));
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(() => readIdSet(DISMISSED_KEY));

  const alerts = ALERTS_DATA as readonly AlertItem[];

  // Unread = every alert whose id has not been marked read AND is not dismissed.
  const unreadCount = useMemo(
    () => alerts.filter((a) => !readIds.has(a.id) && !dismissedIds.has(a.id)).length,
    [alerts, readIds, dismissedIds],
  );

  const visibleAlerts = useMemo(
    () => alerts.filter((a) => !dismissedIds.has(a.id)),
    [alerts, dismissedIds],
  );

  const markAllRead = useCallback(() => {
    setReadIds((prev) => {
      // No-op if everything is already read, so this is safe to call on every
      // open without triggering a needless state update / re-render loop.
      if (alerts.every((a) => prev.has(a.id))) return prev;
      const next = new Set(prev);
      alerts.forEach((a) => next.add(a.id));
      persist(READ_KEY, next);
      return next;
    });
  }, [alerts]);

  const dismiss = useCallback((id: number) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      persist(READ_KEY, next);
      return next;
    });
    setDismissedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      persist(DISMISSED_KEY, next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    const all = new Set(alerts.map((a) => a.id));
    setReadIds(all); persist(READ_KEY, all);
    setDismissedIds(all); persist(DISMISSED_KEY, all);
  }, [alerts]);

  return { alerts, visibleAlerts, unreadCount, markAllRead, dismiss, clearAll };
}
