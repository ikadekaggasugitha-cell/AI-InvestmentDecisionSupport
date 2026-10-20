/**
 * Visitor plan intent: the price line someone picked on the public price
 * sheet before an account existed. Client-side only — no plan column exists
 * anywhere in the database, because the actual payment still takes its price
 * from the server inside the app (REK-26 keeps buy controls off public pages).
 * The intent only preselects: it survives a refresh through the `?plan=`
 * query, and after signup through localStorage, and is thrown away once the
 * person makes their own choice in the billing tab.
 */
export type PlanKey = "weekly" | "monthly" | "annual";

export const PLAN_KEYS: PlanKey[] = ["weekly", "monthly", "annual"];
const STORAGE_KEY = "aidss-plan-intent";

/** Reads a stored intent; unreadable storage and junk values mean "none". */
export function readPlanIntent(): PlanKey | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && PLAN_KEYS.includes(raw as PlanKey) ? (raw as PlanKey) : null;
  } catch {
    return null;
  }
}

/** Writes the intent; `null` throws it away. Storage failure is not an error:
 *  the URL still carries the plan for this session. */
export function writePlanIntent(plan: PlanKey | null): void {
  try {
    if (plan) localStorage.setItem(STORAGE_KEY, plan);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing persists; the sheet's click already put the plan in the URL */
  }
}

/** Parses `?plan=weekly…` off a signup URL. Unknown values are ignored, not
 *  invented — the plan vocabulary belongs to the server. */
export function planFromSearch(search: string): PlanKey | null {
  const value = new URLSearchParams(search).get("plan");
  return value && PLAN_KEYS.includes(value as PlanKey) ? (value as PlanKey) : null;
}
