import { type ElementType, type CSSProperties } from "react";
import {
  LayoutDashboard,
  TrendingUp,
  PieChart,
  Brain,
  ShieldAlert,
  Newspaper,
  FileBarChart2,
  Settings,
  Bell,
  X,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";
import type { Account } from "../hooks/useAuth";
import logoUrl from "../../assets/aidss-logo.svg";

export type ViewType =
  | "dashboard"
  | "markets"
  | "portfolio"
  | "advisor"
  | "risk"
  | "news"
  | "reports"
  | "settings"
  | "alerts";

interface SidebarProps {
  account:        Account | null;
  currentView:    ViewType;
  onViewChange:   (view: ViewType) => void;
  alertCount:     number;
  watchlistCount: number;
  isMarketOpen:   boolean;
  isMobile?:      boolean;
  isOpen?:        boolean;
  onClose?:       () => void;
}

export function Sidebar({
  account,
  currentView,
  onViewChange,
  alertCount,
  watchlistCount,
  isMarketOpen,
  isMobile = false,
  isOpen = false,
  onClose,
}: SidebarProps) {
  const { locale } = useApp();
  const { t } = useTranslation(locale);

  const navItems: Array<{ id: ViewType; label: string; icon: ElementType; badge?: string }> = [
    { id: "dashboard", label: t("nav_dashboard"), icon: LayoutDashboard },
    { id: "markets",   label: t("nav_markets"),   icon: TrendingUp, badge: watchlistCount > 0 ? String(watchlistCount) : undefined },
    { id: "portfolio", label: t("nav_portfolio"),  icon: PieChart },
    { id: "advisor",   label: t("nav_advisor"),    icon: Brain },
    { id: "risk",      label: t("nav_risk"),       icon: ShieldAlert },
    { id: "news",      label: t("nav_news"),       icon: Newspaper },
    { id: "reports",   label: t("nav_reports"),    icon: FileBarChart2 },
  ];

  function handleNavClick(view: ViewType) {
    onViewChange(view);
    if (isMobile && onClose) onClose();
  }

  const sidebarStyle: CSSProperties = {
    width: 220,
    minWidth: 220,
    background: "var(--sidebar)",
    borderRight: "1px solid var(--sidebar-border)",
    ...(isMobile ? {
      position: "fixed",
      top: 0,
      left: 0,
      height: "100dvh",
      zIndex: 50,
      transform: isOpen ? "translateX(0)" : "translateX(-100%)",
      transition: "transform 0.25s ease",
    } : {}),
  };

  return (
    <>
      {isMobile && isOpen && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(9,16,26,0.55)",
            zIndex: 49,
          }}
          aria-hidden="true"
        />
      )}

      <aside className="flex flex-col h-full" style={sidebarStyle}>
        {/* Logo resmi: keputusan pemilik 2026-10-26 (LOGO-AIDSS.svg yang kini
            hidup di assets). Glyphnya putih di atas latar navy sidebar;
            keterangan produk tetap ditampilkan di sampingnya. */}
        <div
          className="flex items-center gap-2.5 px-5"
          style={{
            height: 56,
            borderBottom: "1px solid var(--sidebar-border)",
            flexShrink: 0,
          }}
        >
          <img
            src={logoUrl}
            alt="AIDSS"
            style={{ height: 26, width: "auto", display: "block", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--sidebar-foreground)", letterSpacing: "0.02em", lineHeight: 1.3 }}>
              AI Decision Support
            </div>
          </div>
          {isMobile && (
            <button
              onClick={onClose}
              aria-label="Tutup menu"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--sidebar-foreground)", display: "flex", padding: 4, flexShrink: 0 }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Market status. The dot marks a real state (open/closed), so it earns
            its colour; it carries the label with it. */}
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--sidebar-border)" }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: isMarketOpen ? "var(--sidebar-primary)" : "var(--sidebar-foreground)",
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 11, color: isMarketOpen ? "var(--sidebar-primary)" : "var(--sidebar-foreground)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
              {t(isMarketOpen ? "market_open" : "market_closed")}
            </div>
            <div style={{ fontSize: 11, color: "var(--sidebar-foreground)", opacity: 0.75, marginTop: 1, lineHeight: 1.4 }}>
              09:00–12:00 · 13:30–15:50 WIB
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto flex flex-col gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded text-left"
                style={{
                  /* Owner mapping: Slate Blue carries "selected states", so the
                     selection reads without spending the one teal moment. */
                  background: active ? "var(--sidebar-selected)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <Icon
                  size={15}
                  style={{ color: active ? "var(--sidebar-accent-foreground)" : "var(--sidebar-foreground)", flexShrink: 0 }}
                />
                <span
                  style={{
                    fontSize: 13,
                    color: active ? "var(--sidebar-accent-foreground)" : "var(--sidebar-foreground)",
                    fontWeight: active ? 600 : 400,
                    flex: 1,
                  }}
                >
                  {item.label}
                </span>
                {item.badge && (
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      fontWeight: 600,
                      color: "var(--sidebar-accent-foreground)",
                      background: "var(--sidebar-badge)",
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Alerts + Settings */}
        <div className="px-3 pb-2 flex flex-col gap-0.5">
          <button
            onClick={() => handleNavClick("settings")}
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-left"
            style={{
              background: currentView === "settings" ? "var(--sidebar-selected)" : "transparent",
              cursor: "pointer",
            }}
          >
            <Settings size={15} style={{ color: currentView === "settings" ? "var(--sidebar-accent-foreground)" : "var(--sidebar-foreground)" }} />
            <span style={{ fontSize: 13, fontWeight: currentView === "settings" ? 600 : 400, color: currentView === "settings" ? "var(--sidebar-accent-foreground)" : "var(--sidebar-foreground)" }}>
              {t("nav_settings")}
            </span>
          </button>

          <button
            onClick={() => handleNavClick("alerts")}
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-left"
            style={{
              /* The count is the signal, not the row: the crimson badge marks a
                 queue that needs action, and the row itself stays quiet. */
              background: currentView === "alerts" ? "var(--sidebar-selected)" : "transparent",
              cursor: "pointer",
            }}
          >
            <Bell size={15} style={{ color: alertCount > 0 || currentView === "alerts" ? "var(--sidebar-danger)" : "var(--sidebar-foreground)" }} />
            <span style={{ fontSize: 13, fontWeight: currentView === "alerts" ? 600 : 400, color: currentView === "alerts" ? "var(--sidebar-accent-foreground)" : alertCount > 0 ? "var(--sidebar-accent-foreground)" : "var(--sidebar-foreground)", flex: 1 }}>
              {t("nav_alerts")}
            </span>
            {alertCount > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  color: "var(--sidebar-danger-foreground)",
                  background: "var(--sidebar-danger)",
                  borderRadius: 3,
                  padding: "1px 5px",
                }}
              >
                {alertCount}
              </span>
            )}
          </button>
        </div>

        {/* The signed-in account, as /v1/auth/me reports it.

            This block used to name a person who did not exist. The old auth path
            signed a JWT from AUTH_USERNAME and never read a users table, so the
            name, job title and initials avatar were fabricated and shown as fact.
            Now there is a real account to read — but nothing here is derived or
            defaulted: no monogram, no job title, and the role label appears only
            for an actual administrator, because "Subscription" would be a claim
            about payment that this endpoint deliberately does not make. */}
        <div
          className="px-5 py-3"
          style={{ borderTop: "1px solid var(--sidebar-border)" }}
        >
          <div style={{ fontSize: 11, color: "var(--sidebar-foreground)" }}>
            {account
              ? account.role === "admin"
                ? locale === "id" ? "Administrator" : "Administrator"
                : locale === "id" ? "Akun" : "Account"
              : locale === "id" ? "Akun" : "Account"}
          </div>
          <div
            style={{ fontSize: 13, color: "var(--sidebar-accent-foreground)", marginTop: 2 }}
            title={account?.email}
          >
            {account?.full_name ?? (locale === "id" ? "Belum ada akun terhubung" : "No account connected")}
          </div>
        </div>

      </aside>
    </>
  );
}
