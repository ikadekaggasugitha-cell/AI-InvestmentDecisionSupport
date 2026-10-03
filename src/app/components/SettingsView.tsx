import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "../context/AppContext";
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
}

export function SettingsView({ fx, freshness }: Props) {
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
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
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
        {tab === "profile" && <TabProfile id={id} />}
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

function TabProfile({ id }: { id: boolean }) {
  // TODO: bind to GET /v1/user/profile once the multi-user backend lands
  // (docs/saas-subscription-platform.md, Fase 1). Until then the app has no
  // user store at all: auth.py signs a JWT from AUTH_USERNAME and never reads
  // a users table, so there is no name, email, phone or role to display.
  return (
    <Panel title={id ? "Profil & Akun" : "Profile & Account"}>
      <Unavailable
        id={id}
        title={id ? "Belum ada akun terhubung" : "No account connected"}
        body={
          id
            ? "Backend masih beroperasi sebagai satu operator: login memverifikasi AUTH_USERNAME dan AUTH_PASSWORD tanpa menyimpan data pengguna. Nama, email, nomor WhatsApp, dan peran akan muncul di sini setelah endpoint /v1/user/profile ada."
            : "The backend is still single-operator: login checks AUTH_USERNAME and AUTH_PASSWORD without a user store. Name, email, WhatsApp number, and role will appear here once /v1/user/profile exists."
        }
      />
    </Panel>
  );
}

/* ── Tab 2: Subscription ─────────────────────────────────────────────────── */

function TabSubscription({ id }: { id: boolean }) {
  // TODO: bind to GET /v1/user/subscription and /v1/user/transactions once the
  // subscriptions and transactions tables exist (Fase 1). Rendering a plan
  // card or an invoice table now would mean inventing a subscription the user
  // may not have, and an invoice number that does not exist.
  return (
    <Panel title={id ? "Langganan & Tagihan" : "Subscription & Billing"}>
      <Unavailable
        id={id}
        title={id ? "Belum ada langganan" : "No subscription yet"}
        body={
          id
            ? "Tabel subscriptions dan transactions belum dibuat, jadi AIDSS tidak tahu paket Anda, sisa hari aktif, maupun riwayat pembayaran. Semua angka di tab ini akan dibaca dari server, tidak diketik manual."
            : "The subscriptions and transactions tables do not exist yet, so AIDSS does not know your plan, remaining days, or payment history. Every figure on this tab will be read from the server, never typed in."
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
            border: `1px solid ${o.active ? "var(--primary)" : "var(--border)"}`,
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