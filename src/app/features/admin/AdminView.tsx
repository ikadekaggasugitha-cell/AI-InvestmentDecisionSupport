import { useState } from 'react'

import { useApp } from '@/app/context/AppContext'
import { AdminAccountsView, useAdminAccounts } from '@/app/features/admin/AdminAccountsView'
import { AdminBankAccountsView } from '@/app/features/admin/AdminBankAccountsView'
import { AdminContactView } from '@/app/features/admin/AdminContactView'
import { AdminDashboardView } from '@/app/features/admin/AdminDashboardView'
import { AdminIntegrationsView } from '@/app/features/admin/AdminIntegrationsView'
import { AdminPricingView } from '@/app/features/admin/AdminPricingView'
import { AdminTransactionsView } from '@/app/features/admin/AdminTransactionsView'
import logoUrl from '@/assets/aidss-logo.svg'

/**
 * The console's shell: the operator gate, the tab strip, and the footer.
 *
 * Reached at its own URL (`/admin`) rather than from the sidebar. That is a
 * deliberate choice and not an omission: this is an operational tool, not a place
 * people live, and a permanent entry in the main navigation would put "manage every
 * account in the system" one click away on every screen. The backend refuses
 * non-admins with 403 regardless — this is about who can *find* the page, not who
 * can use it.
 *
 * The one piece of data the shell owns is the account list's load state, because
 * that read is also the probe that answers "is this person an operator at all":
 * the gate screen and the `OPERATOR ACCESS` tag both hang on it. The list itself,
 * its columns and its row actions live in `AdminAccountsView`, which receives
 * that state rather than issuing a second read.
 */

type AdminTab =
  'dashboard' | 'accounts' | 'transactions' | 'pricing' | 'payments' | 'contact' | 'integrations'

export function AdminView() {
  const { locale } = useApp()
  const isId = locale === 'id'
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const accounts = useAdminAccounts()
  const state = accounts.state

  return (
    <div className="min-h-0 flex-1" style={{ overflowY: 'auto', padding: 24 }}>
      <div
        style={{
          maxWidth: 1080,
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* The page names itself once, and the operator's provenance sits on the
            same row, not above the name like a label. Never worn by a visitor:
            the tag appears only after the admin endpoint has answered 200 to
            this person's key. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <h1
            style={{ fontSize: 20, fontWeight: 600, margin: 0, fontFamily: 'var(--font-display)' }}
          >
            {isId ? 'Konsol operator' : 'Operator console'}
          </h1>
          {state.kind === 'ready' && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.08em',
                color: 'var(--muted-foreground)',
                border: '1px solid var(--control-border)',
                borderRadius: 3,
                padding: '3px 8px',
              }}
            >
              OPERATOR ACCESS
            </span>
          )}
        </div>

        {state.kind === 'denied' ? (
          <GateSection isId={isId} />
        ) : (
          <>
            {/* Seven tabs, not seven routes. /admin is already an operational tool at
            its own URL with no sidebar entry, so a second URL would add routing and a
            nav element to solve a problem the page does not have. The overview
            opens because it is the question an operator arrives with; the queue
            sits second as the daily work. */}
            <div
              role="tablist"
              aria-label={isId ? 'Bagian admin' : 'Admin sections'}
              style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}
            >
              {(
                [
                  ['dashboard', isId ? 'Ringkasan' : 'Overview'],
                  ['accounts', isId ? 'Akun' : 'Accounts'],
                  ['transactions', isId ? 'Antrean' : 'Queue'],
                  ['pricing', isId ? 'Harga' : 'Pricing'],
                  // Was "Pembayaran". Once a real payment queue exists, a tab
                  // called Payments that opens bank-account settings is not
                  // merely vague, it points at the wrong thing.
                  ['payments', isId ? 'Rekening' : 'Destinations'],
                  ['contact', isId ? 'Kontak' : 'Contact'],
                  ['integrations', isId ? 'Integrasi' : 'Integrations'],
                ] as [AdminTab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  id={`admin-tab-${id}`}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  aria-controls={`admin-panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  style={{
                    fontSize: 12,
                    padding: '8px 12px',
                    border: 'none',
                    borderBottom: `2px solid ${tab === id ? 'var(--primary)' : 'transparent'}`,
                    background: 'transparent',
                    color: tab === id ? 'var(--foreground)' : 'var(--muted-foreground)',
                    fontWeight: tab === id ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'dashboard' ? (
              <div id="admin-panel-dashboard" role="tabpanel" aria-labelledby="admin-tab-dashboard">
                <AdminDashboardView onOpenQueue={() => setTab('transactions')} />
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
                <AdminBankAccountsView />
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
              </div>
            ) : tab === 'accounts' ? (
              <div id="admin-panel-accounts" role="tabpanel" aria-labelledby="admin-tab-accounts">
                <AdminAccountsView accounts={accounts} />
              </div>
            ) : null}
          </>
        )}

        {/* The page's height is its data's height: a short fixture (this one has
            an account and a blocked admin) ends where it ends, and a full
            25-row page fills this ground. No spacer and no invented volume to
            make the canvas look busy. The footer closes the grid at the edge
            the content reaches. */}
        <div style={{ height: '32px' }} />
        <footer
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '16px',
            borderTop: '1px solid var(--border)',
            paddingTop: '12px',
          }}
        >
          <span className="brand-chip">
            <img
              src={logoUrl}
              alt="AIDSS"
              style={{ height: 14, width: 'auto', display: 'block' }}
            />
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--muted-foreground)',
            }}
          >
            {isId ? 'Konsol operator' : 'Operator console'}
          </span>
        </footer>
      </div>
    </div>
  )
}

/**
 * The 403 gate. A non-admin who reaches /admin gets a doorway that says who
 * may pass, what is behind it, and one way back, not a table pretending to be
 * empty and not a control for a page that never opens.
 */
function GateSection({ isId }: { isId: boolean }) {
  // The three things the console actually does, named for the visitor the
  // server just refused: the same surface an operator would open, described.
  const topics = isId
    ? ['Kontrol akun pengguna', 'Tetapan harga tiga paket', 'Verifikasi pembayaran transfer']
    : ['User account controls', 'The three plan prices', 'Manual transfer verification']
  return (
    <section
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 20,
        maxWidth: 560,
        margin: '12px auto 0',
        width: '100%',
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
        {isId ? 'Hanya untuk operator' : 'For operators'}
      </h2>
      {/* The server's verdict, kept in its own words. */}
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--foreground)', margin: '10px 0 0' }}>
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
          fontSize: 14,
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
          fontSize: 14,
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
