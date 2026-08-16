import { useState, useMemo, useEffect } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar, type ViewType } from "./components/Sidebar";
import { Header } from "./components/Header";
import { DashboardView } from "./components/DashboardView";
import { MarketsView } from "./components/MarketsView";
import { PortfolioView } from "./components/PortfolioView";
import { AIAdvisorView } from "./components/AIAdvisorView";
import { RiskView } from "./components/RiskView";
import { NewsView } from "./components/NewsView";
import { SettingsView } from "./components/SettingsView";
import { ReportsView } from "./components/ReportsView";
import { useLiveMarket } from "./hooks/useLiveMarket";
import { useExchangeRate } from "./hooks/useExchangeRate";
import { useNews } from "./hooks/useNews";
import { usePortfolio } from "./hooks/usePortfolio";
import { useWatchlist } from "./hooks/useWatchlist";
import { useWindowWidth } from "./hooks/useWindowWidth";
import { ALERTS_DATA } from "./data/idxData";
import { useTranslation } from "./i18n/translations";

function formatDashboardSubtitle(locale: string): string {
  const now = new Date();
  const wib = new Date(now.getTime() + (7 * 60 - now.getTimezoneOffset()) * 60_000);
  const hh  = wib.getHours().toString().padStart(2, "0");
  const mm  = wib.getMinutes().toString().padStart(2, "0");

  if (locale === "id") {
    const day = wib.getDate();
    const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
    return `Ringkasan portofolio · ${day} ${months[wib.getMonth()]} ${wib.getFullYear()} · ${hh}:${mm} WIB`;
  }
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const day = wib.getDate();
  return `Portfolio overview · ${months[wib.getMonth()]} ${day}, ${wib.getFullYear()} · ${hh}:${mm} WIB`;
}

function AppInner() {
  const [view, setView] = useState<ViewType>("dashboard");
  const { isDark, locale } = useApp();
  const { t } = useTranslation(locale);

  const market        = useLiveMarket();
  // Convert at the feed's USD/IDR, not an invented one.
  const fx            = useExchangeRate(market.fx);
  const { news, loading: newsLoading } = useNews();
  const portfolio     = usePortfolio();
  const watchlistHook = useWatchlist();
  const windowWidth   = useWindowWidth();

  const isMobile = windowWidth < 768;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const alertCount = ALERTS_DATA.filter((a) => a.severity === "high").length;
  const dashSubtitle = useMemo(() => formatDashboardSubtitle(locale), [locale]);

  const viewTitles: Record<ViewType, { title: string; subtitle: string }> = {
    dashboard: { title: t("nav_dashboard"), subtitle: dashSubtitle },
    markets:   { title: t("nav_markets"),   subtitle: t("mkt_subtitle")  },
    portfolio: { title: t("nav_portfolio"), subtitle: t("port_subtitle") },
    advisor:   { title: t("nav_advisor"),   subtitle: t("ai_subtitle")   },
    risk:      { title: t("nav_risk"),      subtitle: t("risk_subtitle") },
    news:      { title: t("nav_news"),      subtitle: t("news_subtitle")    },
    reports:   { title: t("nav_reports"),  subtitle: locale === "id" ? "Unduh laporan performa portofolio" : "Download portfolio performance reports" },
    settings:  { title: t("nav_settings"), subtitle: t("settings_sub")     },
  };

  const cfg = viewTitles[view];

  return (
    <div
      className={`flex h-screen overflow-hidden${isDark ? " dark" : ""}`}
      style={{ background: "var(--background)", fontFamily: "var(--font-sans)", color: "var(--foreground)" }}
    >
      <Sidebar
        currentView={view}
        onViewChange={setView}
        alertCount={alertCount}
        watchlistCount={watchlistHook.count}
        isMarketOpen={market.isMarketOpen}
        isMobile={isMobile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header
          title={cfg.title}
          subtitle={cfg.subtitle}
          market={market}
          fx={fx}
          isMobile={isMobile}
          onMenuToggle={() => setSidebarOpen(true)}
        />
          {view === "dashboard"  && (
            <ErrorBoundary key="dashboard" locale={locale}>
              <DashboardView
                market={market} fx={fx}
                holdings={portfolio.holdings}
                transactions={portfolio.transactions}
              />
            </ErrorBoundary>
          )}
          {view === "markets"    && (
            <ErrorBoundary key="markets" locale={locale}>
              <MarketsView
                market={market} fx={fx}
                watchlist={watchlistHook.watchlist}
                onToggleWatchlist={watchlistHook.toggle}
              />
            </ErrorBoundary>
          )}
          {view === "portfolio"  && (
            <ErrorBoundary key="portfolio" locale={locale}>
              <PortfolioView
                market={market} fx={fx}
                holdings={portfolio.holdings}
                onAdd={portfolio.addHolding}
                onUpdate={portfolio.updateHolding}
                onRemove={portfolio.removeHolding}
              />
            </ErrorBoundary>
          )}
          {view === "advisor"    && <ErrorBoundary key="advisor"  locale={locale}><AIAdvisorView /></ErrorBoundary>}
          {view === "risk"       && <ErrorBoundary key="risk"     locale={locale}><RiskView market={market} /></ErrorBoundary>}
          {view === "news"       && <ErrorBoundary key="news"     locale={locale}><NewsView news={news} loading={newsLoading} /></ErrorBoundary>}
          {view === "reports"    && <ErrorBoundary key="reports"  locale={locale}><ReportsView /></ErrorBoundary>}
          {view === "settings"   && <ErrorBoundary key="settings" locale={locale}><SettingsView fx={fx} /></ErrorBoundary>}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppInner />
      </AppProvider>
    </ErrorBoundary>
  );
}
