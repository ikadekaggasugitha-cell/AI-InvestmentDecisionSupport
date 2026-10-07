/**
 * Reading and writing the Gate 2 acceptance.
 *
 * Separate from the component so a module exports either components or functions,
 * not both. Fast refresh then works: editing ConsentGate re-renders it instead of
 * invalidating the module graph for every importer.
 *
 * The acceptance is namespaced by account. It used to be one key with no user id,
 * so accepting once covered every account later used on that browser, which is
 * not what "you agreed to this" means.
 *
 * This marker decides whether the modal appears again. It is not the record: the
 * record is a row in `consent_acceptances`, written by POST /v1/auth/consent after
 * the person presses the button. Local storage is one browser's memory and can be
 * erased, so on its own it could never evidence that anybody accepted anything.
 */

const KEY_PREFIX = "aidss.disclaimerAcceptedAt";
const ACCEPT_LABEL_VERSION = "v1";

/** null when there is no account to bind the acceptance to. */
export function consentKey(accountId: string | null): string | null {
  return accountId ? `${KEY_PREFIX}:${accountId}:${ACCEPT_LABEL_VERSION}` : null;
}

export function hasAcceptedConsent(accountId: string | null): boolean {
  const key = consentKey(accountId);
  if (!key) return false;
  try {
    return !!window.localStorage.getItem(key);
  } catch {
    // Private-mode Safari and disabled storage both throw. Degrading to
    // "not accepted" re-prompts, which is the safe direction for a compliance gate.
    return false;
  }
}

export function writeConsent(accountId: string | null): void {
  const key = consentKey(accountId);
  if (!key) return;
  try {
    window.localStorage.setItem(key, new Date().toISOString());
  } catch {
    /* storage unavailable: the gate falls back to per-session state */
  }
}

/**
 * Report the acceptance to the server, so the acceptance exists somewhere that
 * survives the browser being cleared.
 *
 * Called *after* the local marker is written and never before: the person has
 * pressed the button by the time this runs, and if it fails the marker is already
 * in place. The failure is reported to the caller rather than swallowed, because
 * the honest consequence — this browser now has an acceptance the server does not
 * — is something the person can be told.
 *
 * Returns true when the server recorded it.
 */
export async function reportConsent(accountId: string | null): Promise<boolean> {
  if (!accountId) return false;
  const { ENDPOINTS, apiFetch } = await import("../config/api");
  try {
    const res = await apiFetch(ENDPOINTS.authConsent, { method: "POST" });
    return res.ok;
  } catch {
    // Offline, or the server unreachable. Not fatal to the person: the gate has
    // already been satisfied for this browser and they are not waiting on us.
    return false;
  }
}

export function clearConsent(accountId: string | null): void {
  const key = consentKey(accountId);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}