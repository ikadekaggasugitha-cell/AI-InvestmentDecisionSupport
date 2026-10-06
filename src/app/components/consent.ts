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

export function clearConsent(accountId: string | null): void {
  const key = consentKey(accountId);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}