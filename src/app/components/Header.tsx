import { useState, useEffect, useRef, type CSSProperties, type ChangeEvent } from "react";
import { Search, Sun, Moon, ChevronUp, ChevronDown, X, Menu } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTranslation } from "../i18n/translations";
import type { LiveMarketData } from "../hooks/useLiveMarket";
import type { ExchangeRateData } from "../hooks/useExchangeRate";
import { DataFreshnessBadge } from "./DataFreshnessBadge";

interface HeaderProps {
  title: string;
  subtitle?: string;
  market: LiveMarketData;
  fx: ExchangeRateData;
  isMobile?: boolean;
  onMenuToggle?: () => void;
}

const SECONDARY = [
  { name: "LQ45",  value: 943.82,  changePct:  0.54 },
  { name: "IDX30", value: 512.34,  changePct:  0.61 },
  { name: "ISSI",  value: 248.16,  changePct: -0.22 },
];

function useWibClock(): string {
  const [time, setTime] = useState(() => getWibTime());

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000;
    const timeoutId = setTimeout(() => {
      setTime(getWibTime());
      intervalId = setInterval(() => setTime(getWibTime()), 60_000);
    }, msUntilNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, []);

  return time;
}

function getWibTime(): string {
  return new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }) + " WIB";
}

interface SearchDropdownProps {
  query: string;
  market: LiveMarketData;
  onClose: () => void;
  isId: boolean;
}

function SearchDropdown({ query, market, onClose, isId }: SearchDropdownProps) {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const results = Object.values(market.stocks)
    .filter((s) =>
      s.symbol.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (isId ? s.sector : s.sectorEn).toLowerCase().includes(q)
    )
    .slice(0, 6);

  if (results.length === 0) {
    return (
      <div style={dropdownStyle}>
        <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--muted-foreground)", textAlign: "center" }}>
          {isId ? "Tidak ada saham ditemukan" : "No stocks found"}
        </div>
      </div>
    );
  }

  return (
    <div style={dropdownStyle} role="listbox" aria-label={isId ? "Hasil pencarian" : "Search results"}>
      {results.map((stock) => {
        const pos = stock.changePct >= 0;
        return (
          <div
            key={stock.symbol}
            role="option"
            aria-selected="false"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "9px 16px",
              cursor: "pointer",
              borderBottom: "1px solid var(--border)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--muted)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={onClose}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                  {stock.symbol}
                </span>
                <span
                  style={{
                    fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 600,
                    color: stock.tier === 1 ? "#00d4aa" : stock.tier === 2 ? "#4da6ff" : "#8b9cb0",
                    background: stock.tier === 1 ? "rgba(0,212,170,0.1)" : stock.tier === 2 ? "rgba(77,166,255,0.1)" : "rgba(139,156,176,0.1)",
                    border: `1px solid ${stock.tier === 1 ? "#00d4aa30" : stock.tier === 2 ? "#4da6ff30" : "#8b9cb030"}`,
                    borderRadius: 3,
                    padding: "1px 4px",
                  }}
                >
                  T{stock.tier}
                </span>
              </div>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 1 }}>{stock.name}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                {stock.price.toLocaleString("id-ID")}
              </div>
              <div
                className="flex items-center justify-end gap-0.5"
                style={{ fontSize: 11, color: pos ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}
              >
                {pos ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                {Math.abs(stock.changePct).toFixed(2)}%
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const dropdownStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  zIndex: 40,
  boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
  overflow: "hidden",
};

export function Header({ title, subtitle, market, fx, isMobile = false, onMenuToggle }: HeaderProps) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const { isDark, toggleTheme, locale, toggleLocale } = useApp();
  const { t } = useTranslation(locale);
  const isId = locale === "id";
  const ihsg = market.ihsg;
  const timeStr = useWibClock();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSearchChange(e: ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setSearchOpen(e.target.value.length > 0);
  }

  function clearSearch() {
    setSearch("");
    setSearchOpen(false);
  }

  return (
    <header
      style={{ background: "var(--card)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}
      role="banner"
    >
      {/* ── Ticker row ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center overflow-x-auto"
        style={{ background: "var(--muted)", borderBottom: "1px solid var(--border)", padding: "0 16px", height: 36 }}
        aria-label={isId ? "Indeks pasar saham" : "Market indices"}
        role="region"
      >
        {/* Market open pulse & Feed status */}
        <div
          className="flex items-center gap-1.5 flex-shrink-0"
          style={{ paddingRight: 12, marginRight: 12, borderRight: "1px solid var(--border)" }}
          aria-label={market.isMarketOpen
            ? (isId ? "BEI sedang buka" : "IDX market open")
            : (isId ? "BEI sedang tutup" : "IDX market closed")
          }
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: market.isMarketOpen ? "var(--gain)" : "var(--muted-foreground)",
              display: "inline-block",
              boxShadow: market.isMarketOpen ? "0 0 0 2px var(--gain-bg)" : "none",
              animation: market.isMarketOpen ? "pulse 2s infinite" : "none",
            }}
          />
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", fontWeight: 600, color: market.isMarketOpen ? "var(--gain)" : "var(--muted-foreground)", letterSpacing: "0.06em" }}>
            {market.isMarketOpen ? (isId ? "BEI LIVE" : "IDX LIVE") : (isId ? "PASAR TUTUP" : "MARKET CLOSED")}
          </span>
          {/* What the prices actually are. "BEI LIVE" above refers to the
              EXCHANGE being open — not to the data being real time. The feed is
              delayed, and without this the two read as the same claim. */}
          <DataFreshnessBadge
            freshness={market.freshness}
            isConnected={market.source === "backend_ws"}
            locale={isId ? "id" : "en"}
            compact={isMobile}
          />
        </div>


        {/* IHSG live */}
        <div
          className="flex items-center gap-2 flex-shrink-0"
          style={{ paddingRight: 16, marginRight: 16, borderRight: "1px solid var(--border)" }}
          aria-label={`IHSG ${ihsg.value.toFixed(2)} ${ihsg.changePct >= 0 ? "naik" : "turun"} ${Math.abs(ihsg.changePct).toFixed(2)} persen`}
        >
          <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: "0.05em" }}>
            IHSG
          </span>
          <span style={{ fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
            {ihsg.value.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="flex items-center gap-0.5" style={{ fontSize: 11, color: ihsg.changePct >= 0 ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>
            {ihsg.changePct >= 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {Math.abs(ihsg.changePct).toFixed(2)}%
          </span>
        </div>

        {/* Secondary indices — hidden on mobile */}
        {!isMobile && SECONDARY.map((idx, i) => (
          <div
            key={idx.name}
            className="flex items-center gap-2 flex-shrink-0"
            style={{
              paddingRight: 16, marginRight: 16,
              borderRight: i < SECONDARY.length - 1 ? "1px solid var(--border)" : "none",
            }}
            aria-label={`${idx.name} ${idx.value.toFixed(2)} ${idx.changePct >= 0 ? "naik" : "turun"} ${Math.abs(idx.changePct).toFixed(2)} persen`}
          >
            <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
              {idx.name}
            </span>
            <span style={{ fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)", fontWeight: 500 }}>
              {idx.value.toLocaleString("id-ID", { minimumFractionDigits: 2 })}
            </span>
            <span className="flex items-center gap-0.5" style={{ fontSize: 11, color: idx.changePct >= 0 ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>
              {idx.changePct >= 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {Math.abs(idx.changePct).toFixed(2)}%
            </span>
          </div>
        ))}

        <div style={{ flex: 1 }} />

        {/* USD/IDR */}
        <div
          className="flex items-center gap-2 flex-shrink-0"
          aria-label={`USD IDR ${fx.usdIdr.toLocaleString("id-ID")} ${fx.changePct >= 0 ? "naik" : "turun"} ${Math.abs(fx.changePct).toFixed(3)} persen`}
        >
          <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
            USD/IDR
          </span>
          <span style={{ fontSize: 12, color: "var(--foreground)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
            {fx.usdIdr.toLocaleString("id-ID", { maximumFractionDigits: 0 })}
          </span>
          <span className="flex items-center gap-0.5" style={{ fontSize: 11, color: fx.changePct >= 0 ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>
            {fx.changePct >= 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {Math.abs(fx.changePct).toFixed(3)}%
          </span>
        </div>
      </div>

      {/* ── Main row ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          {isMobile && (
            <button
              onClick={onMenuToggle}
              aria-label={isId ? "Buka menu navigasi" : "Open navigation menu"}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: 4, color: "var(--muted-foreground)",
                display: "flex", alignItems: "center",
              }}
            >
              <Menu size={20} />
            </button>
          )}
          <div>
            <h1 style={{ fontSize: isMobile ? 15 : 18, fontWeight: 600, color: "var(--foreground)", lineHeight: 1.2, margin: 0 }}>
              {title}
            </h1>
            {!isMobile && subtitle && (
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">

          {/* Search — hidden on mobile */}
          {!isMobile && (
            <div ref={searchRef} style={{ position: "relative" }}>
              <div
                className="flex items-center gap-2 rounded px-3"
                style={{ background: "var(--muted)", border: `1px solid ${searchOpen ? "var(--primary)" : "var(--border)"}`, width: 220, height: 34, transition: "border-color 0.1s" }}
                role="combobox"
                aria-expanded={searchOpen}
                aria-haspopup="listbox"
              >
                <Search size={13} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} aria-hidden="true" />
                <input
                  value={search}
                  onChange={handleSearchChange}
                  onFocus={() => search.length > 0 && setSearchOpen(true)}
                  placeholder={t("header_search")}
                  aria-label={isId ? "Cari saham atau pasar" : "Search stock or market"}
                  aria-autocomplete="list"
                  style={{
                    background: "transparent", border: "none", outline: "none",
                    fontSize: 12, color: "var(--foreground)", width: "100%",
                    fontFamily: "var(--font-sans)",
                  }}
                />
                {search && (
                  <button
                    onClick={clearSearch}
                    aria-label={isId ? "Hapus pencarian" : "Clear search"}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--muted-foreground)" }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              {searchOpen && (
                <SearchDropdown
                  query={search}
                  market={market}
                  onClose={clearSearch}
                  isId={isId}
                />
              )}
            </div>
          )}

          {/* IDR / USD toggle */}
          <button
            onClick={fx.toggleCurrency}
            className="flex items-center rounded px-3"
            aria-label={fx.showUsd
              ? (isId ? "Tampilkan nilai dalam IDR" : "Show values in IDR")
              : (isId ? "Tampilkan nilai dalam USD" : "Show values in USD")
            }
            aria-pressed={fx.showUsd}
            style={{
              height: 34,
              background: fx.showUsd ? "var(--neutral-bg)" : "var(--muted)",
              border: `1px solid ${fx.showUsd ? "var(--neutral)" : "var(--border)"}`,
              cursor: "pointer", gap: 4,
            }}
          >
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: !fx.showUsd ? "var(--foreground)" : "var(--muted-foreground)" }}>
              IDR
            </span>
            <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>/</span>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: fx.showUsd ? "var(--neutral)" : "var(--muted-foreground)" }}>
              USD
            </span>
          </button>

          {/* ID / EN toggle — hidden on mobile */}
          {!isMobile && (
            <button
              onClick={toggleLocale}
              className="flex items-center rounded px-3"
              aria-label={locale === "id" ? "Switch to English" : "Ganti ke Bahasa Indonesia"}
              aria-pressed={locale === "en"}
              style={{
                height: 34,
                background: "var(--muted)",
                border: "1px solid var(--border)",
                cursor: "pointer", gap: 4,
              }}
            >
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: locale === "id" ? "var(--foreground)" : "var(--muted-foreground)" }}>
                ID
              </span>
              <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>/</span>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: locale === "en" ? "var(--foreground)" : "var(--muted-foreground)" }}>
                EN
              </span>
            </button>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center rounded"
            aria-label={isDark
              ? (isId ? "Aktifkan tema terang" : "Switch to light mode")
              : (isId ? "Aktifkan tema gelap" : "Switch to dark mode")
            }
            aria-pressed={isDark}
            style={{ width: 34, height: 34, background: "var(--muted)", border: "1px solid var(--border)", cursor: "pointer" }}
          >
            {isDark
              ? <Sun size={14} style={{ color: "var(--warning)" }} aria-hidden="true" />
              : <Moon size={14} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            }
          </button>

          {/* Live clock — hidden on mobile */}
          {!isMobile && (
            <div
              className="flex items-center gap-1.5"
              style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", minWidth: 72 }}
              aria-label={isId ? `Waktu sekarang ${timeStr}` : `Current time ${timeStr}`}
              aria-live="polite"
              aria-atomic="true"
            >
              <span
                style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: market.isMarketOpen ? "var(--gain)" : "var(--muted-foreground)",
                  display: "inline-block", flexShrink: 0,
                }}
                aria-hidden="true"
              />
              {timeStr}
            </div>
          )}
        </div>
      </div>

      {/* Pulse animation keyframe */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 2px var(--gain-bg); }
          50% { opacity: 0.6; box-shadow: 0 0 0 4px var(--gain-bg); }
        }
      `}</style>
    </header>
  );
}
