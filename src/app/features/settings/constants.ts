/* Vocabulary shared by the settings tabs. The notification keys are worded
   after the server; the payment methods are not here at all. */

export const STORAGE_NOTIF = 'aidss-notifications'

export type NotifKey = 'ai_signals' | 'risk_alerts' | 'corp_news'

/* No payment-method list lives here any longer. What a payer can choose is the
   server's answer at GET /v1/subscriptions/payment-channels, and the mapping to
   what the gateway is told lives in backend/api/services/channel_registry.py.
   A second copy of that list in the bundle would be a second answer, and the
   wrong one would be the file nobody looks at. */

const NOTIF_DEFAULT: Record<NotifKey, boolean> = {
  ai_signals: true,
  risk_alerts: true,
  corp_news: false,
}

export function readNotifPrefs(): Record<NotifKey, boolean> {
  try {
    const saved = localStorage.getItem(STORAGE_NOTIF)
    if (saved) return { ...NOTIF_DEFAULT, ...JSON.parse(saved) }
  } catch {
    /* unreadable storage falls back to defaults */
  }
  return NOTIF_DEFAULT
}
