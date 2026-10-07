import { useCallback, useEffect, useState } from "react";

import { ENDPOINTS, apiFetch } from "../config/api";
import { useApp } from "../context/AppContext";

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
  | { kind: "error"; message: string };

export function AdminView() {
  const { locale } = useApp();
  const isId = locale === "id";
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
          // Neither an empty list nor a generic failure. The endpoint answered, and
          // the answer is that this person may not see it.
          setState({
            kind: "error",
            message: isId
              ? "Hanya administrator yang bisa melihat daftar akun."
              : "Only an administrator can see the account list.",
          });
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
    padding: "9px 12px",
    textAlign: "left" as const,
    fontSize: 11,
    color: "var(--muted-foreground)",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  };
  const td = {
    padding: "9px 12px",
    fontSize: 12,
    color: "var(--foreground)",
    borderBottom: "1px solid var(--border)",
  };

  const accounts = state.kind === "ready" ? state.page.accounts : [];

  return (
    <div className="flex-1 h-full overflow-y-auto" style={{ padding: 24 }}>
      <div style={{ maxWidth: 900, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            {isId ? "Kelola Akun" : "Manage Accounts"}
          </h2>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>
            {isId
              ? "Memblokir berlaku pada request berikutnya. Sesi yang sudah terbit tidak dihapus — ADR-0004."
              : "A block takes effect on the account's next request. Existing sessions are not deleted — ADR-0004."}
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
    </div>
  );
}