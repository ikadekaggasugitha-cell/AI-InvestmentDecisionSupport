import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import { AppProvider, useApp } from "./context/AppContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar, type ViewType } from "./components/Sidebar";
import { Header } from "./components/Header";
import { ViewSkeleton } from "./components/ViewSkeleton";
// Views are code-split: each is its own chunk, loaded on first navigation to
// it. Only the shell (Sidebar/Header) and the initial dashboard cost anything
// up front — the app previously bundled all eight views into one eager chunk,
// which is why the build warned about a >500 kB bundle.
const DashboardView = lazy(() => import("./components/DashboardView").then((m) => ({ default: m.DashboardView })));
const MarketsView   = lazy(() => import("./components/MarketsView").then((m) => ({ default: m.MarketsView })));
const PortfolioView = lazy(() => import("./components/PortfolioView").then((m) => ({ default: m.PortfolioView })));
const AIAdvisorView = lazy(() => import("./components/AIAdvisorView").then((m) => ({ default: m.AIAdvisorView })));
const RiskView      = lazy(() => import("./components/RiskView").then((m) => ({ default: m.RiskView })));
const NewsView      = lazy(() => import("./components/NewsView").then((m) => ({ default: m.NewsView })));
const SettingsView  = lazy(() => import("./components/SettingsView").then((m) => ({ default: m.SettingsView })));
const ReportsView   = lazy(() => import("./components/ReportsView").then((m) => ({ default: m.ReportsView })));
import { useLiveMarket } from "./hooks/useLiveMarket";
import { useExchangeRate } from "./hooks/useExchangeRate";
import { useNews } from "./hooks/useNews";
import { usePortfolio } from "./hooks/usePortfolio";
import { useWatchlist } from "./hooks/useWatchlist";
import { useWindowWidth } from "./hooks/useWindowWidth";
import { ALERTS_DATA } from "./data/idxData";
import { useTranslation } from "./i18n/translations";
import { Toaster } from "./components/ui/sonner";
import { onAuthExpired } from "./config/api";
import { toast } from "sonner";

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

  // Surface an expired/rejected session instead of letting hooks fall back to
  // seed data silently. apiFetch clears the token and fires this on a 401.
  useEffect(() => {
    return onAuthExpired(() => {
      toast.error(t("auth_expired_title"), {
        description: t("auth_expired_desc"),
        duration: Infinity,
        id: "auth-expired", // one persistent toast, not one per failed request
      });
    });
  }, [t]);

  const alertCount = ALERTS_DATA.filter((a) => a.severity === "high").length;
  const dashSubtitle = useMemo(() => formatDashboardSubtitle(locale), [locale]);

  const viewTitles: Record<ViewType, { title: string; subtitle: string }> = {
    dashboard: { title: t("nav_dashboard"), subtitle: dashSubtitle },
    markets:   { title: t("nav_markets"),   subtitle: t("mkt_subtitle")  },
    portfolio: { title: t("nav_portfolio"), subtitle: t("port_subtitle") },
    advisor:   { title: t("nav_advisor"),   subtitle: t("ai_subtitle")   },
    risk:      { title: t("nav_risk"),      subtitle: t("risk_subtitle") },
    news:      { title: t("nav_news"),      subtitle: t("news_subtitle")    },
    reports:   { title: t("nav_reports"),  subtitle: t("reports_subtitle") },
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
          <Suspense fallback={<ViewSkeleton />}>
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
          </Suspense>
      </div>
      <Toaster theme={isDark ? "dark" : "light"} position="top-right" richColors />
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
