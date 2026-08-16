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
  Zap,
  Bell,
  X,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";

export type ViewType =
  | "dashboard"
  | "markets"
  | "portfolio"
  | "advisor"
  | "risk"
  | "news"
  | "reports"
  | "settings";

interface SidebarProps {
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
    { id: "advisor",   label: t("nav_advisor"),    icon: Brain, badge: "5" },
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
    background: "#050810",
    borderRight: "1px solid rgba(255,255,255,0.05)",
    ...(isMobile ? {
      position: "fixed",
      top: 0,
      left: 0,
      height: "100vh",
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
            background: "rgba(0,0,0,0.55)",
            zIndex: 49,
          }}
          aria-hidden="true"
        />
      )}

      <aside className="flex flex-col h-full" style={sidebarStyle}>
        {/* Logo */}
        <div
          className="flex items-center gap-2.5 px-5"
          style={{
            height: 56,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            flexShrink: 0,
          }}
        >
          <div
            className="flex items-center justify-center rounded"
            style={{ width: 28, height: 28, background: "#00d4aa" }}
          >
            <Zap size={15} color="#060a0f" strokeWidth={2.5} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, color: "#e2e8f0", letterSpacing: "0.06em" }}>
              AIDSS
            </div>
            <div style={{ fontSize: 10, color: "#4a6480", letterSpacing: "0.04em" }}>
              AI Decision System
            </div>
          </div>
          {isMobile && (
            <button
              onClick={onClose}
              aria-label="Tutup menu"
              style={{ background: "none", border: "none", cursor: "pointer", color: "#4a6480", display: "flex", padding: 4 }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Market status */}
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: isMarketOpen ? "#00d4aa" : "#5a7a9a",
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 10, color: isMarketOpen ? "#00d4aa" : "#5a7a9a", fontFamily: "var(--font-mono)", letterSpacing: "0.05em", fontWeight: 600 }}>
              {t(isMarketOpen ? "market_open" : "market_closed")}
            </div>
            <div style={{ fontSize: 9, color: "#3a5570", marginTop: 1, lineHeight: 1.4 }}>
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
                  background: active ? "rgba(0, 212, 170, 0.08)" : "transparent",
                  borderLeft: `2px solid ${active ? "#00d4aa" : "transparent"}`,
                  cursor: "pointer",
                }}
              >
                <Icon
                  size={15}
                  style={{ color: active ? "#00d4aa" : "#4a6480", flexShrink: 0 }}
                />
                <span
                  style={{
                    fontSize: 13,
                    color: active ? "#c8d6e5" : "#6b8ba8",
                    fontWeight: active ? 500 : 400,
                    flex: 1,
                  }}
                >
                  {item.label}
                </span>
                {item.badge && (
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      fontWeight: 600,
                      color: "#00d4aa",
                      background: "rgba(0, 212, 170, 0.12)",
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
              background: currentView === "settings" ? "rgba(0, 212, 170, 0.08)" : "transparent",
              borderLeft: `2px solid ${currentView === "settings" ? "#00d4aa" : "transparent"}`,
              cursor: "pointer",
            }}
          >
            <Settings size={15} style={{ color: currentView === "settings" ? "#00d4aa" : "#4a6480" }} />
            <span style={{ fontSize: 13, color: currentView === "settings" ? "#c8d6e5" : "#6b8ba8" }}>
              {t("nav_settings")}
            </span>
          </button>

          <button
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-left"
            style={{
              background: alertCount > 0 ? "rgba(255, 71, 87, 0.06)" : "transparent",
              borderLeft: "2px solid transparent",
              cursor: "pointer",
            }}
          >
            <Bell size={15} style={{ color: alertCount > 0 ? "#ff4757" : "#4a6480" }} />
            <span style={{ fontSize: 13, color: alertCount > 0 ? "#c8d6e5" : "#6b8ba8", flex: 1 }}>
              {t("nav_alerts")}
            </span>
            {alertCount > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  color: "#fff",
                  background: "#ff4757",
                  borderRadius: 3,
                  padding: "1px 5px",
                }}
              >
                {alertCount}
              </span>
            )}
          </button>
        </div>

        {/* User */}
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
        >
          <div
            className="flex items-center justify-center rounded flex-shrink-0"
            style={{
              width: 30,
              height: 30,
              background: "#0f2a45",
              color: "#4da6ff",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              border: "1px solid rgba(77,166,255,0.15)",
            }}
          >
            JD
          </div>
          <div className="overflow-hidden flex-1 min-w-0">
            <div style={{ fontSize: 12, color: "#8ba3be", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              James Davidson
            </div>
            <div style={{ fontSize: 10, color: "#4a6480" }}>
              {locale === "id" ? "Manajer Portofolio" : "Portfolio Manager"}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
