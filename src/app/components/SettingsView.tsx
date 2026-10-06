import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useApp } from "../context/AppContext";
import type { AuthState } from "../hooks/useAuth";
import { useTranslation } from "../i18n/translations";
import type { ExchangeRateData } from "../hooks/useExchangeRate";
import type { DataFreshness } from "../hooks/useLiveMarket";

/*
 * Settings, per docs/settings-module-spec.md v1.1.0.
 *
 * Implements the tab architecture the spec defines, using only tokens that
 * already exist in src/styles/theme.css. No new colour, typeface, radius or
 * icon was introduced, because DESIGN.md has not named any.
 *
 * Two of the five tabs (Profile, Subscription) read endpoints that do not
 * exist yet: the backend is still single-operator (backend/api/routers/auth.py
 * issues a JWT from AUTH_USERNAME/AUTH_PASSWORD and has no user store), and
 * docs/saas-subscription-platform.md has not been implemented. Those tabs
 * say so plainly instead of showing placeholder people or invoices, per R-38.
 * Appearance, Notifications and About read state that genuinely exists.
 */

const STORAGE_NOTIF = "aidss-notifications";

type NotifKey = "ai_signals" | "risk_alerts" | "corp_news";

const NOTIF_DEFAULT: Record<NotifKey, boolean> = {
  ai_signals: true,
  risk_alerts: true,
  corp_news: false,
};

function readNotifPrefs(): Record<NotifKey, boolean> {
  try {
    const saved = localStorage.getItem(STORAGE_NOTIF);
    if (saved) return { ...NOTIF_DEFAULT, ...JSON.parse(saved) };
  } catch {
    /* unreadable storage falls back to defaults */
  }
  return NOTIF_DEFAULT;
}

type TabId = "profile" | "billing" | "appearance" | "notifications" | "about";

interface Props {
  fx: ExchangeRateData;
  /** Feed state, so About reports what the prices actually are. */
  freshness?: DataFreshness;
  /** The signed-in account, for the Profile tab and the sign-out control. */
  auth: AuthState;
  onSignedOut: () => void;
}

export function SettingsView({ fx, freshness, auth, onSignedOut }: Props) {
  const { isDark, toggleTheme, locale, toggleLocale } = useApp();
  const id = locale === "id";
  const [tab, setTab] = useState<TabId>("appearance");

  const TABS: { id: TabId; label: string; en: string }[] = [
    { id: "profile", label: "Profil & Akun", en: "Profile & Account" },
    { id: "billing", label: "Langganan & Tagihan", en: "Subscription & Billing" },
    { id: "appearance", label: "Tampilan", en: "Appearance" },
    { id: "notifications", label: "Notifikasi", en: "Notifications" },
    { id: "about", label: "Tentang", en: "About" },
  ];

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
    };
    const next = offsets[e.key];
    if (next === undefined) return;
    e.preventDefault();
    // Wrap at both ends: a horizontal tablist has no first or last tab to stop on.
    const target = TABS[(next + TABS.length) % TABS.length];
    setTab(target.id);
    document.getElementById(`tab-${target.id}`)?.focus();
  };

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 720,
      }}
    >
      {/* No page heading here on purpose: App.tsx renders the view title and
          subtitle in Header, so an h2 in this view printed the same two lines
          twice. */}

      {/* Tab bar. Text labels only: an icon here would restate the label.
          Scrolls horizontally on narrow screens so no tab is ever clipped. */}
      <div
        role="tablist"
        aria-label={id ? "Bagian pengaturan" : "Settings sections"}
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--border)",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {TABS.map((t, index) => {
          const active = tab === t.id;
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
                padding: "10px 12px",
                minHeight: 44,
                whiteSpace: "nowrap",
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                color: active ? "var(--primary)" : "var(--muted-foreground)",
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${active ? "var(--primary)" : "transparent"}`,
                cursor: "pointer",
                transition: "color 0.1s, border-color 0.1s",
              }}
            >
              {id ? t.label : t.en}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "profile" && <TabProfile id={id} auth={auth} onSignedOut={onSignedOut} />}
        {tab === "billing" && <TabSubscription id={id} />}
        {tab === "appearance" && (
          <TabAppearance id={id} isDark={isDark} onToggleTheme={toggleTheme} locale={locale} onToggleLocale={toggleLocale} fx={fx} />
        )}
        {tab === "notifications" && <TabNotifications id={id} />}
        {tab === "about" && <TabAbout id={id} fx={fx} freshness={freshness} />}
      </div>
    </div>
  );
}

/* ── Tab 1: Profile ──────────────────────────────────────────────────────── */

function TabProfile({
  id,
  auth,
  onSignedOut,
}: {
  id: boolean;
  auth: AuthState;
  onSignedOut: () => void;
}) {
  const { locale } = useApp();
  // Real data, from GET /v1/auth/me. Before the multi-user backend this tab said
  // the backend had no user store, which stopped being true the moment the users
  // table existed.
  const account = auth.account;
  const { t: t2 } = useTranslation(locale);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(account?.full_name ?? "");
  const [draftPhone, setDraftPhone] = useState(account?.phone_number ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    account !== null &&
    (draftName !== account.full_name || draftPhone !== account.phone_number);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await auth.updateProfile({ full_name: draftName, phone_number: draftPhone });
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t2("auth_error_generic"));
    } finally {
      setSaving(false);
    }
  };

  if (!account) {
    return (
      <Panel title={id ? "Profil & Akun" : "Profile & Account"}>
        <Unavailable
          id={id}
          title={id ? "Akun belum dimuat" : "Account not loaded"}
          body={
            id
              ? "Gagal memuat akun. Periksa koneksi lalu buka lagi halaman ini."
              : "Could not load the account. Check the connection and reopen this tab."
          }
        />
      </Panel>
    );
  }

  const roleLabel = account.role === "admin"
    ? (id ? "Administrator" : "Administrator")
    : (id ? "Pengguna" : "User");

  return (
    <Panel title={id ? "Profil & Akun" : "Profile & Account"}>
      <div className="account-name">{account.full_name}</div>
      <div className="account-email">{account.email}</div>

      <Divider />

      <Metric label={id ? "Nomor WhatsApp" : "WhatsApp"} value={account.phone_number} />
      {/* Role as a text label, not a coloured pill: see docs/settings-module-spec.md
          §4.1, which removed the badge for exactly this reason. */}
      <Metric label={id ? "Peran" : "Role"} value={roleLabel} />

      {account.blocked && (
        <p className="account-blocked">
          {id
            ? "Akun ini sedang diblokir, jadi akses datanya ditolak."
            : "This account is blocked, so its data access is refused."}
        </p>
      )}

      <Divider />

      {/* Editable fields. Every control here has a label, a real border and a
          focus ring from focus.css, and the save button is disabled until
          something actually changed, so it cannot be pressed to do nothing. */}
      {editing ? (
        <form onSubmit={save}>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="profile-name" style={fieldLabel}>{id ? "Nama lengkap" : "Full name"}</label>
            <input
              id="profile-name"
              name="full_name"
              type="text"
              className="auth-control"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              style={fieldInput}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="profile-phone" style={fieldLabel}>
              {id ? "Nomor WhatsApp" : "WhatsApp number"}
            </label>
            <input
              id="profile-phone"
              name="phone_number"
              type="tel"
              inputMode="tel"
              className="auth-control"
              value={draftPhone}
              onChange={(e) => setDraftPhone(e.target.value)}
              style={fieldInput}
            />
          </div>

          {saveError && <p role="alert" className="profile-error">{saveError}</p>}
          {saved && <p role="status" className="profile-saved">{t2("auth_saved")}</p>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" className="auth-control" disabled={!dirty || saving} style={primaryButton}>
              {saving ? t2("auth_working") : t2("auth_save")}
            </button>
            <button
              type="button"
              className="auth-control"
              onClick={() => { setEditing(false); setSaveError(null); setSaved(false); }}
              style={secondaryButton}
            >
              {t2("auth_cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="auth-control"
          onClick={() => {
            setEditing(true);
            setDraftName(account.full_name);
            setDraftPhone(account.phone_number);
            setSaveError(null);
            setSaved(false);
          }}
          style={secondaryButton}
        >
          {t2("auth_edit_profile")}
        </button>
      )}

      <Divider />

      <button
        type="button"
        className="auth-control"
        disabled={busy}
        style={signOutButton}
        onClick={async () => {
          setBusy(true);
          await auth.signOut();
          onSignedOut();
        }}
      >
        {id ? "Keluar akun" : "Sign out"}
      </button>
</Panel>
  );
}

/* Shared control styles for the Profile tab. Declared once because three
   components would otherwise each re-state the same 44px tap target and the same
   3:1 border, and one of them would eventually get it wrong. */

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "var(--foreground)",
  marginBottom: 6,
};

const fieldInput: React.CSSProperties = {
  width: "100%",
  minHeight: "44px",
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "var(--font-sans)",
  color: "var(--foreground)",
  background: "var(--input-background, #f9fafb)",
  border: "1px solid var(--control-border)",
  borderRadius: "var(--radius)",
  boxSizing: "border-box",
};

const primaryButton: React.CSSProperties = {
  minHeight: "44px",
  padding: "10px 16px",
  fontSize: 13,
  fontFamily: "var(--font-sans)",
  fontWeight: 500,
  color: "var(--primary-foreground)",
  background: "var(--primary)",
  border: "1px solid var(--primary)",
  borderRadius: "var(--radius)",
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  minHeight: "44px",
  padding: "10px 16px",
  fontSize: 13,
  fontFamily: "var(--font-sans)",
  fontWeight: 500,
  color: "var(--foreground)",
  background: "transparent",
  border: "1px solid var(--control-border)",
  borderRadius: "var(--radius)",
  cursor: "pointer",
};

const signOutButton: React.CSSProperties = {
  minHeight: "44px",
  padding: "10px 16px",
  fontSize: 13,
  fontFamily: "var(--font-sans)",
  fontWeight: 500,
  color: "var(--destructive)",
  background: "transparent",
  border: "1px solid var(--destructive)",
  borderRadius: "var(--radius)",
  cursor: "pointer",
};

/* ── Tab 2: Subscription ─────────────────────────────────────────────────── */

function TabSubscription({ id }: { id: boolean }) {
  // TODO: bind to a real subscription read. The `subscriptions` table landed in
  // migration 0005, but `transactions` did not and there is no payment path, so
  // every figure on this tab would have to be invented.
  return (
    <Panel title={id ? "Langganan & Tagihan" : "Subscription & Billing"}>
      <Unavailable
        id={id}
        title={id ? "Belum ada langganan" : "No subscription yet"}
        body={
          id
            ? "Tabel langganan sudah ada, tetapi belum ada jalan untuk punya satu: pembayaran belum dibuka, jadi tidak ada paket, sisa hari, maupun invoice yang bisa ditampilkan. Angka di tab ini akan dibaca dari server saat ada, tidak diketik manual."
            : "The subscriptions table exists, but there is no way to hold a subscription yet: payment is not open, so there is no plan, no remaining days and no invoice to show. Every figure on this tab will be read from the server when there is one."
        }
      />
    </Panel>
  );
}

/* ── Tab 3: Appearance ───────────────────────────────────────────────────── */

function TabAppearance({
  id,
  isDark,
  onToggleTheme,
  locale,
  onToggleLocale,
  fx,
}: {
  id: boolean;
  isDark: boolean;
  onToggleTheme: () => void;
  locale: "id" | "en";
  onToggleLocale: () => void;
  fx: ExchangeRateData;
}) {
  return (
    <Panel title={id ? "Tampilan" : "Appearance"}>
      <SettingRow label={id ? "Tema" : "Theme"} description={id ? "Tampilan terang atau gelap" : "Light or dark appearance"}>
        <ChoiceGroup
          options={[
            { key: "light", label: id ? "Terang" : "Light", active: !isDark, onClick: isDark ? onToggleTheme : undefined },
            { key: "dark", label: id ? "Gelap" : "Dark", active: isDark, onClick: isDark ? undefined : onToggleTheme },
          ]}
          id={id}
        />
      </SettingRow>

      <Divider />

      <SettingRow label={id ? "Bahasa antarmuka" : "Interface language"} description={id ? "Bahasa teks antarmuka" : "Language of interface text"}>
        <ChoiceGroup
          options={[
            { key: "id", label: "Indonesia", active: locale === "id", onClick: locale === "en" ? onToggleLocale : undefined },
            { key: "en", label: "English", active: locale === "en", onClick: locale === "id" ? onToggleLocale : undefined },
          ]}
          id={id}
        />
      </SettingRow>

      <Divider />

      <SettingRow label={id ? "Mata uang" : "Currency"} description={id ? "Nilai portofolio ditampilkan dalam" : "Portfolio values are displayed in"}>
        <ChoiceGroup
          options={[
            { key: "idr", label: "IDR", active: !fx.showUsd, onClick: fx.showUsd ? fx.toggleCurrency : undefined },
            { key: "usd", label: "USD", active: fx.showUsd, onClick: !fx.showUsd ? fx.toggleCurrency : undefined },
          ]}
          id={id}
        />
      </SettingRow>

      <Divider />

      <FxCard fx={fx} id={id} />
    </Panel>
  );
}

function FxCard({ fx, id }: { fx: ExchangeRateData; id: boolean }) {
  // The rate is pushed with the market snapshot, so it is never older than the
  // prices. Saying so is the point: an unexplained number reads as a live feed.
  const weaker = fx.change > 0;
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "16px 20px",
        marginTop: 16,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--foreground)",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {id ? "Kurs USD/IDR" : "USD/IDR rate"}
        <span style={{ fontSize: 11, fontWeight: 400, color: fx.isLive ? "var(--muted-foreground)" : "var(--warning)" }}>
          {fx.isLive
            ? id
              ? "dari snapshot pasar"
              : "from market snapshot"
            : id
              ? "belum ada feed"
              : "no feed yet"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <Metric label={id ? "Kurs saat ini" : "Current rate"} value={`Rp ${fx.usdIdr.toLocaleString("id-ID")}`} />
        <Metric
          label={id ? "Perubahan" : "Change"}
          value={`${fx.change >= 0 ? "+" : ""}${fx.change.toLocaleString("id-ID")}`}
          tone={fx.change > 0 ? "loss" : fx.change < 0 ? "gain" : undefined}
        />
        <Metric
          label="%"
          value={`${fx.changePct >= 0 ? "+" : ""}${fx.changePct.toFixed(3)}%`}
          tone={fx.changePct > 0 ? "loss" : fx.changePct < 0 ? "gain" : undefined}
        />
      </div>

      <p style={{ fontSize: 11, color: "var(--muted-foreground)", margin: "12px 0 0" }}>
        {fx.isLive
          ? id
            ? "Kurs dikirim bersama snapshot pasar, jadi kesegaran kurs mengikuti feed pasar. Rupiah melemah berarti potensi kerugian bagi investor yang memegang aset dalam dolar."
            : "The rate arrives with the market snapshot, so it refreshes whenever the feed does. Rupiah weakening means potential loss for a holder of dollar-denominated assets."
          : id
            ? "Feed forex belum pernah mengirim angka, jadi nilai di atas bukan kurs pasar. Muat ulang setelah backend terhubung."
            : "The forex feed has not reported a rate yet, so the figure above is not a market rate. Reload once the backend is connected."}
      </p>
      {weaker && !fx.isLive && null}
    </div>
  );
}

/* ── Tab 4: Notifications ────────────────────────────────────────────────── */

function TabNotifications({ id }: { id: boolean }) {
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>(readNotifPrefs);
  const [saved, setSaved] = useState<NotifKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  function toggle(key: NotifKey) {
    setNotifs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(STORAGE_NOTIF, JSON.stringify(next));
      } catch {
        /* preference stays in memory for this session */
      }
      return next;
    });
    if (timer.current !== null) clearTimeout(timer.current);
    setSaved(key);
    timer.current = setTimeout(() => setSaved(null), 2000);
  }

  const rows: { key: NotifKey; label: string; en: string; desc: string; descEn: string }[] = [
    {
      key: "ai_signals",
      label: "Sinyal AI baru",
      en: "New AI signals",
      desc: "Saat model kuantitatif menghasilkan sinyal probabilitas baru",
      descEn: "When the quantitative model produces a new probability signal",
    },
    {
      key: "risk_alerts",
      label: "Peringatan risiko",
      en: "Risk alerts",
      desc: "Saat eksposur risiko portofolio melewati ambang toleransi",
      descEn: "When portfolio risk exposure crosses the tolerance threshold",
    },
    {
      key: "corp_news",
      label: "Berita korporasi",
      en: "Corporate news",
      desc: "Keterbukaan informasi emiten yang sedang dipantau",
      descEn: "Listed-company disclosure filings for tracked holdings",
    },
  ];

  return (
    <Panel title={id ? "Notifikasi" : "Notifications"}>
      {rows.map((r, i) => (
        <div key={r.key}>
          {i > 0 && <Divider />}
          <ToggleRow
            label={id ? r.label : r.en}
            description={id ? r.desc : r.descEn}
            isOn={notifs[r.key]}
            saved={saved === r.key}
            savedLabel={id ? "Tersimpan" : "Saved"}
            onToggle={() => toggle(r.key)}
            id={`notif-${r.key}`}
          />
        </div>
      ))}
    </Panel>
  );
}

/* ── Tab 5: About ────────────────────────────────────────────────────────── */

function TabAbout({ id, fx, freshness }: { id: boolean; fx: ExchangeRateData; freshness?: DataFreshness }) {
  // Only facts this component can actually verify. Version, model name and
  // last-trained date are absent on purpose: they are not readable from the
  // backend, so a fixed string there would be a number that goes stale.
  const feedStatus = !fx.isLive
    ? id
      ? "Belum terhubung"
      : "Not connected"
    : !freshness
      ? id
        ? "Langsung"
        : "Live"
      : freshness.isSimulated
        ? id
          ? "Simulasi"
          : "Simulated"
        : freshness.isDelayed
          ? id
            ? `Tertunda ${Math.round(freshness.delaySeconds / 60)} menit`
            : `Delayed ${Math.round(freshness.delaySeconds / 60)} min`
          : id
            ? "Langsung"
            : "Live";

  const rows: [string, string][] = [
    [id ? "Sumber data" : "Data source", "IDX / Yahoo Finance"],
    [id ? "Bursa" : "Exchange", "BEI (IDX)"],
    [id ? "Zona waktu" : "Timezone", "WIB (UTC+7)"],
    [id ? "Status feed" : "Feed status", feedStatus],
  ];

  return (
    <Panel title={id ? "Tentang" : "About"}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ background: "var(--muted)", borderRadius: "var(--radius)", padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {label}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <Divider />

      {/* Regulatory line, plain text. The consent modal in AIAdvisorView is the
          enforced gate (Gate 2 in docs/legal-and-consent.md); this is the
          standing reference, not a second consent surface. */}
      <p style={{ fontSize: 11, color: "var(--muted-foreground)", margin: 0 }}>
        {id
          ? "AIDSS adalah perangkat analisis data, bukan Penasihat Investasi berizin OJK. Semua skor adalah probabilitas matematis, bukan rekomendasi beli, jual, atau tahan efek."
          : "AIDSS is a data analytics tool, not an OJK-licensed Investment Advisor. Every score is a mathematical probability, not a recommendation to buy, sell, or hold any security."}
      </p>
    </Panel>
  );
}

/* ── Primitives ──────────────────────────────────────────────────────────── */

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{title}</span>
      </div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

function Unavailable({ id, title, body }: { id: boolean; title: string; body: string }) {
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>{title}</span>
      <span style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>{body}</span>
      <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
        {id ? "docs/saas-subscription-platform.md, Fase 1" : "docs/saas-subscription-platform.md, Phase 1"}
      </span>
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="setting-row" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{description}</div>
      </div>
      {children}
    </div>
  );
}

function ChoiceGroup({
  options,
  id,
}: {
  options: { key: string; label: string; active: boolean; onClick?: () => void }[];
  id: boolean;
}) {
  return (
    <div role="group" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={o.onClick}
          aria-pressed={o.active}
          disabled={!o.onClick}
          style={{
            minHeight: 32,
            padding: "6px 12px",
            borderRadius: "var(--radius)",
            cursor: o.onClick ? "pointer" : "default",
            background: o.active ? "var(--accent)" : "var(--muted)",
            border: `1px solid ${o.active ? "var(--primary)" : "var(--control-border)"}`,
            color: o.active ? "var(--accent-foreground)" : "var(--muted-foreground)",
            fontSize: 12,
            fontWeight: o.active ? 500 : 400,
            opacity: o.active ? 1 : 0.75,
          }}
        >
          {o.label}
        </button>
      ))}
      {id ? null : null}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  isOn,
  onToggle,
  saved,
  savedLabel,
  id,
}: {
  label: string;
  description: string;
  isOn: boolean;
  onToggle: () => void;
  saved: boolean;
  savedLabel: string;
  id: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, padding: "4px 0" }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 20 }}>
          <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)", cursor: "pointer" }}>
            {label}
          </label>
          {saved && (
            <span
              style={{ fontSize: 11, color: "var(--muted-foreground)" }}
              role="status"
            >
              {savedLabel}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{description}</div>
      </div>
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={isOn}
        aria-label={label}
        onClick={onToggle}
        style={{
          width: 36,
          height: 20,
          minHeight: 44,
          borderRadius: 10,
          background: isOn ? "var(--primary)" : "var(--switch-background)",
          position: "relative",
          cursor: "pointer",
          flexShrink: 0,
          marginTop: 12,
          border: "none",
          padding: 0,
          transition: "background 0.15s",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "var(--card)",
            position: "absolute",
            top: 3,
            left: isOn ? 19 : 3,
            transition: "left 0.15s",
            pointerEvents: "none",
          }}
        />
      </button>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "var(--font-mono)",
          color: tone === "gain" ? "var(--gain)" : tone === "loss" ? "var(--loss)" : "var(--foreground)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "16px 0" }} />;
}