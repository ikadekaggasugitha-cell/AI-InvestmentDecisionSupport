import { Lock, Settings2, Sparkles } from 'lucide-react'

import type { Locale } from '@/app/i18n/translations'

/**
 * Why the paid data is not arriving.
 *
 * Deliberately three states. "Your subscription" and "the backend" and "we could
 * not find out" are different problems with different fixes, and a single
 * generic error collapses them into one — which is how an account without a
 * subscription ends up being told to check their connection.
 */
export type PaywallReason = 'subscription' | 'unknown'

interface Props {
  /** Which failure to report. Defaults to the subscription case. */
  reason?: PaywallReason
  locale?: Locale
  /** Opens Settings, where the subscription status can actually be read. */
  onOpenSettings: () => void
  /** `/bayar` is the in-app payment screen — gated on the session, not the
      entitlement, so the account that wants in can actually reach it. R-26
      barred a buy control only while no path existed; /bayar is that path. */
  onOpenPay?: () => void
  /** The labelled preview of the AI Advisor — what the subscription unlocks. */
  onOpenAdvisor?: () => void
}

const buttonBase: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '5px 10px',
  minHeight: 28,
  flexShrink: 0,
  borderRadius: 3,
  cursor: 'pointer',
}

/**
 * One banner in the shell, not a modal per view.
 *
 * Every paid panel refusing at once is one fact about the account, and saying it
 * eight times is a different kind of noise from saying it once. The subscription
 * case now carries three destinations, quiet to loud: Settings (the status),
 * the AI Advisor (what the money unlocks), and /bayar (the way out). The
 * `unknown` case still offers only Settings — offering to charge someone when
 * the server could not say whether they owe money is not an offer anyone can
 * act on.
 */
export function PaywallNotice({
  reason = 'subscription',
  locale = 'id',
  onOpenSettings,
  onOpenPay,
  onOpenAdvisor,
}: Props) {
  const isId = locale === 'id'

  const copy: Record<PaywallReason, { title: string; body: string }> = {
    subscription: isId
      ? {
          title: 'Analisis berbayar tidak aktif',
          body: 'Langganan Anda belum aktif, jadi sinyal, risiko, dan optimasi tidak ditampilkan. Data pasar tetap berjalan.',
        }
      : {
          title: 'Paid analysis is not active',
          body: 'Your subscription is not active, so signals, risk and optimisation are not shown. Market data keeps running.',
        },
    unknown: isId
      ? {
          title: 'Status tidak dapat dipastikan',
          body: 'Server tidak menjawab apakah langganan aktif. Angka di bawah berlabel simulasi sampai hal itu diketahui.',
        }
      : {
          title: 'Status could not be confirmed',
          body: 'The server did not say whether a subscription is active. Figures below stay labelled as simulated until that is known.',
        },
  }

  const { title, body } = copy[reason]

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
      style={{
        background: 'var(--warning-bg)',
        border: '1px solid var(--warning)',
        borderRadius: 'var(--radius)',
        padding: '8px 12px',
        margin: '0 16px',
      }}
    >
      <Lock size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} aria-hidden />
      <div style={{ flex: '1 1 300px', minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--muted-foreground)', marginLeft: 8 }}>
          {body}
        </span>
      </div>
      {/* Only the subscription case gets buy actions: it is the one state where
          payment can actually be the fix. The `unknown` case gets Settings alone. */}
      {reason === 'subscription' ? (
        <>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-1"
            title={isId ? 'Status langganan di Pengaturan' : 'Subscription status in Settings'}
            style={{ ...buttonBase, background: 'transparent', border: 'none' }}
          >
            <Settings2 size={11} aria-hidden />
            {isId ? 'Pengaturan' : 'Settings'}
          </button>
          {onOpenAdvisor && (
            <button
              type="button"
              onClick={onOpenAdvisor}
              className="flex items-center gap-1.5"
              style={{ ...buttonBase, background: 'transparent', border: '1px solid var(--control-border)' }}
            >
              <Sparkles size={11} aria-hidden />
              {isId ? 'Lihat AI Advisor' : 'Preview AI Advisor'}
            </button>
          )}
          {onOpenPay && (
            <button
              type="button"
              onClick={onOpenPay}
              style={{
                ...buttonBase,
                fontWeight: 700,
                color: 'var(--primary-foreground)',
                background: 'var(--primary)',
                border: 'none',
              }}
            >
              {isId ? 'Aktifkan langganan' : 'Subscribe'}
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={onOpenSettings}
          style={{ ...buttonBase, background: 'transparent', border: '1px solid var(--control-border)' }}
        >
          {isId ? 'Pengaturan' : 'Settings'}
        </button>
      )}
    </div>
  )
}
