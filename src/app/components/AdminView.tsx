import { useCallback, useEffect, useState } from "react";

import { ENDPOINTS, apiFetch } from "../config/api";
import { useApp } from "../context/AppContext";
import { AdminBankAccountsView } from "./AdminBankAccountsView";
import { AdminPricingView } from "./AdminPricingView";

/**
 * Account administration: the list, and blocking or unblocking.
 *
 * Reached at its own URL (`/admin`) rather than from the sidebar. That is a
 * deliberate choice and not an omission: this is an operational tool, not a place
 * people live, and a permanent entry in the main navigation would put "manage every
 * account in the system" one click away on every screen. The backend refuses
 * non-admins with 403 regardless — this is about who can *find* the page, not who
 * can use it.
 *
 * Nothing here is invented. Every field on a row comes from the server: there is
 * no plan name, no spend figure, and no "last seen" column, because none of those
 * is recorded anywhere. A column here would be a column of invented data.
 */

interface AdminAccount {
  id: string;
  email: string;
  full_name: string;
  phone_number: string;
  role: string;
  blocked: boolean;
  blocked_at: string | null;
}

interface AccountsPage {
  accounts: AdminAccount[];
  hasMore: boolean;
}

const PAGE_SIZE = 25;

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; page: AccountsPage; offset: number }
  | { kind: "denied" }
  | { kind: "error"; message: string };

type AdminTab = "accounts" | "pricing" | "payments";

export function AdminView() {
  const { locale } = useApp();
  const isId = locale === "id";
  const [tab, setTab] = useState<AdminTab>("accounts");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // The account being acted on, so exactly one row shows progress and a failure
  // cannot leave every row looking busy.
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setState({ kind: "loading" });
      try {
        const res = await apiFetch(
          `${ENDPOINTS.adminAccounts}?limit=${PAGE_SIZE}&offset=${offset}`,
          signal ? { signal } : undefined,
        );
        if (res.status === 403) {
          // Neither an empty list nor a generic failure. The endpoint answered,
          // and the answer is that this person may not see it, so the page
          // becomes the gate screen rather than a table with a note inside it.
          setState({ kind: "denied" });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState({ kind: "ready", page: await res.json(), offset });
      } catch {
        if (signal?.aborted) return;
        // "We could not ask" is not "there is nothing". Showing an empty table here
        // would tell someone whose accounts are all there that they have none.
        setState({
          kind: "error",
          message: isId
            ? "Daftar akun tidak dapat dimuat. Ini bukan berarti tidak ada akun."
            : "The account list could not be loaded. That does not mean there are no accounts.",
        });
      }
    },
    [isId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(0, controller.signal);
    return () => controller.abort();
  }, [load]);

  const act = useCallback(
    async (accountId: string, blocked: boolean) => {
      setPending(accountId);
      setActionError(null);
      const offset = state.kind === "ready" ? state.offset : 0;
      try {
        const res = await apiFetch(`${ENDPOINTS.adminAccounts}/${accountId}/block`, {
          method: blocked ? "DELETE" : "POST",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Reload rather than patching the row in place. The server decides what
        // `blocked_at` is, and a locally patched row would be a claim about the
        // server's answer rather than the answer itself.
        await load(offset);
      } catch {
        setActionError(
          isId
            ? "Aksi gagal. Status akun tidak berubah."
            : "The action failed. The account's state is unchanged."
        );
      } finally {
        setPending(null);
      }
    },
    [isId, load, state]
  );

  const th = {
    padding: "10px 12px",
    textAlign: "left" as const,
    fontSize: 12,
    color: "var(--muted-foreground)",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  };
  const td = {
    padding: "14px 12px",
    fontSize: 13,
    color: "var(--foreground)",
    borderBottom: "1px solid var(--border)",
  };

  const accounts = state.kind === "ready" ? state.page.accounts : [];

  return (
    <div className="min-h-0 flex-1" style={{ overflowY: "auto", padding: 24 }}>
      <div
        style={{
          maxWidth: 1080,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* The page names itself once, and the operator's provenance sits on the
            same row, not above the name like a label. Never worn by a visitor:
            the tag appears only after the admin endpoint has answered 200 to
            this person's key. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, fontFamily: "var(--font-display)" }}>
            {isId ? "Konsol operator" : "Operator console"}
          </h1>
          {state.kind === "ready" && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                color: "var(--muted-foreground)",
                border: "1px solid var(--control-border)",
                borderRadius: 3,
                padding: "3px 8px",
              }}
            >
              OPERATOR ACCESS
            </span>
          )}
        </div>

        {state.kind === "denied" ? (
          <GateSection isId={isId} />
        ) : (
        <>
        {/* Three tabs, not three routes. /admin is already an operational tool at its
            own URL with no sidebar entry, so a second URL would add routing and a
            nav element to solve a problem the page does not have. */}
        <div
          role="tablist"
          aria-label={isId ? "Bagian admin" : "Admin sections"}
          style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}
        >
          {([
            ["accounts", isId ? "Akun" : "Accounts"],
            ["pricing", isId ? "Harga" : "Pricing"],
            ["payments", isId ? "Pembayaran" : "Payments"],
          ] as [AdminTab, string][]).map(([id, label]) => (
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
                padding: "8px 12px",
                border: "none",
                borderBottom: `2px solid ${tab === id ? "var(--primary)" : "transparent"}`,
                background: "transparent",
                color: tab === id ? "var(--foreground)" : "var(--muted-foreground)",
                fontWeight: tab === id ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "pricing" ? (
          <div id="admin-panel-pricing" role="tabpanel" aria-labelledby="admin-tab-pricing">
            <AdminPricingView />
          </div>
        ) : tab === "payments" ? (
          <div id="admin-panel-payments" role="tabpanel" aria-labelledby="admin-tab-payments">
            <AdminBankAccountsView />
          </div>
        ) : (
        <div id="admin-panel-accounts" role="tabpanel" aria-labelledby="admin-tab-accounts">
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            {isId ? "Kelola Akun" : "Manage Accounts"}
          </h2>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>
            {isId
              ? "Memblokir berlaku pada request berikutnya. Sesi yang sudah terbit tidak dihapus (ADR-0004)."
              : "A block takes effect on the account's next request. Existing sessions are not deleted (ADR-0004)."}
          </p>
        </div>

        {actionError && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: "var(--loss)",
              background: "var(--loss-bg)",
              padding: "8px 10px",
              borderRadius: 4,
            }}
          >
            {actionError}
          </div>
        )}

        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            overflowX: "auto",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>{isId ? "Nama" : "Name"}</th>
                <th style={th}>Email</th>
                <th style={th}>Role</th>
                <th style={th}>{isId ? "Status" : "Status"}</th>
                <th style={{ ...th, textAlign: "right" }}>{isId ? "Aksi" : "Action"}</th>
              </tr>
            </thead>
            <tbody>
              {state.kind === "loading" && (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "var(--muted-foreground)" }}>
                    {isId ? "Memuat…" : "Loading…"}
                  </td>
                </tr>
              )}

              {state.kind === "error" && (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "var(--muted-foreground)" }}>
                    {state.message}
                  </td>
                </tr>
              )}

              {state.kind === "ready" && accounts.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "var(--muted-foreground)" }}>
                    {isId ? "Tidak ada akun." : "No accounts."}
                  </td>
                </tr>
              )}

              {accounts.map((account) => (
                <tr key={account.id}>
                  <td style={td}>{account.full_name}</td>
                  <td style={{ ...td, color: "var(--muted-foreground)" }}>{account.email}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono)" }}>{account.role}</td>
                  <td style={{ ...td, color: "var(--muted-foreground)" }}>
                    {account.blocked
                      ? isId
                        ? "Diblokir"
                        : "Blocked"
                      : isId
                        ? "Aktif"
                        : "Active"}
                    {/* The timestamp is real and the server owns it; print it
                        where the status it explains sits, not as a column of
                        invented "last seen". */}
                    {account.blocked && account.blocked_at && (
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--muted-foreground)",
                          marginTop: 3,
                        }}
                      >
                        {isId ? "sejak " : "since "}
                        {new Date(account.blocked_at).toLocaleDateString(isId ? "id-ID" : "en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => void act(account.id, account.blocked)}
                      disabled={pending === account.id}
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
                        fontSize: 11,
                        padding: "4px 8px",
                        minHeight: 28,
                        color: account.blocked ? "var(--foreground)" : "var(--loss)",
                        background: "transparent",
                        // Same floor as the pagination buttons — a button outline is
                        // a control boundary, not a row divider.
                        border: `1px solid ${account.blocked ? "var(--control-border)" : "var(--loss)"}`,
                        borderRadius: 3,
                        cursor: pending === account.id ? "default" : "pointer",
                        opacity: pending === account.id ? 0.5 : 1,
                      }}
                    >
                      {pending === account.id
                        ? "…"
                        : account.blocked
                          ? isId
                            ? "Buka blokir"
                            : "Unblock"
                          : isId
                            ? "Blokir"
                            : "Block"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {state.kind === "ready" && accounts.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void load(Math.max(0, state.offset - PAGE_SIZE))}
              disabled={state.offset === 0}
              style={{
                fontSize: 12,
                padding: "5px 10px",
                minHeight: 32,
                color: "var(--foreground)",
                background: "transparent",
                // --control-border, not --border: ADR-0007 gives interactive
                // boundaries a contrast floor, and --border is a divider token that
                // sits below it on purpose.
                border: "1px solid var(--control-border)",
                borderRadius: 3,
                cursor: state.offset === 0 ? "default" : "pointer",
                opacity: state.offset === 0 ? 0.5 : 1,
              }}
            >
              {isId ? "Sebelumnya" : "Previous"}
            </button>
            <button
              type="button"
              onClick={() => void load(state.offset + PAGE_SIZE)}
              disabled={!state.page.hasMore}
              style={{
                fontSize: 12,
                padding: "5px 10px",
                minHeight: 32,
                color: "var(--foreground)",
                background: "transparent",
                border: "1px solid var(--control-border)",
                borderRadius: 3,
                cursor: state.page.hasMore ? "pointer" : "default",
                opacity: state.page.hasMore ? 1 : 0.5,
              }}
            >
              {isId ? "Berikutnya" : "Next"}
            </button>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              {state.offset + 1}–{state.offset + accounts.length}
            </span>
          </div>
        )}
        </div>
        )}
        </>
        )}

        {/* The page's height is its data's height: a short fixture (this one has
            an account and a blocked admin) ends where it ends, and a full
            25-row page fills this ground. No spacer and no invented volume to
            make the canvas look busy. The footer closes the grid at the edge
            the content reaches. */}
        <div style={{ height: "32px" }} />
        <footer
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "16px",
            borderTop: "1px solid var(--border)",
            paddingTop: "12px",
          }}
        >
          <span style={{ fontFamily: "var(--font-display)", fontSize: "13px", fontWeight: 700, letterSpacing: "0.02em" }}>
            AIDSS
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted-foreground)" }}>
            {isId ? "Konsol operator" : "Operator console"}
          </span>
        </footer>
      </div>
    </div>
  );
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
    ? ["Kontrol akun pengguna", "Tetapan harga tiga paket", "Verifikasi pembayaran transfer"]
    : ["User account controls", "The three plan prices", "Manual transfer verification"];
  return (
    <section
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 20,
        maxWidth: 560,
        margin: "12px auto 0",
        width: "100%",
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
        {isId ? "Hanya untuk operator" : "For operators"}
      </h2>
      {/* The server's verdict, kept in its own words. */}
      <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--foreground)", margin: "10px 0 0" }}>
        {isId
          ? "Hanya administrator yang bisa melihat daftar akun."
          : "Only an administrator can see the account list."}
      </p>
      <ul
        style={{
          margin: "14px 0 0",
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: 14,
          color: "var(--foreground)",
        }}
      >
        {topics.map((topic) => (
          <li key={topic} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            {topic}
          </li>
        ))}
      </ul>
      <a
        href="/"
        className="auth-control"
        style={{
          display: "inline-block",
          marginTop: 16,
          padding: "8px 14px",
          fontSize: 14,
          color: "var(--foreground)",
          border: "1px solid var(--control-border)",
          borderRadius: "var(--radius)",
          textDecoration: "none",
          background: "var(--background)",
        }}
      >
        {isId ? "Kembali ke aplikasi" : "Back to the app"}
      </a>
    </section>
  );
}