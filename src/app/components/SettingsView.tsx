import { useState, useEffect, useRef, type ElementType, type ReactNode } from "react";
import { Sun, Moon, Globe, DollarSign, Info, Monitor, Bell, Check } from "lucide-react";
import { useApp } from "../context/AppContext";
import type { ExchangeRateData } from "../hooks/useExchangeRate";

const STORAGE_NOTIF = "aidss-notifications";

type NotifKey = "ai_signals" | "risk_alerts" | "corp_news";

function readNotifPrefs(): Record<NotifKey, boolean> {
  const defaults: Record<NotifKey, boolean> = {
    ai_signals:  true,
    risk_alerts: true,
    corp_news:   false,
  };
  try {
    const saved = localStorage.getItem(STORAGE_NOTIF);
    if (saved) return { ...defaults, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return defaults;
}

interface Props { fx: ExchangeRateData; }

export function SettingsView({ fx }: Props) {
  const { isDark, toggleTheme, locale, toggleLocale } = useApp();
  const id = locale === "id";

  /* Notification preferences — persisted */
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>(readNotifPrefs);
  const [savedToast, setSavedToast] = useState<NotifKey | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current); };
  }, []);

  function toggleNotif(key: NotifKey) {
    setNotifs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_NOTIF, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    setSavedToast(key);
    toastTimerRef.current = setTimeout(() => setSavedToast(null), 1800);
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 640 }}>

      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)", margin: "0 0 4px" }}>
          {id ? "Pengaturan" : "Settings"}
        </h2>
        <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: 0 }}>
          {id ? "Konfigurasi tampilan, bahasa, dan preferensi aplikasi" : "Configure display, language, and application preferences"}
        </p>
      </div>

      {/* Appearance */}
      <Section title={id ? "Tampilan" : "Appearance"} icon={Monitor}>
        <SettingRow
          label={id ? "Tema" : "Theme"}
          description={id ? "Pilih tampilan terang atau gelap" : "Choose between light and dark appearance"}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <ThemeOption
              label={id ? "Terang" : "Light"}
              icon={<Sun size={14} />}
              active={!isDark}
              onClick={() => isDark && toggleTheme()}
            />
            <ThemeOption
              label={id ? "Gelap" : "Dark"}
              icon={<Moon size={14} />}
              active={isDark}
              onClick={() => !isDark && toggleTheme()}
            />
          </div>
        </SettingRow>
      </Section>

      {/* Language */}
      <Section title={id ? "Bahasa" : "Language"} icon={Globe}>
        <SettingRow
          label={id ? "Bahasa Antarmuka" : "Interface Language"}
          description={id ? "Pilih bahasa untuk teks antarmuka" : "Choose the language for interface text"}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <LangOption label="Indonesia" code="ID" active={locale === "id"} onClick={() => locale === "en" && toggleLocale()} />
            <LangOption label="English"   code="EN" active={locale === "en"} onClick={() => locale === "id" && toggleLocale()} />
          </div>
        </SettingRow>
      </Section>

      {/* Currency */}
      <Section title={id ? "Mata Uang" : "Currency"} icon={DollarSign}>
        <SettingRow
          label={id ? "Tampilan Nilai" : "Value Display"}
          description={id ? "Pilih mata uang untuk menampilkan nilai portofolio" : "Choose currency for displaying portfolio values"}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <CurrencyOption
              label="IDR (Rupiah)"
              active={!fx.showUsd}
              onClick={() => fx.showUsd && fx.toggleCurrency()}
            />
            <CurrencyOption
              label="USD (Dollar)"
              active={fx.showUsd}
              onClick={() => !fx.showUsd && fx.toggleCurrency()}
            />
          </div>
        </SettingRow>

        <Divider />

        {/* Live exchange rate card */}
        <div
          style={{
            background: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "16px 20px",
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            marginTop: 16,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "var(--neutral-bg)",
              border: "1px solid color-mix(in srgb, var(--neutral) 20%, transparent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <DollarSign size={16} style={{ color: "var(--neutral)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)", marginBottom: 8 }}>
              {id ? "Kurs USD/IDR Real-time" : "Live USD/IDR Exchange Rate"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              <RateItem label={id ? "Kurs Saat Ini" : "Current Rate"} value={`Rp ${fx.usdIdr.toLocaleString("id-ID")}`} />
              <RateItem label={id ? "Perubahan" : "Change"} value={`${fx.change >= 0 ? "+" : ""}${fx.change.toLocaleString("id-ID")}`} positive={fx.change <= 0} />
              <RateItem label="%" value={`${fx.changePct >= 0 ? "+" : ""}${fx.changePct.toFixed(3)}%`} positive={fx.changePct <= 0} />
            </div>
            <p style={{ fontSize: 11, color: "var(--muted-foreground)", margin: "12px 0 0" }}>
              {id
                ? "Kurs diperbarui setiap 8 detik menggunakan simulasi pasar forex real-time. Rupiah melemah (+IDR) berarti potensi kerugian untuk investor Indonesia."
                : "Rate updates every 8 seconds using real-time forex market simulation. Rupiah weakening (+IDR per USD) represents purchasing power loss for IDR-based portfolios."}
            </p>
          </div>
        </div>
      </Section>

      {/* Notifications */}
      <Section title={id ? "Notifikasi" : "Notifications"} icon={Bell}>
        <ToggleRow
          label={id ? "Sinyal AI Baru" : "New AI Signals"}
          description={id ? "Notifikasi ketika model AI menghasilkan sinyal probabilitas baru" : "Notify when AI model generates new probability signals"}
          isOn={notifs.ai_signals}
          saved={savedToast === "ai_signals"}
          onToggle={() => toggleNotif("ai_signals")}
          id="notif-ai-signals"
        />
        <Divider />
        <ToggleRow
          label={id ? "Peringatan Risiko" : "Risk Alerts"}
          description={id ? "Notifikasi ketika eksposur portofolio melebihi ambang batas" : "Notify when portfolio exposure exceeds thresholds"}
          isOn={notifs.risk_alerts}
          saved={savedToast === "risk_alerts"}
          onToggle={() => toggleNotif("risk_alerts")}
          id="notif-risk-alerts"
        />
        <Divider />
        <ToggleRow
          label={id ? "Berita Korporasi" : "Corporate News"}
          description={id ? "Notifikasi untuk kepemilikan aktif" : "Notify for active holdings"}
          isOn={notifs.corp_news}
          saved={savedToast === "corp_news"}
          onToggle={() => toggleNotif("corp_news")}
          id="notif-corp-news"
        />
      </Section>

      {/* About */}
      <Section title={id ? "Tentang" : "About"} icon={Info}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {[
            [id ? "Versi Aplikasi" : "App Version", "4.2.1"],
            [id ? "Model AI" : "AI Model",          "AIDSS Quant v4.2"],
            [id ? "Sumber Data" : "Data Source",    "IDX / Yahoo Finance"],
            [id ? "Bursa" : "Exchange",             "BEI (IDX)"],
            [id ? "Zona Waktu" : "Timezone",        "WIB (UTC+7)"],
            [id ? "Terakhir Latih" : "Last Trained","20 Jul 2026"],
          ].map(([label, value]) => (
            <div key={label} style={{ background: "var(--muted)", borderRadius: 6, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{value}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ── Primitives ──────────────────────────────────────────────────────────── */
function Section({ title, icon: Icon, children }: { title: string; icon: ElementType; children: ReactNode }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={14} style={{ color: "var(--muted-foreground)" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{title}</span>
      </div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{description}</div>
      </div>
      {children}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  isOn: boolean;
  onToggle: () => void;
  saved: boolean;
  id: string;
}

function ToggleRow({ label, description, isOn, onToggle, saved, id }: ToggleRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, padding: "4px 0" }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)", cursor: "pointer" }}>
            {label}
          </label>
          {saved && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--gain)",
                background: "var(--gain-bg)", borderRadius: 3, padding: "1px 6px",
              }}
            >
              <Check size={9} />
              {/* "Tersimpan" text purposely omitted to keep it compact */}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{description}</div>
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={isOn}
        onClick={onToggle}
        style={{
          width: 36, height: 20, borderRadius: 10,
          background: isOn ? "var(--primary)" : "var(--switch-background)",
          position: "relative",
          cursor: "pointer",
          flexShrink: 0,
          marginTop: 2,
          border: "none",
          padding: 0,
          transition: "background 0.15s",
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: "50%", background: "#fff",
          position: "absolute", top: 3,
          left: isOn ? 19 : 3,
          transition: "left 0.15s",
          pointerEvents: "none",
        }} />
      </button>
    </div>
  );
}

function ThemeOption({ label, icon, active, onClick }: { label: string; icon: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 14px", borderRadius: 6, cursor: "pointer",
        background: active ? "var(--accent)" : "var(--muted)",
        border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
        color: active ? "var(--accent-foreground)" : "var(--muted-foreground)",
        fontSize: 12, fontWeight: active ? 500 : 400,
        transition: "all 0.1s",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function LangOption({ label, code, active, onClick }: { label: string; code: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        padding: "8px 16px", borderRadius: 6, cursor: "pointer",
        background: active ? "var(--accent)" : "var(--muted)",
        border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
        color: active ? "var(--accent-foreground)" : "var(--muted-foreground)",
        transition: "all 0.1s",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{code}</span>
      <span style={{ fontSize: 10 }}>{label}</span>
    </button>
  );
}

function CurrencyOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px", borderRadius: 6, cursor: "pointer",
        background: active ? "var(--accent)" : "var(--muted)",
        border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
        color: active ? "var(--accent-foreground)" : "var(--muted-foreground)",
        fontSize: 12, fontWeight: active ? 500 : 400,
        transition: "all 0.1s",
      }}
    >
      {label}
    </button>
  );
}

function RateItem({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{
        fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)",
        color: positive === undefined ? "var(--foreground)" : positive ? "var(--gain)" : "var(--loss)",
      }}>
        {value}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }} />;
}
