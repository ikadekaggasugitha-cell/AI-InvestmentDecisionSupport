import { useCallback, useEffect, useState } from 'react'

import { GrantPeriodDialog } from '@/app/features/admin/GrantPeriodDialog'
import { ENDPOINTS, apiFetch } from '@/app/config/api'
import { useApp } from '@/app/context/AppContext'
import {
  mono,
  monoCell,
  rowActionStyle,
  searchStyle,
  sectionNoteStyle,
  td,
  tdMeta,
  text,
  th,
} from '@/app/features/admin/consoleStyles'

/**
 * The account list: what the server holds, blocking and unblocking, and granting
 * a period without a payment in front of it.
 *
 * Split into `useAdminAccounts` (the read and the two writes) and
 * `AdminAccountsView` (the table and the dialogs). The split is not decoration:
 * the console's own gate — is this person an operator at all — is decided by the
 * answer this read gives, so the shell has to hold the state while the table that
 * renders it lives here. Keeping both in the shell is what left `AdminView.tsx`
 * at 574 lines for one table.
 *
 * Nothing here is invented. Every field on a row comes from the server, and the
 * two columns that took a join to add (the period's end, the reason a block was
 * placed) still come from one statement.
 *
 * What is deliberately *not* here is a plan column. `subscriptions` stores a
 * user and an end date and nothing else (ADR-0002), so there is no plan on a
 * period to show. The nearest real fact is the plan on the last settled
 * transaction, which answers "what did they last pay for" — a different question
 * from the one a column headed "Paket" would be read as answering, especially for
 * an account whose period came from an operator's grant instead of money.
 */

export interface AdminAccount {
  id: string
  email: string
  full_name: string
  phone_number: string
  role: string
  blocked: boolean
  blocked_at: string | null
  // Which kind of closure this is, because the two have different openers:
  // payment reopens 'subscription_expired', only this screen's unblock reopens
  // 'admin' (ADR-0012). The server sends exactly those two values or none.
  blocked_reason: string | null
  // When the account's furthest known period ends. Display only — the
  // entitlement check is still the only thing that decides access.
  subscriptionExpiresAt: string | null
}

export interface AccountsPage {
  accounts: AdminAccount[]
  hasMore: boolean
}

export const PAGE_SIZE = 25

export type AccountsState =
  | { kind: 'loading' }
  | { kind: 'ready'; page: AccountsPage; offset: number }
  | { kind: 'denied' }
  | { kind: 'error'; message: string }

/**
 * The three ways the operator can cut the list.
 *
 * This is the screen's word for a predicate the database only spells as
 * `blocked_at IS (NOT) NULL`. It deliberately is not the *reason* a row is
 * closed: which kind of closure it is already has its own column and its own
 * subline, and making that a filter would put a second copy of the decision
 * about what those two words mean somewhere other than ADR-0012.
 */
export type AccountFilter = 'all' | 'active' | 'blocked'

const FILTERS: AccountFilter[] = ['all', 'active', 'blocked']

const FILTER_LABEL: Record<AccountFilter, { id: string; en: string }> = {
  all: { id: 'Semua', en: 'All' },
  active: { id: 'Aktif', en: 'Active' },
  blocked: { id: 'Diblokir', en: 'Blocked' },
}

/** How long the search field waits before asking the server.
 *
 * Long enough that typing a whole address is one read rather than eleven, short
 * enough that the table still feels like it is answering the operator. */
const SEARCH_DEBOUNCE_MS = 300

export interface AdminAccountsApi {
  state: AccountsState
  /** The account being acted on, so exactly one row shows progress and a failure
   *  cannot leave every row looking busy. */
  pending: string | null
  actionError: string | null
  /** The account whose "beri masa aktif" dialog is open. */
  granting: AdminAccount | null
  openGrant: (account: AdminAccount) => void
  closeGrant: () => void
  act: (accountId: string, blocked: boolean) => Promise<void>
  reload: (offset?: number) => Promise<void>
  /** What is in the search field right now, including a half-typed word. */
  query: string
  setQuery: (value: string) => void
  /** The term the list on screen was actually read with. It can lag the field by
   *  one debounce, which is why the readout describes the list and not the box. */
  appliedQuery: string
  filter: AccountFilter
  setFilter: (value: AccountFilter) => void
  /** Whether anything is being filtered at all. Decides how an empty table is
   *  worded: "nobody matches this" is a different fact from "there is nobody". */
  filtering: boolean
}

/**
 * The account list's read and its two writes.
 *
 * The read doubles as the console's operator probe: a 403 here is what turns the
 * whole console into the gate screen, and the `OPERATOR ACCESS` tag is only worn
 * after this endpoint has answered 200. That is why the state lives in a hook the
 * shell calls rather than inside the table — the table is only one of the things
 * that answer depends on.
 *
 * The search term and the state filter go to the server; they are not applied to
 * `page.accounts` afterwards. A list cut in the browser answers "there is nobody
 * here" about the twenty-five rows this page happens to hold, which is how an
 * account gets reported missing while it sits one page down.
 */
export function useAdminAccounts(): AdminAccountsApi {
  const { locale } = useApp()
  const isId = locale === 'id'
  const [state, setState] = useState<AccountsState>({ kind: 'loading' })
  const [pending, setPending] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [granting, setGranting] = useState<AdminAccount | null>(null)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [filter, setFilter] = useState<AccountFilter>('all')

  const load = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setState({ kind: 'loading' })
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (appliedQuery) params.set('q', appliedQuery)
      if (filter !== 'all') params.set('state', filter)
      try {
        const res = await apiFetch(
          `${ENDPOINTS.adminAccounts}?${params.toString()}`,
          signal ? { signal } : undefined,
        )
        if (res.status === 403) {
          // Neither an empty list nor a generic failure. The endpoint answered,
          // and the answer is that this person may not see it, so the page
          // becomes the gate screen rather than a table with a note inside it.
          setState({ kind: 'denied' })
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setState({ kind: 'ready', page: await res.json(), offset })
      } catch {
        if (signal?.aborted) return
        // "We could not ask" is not "there is nothing". Showing an empty table here
        // would tell someone whose accounts are all there that they have none.
        setState({
          kind: 'error',
          message: isId
            ? 'Daftar akun tidak dapat dimuat. Ini bukan berarti tidak ada akun.'
            : 'The account list could not be loaded. That does not mean there are no accounts.',
        })
      }
    },
    [isId, appliedQuery, filter],
  )

  // The field trims into the term that is asked for. Trimming happens here so a
  // field holding only spaces reads as "no search", the same way the endpoint's
  // own empty-parameter rule does.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // One effect covers the first read and every filter change after it, because
  // `load` changes identity when the term or the filter does. A second,
  // mount-only read would fire beside this one on the first paint, and two
  // reads of one list is how a page shows one filter's answer under another
  // filter's heading. Both start at offset 0: the third page of a list that no
  // longer matches is an empty page pretending to be "no results".
  useEffect(() => {
    const controller = new AbortController()
    void load(0, controller.signal)
    return () => controller.abort()
  }, [load])

  const act = useCallback(
    async (accountId: string, blocked: boolean) => {
      setPending(accountId)
      setActionError(null)
      const offset = state.kind === 'ready' ? state.offset : 0
      try {
        const res = await apiFetch(`${ENDPOINTS.adminAccounts}/${accountId}/block`, {
          method: blocked ? 'DELETE' : 'POST',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        // Reload rather than patching the row in place. The server decides what
        // `blocked_at` is, and a locally patched row would be a claim about the
        // server's answer rather than the answer itself.
        await load(offset)
      } catch {
        setActionError(
          isId
            ? 'Aksi gagal. Status akun tidak berubah.'
            : "The action failed. The account's state is unchanged.",
        )
      } finally {
        setPending(null)
      }
    },
    [isId, load, state],
  )

  return {
    state,
    pending,
    actionError,
    granting,
    openGrant: (account) => setGranting(account),
    closeGrant: () => setGranting(null),
    act,
    reload: async (offset) => load(offset ?? (state.kind === 'ready' ? state.offset : 0)),
    query,
    setQuery,
    appliedQuery,
    filter,
    setFilter,
    filtering: appliedQuery !== '' || filter !== 'all',
  }
}

export function AdminAccountsView({ accounts }: { accounts: AdminAccountsApi }) {
  const { locale } = useApp()
  const isId = locale === 'id'
  const { state, pending, actionError, granting, filter, appliedQuery, filtering } = accounts

  const offset = state.kind === 'ready' ? state.offset : 0
  const page = state.kind === 'ready' ? state.page : null
  const rows = page?.accounts ?? []

  // What the window line says. The row numbers are the window into the filtered
  // result, not into the table, and the two words after them are what makes that
  // legible: an operator who searched "budi" and got one row must not be able to
  // read "1–1" as "there is one account in this install".
  const readout = [`${offset + 1}\u2013${offset + rows.length}`]
  if (filter !== 'all') readout.push(isId ? FILTER_LABEL[filter].id : FILTER_LABEL[filter].en)
  if (appliedQuery) {
    readout.push(isId ? `pencarian "${appliedQuery}"` : `search "${appliedQuery}"`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        {/* No section title; the h1 above already says Akun (owner
            direction). */}
        <p style={sectionNoteStyle}>
          {isId
            ? 'Pemblokiran mulai berlaku saat akun tersebut memakai aplikasi lagi. Sesi yang sedang berjalan tidak ditutup.'
            : 'A block takes effect when the account next uses the app. Sessions already open are not closed.'}
        </p>
      </div>

      {actionError && (
        <div
          role="alert"
          style={{
            fontSize: text.body,
            color: 'var(--loss)',
            background: 'var(--loss-bg)',
            padding: '8px 10px',
            borderRadius: 4,
          }}
        >
          {actionError}
        </div>
      )}

      {/* Search and the state filter. Both are sent to the server before the page
          is cut, so an account on page nine is reachable by typing its name
          instead of clicking through nine pages to discover it was there. */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          htmlFor="admin-account-search"
          style={{ fontSize: text.meta, color: 'var(--console-secondary)' }}
        >
          {isId ? 'Cari' : 'Search'}
        </label>
        <input
          id="admin-account-search"
          type="search"
          value={accounts.query}
          onChange={(event) => accounts.setQuery(event.target.value)}
          placeholder={isId ? 'Email atau nama' : 'Email or name'}
          style={{ ...searchStyle, width: 240, maxWidth: '100%' }}
        />
        <div
          role="group"
          aria-label={isId ? 'Saring daftar akun' : 'Filter the account list'}
          style={{ display: 'flex', gap: 8 }}
        >
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => accounts.setFilter(value)}
              style={{
                fontSize: text.body,
                padding: '5px 10px',
                minHeight: 32,
                color: filter === value ? 'var(--console-accent-ink)' : 'var(--foreground)',
                background: filter === value ? 'var(--console-accent)' : 'transparent',
                border: `1px solid ${filter === value ? 'var(--console-accent)' : 'var(--control-border)'}`,
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              {isId ? FILTER_LABEL[value].id : FILTER_LABEL[value].en}
            </button>
          ))}
        </div>
      </div>

      <div
        role="region"
        aria-label={
          isId ? 'Tabel akun, dapat digulir ke samping' : 'Account table, scrolls sideways'
        }
        tabIndex={0}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--console-card-shadow)',
          overflowX: 'auto',
          // Seven columns do not fit a phone. A scrollable region that cannot
          // take focus cannot be scrolled without a mouse or a thumb, so the
          // right-hand columns become unreachable for a keyboard operator.
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>{isId ? 'Nama' : 'Name'}</th>
              <th style={th}>Email</th>
              <th style={th}>{isId ? 'No WA' : 'Phone'}</th>
              <th style={th}>Role</th>
              <th style={th}>{isId ? 'Status' : 'Status'}</th>
              <th style={th}>{isId ? 'Berakhir' : 'Ends'}</th>
              <th style={{ ...th, textAlign: 'right' }}>{isId ? 'Aksi' : 'Action'}</th>
            </tr>
          </thead>
          <tbody>
            {state.kind === 'loading' && (
              <tr>
                <td colSpan={7} style={{ ...td, color: 'var(--console-secondary)' }}>
                  {isId ? 'Memuat…' : 'Loading…'}
                </td>
              </tr>
            )}

            {state.kind === 'error' && (
              <tr>
                <td colSpan={7} style={{ ...td, color: 'var(--console-secondary)' }}>
                  {state.message}
                </td>
              </tr>
            )}

            {state.kind === 'ready' && rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, color: 'var(--console-secondary)' }}>
                  {/* Two different empties. A filtered list with no rows is not an
                      install with no accounts, and reading the second onto the
                      first is how an operator stops looking for someone who is
                      there. A failed read is a third, and it is said above. */}
                  {filtering
                    ? isId
                      ? 'Tidak ada akun yang cocok dengan pencarian dan saringan ini.'
                      : 'No account matches this search and filter.'
                    : isId
                      ? 'Tidak ada akun.'
                      : 'No accounts.'}
                </td>
              </tr>
            )}

            {rows.map((account) => (
              <tr key={account.id}>
                <td style={td}>{account.full_name}</td>
                <td style={{ ...td, color: 'var(--console-secondary)' }}>{account.email}</td>
                {/* The number the account gave at signup, from the same statement
                    as the rest of the row. Set in mono without a nowrap, so a long
                    international number wraps inside its cell instead of widening
                    the table an operator is already scrolling. */}
                <td
                  style={{
                    ...td,
                    ...mono,
                  }}
                >
                  {account.phone_number || '—'}
                </td>
                <td style={{ ...td, ...mono }}>{account.role}</td>
                <td style={{ ...td, color: 'var(--console-secondary)' }}>
                  {/* Three states, not two. "Diblokir" alone hides the one fact
                      that decides whether the button in front of the operator is
                      the right one: a lapsed subscription is reopened by paying,
                      an admin ban only by this screen (ADR-0012). The vocabulary
                      is the server's two values; anything else reads as absent,
                      not as a third kind. */}
                  {account.blocked
                    ? account.blocked_reason === 'subscription_expired'
                      ? isId
                        ? 'Diblokir (langganan habis)'
                        : 'Blocked (subscription ended)'
                      : account.blocked_reason === 'admin'
                        ? isId
                          ? 'Diblokir (admin)'
                          : 'Blocked (admin)'
                        : isId
                          ? 'Diblokir'
                          : 'Blocked'
                    : isId
                      ? 'Aktif'
                      : 'Active'}
                  {/* The timestamp is real and the server owns it; print it where
                      the status it explains sits, not as a column of invented
                      "last seen". */}
                  {account.blocked && account.blocked_at && (
                    <div
                      style={{
                        ...tdMeta,
                        ...mono,
                      }}
                    >
                      {isId ? 'sejak ' : 'since '}
                      {new Date(account.blocked_at).toLocaleDateString(isId ? 'id-ID' : 'en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </div>
                  )}
                  {account.blocked && account.blocked_reason === 'subscription_expired' && (
                    <div
                      style={{
                        fontSize: text.meta,
                        color: 'var(--console-secondary)',
                        marginTop: 3,
                      }}
                    >
                      {isId ? 'pembayaran baru membukanya kembali' : 'a new payment reopens it'}
                    </div>
                  )}
                  {account.blocked && account.blocked_reason === 'admin' && (
                    <div
                      style={{
                        fontSize: text.meta,
                        color: 'var(--console-secondary)',
                        marginTop: 3,
                      }}
                    >
                      {isId
                        ? 'hanya buka blokir di layar ini yang membukanya'
                        : 'only unblocking here reopens it'}
                    </div>
                  )}
                </td>
                <td style={{ ...td, ...monoCell }}>
                  {/* The account's furthest period, from the same query as the
                      rest of the row. No date is not "no access": an end in the
                      past is a date, and the entitlement check is still what
                      decides whether data flows. */}
                  {account.subscriptionExpiresAt ? (
                    new Date(account.subscriptionExpiresAt).toLocaleDateString(
                      isId ? 'id-ID' : 'en-GB',
                      { day: 'numeric', month: 'short', year: 'numeric' },
                    )
                  ) : (
                    <span style={{ color: 'var(--console-secondary)' }}>
                      {isId ? 'tidak ada langganan' : 'no subscription'}
                    </span>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    onClick={() => accounts.openGrant(account)}
                    disabled={pending === account.id}
                    aria-label={
                      isId ? `Beri masa aktif ${account.email}` : `Grant access to ${account.email}`
                    }
                    style={{
                      // The constructive action carries the primary fill, so it
                      // reads first; the block button below answers with the soft
                      // red wash (owner direction on action hierarchy).
                      ...rowActionStyle('confirm'),
                      marginRight: 8,
                      cursor: pending === account.id ? 'default' : 'pointer',
                    }}
                  >
                    {isId ? 'Perpanjang' : 'Extend'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void accounts.act(account.id, account.blocked)}
                    disabled={pending !== null}
                    aria-label={
                      account.blocked
                        ? isId
                          ? `Buka blokir ${account.email}`
                          : `Unblock ${account.email}`
                        : isId
                          ? `Blokir ${account.email}`
                          : `Block ${account.email}`
                    }
                    style={{
                      // A button outline is a control boundary, not a row divider,
                      // so both states sit on the 32px floor; a blocked row softens
                      // to the quiet treatment rather than losing its edge.
                      ...rowActionStyle(account.blocked ? 'quiet' : 'danger'),
                      cursor: pending !== null ? 'default' : 'pointer',
                      opacity: pending === account.id ? 0.5 : 1,
                    }}
                  >
                    {pending === account.id
                      ? '…'
                      : account.blocked
                        ? isId
                          ? 'Buka blokir'
                          : 'Unblock'
                        : isId
                          ? 'Blokir'
                          : 'Block'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {page && rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => void accounts.reload(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            style={{
              fontSize: text.body,
              padding: '5px 10px',
              minHeight: 32,
              color: 'var(--foreground)',
              background: 'transparent',
              // --control-border, not --border: ADR-0007 gives interactive
              // boundaries a contrast floor, and --border is a divider token that
              // sits below it on purpose.
              border: '1px solid var(--control-border)',
              borderRadius: 3,
              cursor: offset === 0 ? 'default' : 'pointer',
              opacity: offset === 0 ? 0.5 : 1,
            }}
          >
            {isId ? 'Sebelumnya' : 'Previous'}
          </button>
          <button
            type="button"
            onClick={() => void accounts.reload(offset + PAGE_SIZE)}
            disabled={!page.hasMore}
            style={{
              fontSize: text.body,
              padding: '5px 10px',
              minHeight: 32,
              color: 'var(--foreground)',
              background: 'transparent',
              border: '1px solid var(--control-border)',
              borderRadius: 3,
              cursor: page.hasMore ? 'pointer' : 'default',
              opacity: page.hasMore ? 1 : 0.5,
            }}
          >
            {isId ? 'Berikutnya' : 'Next'}
          </button>
          <span style={{ fontSize: text.meta, color: 'var(--console-secondary)' }}>
            {readout.join(' · ')}
          </span>
        </div>
      )}

      {granting && (
        <GrantPeriodDialog
          accountId={granting.id}
          accountLabel={granting.email}
          currentExpiresAt={granting.subscriptionExpiresAt}
          onCancel={() => accounts.closeGrant()}
          onGranted={() => {
            // Close and re-read. The expiry the column shows afterwards is the
            // one the server wrote, not the one this screen predicted from the
            // day count that was typed.
            accounts.closeGrant()
            void accounts.reload()
          }}
        />
      )}
    </div>
  )
}
