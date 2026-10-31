/* Vocabulary shared by the settings tabs. The notification keys and the
   payment methods are deliberately worded after the server, not invented here. */

export const STORAGE_NOTIF = 'aidss-notifications'

export type NotifKey = 'ai_signals' | 'risk_alerts' | 'corp_news'

/** Where a transfer can go, word for word the server's vocabulary. */
export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'qris', label: 'QRIS' },
  { value: 'va_bca', label: 'Virtual Account BCA' },
  { value: 'va_mandiri', label: 'Virtual Account Mandiri' },
  { value: 'bank_transfer', label: 'Transfer bank' },
]

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
