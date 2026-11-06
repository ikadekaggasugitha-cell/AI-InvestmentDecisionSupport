import { useEffect, useState } from 'react'
import {
  Bell,
  ChevronDown,
  Globe,
  Inbox,
  Landmark,
  LayoutDashboard,
  Mail,
  Menu,
  PanelLeft,
  Plug,
  Tag,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'

import { useApp } from '@/app/context/AppContext'
import type { AuthState } from '@/app/features/identity/useAuth'
import {
  consoleHeaderStyle,
  consoleNavStyle,
  consoleSheetStyle,
  navBadgeStyle,
  navDotStyle,
  navItemStyle,
  navTooltipStyle,
  text,
} from '@/app/features/admin/consoleStyles'
import { AdminAccountsView, useAdminAccounts } from '@/app/features/admin/AdminAccountsView'
import { AdminProfilePopup } from '@/app/features/admin/AdminProfilePopup'
import { AdminPaymentChannelsView } from '@/app/features/admin/AdminPaymentChannelsView'
import { AdminSmtpView } from '@/app/features/admin/AdminSmtpView'
import { AdminBankAccountsView } from '@/app/features/admin/AdminBankAccountsView'
import { AdminContactView } from '@/app/features/admin/AdminContactView'
import { AdminDashboardView } from '@/app/features/admin/AdminDashboardView'
import { AdminIntegrationsView } from '@/app/features/admin/AdminIntegrationsView'
import { AdminPricingView } from '@/app/features/admin/AdminPricingView'
import { AdminTransactionsView } from '@/app/features/admin/AdminTransactionsView'
import { useAdminOverview } from '@/app/features/admin/useAdminOverview'
import logoUrl from '@/assets/aidss-logo.svg'

/**
 * The console shell. A neutral near-black top bar (logo + notification + operator
 * identity, no global search), and a floating, frosted-glass icon sidebar that
 * collapses to icons with hover tooltips. The page sits on a soft gradient so the
 * glass reads; the content cards stay flat white on top.
 *
 * The chrome changed; the contract did not. The sidebar is still the roving
 * `role="tablist"` the keyboard test walks, each item is a `role="tab"` whose
 * accessible name is exactly its label (icons aria-hidden; the queue count lives
 * on the header bell, never inside a tab), and every panel is still keyed by
 * `id="admin-panel-<name>"` so the accent dose-cap reads the pairing here. A 403
 * replaces the whole console, tablist included.
 */

type AdminTab =
  'dashboard' | 'accounts' | 'transactions' | 'pricing' | 'payments' | 'contact' | 'integrations'

const TAB_IDS: AdminTab[] = [
  'dashboard',
  'accounts',
  'transactions',
  'pricing',
  'payments',
  'contact',
  'integrations',
]

const TAB_LABELS: Record<AdminTab, [string, string]> = {
  dashboard: ['Ringkasan', 'Overview'],
  accounts: ['Akun', 'Accounts'],
  transactions: ['Antrean', 'Queue'],
  pricing: ['Harga', 'Pricing'],
  payments: ['Rekening', 'Destinations'],
  contact: ['Kontak', 'Contact'],
  integrations: ['Integrasi', 'Integrations'],
}

const TAB_ICONS: Record<AdminTab, LucideIcon> = {
  dashboard: LayoutDashboard,
  accounts: Users,
  transactions: Inbox,
  pricing: Tag,
  payments: Landmark,
  contact: Mail,
  integrations: Plug,
}

const HEADER_HEIGHT = 56

/**
 * How often the shell re-asks for the overview quietly. One minute: long enough
 * that an idle console costs almost nothing, short enough that a transfer
 * declared while the operator read another tab is announced before they finish
 * the page they are on.
 */
const OVERVIEW_POLL_MS = 60_000

/**
 * The pending count the operator last saw in the queue, in their own browser.
 * It is display state, not money: the server stays the authority on the queue,
 * and clearing this key changes nothing except whether the dot is lit.
 */
const QUEUE_SEEN_KEY = 'aidss-admin-queue-seen'

function readQueueSeen(): number | null {
  const raw = localStorage.getItem(QUEUE_SEEN_KEY)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : null
}

const headerIconButton: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: 'var(--radius)',
  border: 'none',
  background: 'transparent',
  color: 'var(--console-header-ink)',
  cursor: 'pointer',
}

const identityLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--console-header-ink)',
  fontSize: text.control,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

/** The same chip, asked to behave as a button: it opens a popup, not a page. */
const identityChipStyle: React.CSSProperties = {
  ...identityLinkStyle,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
  padding: '0 4px',
}

export function AdminView({ auth }: { auth: AuthState }) {
  const { locale, setLocale } = useApp()
  const isId = locale === 'id'
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const accounts = useAdminAccounts()
  const overview = useAdminOverview(OVERVIEW_POLL_MS)
  const state = accounts.state

  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  )
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [hovered, setHovered] = useState<AdminTab | null>(null)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isMobile = width < 768
  const pendingQueue = overview.state.kind === 'ready' ? overview.state.figures.pendingQueue : null

  const [queueSeen, setQueueSeen] = useState<number | null>(() => readQueueSeen())

  // A first read with no stored baseline counts the current backlog as seen:
  // the dot answers "what arrived since you last looked", not "the queue is
  // not empty". The number on the bell already says the second thing.
  useEffect(() => {
    if (pendingQueue !== null && queueSeen === null) {
      setQueueSeen(pendingQueue)
      localStorage.setItem(QUEUE_SEEN_KEY, String(pendingQueue))
    }
  }, [pendingQueue, queueSeen])

  // Opening the queue is the act of seeing. The baseline moves to whatever the
  // server now reports, and it moves in storage too, so a reload does not
  // resurrect a dot for transfers that were already adjudicated from this
  // browser.
  useEffect(() => {
    if (tab === 'transactions' && pendingQueue !== null && pendingQueue !== queueSeen) {
      setQueueSeen(pendingQueue)
      localStorage.setItem(QUEUE_SEEN_KEY, String(pendingQueue))
    }
  }, [tab, pendingQueue, queueSeen])

  const newQueue =
    pendingQueue !== null && queueSeen !== null ? Math.max(0, pendingQueue - queueSeen) : 0

  function moveSelection(next: AdminTab) {
    setTab(next)
    document.getElementById(`admin-tab-${next}`)?.focus()
  }

  function onTabListKeyDown(event: React.KeyboardEvent, from: AdminTab) {
    const index = TAB_IDS.indexOf(from)
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveSelection(TAB_IDS[(index + 1) % TAB_IDS.length])
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveSelection(TAB_IDS[(index - 1 + TAB_IDS.length) % TAB_IDS.length])
        break
      case 'Home':
        event.preventDefault()
        moveSelection(TAB_IDS[0])
        break
      case 'End':
        event.preventDefault()
        moveSelection(TAB_IDS[TAB_IDS.length - 1])
        break
    }
  }

  function openTab(next: AdminTab) {
    setTab(next)
    if (isMobile) setDrawerOpen(false)
  }

  const header = (
    <header style={consoleHeaderStyle}>
      {isMobile && (
        <button
          type="button"
          aria-label={isId ? 'Tampilkan navigasi' : 'Show navigation'}
          onClick={() => setDrawerOpen((v) => !v)}
          style={headerIconButton}
        >
          <Menu size={20} strokeWidth={1.9} aria-hidden focusable={false} />
        </button>
      )}

      {/* The logo lockup already carries the wordmark; no duplicate text. */}
      <img src={logoUrl} alt="AIDSS" style={{ height: 30, width: 'auto', display: 'block' }} />

      <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          aria-label={
            newQueue > 0
              ? isId
                ? `Buka antrean pembayaran, ${newQueue} transfer baru`
                : `Open the payment queue, ${newQueue} new transfers`
              : isId
                ? 'Buka antrean pembayaran'
                : 'Open the payment queue'
          }
          onClick={() => openTab('transactions')}
          style={headerIconButton}
        >
          <Bell size={20} strokeWidth={1.9} aria-hidden focusable={false} />
          {pendingQueue != null && pendingQueue > 0 && (
            <span style={{ ...navBadgeStyle, position: 'absolute', top: 2, right: 2 }}>
              {pendingQueue}
            </span>
          )}
        </button>
        {/* The operator's own account. This chip used to be a link straight to
            the market dashboard, which made it a door with no room behind it:
            there was no way to ask who is signed in, and no way inside the
            console to change the operator's own name, address or password. It
            now opens the profile popup, and the market page is one of the two
            choices inside it. */}
        <button
          type="button"
          aria-label={isId ? 'Buka menu profil' : 'Open the profile menu'}
          aria-haspopup="dialog"
          aria-expanded={profileOpen}
          onClick={() => setProfileOpen(true)}
          style={identityChipStyle}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.06)',
            }}
          >
            <User size={16} strokeWidth={1.9} aria-hidden />
          </span>
          Operator
        </button>
      </div>
    </header>
  )

  const nav = (
    <aside
      style={{
        ...consoleNavStyle,
        overflow: 'visible',
        width: isMobile ? 256 : collapsed ? 80 : 256,
        position: isMobile ? 'fixed' : 'sticky',
        top: isMobile ? HEADER_HEIGHT : HEADER_HEIGHT + 1,
        bottom: isMobile ? 0 : undefined,
        left: isMobile ? 0 : undefined,
        maxHeight: isMobile ? undefined : 'calc(100vh - 73px)',
        zIndex: isMobile ? 40 : 5,
        display: isMobile && !drawerOpen ? 'none' : 'flex',
      }}
    >
      {!isMobile && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 2px 8px' }}>
          <button
            type="button"
            aria-label={isId ? 'Ciutkan atau lebarkan menu' : 'Collapse or expand menu'}
            onClick={() => setCollapsed((v) => !v)}
            style={{
              ...headerIconButton,
              width: 32,
              height: 32,
              color: 'var(--console-nav-ink)',
            }}
          >
            <PanelLeft size={18} strokeWidth={1.9} aria-hidden focusable={false} />
          </button>
        </div>
      )}

      <div
        role="tablist"
        aria-label={isId ? 'Bagian admin' : 'Admin sections'}
        aria-orientation="vertical"
        style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}
      >
        {TAB_IDS.map((id) => {
          const Icon = TAB_ICONS[id]
          const active = tab === id
          const label = TAB_LABELS[id][isId ? 0 : 1]
          return (
            <span
              key={id}
              style={{ position: 'relative', display: 'block' }}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
            >
              <button
                id={`admin-tab-${id}`}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls={`admin-panel-${id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => openTab(id)}
                onKeyDown={(event) => onTabListKeyDown(event, id)}
                title={label}
                style={navItemStyle(active)}
              >
                <Icon size={18} strokeWidth={1.9} aria-hidden focusable={false} />
                {(!collapsed || isMobile) && <span>{label}</span>}
              </button>
              {collapsed && !isMobile && hovered === id && (
                <span style={navTooltipStyle}>{label}</span>
              )}
              {id === 'transactions' && newQueue > 0 && tab !== 'transactions' && (
                // Unseen arrivals ride the tab icon. aria-hidden: the tab's
                // accessible name must stay exactly its label, which the
                // keyboard test compares; the count lives on the bell.
                <span data-queue-new="true" aria-hidden style={navDotStyle} />
              )}
            </span>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => setLocale(isId ? 'en' : 'id')}
        style={{
          ...navItemStyle(false),
          marginTop: 'auto',
          minHeight: 44,
          color: 'var(--console-nav-ink)',
        }}
      >
        <Globe size={18} strokeWidth={1.9} aria-hidden focusable={false} />
        {(!collapsed || isMobile) && (
          <>
            <span style={{ flex: 1 }}>{isId ? 'Indonesia' : 'English'}</span>
            <ChevronDown size={14} strokeWidth={1.9} aria-hidden />
          </>
        )}
      </button>
    </aside>
  )

  /* Denied: a doorway, not a console. No tablist, one way back. */
  if (state.kind === 'denied') {
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100dvh',
          background: 'var(--console-page)',
        }}
      >
        <header style={consoleHeaderStyle}>
          <img src={logoUrl} alt="AIDSS" style={{ height: 30, width: 'auto', display: 'block' }} />
        </header>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <GateSection isId={isId} />
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        background: 'var(--console-page)',
      }}
    >
      {header}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {nav}
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 8px 8px' }}>
          <div style={consoleSheetStyle}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                marginBottom: 4,
              }}
            >
              {/* The heading names the module the operator is standing in, not
                  the console as a whole; "Konsol operator" above every tab said
                  nothing the sidebar had not already said. (owner direction) */}
              <h1
                style={{
                  fontSize: text.title,
                  fontWeight: 700,
                  margin: 0,
                  fontFamily: 'var(--font-console)',
                  color: 'var(--console-ink)',
                }}
              >
                {TAB_LABELS[tab][isId ? 0 : 1]}
              </h1>
              {state.kind === 'ready' && (
                <span
                  style={{
                    fontFamily: 'var(--font-console)',
                    fontSize: text.meta,
                    fontWeight: 600,
                    color: 'var(--console-accent)',
                    background: 'var(--console-accent-quiet)',
                    border: '1px solid transparent',
                    borderRadius: 999,
                    padding: '4px 12px',
                  }}
                >
                  {isId ? 'Akses operator' : 'Operator access'}
                </span>
              )}
            </div>

            {tab === 'dashboard' ? (
              <div id="admin-panel-dashboard" role="tabpanel" aria-labelledby="admin-tab-dashboard">
                <AdminDashboardView
                  state={overview.state}
                  refreshing={overview.refreshing}
                  onReload={overview.reload}
                  onOpenQueue={() => setTab('transactions')}
                />
              </div>
            ) : tab === 'transactions' ? (
              <div
                id="admin-panel-transactions"
                role="tabpanel"
                aria-labelledby="admin-tab-transactions"
              >
                <AdminTransactionsView />
              </div>
            ) : tab === 'pricing' ? (
              <div id="admin-panel-pricing" role="tabpanel" aria-labelledby="admin-tab-pricing">
                <AdminPricingView />
              </div>
            ) : tab === 'payments' ? (
              <div id="admin-panel-payments" role="tabpanel" aria-labelledby="admin-tab-payments">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                  <AdminBankAccountsView />
                  <AdminPaymentChannelsView />
                </div>
              </div>
            ) : tab === 'contact' ? (
              <div id="admin-panel-contact" role="tabpanel" aria-labelledby="admin-tab-contact">
                <AdminContactView />
              </div>
            ) : tab === 'integrations' ? (
              <div
                id="admin-panel-integrations"
                role="tabpanel"
                aria-labelledby="admin-tab-integrations"
              >
                <AdminIntegrationsView />
                <div style={{ marginTop: 24 }}>
                  <AdminSmtpView />
                </div>
              </div>
            ) : tab === 'accounts' ? (
              <div id="admin-panel-accounts" role="tabpanel" aria-labelledby="admin-tab-accounts">
                <AdminAccountsView accounts={accounts} />
              </div>
            ) : null}

            {profileOpen && <AdminProfilePopup onClose={() => setProfileOpen(false)} auth={auth} />}

            {/* No footer. It carried the AIDSS lockup and the words "Konsol
                operator" under every tab; the header already shows the logo
                and the h1 already names the module, so the strip repeated two
                facts and nothing else (owner direction). */}
          </div>
        </main>
      </div>
    </div>
  )
}

/**
 * The 403 gate. A non-admin who reaches /admin gets a doorway that says who may
 * pass, what is behind it, and one way back — not a table pretending to be empty.
 */
function GateSection({ isId }: { isId: boolean }) {
  const topics = isId
    ? ['Kontrol akun pengguna', 'Tetapan harga tiga paket', 'Verifikasi pembayaran transfer']
    : ['User account controls', 'The three plan prices', 'Manual transfer verification']
  return (
    <section
      style={{
        background: 'var(--card)',
        border: '1px solid var(--control-border)',
        borderRadius: 'var(--radius)',
        padding: 20,
        maxWidth: 560,
        margin: '12px auto 0',
        width: '100%',
      }}
    >
      <h2 style={{ fontSize: text.heading, fontWeight: 700, margin: 0 }}>
        {isId ? 'Hanya untuk operator' : 'For operators'}
      </h2>
      <p
        style={{
          fontSize: text.control,
          lineHeight: 1.6,
          color: 'var(--foreground)',
          margin: '10px 0 0',
        }}
      >
        {isId
          ? 'Hanya administrator yang bisa melihat daftar akun.'
          : 'Only an administrator can see the account list.'}
      </p>
      <ul
        style={{
          margin: '14px 0 0',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          fontSize: text.control,
          color: 'var(--foreground)',
        }}
      >
        {topics.map((topic) => (
          <li key={topic} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            {topic}
          </li>
        ))}
      </ul>
      <a
        href="/"
        className="auth-control"
        style={{
          display: 'inline-block',
          marginTop: 16,
          padding: '8px 14px',
          fontSize: text.control,
          color: 'var(--foreground)',
          border: '1px solid var(--control-border)',
          borderRadius: 'var(--radius)',
          textDecoration: 'none',
          background: 'var(--background)',
        }}
      >
        {isId ? 'Kembali ke aplikasi' : 'Back to the app'}
      </a>
    </section>
  )
}
