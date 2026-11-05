import { useState } from 'react'

import { useApp } from '@/app/context/AppContext'
import { text } from '@/app/features/admin/consoleStyles'
import { AdminAccountsView, useAdminAccounts } from '@/app/features/admin/AdminAccountsView'
import { AdminPaymentChannelsView } from '@/app/features/admin/AdminPaymentChannelsView'
import { AdminSmtpView } from '@/app/features/admin/AdminSmtpView'
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

/**
 * The strip's order, and it is a contract rather than a layout detail: arrow keys
 * walk this array, so the order here is the order a keyboard reader travels. It
 * puts the overview first because that is the question an operator arrives with,
 * and the queue second because it is the daily work.
 */
const TAB_IDS: AdminTab[] = [
  'dashboard',
  'accounts',
  'transactions',
  'pricing',
  'payments',
  'contact',
  'integrations',
]

/** [Indonesia, English]. Kept beside the ids so adding a tab cannot ship a label in one language only. */
const TAB_LABELS: Record<AdminTab, [string, string]> = {
  dashboard: ['Ringkasan', 'Overview'],
  accounts: ['Akun', 'Accounts'],
  transactions: ['Antrean', 'Queue'],
  pricing: ['Harga', 'Pricing'],
  // Was "Pembayaran". Once a real payment queue exists, a tab called Payments that
  // opens bank-account settings is not merely vague, it points at the wrong thing.
  payments: ['Rekening', 'Destinations'],
  contact: ['Kontak', 'Contact'],
  integrations: ['Integrasi', 'Integrations'],
}

export function AdminView() {
  const { locale } = useApp()
  const isId = locale === 'id'
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const accounts = useAdminAccounts()
  const state = accounts.state

  /**
   * Roving focus for the tablist: arrows walk the strip, Home and End jump to its
   * ends, and selection follows focus.
   *
   * Seven tabs at `tabIndex={-1}` except the selected one is the ARIA pattern, and
   * it only holds if the arrows move between them. Without this the strip is a set
   * of seven tab stops the keyboard can reach but not traverse — `Tab` walks it one
   * press per tab and there is no way to get from the first section to the last
   * without visiting all seven. Focus is moved explicitly because React re-renders
   * the strip when `tab` changes; setting the tab alone would leave the caret on a
   * button that is no longer the selected one.
   */
  function moveSelection(next: AdminTab) {
    setTab(next)
    document.getElementById(`admin-tab-${next}`)?.focus()
  }

  function onTabListKeyDown(event: React.KeyboardEvent, from: AdminTab) {
    const index = TAB_IDS.indexOf(from)
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        moveSelection(TAB_IDS[(index + 1) % TAB_IDS.length])
        break
      case 'ArrowLeft':
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
            style={{
              fontSize: text.title,
              fontWeight: 600,
              margin: 0,
              fontFamily: 'var(--font-display)',
              color: 'var(--console-ink)',
            }}
          >
            {isId ? 'Konsol operator' : 'Operator console'}
          </h1>
          {state.kind === 'ready' && (
            /* The provenance is the fact: this person is an operator, and the
               tag only exists once the admin endpoint has answered 200 to them.
               Uppercase with wide tracking is not part of that fact — it is the
               tracked-caps tell, and it reads as a badge rather than a status.
               Sentence case, no letterspacing, and the same border as every
               other control edge on this screen. */
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: text.meta,
                color: 'var(--console-secondary)',
                border: '1px solid var(--control-border)',
                borderRadius: 3,
                padding: '3px 8px',
              }}
            >
              {isId ? 'Akses operator' : 'Operator access'}
            </span>
          )}
        </div>

        {state.kind === 'denied' ? (
          <GateSection isId={isId} />
        ) : (
          <>
            {/* Seven tabs, not seven routes. /admin is already an operational tool at
            its own URL with no sidebar entry, so a second URL would add routing and a
            nav element to solve a problem the page does not have. The order the
            arrows walk is `TAB_IDS`. */}
            <div
              role="tablist"
              aria-label={isId ? 'Bagian admin' : 'Admin sections'}
              style={{
                display: 'flex',
                gap: 4,
                borderBottom: '1px solid var(--border)',
                // Seven tabs are wider than a phone. Without wrapping the strip
                // scrolls inside itself and the last two sections are simply not
                // there — the operator cannot reach what they cannot see, and a
                // tab strip is not somewhere a reader expects to scroll.
                flexWrap: 'wrap',
              }}
            >
              {TAB_IDS.map((id) => (
                <button
                  key={id}
                  id={`admin-tab-${id}`}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  aria-controls={`admin-panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  onKeyDown={(event) => onTabListKeyDown(event, id)}
                  style={{
                    fontSize: text.body,
                    padding: '8px 12px',
                    minHeight: 32,
                    border: 'none',
                    // The accent marks selection here and nowhere else on this
                    // screen; it is not a status colour (see consoleStyles).
                    borderBottom: `2px solid ${tab === id ? 'var(--console-accent)' : 'transparent'}`,
                    background: 'transparent',
                    color: tab === id ? 'var(--console-ink)' : 'var(--console-secondary)',
                    // Weight as well as colour: a selected tab that differs only
                    // in hue is one a reader with low colour vision does not get.
                    fontWeight: tab === id ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {TAB_LABELS[id][isId ? 0 : 1]}
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
                {/* Both halves answer one operator question, "how does a customer
                    pay me", and they are kept in one place so the two lists a
                    payment screen reads cannot be maintained apart by accident. */}
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
                {/* The editor sits under the status it explains, in the same tab:
                    "what is wired up" and "what do I change" are one question to
                    an operator, and answering them two tabs apart is how the two
                    end up describing different installs. */}
                <div style={{ marginTop: 24 }}>
                  <AdminSmtpView />
                </div>
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
              fontSize: text.meta,
              color: 'var(--console-secondary)',
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
        border: '1px solid var(--control-border)',
        borderRadius: 'var(--radius)',
        padding: 20,
        maxWidth: 560,
        margin: '12px auto 0',
        width: '100%',
      }}
    >
      <h2 style={{ fontSize: text.heading, fontWeight: 600, margin: 0 }}>
        {isId ? 'Hanya untuk operator' : 'For operators'}
      </h2>
      {/* The server's verdict, kept in its own words. */}
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
