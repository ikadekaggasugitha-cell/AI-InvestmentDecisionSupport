import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
const AlertsView    = lazy(() => import("./components/AlertsView").then((m) => ({ default: m.AlertsView })));
// Lazy for the same reason as the rest, and it keeps the admin bundle out of the
// chunk every signed-in person downloads — including the ones who will never be
// allowed to see it.
const AdminView     = lazy(() => import("./components/AdminView").then((m) => ({ default: m.AdminView })));
import { useLiveMarket } from "./hooks/useLiveMarket";
import { useExchangeRate } from "./hooks/useExchangeRate";
import { useNews } from "./hooks/useNews";
import { usePortfolio } from "./hooks/usePortfolio";
import { useWatchlist } from "./hooks/useWatchlist";
import { useWindowWidth } from "./hooks/useWindowWidth";
import { useAlerts } from "./hooks/useAlerts";
import { useTranslation } from "./i18n/translations";
import { Toaster } from "./components/ui/sonner";
import { onAuthExpired } from "./config/api";
import { PaywallNotice } from "./components/PaywallNotice";
import { useAuth } from "./hooks/useAuth";
import { useOverlayScrollbars } from "./hooks/useOverlayScrollbars";
import { AuthScreen } from "./components/AuthScreen";
import { PublicPricing } from "./components/PublicPricing";
import { PublicFeatures } from "./components/PublicFeatures";
import { SuspensionScreen } from "./components/SuspensionScreen";
import { planFromSearch, writePlanIntent } from "./planIntent";
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
  const { isDark, locale, locked, subscription, refreshSubscription } = useApp();
  const { t } = useTranslation(locale);
  const auth = useAuth();
  useOverlayScrollbars();
  const navigate = useNavigate();
  const location = useLocation();

  const market        = useLiveMarket();
  // Convert at the feed's USD/IDR, not an invented one.
  const fx            = useExchangeRate(market.fx);
  const { news, loading: newsLoading, isLive: newsIsLive, error: newsError, retry: newsRetry } = useNews();
  const portfolio     = usePortfolio();
  const watchlistHook = useWatchlist();
  const windowWidth   = useWindowWidth();

  const isMobile = windowWidth < 768;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Cross-view "open this stock": Dashboard rows and the Header search jump to
  // Markets pre-filtered to a symbol. Bumped each selection so re-selecting the
  // same symbol still re-applies the filter.
  const [focus, setFocus] = useState<{ symbol: string; nonce: number } | null>(null);
  const selectSymbol = (symbol: string) => {
    setFocus((f) => ({ symbol, nonce: (f?.nonce ?? 0) + 1 }));
    setView("markets");
  };

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

  /* Destructured once so the effect below can depend on the callback itself:
     the exhaustive-deps rule wants the exact function, not a property of the
     per-render hook object. markAllRead is useCallback-stable (it changes
     only with the alert list) and idempotent, so the dep stays small and
     honest. */
  const {
    visibleAlerts: alertList,
    isLive: alertsIsLive,
    unreadCount: alertCount,
    markAllRead,
    dismiss: alertDismiss,
    clearAll: alertClearAll,
  } = useAlerts();

  // Opening the Peringatan view marks everything read, so the badge clears the
  // moment the user looks at their alerts (and stays cleared — the read state is
  // persisted). This is what the badge count is supposed to track.
  useEffect(() => {
    if (view === "alerts") markAllRead();
  }, [view, markAllRead]);

  // Public screens cross-link with hashes (the features screen's Catatan
  // lands on the sheet's disclaimer). A client-side navigation never scrolls
  // to a fragment on its own (and a fresh load can race the render), so the
  // effect does it once the target element exists. Smooth scrolling honours
  // the visitor's reduced-motion request.
  useEffect(() => {
    if (!location.hash) return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(location.hash.slice(1))
        ?.scrollIntoView({
          behavior:
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
          block: "start",
        });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [location.hash, location.pathname]);

  const dashSubtitle = useMemo(() => formatDashboardSubtitle(locale), [locale]);

  // The gate. Three states, because "checking" is genuinely different from
  // "signed out": until /v1/auth/me answers, we do not know, and redirecting on
  // unknown would bounce a signed-in person to the login page on every refresh.
  //
  // While checking, render nothing rather than the dashboard. The alternative is
  // a frame of the real interface at someone who turns out not to be signed in.
  if (auth.status === "checking") {
    return (
      <div
        className={isDark ? "dark" : ""}
        style={{
          minHeight: "100dvh",
          background: "var(--background)",
          fontFamily: "var(--font-sans)",
        }}
      />
    );
  }

  if (auth.status === "signed-out") {
    // The public price sheet is a visitor's first view: `/` lands on it, and
    // `/harga` keeps working as its own URL. The price is the fact they are
    // exercising — the person deciding whether to subscribe is, by
    // definition, not yet subscribed. The forms are real URLs too, so a
    // refresh (or a shared link) returns to the same surface. Picking a price
    // line writes a client-side intent and walks into the signup form with
    // `?plan=`; the payment itself still starts inside the app (R-26).
    // `/fitur` is the second public surface: the features the sheet's pillar
    // band compresses, expanded in full.
    if (location.pathname === "/fitur") {
      return (
        <div className={isDark ? "dark" : ""} style={{ fontFamily: "var(--font-sans)" }}>
          <PublicFeatures
            locale={locale}
            onEnter={() => navigate("/masuk")}
            onSignUp={() => navigate("/daftar")}
            onViewPricing={() => navigate("/")}
            onViewNotes={() => navigate("/#catatan")}
          />
        </div>
      );
    }
    if (location.pathname === "/masuk" || location.pathname === "/login") {
      return (
        <div className={isDark ? "dark" : ""} style={{ fontFamily: "var(--font-sans)" }}>
          <AuthScreen
            auth={auth}
            locale={locale}
            initialMode="login"
            onAuthed={() => { refreshSubscription(); navigate("/", { replace: true }); }}
            onViewPricing={() => navigate("/")}
          />
        </div>
      );
    }
    if (location.pathname === "/daftar" || location.pathname === "/signup") {
      return (
        <div className={isDark ? "dark" : ""} style={{ fontFamily: "var(--font-sans)" }}>
          <AuthScreen
            auth={auth}
            locale={locale}
            initialMode="signup"
            initialPlan={planFromSearch(location.search)}
            onAuthed={() => { refreshSubscription(); navigate("/", { replace: true }); }}
            onViewPricing={() => navigate("/")}
          />
        </div>
      );
    }
    return (
      <div className={isDark ? "dark" : ""} style={{ fontFamily: "var(--font-sans)" }}>
        <PublicPricing
          locale={locale}
          onEnter={() => navigate("/masuk")}
          onSignUp={() => navigate("/daftar")}
          onViewFeatures={() => navigate("/fitur")}
          onPickPlan={(plan) => {
            writePlanIntent(plan);
            navigate(`/daftar?plan=${plan}`);
          }}
        />
      </div>
    );
  }

  // A closed account with a reason: the app frame is replaced, because every
  // data route refuses this account server-side. The screen carries the billing
  // pane itself for a lapse, and a refusal with no payment path for a ban.
  // Signed-in, not signed-out — the session is valid; only the data is closed.
  const suspensionReason = auth.account?.blockedReason;
  if (suspensionReason) {
    return (
      <div className={isDark ? "dark" : ""} style={{ fontFamily: "var(--font-sans)" }}>
        <SuspensionScreen
          reason={suspensionReason}
          onRefresh={() => auth.refresh()}
        />
      </div>
    );
  }

  const viewTitles: Record<ViewType, { title: string; subtitle: string }> = {
    dashboard: { title: t("nav_dashboard"), subtitle: dashSubtitle },
    markets:   { title: t("nav_markets"),   subtitle: t("mkt_subtitle")  },
    portfolio: { title: t("nav_portfolio"), subtitle: t("port_subtitle") },
    advisor:   { title: t("nav_advisor"),   subtitle: t("ai_subtitle")   },
    risk:      { title: t("nav_risk"),      subtitle: t("risk_subtitle") },
    news:      { title: t("nav_news"),      subtitle: t("news_subtitle")    },
    reports:   { title: t("nav_reports"),  subtitle: t("reports_subtitle") },
    settings:  { title: t("nav_settings"), subtitle: t("settings_sub")     },
    alerts:    { title: t("nav_alerts"),   subtitle: t("alerts_subtitle")  },
  };

  const cfg = viewTitles[view];

  // The two auth paths are real URLs so they survive a refresh and can be
  // linked to. Both redirect into the shell, because by this point the gate above
  // has already established that there is a session; if there is not, the gate
  // renders the auth screen instead and none of this is reached.
  const shell = (
    <div
      className={`flex h-dvh overflow-hidden${isDark ? " dark" : ""}`}
      style={{ background: "var(--background)", fontFamily: "var(--font-sans)", color: "var(--foreground)" }}
    >
      <Sidebar
        account={auth.account}
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
          onSelectSymbol={selectSymbol}
        />
        {/* One banner for the whole app, not one per panel. Every paid view
            refusing at once is one fact about the account; saying it eight times
            is noise that hides the one thing worth reading. */}
        {locked && (
          <PaywallNotice locale={locale} onOpenSettings={() => setView("settings")} />
        )}
        {/* `unknown` gets its own line rather than nothing. A server that will
            not answer is not the same as an account with no subscription, and
            silently showing nothing there is the claim that they are the same. */}
        {!locked && subscription.kind === "unknown" && (
          <PaywallNotice
            locale={locale}
            reason="unknown"
            onOpenSettings={() => setView("settings")}
          />
        )}
          <Suspense fallback={<ViewSkeleton />}>
          {view === "dashboard"  && (
            <ErrorBoundary key="dashboard" locale={locale}>
              <DashboardView
                market={market} fx={fx}
                holdings={portfolio.holdings}
                transactions={portfolio.transactions}
                onSelectSymbol={selectSymbol}
                alerts={alertList}
                alertsIsLive={alertsIsLive}
                onOpenPortfolio={() => setView("portfolio")}
              />
            </ErrorBoundary>
          )}
          {view === "markets"    && (
            <ErrorBoundary key="markets" locale={locale}>
              <MarketsView
                market={market} fx={fx}
                watchlist={watchlistHook.watchlist}
                onToggleWatchlist={watchlistHook.toggle}
                focusSymbol={focus?.symbol ?? null}
                focusNonce={focus?.nonce ?? 0}
              />
            </ErrorBoundary>
          )}
          {view === "portfolio"  && (
            <ErrorBoundary key="portfolio" locale={locale}>
              <PortfolioView
                market={market} fx={fx}
                holdings={portfolio.holdings}
                loading={portfolio.loading}
                error={portfolio.error}
                failure={portfolio.failure}
                onAdd={portfolio.addHolding}
                onUpdate={portfolio.updateHolding}
                onRemove={portfolio.removeHolding}
              />
            </ErrorBoundary>
          )}
          {view === "advisor"    && <ErrorBoundary key="advisor"  locale={locale}><AIAdvisorView market={market} /></ErrorBoundary>}
          {view === "risk"       && <ErrorBoundary key="risk"     locale={locale}><RiskView market={market} /></ErrorBoundary>}
          {view === "news"       && <ErrorBoundary key="news"     locale={locale}><NewsView news={news} loading={newsLoading} isLive={newsIsLive} error={newsError} retry={newsRetry} /></ErrorBoundary>}
          {view === "reports"    && <ErrorBoundary key="reports"  locale={locale}><ReportsView /></ErrorBoundary>}
          {view === "settings"   && <ErrorBoundary key="settings" locale={locale}><SettingsView fx={fx} freshness={market.freshness} auth={auth} onSignedOut={() => navigate("/", { replace: true })} /></ErrorBoundary>}
          {view === "alerts"     && <ErrorBoundary key="alerts"   locale={locale}><AlertsView alerts={alertList} onDismiss={alertDismiss} onClearAll={alertClearAll} locale={locale} isLive={alertsIsLive} /></ErrorBoundary>}
          </Suspense>
      </div>
      <Toaster theme={isDark ? "dark" : "light"} position="top-right" richColors />
    </div>
  );

  /* `/admin` gets its own URL and no sidebar.
   *
   * Deliberate on both counts. A sidebar entry would put "manage every account" in
   * the navigation of every signed-in person, and the sidebar has no role-gating at
   * all today — adding the first role-conditional item there is a bigger change than
   * this task, and it is not needed here.
   *
   * No client-side role check either. The backend answers 403 for a non-admin and
   * AdminView says so in its own words; deciding it in the browser would mean the
   * client is the authority on who is an administrator, which is not a thing a
   * browser should be.
   */
  const adminPage = (
    <div
      className={isDark ? "dark" : ""}
      style={{
        minHeight: "100dvh",
        display: "flex",
        background: "var(--background)",
        color: "var(--foreground)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <Suspense fallback={<ViewSkeleton />}>
        <ErrorBoundary key="admin" locale={locale}>
          <AdminView />
        </ErrorBoundary>
      </Suspense>
    </div>
  );

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      {/* A signed-in person has no public-price question left: their facts live
          in Settings → Langganan & Tagihan, so /harga folds back into the app,
          and the visitor form URLs join it for the same reason. */}
      <Route path="/masuk" element={<Navigate to="/" replace />} />
      <Route path="/daftar" element={<Navigate to="/" replace />} />
      <Route path="/harga" element={<Navigate to="/" replace />} />
      <Route path="/admin" element={adminPage} />
      <Route path="*" element={shell} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <BrowserRouter>
          <AppInner />
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  );
}
