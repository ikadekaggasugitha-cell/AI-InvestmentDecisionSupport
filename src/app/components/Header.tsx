import { useState, useEffect, useRef, type CSSProperties, type ChangeEvent } from 'react'
import { Search, Sun, Moon, ChevronUp, ChevronDown, X, Menu } from 'lucide-react'
import { useApp } from '@/app/context/AppContext'
import { useTranslation } from '@/app/i18n/translations'
import type { LiveMarketData } from '@/app/features/market/useLiveMarket'
import type { ExchangeRateData } from '@/app/features/market/useExchangeRate'
interface HeaderProps {
  title: string
  subtitle?: string
  market: LiveMarketData
  fx: ExchangeRateData
  isMobile?: boolean
  onMenuToggle?: () => void
  /** Open a search result in Markets, pre-filtered to that symbol. */
  onSelectSymbol?: (symbol: string) => void
  /**
   * Glass chrome on the dashboard only (docs/DESIGN.md, dashboard exception).
   * Passed as a flag rather than applied unconditionally so the other views keep
   * the opaque paper surface the rest of the app is built on.
   */
  glass?: boolean
}

// LQ45 / IDX30 / ISSI used to be rendered here from hardcoded constants on the
// same ticker row as the provenance-badged IHSG, which made them
// indistinguishable from live index data. They are gone rather than relabelled
// because no provider this project uses carries them: IdxProvider only exposes
// GetStockSummary for individual equities, and the quote vendor supplies the
// composite index as ^JKSE alone. Adding an endpoint for them would return
// nothing, so the row now shows only the indices that are actually fetched.

function useWibClock(): string {
  const [time, setTime] = useState(() => getWibTime())

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000
    const timeoutId = setTimeout(() => {
      setTime(getWibTime())
      intervalId = setInterval(() => setTime(getWibTime()), 60_000)
    }, msUntilNextMinute)
    return () => {
      clearTimeout(timeoutId)
      if (intervalId !== null) clearInterval(intervalId)
    }
  }, [])

  return time
}

function getWibTime(): string {
  return (
    new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    }) + ' WIB'
  )
}

/* Tier ramp, duplicated from MarketsView rather than imported: it is three
 * entries and importing across view components would couple the shell to a
 * page. Both sides reference the same tokens, so they cannot drift in colour. */
const TIER_RAMP_COLOR: Record<number, string> = {
  1: 'var(--primary)',
  2: 'color-mix(in srgb, var(--primary) 65%, var(--card))',
  3: 'color-mix(in srgb, var(--primary) 35%, var(--card))',
}
const TIER_RAMP_BG: Record<number, string> = {
  1: 'var(--accent)',
  2: 'color-mix(in srgb, var(--primary) 8%, var(--card))',
  3: 'transparent',
}

/* Liquid tape symbols, pinned to the feed's universe where they render. A
   symbol the backend does not carry never appears as a dead entry. */
const TAPE_SYMBOLS = [
  'BBCA',
  'BBRI',
  'BMRI',
  'TLKM',
  'ASII',
  'BREN',
  'ADRO',
  'ANTM',
  'UNVR',
  'ICBP',
  'EMTK',
  'MDKA',
]

interface SearchDropdownProps {
  query: string
  market: LiveMarketData
  onClose: () => void
  isId: boolean
  onSelectSymbol?: (symbol: string) => void
}

function SearchDropdown({ query, market, onClose, isId, onSelectSymbol }: SearchDropdownProps) {
  const q = query.toLowerCase().trim()
  if (!q) return null

  const results = Object.values(market.stocks)
    .filter(
      (s) =>
        s.symbol.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (isId ? s.sector : s.sectorEn).toLowerCase().includes(q),
    )
    .slice(0, 6)

  if (results.length === 0) {
    return (
      <div style={dropdownStyle}>
        <div
          style={{
            padding: '12px 16px',
            fontSize: 12,
            color: 'var(--muted-foreground)',
            textAlign: 'center',
          }}
        >
          {isId ? 'Tidak ada saham ditemukan' : 'No stocks found'}
        </div>
      </div>
    )
  }

  return (
    <div
      style={dropdownStyle}
      role="listbox"
      aria-label={isId ? 'Hasil pencarian' : 'Search results'}
    >
      {results.map((stock) => {
        const pos = stock.changePct >= 0
        return (
          <div
            key={stock.symbol}
            role="option"
            aria-selected="false"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '9px 16px',
              cursor: 'pointer',
              borderBottom: '1px solid var(--border)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--muted)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => {
              onSelectSymbol?.(stock.symbol)
              onClose()
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {stock.symbol}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    /* Same ordinal ramp as MarketsView: one hue stepping down
                       toward the surface. Dark-theme hex here sat on var(--card)
                       in light mode, so T1 landed near 2:1 on white. */
                    color: TIER_RAMP_COLOR[stock.tier] ?? 'var(--muted-foreground)',
                    background: TIER_RAMP_BG[stock.tier] ?? 'transparent',
                    border: '1px solid var(--control-border)',
                    borderRadius: 3,
                    padding: '1px 4px',
                  }}
                >
                  T{stock.tier}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 1 }}>
                {stock.name}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--foreground)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {stock.price.toLocaleString('id-ID')}
              </div>
              <div
                className="flex items-center justify-end gap-0.5"
                style={{
                  fontSize: 11,
                  color: pos ? 'var(--gain)' : 'var(--loss)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {pos ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                {Math.abs(stock.changePct).toFixed(2)}%
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const dropdownStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  background: 'var(--card)',
  border: '1px solid var(--control-border)',
  borderRadius: 6,
  zIndex: 40,
  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  // A long result set on a short viewport used to be cut off with no way to
  // reach the rest: overflow hidden clipped it and there was no height limit.
  maxHeight: 'min(60vh, 420px)',
  overflowY: 'auto',
  overflowX: 'hidden',
}

export function Header({
  title,
  subtitle,
  market,
  fx,
  isMobile = false,
  onMenuToggle,
  onSelectSymbol,
  glass = false,
}: HeaderProps) {
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const { isDark, toggleTheme, locale, toggleLocale } = useApp()
  const { t } = useTranslation(locale)
  const isId = locale === 'id'
  const ihsg = market.ihsg
  const timeStr = useWibClock()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleSearchChange(e: ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value)
    setSearchOpen(e.target.value.length > 0)
  }

  function clearSearch() {
    setSearch('')
    setSearchOpen(false)
  }

  return (
    <header
      className={glass ? 'glass-bar' : undefined}
      style={{
        // Inline declarations beat the .glass-bar class, so the two the glass
        // owns — the translucent fill and its hairline edge — are simply not
        // written when the glass chrome is asked for.
        ...(glass ? null : { background: 'var(--card)', borderBottom: '1px solid var(--border)' }),
        flexShrink: 0,
      }}
      role="banner"
    >
      {/* ── Ticker row ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center overflow-x-auto"
        style={{
          background: 'var(--muted)',
          borderBottom: '1px solid var(--border)',
          padding: '0 16px',
          height: 36,
        }}
        aria-label={isId ? 'Indeks pasar saham' : 'Market indices'}
        role="region"
      >
        {/* Market open pulse. The dot marks the exchange state only — data
            freshness is reported by the dedicated badge/toast elsewhere so a
            backend outage never bleeds into the running ticker line. */}
        <div
          className="flex items-center gap-1.5 flex-shrink-0"
          style={{ paddingRight: 12, marginRight: 12, borderRight: '1px solid var(--border)' }}
          aria-label={
            market.isMarketOpen
              ? isId
                ? 'BEI sedang buka'
                : 'IDX market open'
              : isId
                ? 'BEI sedang tutup'
                : 'IDX market closed'
          }
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: market.isMarketOpen ? 'var(--gain)' : 'var(--muted-foreground)',
              display: 'inline-block',
              boxShadow: market.isMarketOpen ? '0 0 0 2px var(--gain-bg)' : 'none',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              color: market.isMarketOpen ? 'var(--gain)' : 'var(--muted-foreground)',
            }}
          >
            {market.isMarketOpen
              ? isId
                ? 'BEI Live'
                : 'IDX Live'
              : isId
                ? 'Pasar tutup'
                : 'Market closed'}
          </span>
        </div>

        {/* IHSG live */}
        <div
          className="flex items-center gap-2 flex-shrink-0"
          style={{ paddingRight: 16, marginRight: 16, borderRight: '1px solid var(--border)' }}
          aria-label={`IHSG ${ihsg.value.toFixed(2)} ${ihsg.changePct >= 0 ? 'naik' : 'turun'} ${Math.abs(ihsg.changePct).toFixed(2)} persen`}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--muted-foreground)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
            }}
          >
            IHSG
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--foreground)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
            }}
          >
            {ihsg.value.toLocaleString('id-ID', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <span
            className="flex items-center gap-0.5"
            style={{
              fontSize: 11,
              color: ihsg.changePct >= 0 ? 'var(--gain)' : 'var(--loss)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {ihsg.changePct >= 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {Math.abs(ihsg.changePct).toFixed(2)}%
          </span>
        </div>

        {/* ── Running tape ───────────────────────────────────────────────────── */}
        <div className="ticker-tape">
          {/* The second copy is for the seamless loop only; hiding both copies
              from assistive tech (the whole strip) works because the same facts
              sit in the KPI cards and the Markets view. */}
          <div className="ticker-marquee" role="list" aria-label={isId ? 'Harga saham unggulan' : 'Featured stock tape'}>
            {[0, 1].map((copy) => {
              const tape = TAPE_SYMBOLS.filter((sym) => market.stocks[sym]).map((sym) => ({
                sym,
                st: market.stocks[sym],
              }))
              return tape.length > 0 ? (
                <div key={copy} className="flex items-center" {...(copy === 1 ? { 'aria-hidden': true } : {})}>
                  {tape.map(({ sym, st }) => (
                    <div
                      key={`${copy}-${sym}`}
                      role="listitem"
                      className="flex items-center gap-1.5 flex-shrink-0"
                      style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        padding: '0 14px',
                        borderRight: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>{sym}</span>
                      <span style={{ color: 'var(--muted-foreground)' }}>
                        {st.price.toLocaleString('id-ID')}
                      </span>
                      <span
                        className="flex items-center gap-0.5"
                        style={{
                          color:
                            st.changePct === 0
                              ? 'var(--muted-foreground)'
                              : st.changePct > 0
                                ? 'var(--gain)'
                                : 'var(--loss)',
                        }}
                      >
                        {st.changePct > 0 ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                        {Math.abs(st.changePct).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : null
            })}
          </div>
        </div>

        {/* ── FX ────────────────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-2 flex-shrink-0"
          style={{ paddingLeft: 12, marginLeft: 12, borderLeft: '1px solid var(--border)' }}
          aria-label={`USD IDR ${fx.usdIdr.toLocaleString('id-ID')} ${fx.changePct >= 0 ? 'naik' : 'turun'} ${Math.abs(fx.changePct).toFixed(3)} persen`}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--muted-foreground)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            USD/IDR
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--foreground)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
            }}
          >
            {fx.usdIdr.toLocaleString('id-ID', { maximumFractionDigits: 0 })}
          </span>
          <span
            className="flex items-center gap-0.5"
            style={{
              fontSize: 11,
              color: fx.changePct >= 0 ? 'var(--gain)' : 'var(--loss)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {fx.changePct >= 0 ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {Math.abs(fx.changePct).toFixed(3)}%
          </span>
        </div>
      </div>

      {/* ── Main row ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          {isMobile && (
            <button
              onClick={onMenuToggle}
              aria-label={isId ? 'Buka menu navigasi' : 'Open navigation menu'}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: 'var(--muted-foreground)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Menu size={20} />
            </button>
          )}
          <div>
            <h1
              style={{
                fontSize: isMobile ? 15 : 18,
                fontWeight: 600,
                color: 'var(--foreground)',
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              {title}
            </h1>
            {!isMobile && subtitle && (
              <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Search — from lg up. Below that the width is spent on the view's
              own controls; Markets has its own filter. */}
          <div
            ref={searchRef}
            className="relative hidden lg:block"
            style={{ position: 'relative' }}
          >
            <div
              className="flex items-center gap-2 rounded px-3"
              style={{
                background: 'var(--muted)',
                border: `1px solid ${searchOpen ? 'var(--primary)' : 'var(--control-border)'}`,
                width: 220,
                height: 34,
                transition: 'border-color 0.1s',
              }}
              role="combobox"
              aria-expanded={searchOpen}
              aria-haspopup="listbox"
            >
              <Search
                size={13}
                style={{ color: 'var(--muted-foreground)', flexShrink: 0 }}
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={handleSearchChange}
                onFocus={() => search.length > 0 && setSearchOpen(true)}
                placeholder={t('header_search')}
                aria-label={isId ? 'Cari saham atau pasar' : 'Search stock or market'}
                aria-autocomplete="list"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 12,
                  color: 'var(--foreground)',
                  width: '100%',
                  fontFamily: 'var(--font-sans)',
                }}
              />
              {search && (
                <button
                  onClick={clearSearch}
                  aria-label={isId ? 'Hapus pencarian' : 'Clear search'}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    color: 'var(--muted-foreground)',
                  }}
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
                onSelectSymbol={onSelectSymbol}
              />
            )}
          </div>

          {/* IDR / USD toggle */}
          <button
            onClick={fx.toggleCurrency}
            className="flex items-center rounded px-3"
            aria-label={
              fx.showUsd
                ? isId
                  ? 'Tampilkan nilai dalam IDR'
                  : 'Show values in IDR'
                : isId
                  ? 'Tampilkan nilai dalam USD'
                  : 'Show values in USD'
            }
            aria-pressed={fx.showUsd}
            style={{
              height: 34,
              background: fx.showUsd ? 'var(--neutral-bg)' : 'var(--muted)',
              border: `1px solid ${fx.showUsd ? 'var(--neutral)' : 'var(--control-border)'}`,
              cursor: 'pointer',
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                color: !fx.showUsd ? 'var(--foreground)' : 'var(--muted-foreground)',
              }}
            >
              IDR
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>/</span>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                color: fx.showUsd ? 'var(--neutral)' : 'var(--muted-foreground)',
              }}
            >
              USD
            </span>
          </button>

          {/* ID / EN toggle — from lg up, same band as the search. */}
          <button
            onClick={toggleLocale}
            className="hidden lg:flex items-center rounded px-3"
            aria-label={locale === 'id' ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'}
            aria-pressed={locale === 'en'}
            style={{
              height: 34,
              background: 'var(--muted)',
              border: '1px solid var(--control-border)',
              cursor: 'pointer',
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                color: locale === 'id' ? 'var(--foreground)' : 'var(--muted-foreground)',
              }}
            >
              ID
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>/</span>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                color: locale === 'en' ? 'var(--foreground)' : 'var(--muted-foreground)',
              }}
            >
              EN
            </span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center rounded"
            aria-label={
              isDark
                ? isId
                  ? 'Aktifkan tema terang'
                  : 'Switch to light mode'
                : isId
                  ? 'Aktifkan tema gelap'
                  : 'Switch to dark mode'
            }
            aria-pressed={isDark}
            style={{
              width: 34,
              height: 34,
              background: 'var(--muted)',
              border: '1px solid var(--control-border)',
              cursor: 'pointer',
            }}
          >
            {isDark ? (
              <Sun size={14} style={{ color: 'var(--warning)' }} aria-hidden="true" />
            ) : (
              <Moon size={14} style={{ color: 'var(--muted-foreground)' }} aria-hidden="true" />
            )}
          </button>

          {/* Live clock — from xl up. The market state is marked once,
              in the ticker row where its label lives; a dot here would mark
              the same fact a second time. */}
          <div
            className="hidden xl:block"
            style={{
              fontSize: 11,
              color: 'var(--muted-foreground)',
              fontFamily: 'var(--font-mono)',
              minWidth: 72,
              textAlign: 'right',
            }}
            aria-label={isId ? `Waktu sekarang ${timeStr}` : `Current time ${timeStr}`}
            aria-live="polite"
            aria-atomic="true"
          >
            {timeStr}
          </div>
        </div>
      </div>
    </header>
  )
}
