# AIDSS Full Redesign — Implementation Plan

## Context

The app is an AI Investment Decision Support System targeting Indonesian stock market (IDX). The previous session wrote new data/hook/some component files but they were reverted by the linter. The goal is to wire everything together: create the missing context/i18n files, rewrite all components to use IDX data with live GBM simulation, bilingual support (ID/EN), light/dark theme, and IDR/USD exchange rate — all without touching existing business logic.

Current state:
- **New files that exist and are correct**: `useLiveMarket.ts`, `useExchangeRate.ts`, `useNews.ts`, `idxData.ts`, `NewsView.tsx` (uses AppContext), `SettingsView.tsx` (uses AppContext + fx prop)
- **Missing files that must be created**: `AppContext.tsx`, `translations.ts`
- **Files that must be rewritten** (all currently use old `mockData.ts` and have US stock framing): `App.tsx`, `Sidebar.tsx`, `Header.tsx`, `DashboardView.tsx`, `MarketsView.tsx`, `PortfolioView.tsx`, `AIAdvisorView.tsx`, `RiskView.tsx`

---

## Files to Create / Rewrite (in order)

### 1. `src/app/i18n/translations.ts` — CREATE
Bilingual map for all UI strings used across every view.
```ts
export type Locale = "id" | "en";
const translations = { id: { ... }, en: { ... } };
export function useTranslation(locale: Locale) { return { t: (key) => translations[locale][key] ?? key }; }
```
Key groups: nav labels, dashboard section headers, market table headers, portfolio labels, AI advisor copy, risk labels, settings labels, time/date formatting helpers.

### 2. `src/app/context/AppContext.tsx` — CREATE
```tsx
export function AppProvider({ children }) {
  const [isDark, setIsDark] = useState(true);
  const [locale, setLocale] = useState<Locale>("id");
  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); }, [isDark]);
  // toggleTheme, toggleLocale
}
export function useApp() { return useContext(AppContext); }
```

### 3. `src/app/App.tsx` — REWRITE
- Wrap entire app with `<AppProvider>`
- Export `ViewType` = `"dashboard" | "markets" | "portfolio" | "advisor" | "risk" | "news" | "settings"`  
- Call `useLiveMarket()`, `useExchangeRate()`, `useNews()` at top level
- Pass `market` and `fx` props to all views that need them; pass `news` + `loading` to NewsView
- Import `alertsData` from `idxData.ts` (not `mockData.ts`)
- Update viewConfig titles to bilingual via locale from `useApp()`

### 4. `src/app/components/Sidebar.tsx` — REWRITE
- Import `ViewType` from `../App` (re-export from Sidebar too for backward compat, or just define it here)
- Always-dark background (`#050810`) regardless of theme — intentional pattern
- Nav items include: dashboard, markets, portfolio, advisor, risk, news, settings
- Market status shows BEI (IDX) open/close based on `isMarketOpen` prop
- Active item: 2px left border accent, no glow
- i18n: nav labels from locale, market status text bilingual
- No decorative gradient logo — clean text "AIDSS" with simple icon

### 5. `src/app/components/Header.tsx` — REWRITE
Two-row layout:
- **Row 1 (ticker bar)**: IHSG live value + change (from `market.ihsg`), LQ45 and IDX30 static, then USD/IDR rate (from `fx.usdIdr`)
- **Row 2 (main)**: Page title/subtitle (left), search + IDR/USD toggle + ID/EN toggle + sun/moon toggle (right)
- No hardcoded US index data
- Toggle buttons: compact pill style, no glow

### 6. `src/app/components/DashboardView.tsx` — REWRITE
Props: `{ market: LiveMarketData; fx: ExchangeRateData }`
- 4 KPI cards: Portfolio Value (live, IDR or USD via fx), Daily P&L, IHSG, top gainer
- Intraday AreaChart: `market.intradayChart` data, `value` key, formatted in IDR/T/M
- Allocation donut: `SECTOR_ALLOCATION` from idxData
- Top holdings table: 5 positions from `PORTFOLIO_HOLDINGS`, live price from `market.stocks`
- Recent transactions: `RECENT_TRANSACTIONS` from idxData, bilingual via `useApp()`
- AI alerts strip: `ALERTS_DATA` from idxData

### 7. `src/app/components/MarketsView.tsx` — REWRITE
Props: `{ market: LiveMarketData; fx: ExchangeRateData }`
- Summary bar: gainers / losers / total tracked (computed from `market.stocks`)
- Sector filter tabs using IDX sectors (Perbankan, Energi, Telekomunikasi, etc.) — bilingual
- Sortable table: uses `Object.values(market.stocks)` — live data, updates every 2s via market prop
- Sparkline: `stock.history` array (60 ticks)
- Price display: IDR formatted with Rb/Jt/M suffixes, or USD if `fx.showUsd`

### 8. `src/app/components/PortfolioView.tsx` — REWRITE
Props: `{ market: LiveMarketData; fx: ExchangeRateData }`
- 4 KPI cards: Portfolio Value, Unrealized Gain, Daily P&L, Weighted Return — all computed from live prices
- Equity curve: `PORTFOLIO_HISTORY` from idxData, formatted in IDR T (triliun)
- Allocation donut: `SECTOR_ALLOCATION`
- Returns bar chart: per holding return %
- Positions table: `PORTFOLIO_HOLDINGS` × `market.stocks[symbol].price` for live value, cost basis from `h.avgPrice * h.lots * 100`
- All numbers: IDR format with `fx.formatAmount` toggle

### 9. `src/app/components/AIAdvisorView.tsx` — REWRITE
Props: none (reads idxData directly; uses `useApp()` for locale)
- Header metric strip: model accuracy, active signals, recommendations sourced
- 5 recommendation cards from `AI_RECOMMENDATIONS` in idxData
- Each card: action badge (BELI KUAT / STRONG BUY), confidence bar, price target, bilingual thesis + catalysts (expandable)
- Collapsible detail section on click
- No mockData dependency

### 10. `src/app/components/RiskView.tsx` — REWRITE
Props: `{ market: LiveMarketData }`
- Risk summary: portfolio beta, VaR (simulated), Sharpe ratio — computed or from constants in idxData
- Radar chart: 6 risk dimensions using `RISK_DATA` from idxData
- Stress test bar chart: `STRESS_TESTS` from idxData (Indonesian market scenarios: Krisis 2008, COVID-2020, etc.)
- Sector exposure horizontal bar chart: `SECTOR_EXPOSURE`
- Bilingual scenario names via `useApp()` locale

---

## Design System Rules (apply everywhere)

- **Spacing**: 8px grid — padding values: 8, 16, 24, 32. Gap values: 4, 8, 12, 16, 24
- **Typography**: JetBrains Mono for all numbers, Inter for UI text. No mixed sizes within a single line
- **Colors**: Use CSS vars — `var(--foreground)`, `var(--muted-foreground)`, `var(--card)`, `var(--border)`. Gains: `#00d4aa`, losses: `#ff4757`, neutral: `#4da6ff`
- **Shadows**: None decorative. Border only: `1px solid var(--border)`
- **Border radius**: `rounded` (6px) for cards and buttons — never `rounded-2xl` or `rounded-3xl`
- **Icons**: Size 14–16px max in tables/nav. Never 24+ unless standalone display
- **Active states**: 2px left border indicator, subtle bg tint — no glow, no heavy border boxes
- **Light mode**: `--background: #f6f8fa`, `--card: #ffffff`, sidebar stays dark always
- **Theme tokens to add to theme.css**: `--gain: #00d4aa`, `--loss: #ff4757`, `--gain-bg: rgba(0,212,170,0.08)`, `--loss-bg: rgba(255,71,87,0.08)`, `--warning: #f59e0b`, `--neutral: #4da6ff`, `--neutral-bg: rgba(77,166,255,0.08)`

---

## Light Mode Theme Updates (theme.css)
`:root` currently has dark values — need to split:
- `:root` = light: `--background: #f6f8fa`, `--card: #ffffff`, `--foreground: #111827`, `--muted-foreground: #6b7280`, `--border: rgba(0,0,0,0.08)`, `--primary: #0b7c5e`
- `.dark` = dark: keep existing values (`--background: #060a0f`, `--primary: #00d4aa`, etc.)
- Add financial tokens to both and to `@theme inline`

---

## Execution Order

1. `theme.css` — light/dark split + financial tokens
2. `translations.ts` — i18n map
3. `AppContext.tsx` — theme + locale state
4. `App.tsx` — wire context + hooks + props
5. `Sidebar.tsx` — IDX nav + bilingual + market status
6. `Header.tsx` — live ticker + toggles
7. `DashboardView.tsx` — live KPIs + intraday chart
8. `MarketsView.tsx` — live market table
9. `PortfolioView.tsx` — live positions
10. `AIAdvisorView.tsx` — IDX recommendations
11. `RiskView.tsx` — IDX risk analytics

---

## Verification

After implementation, the app should:
- Show IDX stocks (BBCA, BBRI, TLKM, etc.) with live GBM price updates every 2s
- Toggle between Bahasa Indonesia and English across all UI text
- Toggle dark/light theme (sidebar stays dark in both)
- Show USD/IDR exchange rate in header; toggle portfolio values IDR ↔ USD
- News feed showing IDX-related headlines (seed data + Yahoo Finance fallback)
- Settings page with all four toggles working
- No US stock symbols (AAPL, MSFT, etc.) anywhere in the UI
- All financial numbers in JetBrains Mono
- All spacing multiples of 8px
