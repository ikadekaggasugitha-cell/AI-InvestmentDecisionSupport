import { useState, type KeyboardEvent } from 'react'
import { useApp } from '@/app/context/AppContext'
import type { AuthState } from '@/app/features/identity/useAuth'
import type { ExchangeRateData } from '@/app/features/market/useExchangeRate'
import type { DataFreshness } from '@/app/features/market/useLiveMarket'
import { TabProfile } from '@/app/features/settings/TabProfile'
import { TabSubscription } from '@/app/features/settings/TabSubscription'
import { TabAppearance } from '@/app/features/settings/TabAppearance'
import { TabNotifications } from '@/app/features/settings/TabNotifications'
import { TabAbout } from '@/app/features/settings/TabAbout'

/*
 * Settings, per docs/settings-module-spec.md v1.1.0.
 *
 * Implements the tab architecture the spec defines, using only tokens that
 * already exist in src/styles/theme.css. No new colour, typeface, radius or
 * icon was introduced; the logo itself was named by the owner on 2026-10-26
 * (see docs/DESIGN.md) after this screen shipped without one.
 *
 * This file is the tab shell: state for which tab is open and the WAI-ARIA
 * tablist. Each tab's body lives beside it — TabProfile, TabSubscription,
 * TabAppearance, TabNotifications, TabAbout — sharing the primitives in
 * tabPrimitives.tsx.
 *
 * Tab 2 (Subscription) reads the price, the account's own payment attempts and
 * the public bank-account list. Declaring a manual transfer needs the
 * destination from the server — a number typed into the client would be a
 * destination the server never honoured — and a waiting payment must be
 * findable, because "where is my payment" has to have an answer.
 * Appearance, Notifications and About read state that genuinely exists.
 */

type TabId = 'profile' | 'billing' | 'appearance' | 'notifications' | 'about'

interface Props {
  fx: ExchangeRateData
  /** Feed state, so About reports what the prices actually are. */
  freshness?: DataFreshness
  /** The signed-in account, for the Profile tab and the sign-out control. */
  auth: AuthState
  onSignedOut: () => void
}

export function SettingsView({ fx, freshness, auth, onSignedOut }: Props) {
  const { isDark, toggleTheme, locale, toggleLocale } = useApp()
  const id = locale === 'id'
  const [tab, setTab] = useState<TabId>('appearance')

  const TABS: { id: TabId; label: string; en: string }[] = [
    { id: 'profile', label: 'Profil & Akun', en: 'Profile & Account' },
    { id: 'billing', label: 'Langganan & Tagihan', en: 'Subscription & Billing' },
    { id: 'appearance', label: 'Tampilan', en: 'Appearance' },
    { id: 'notifications', label: 'Notifikasi', en: 'Notifications' },
    { id: 'about', label: 'Tentang', en: 'About' },
  ]

  /* WAI-ARIA puts arrow-key navigation on the tablist, not on the document: the
     pattern expects Left/Right to move between tabs and to take focus with them.
     Nothing provided that here — the tabs were plain buttons, so reaching the last
     tab by keyboard meant Tab-ing past every intermediate one. Only the active tab
     is in the tab order, which is why the rest carry tabIndex={-1}. */
  const onTabKeyDown = (e: KeyboardEvent, index: number) => {
    const offsets: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: TABS.length - 1,
    }
    const next = offsets[e.key]
    if (next === undefined) return
    e.preventDefault()
    // Wrap at both ends: a horizontal tablist has no first or last tab to stop on.
    const target = TABS[(next + TABS.length) % TABS.length]
    setTab(target.id)
    document.getElementById(`tab-${target.id}`)?.focus()
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto flex flex-col [&>*]:shrink-0"
      style={{ padding: 24, gap: 20, maxWidth: 720 }}
    >
      {/* No page heading here on purpose: App.tsx renders the view title and
          subtitle in Header, so an h2 in this view printed the same two lines
          twice. */}

      {/* Tab bar. Text labels only: an icon here would restate the label.
          Scrolls horizontally on narrow screens so no tab is ever clipped. */}
      <div
        role="tablist"
        aria-label={id ? 'Bagian pengaturan' : 'Settings sections'}
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--surface-hairline)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {TABS.map((t, index) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onKeyDown={(e) => onTabKeyDown(e, index)}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 12px',
                minHeight: 44,
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                color: active ? 'var(--primary)' : 'var(--muted-foreground)',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
                cursor: 'pointer',
                transition: 'color 0.1s, border-color 0.1s',
              }}
            >
              {id ? t.label : t.en}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'profile' && <TabProfile id={id} auth={auth} onSignedOut={onSignedOut} />}
        {tab === 'billing' && <TabSubscription id={id} />}
        {tab === 'appearance' && (
          <TabAppearance
            id={id}
            isDark={isDark}
            onToggleTheme={toggleTheme}
            locale={locale}
            onToggleLocale={toggleLocale}
            fx={fx}
          />
        )}
        {tab === 'notifications' && <TabNotifications id={id} />}
        {tab === 'about' && <TabAbout id={id} fx={fx} freshness={freshness} />}
      </div>
    </div>
  )
}
