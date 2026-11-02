/**
 * The navy footer, one surface shared by all three public screens (the price
 * sheet, the features screen, the notes screen). Moving it out of
 * PublicPricing keeps the pages from drifting apart: same brand block, same
 * risk note wording, same Jakarta clock.
 *
 * It has one job, decided by the owner on 2026-11-02: **close, then state**.
 * The old shape was a sitemap with eleven links, five of which pointed at the
 * same anchor, and it read like every other footer. This one ends the page's
 * argument, offers the two actions that actually exist, and then says what the
 * product is not.
 *
 * Three bands, in this order:
 *  1. the closing band: the screen's own sentence, its primary action, and
 *     Masuk beside it. The topbar is not sticky, so a reader who has finished
 *     the page has no gate on screen anymore; this band is where they do.
 *  2. the disclose strip: brand block, plus the row of destinations that are
 *     genuinely different places.
 *  3. the meta line: copyright, the language switch, the server's price date
 *     when there is one, and the time.
 *
 * The CTA and the link row are props, not constants, because the three screens
 * anchor differently. Two rules the pages must obey, both already written down
 * elsewhere in this folder: a link back to the page the reader stands on has no
 * use (PublicNavMenu.tsx), and the row never repeats the CTA's target.
 *
 * There is no contact entry. It used to be a held span, because no channel has
 * ever been named ([OWNER TO NAME], and docs/status.md still records
 * `contact_support` as empty with no endpoint). The owner's own settings spec
 * already rules on this: an empty value means the row is not rendered, because
 * a half-written wa.me is a dead control. When a channel exists, the row comes
 * back by itself.
 */
import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { Locale } from '@/app/i18n/translations'
import { useApp } from '@/app/context/AppContext'
import logoUrl from '@/assets/aidss-logo.svg'

/** The closing move, per screen. */
export interface FooterCta {
  titleId: string
  titleEn: string
  labelId: string
  labelEn: string
  /** Real href: middle-click and sharing keep working. */
  href: string
  onNavigate: () => void
}

/** A destination the reader is not already standing on. */
export interface FooterLink {
  id: string
  en: string
  href: string
  onNavigate?: () => void
}

export interface PublicFooterProps {
  locale: Locale
  cta: FooterCta
  /** The sign-in gate, the secondary action. Every screen has one. */
  onEnter: () => void
  links: FooterLink[]
  /** The sheet passes the server's pricing date when prices are ready; the
   *  other two screens leave it empty and the meta line skips that fact. */
  updatedAt?: string | null
}

/* The reference's footer shows an Asia/Jakarta clock. Since 2026-11-02 it stops
   at the minute: seconds in a footer answer no question a visitor is asking,
   and the app itself speaks in minutes (Header.tsx, Sidebar.tsx). en-GB forces
   the colons, because id-ID spells times with dots and the artwork spells them
   with colons. The 1s poll is only how the roll gets noticed; the state setter
   returns the same string sixty times a minute, and React bails out, so the
   footer renders once per minute rather than once per second. */
const jakartaFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const jakartaClock = () => `${jakartaFormatter.format(new Date())} WIB`

/* Exchange sessions, printed not computed. These are the same hours the
   signed-in sidebar already shows. The footer deliberately does NOT say
   whether the market is open right now: isMarketOpen() in useLiveMarket.ts is a
   browser clock over weekday and lunch-break rules with no holiday table, so it
   would call the exchange open on roughly fifteen public holidays a year. That
   is tolerable inside the app; on a page whose whole argument is that it does
   not overstate, it would be a new claim (ADR-0013). Plain hyphens, not en
   dashes: the features screen bans dashes in its rendered text.
   Two parts, not one string, because a phone must be able to break the line
   between them rather than inside a session's own range. */
const SESSIONS = {
  id: ['Bursa Senin-Jumat', '09:00-12:00 dan 13:30-15:50'],
  en: ['Exchange Mon-Fri', '09:00-12:00 and 13:30-15:50'],
}

export function PublicFooter({ locale, cta, onEnter, links, updatedAt = null }: PublicFooterProps) {
  const isId = locale === 'id'
  const { toggleLocale } = useApp()
  const [clock, setClock] = useState(jakartaClock)

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = jakartaClock()
      setClock((prev) => (prev === next ? prev : next))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <footer className="pub-footer">
      <div className="pub-container">
        <div className="pub-footer-cta">
          <h2 className="pub-footer-cta-title">{isId ? cta.titleId : cta.titleEn}</h2>
          <div className="pub-footer-cta-actions">
            <a
              className="pub-footer-cta-primary"
              href={cta.href}
              onClick={(e) => {
                e.preventDefault()
                cta.onNavigate()
              }}
            >
              {isId ? cta.labelId : cta.labelEn}
              <ArrowUpRight size={16} strokeWidth={2.4} aria-hidden="true" />
            </a>
            <button type="button" className="pub-footer-cta-ghost" onClick={onEnter}>
              {isId ? 'Masuk' : 'Sign in'}
            </button>
          </div>
          <p className="pub-footer-cta-note">
            {isId
              ? 'Pilihan paket membawa Anda ke form daftar; pembayaran dimulai dari dalam aplikasi.'
              : 'A plan pick carries you into the signup form; payment begins inside the app.'}
          </p>
        </div>

        <div className="pub-footer-rule" />

        <div className="pub-footer-disclose">
          <div className="pub-footer-brand">
            {/* Held by class rather than inline size so the narrow-screen rule
                can shrink it, the way the topbar's mark has been since
                2026-10-26. The white original glyph goes on navy untinted. */}
            <img src={logoUrl} alt="AIDSS" className="pub-footer-logo" />
            <p className="pub-footer-eyebrow">Trading Intelligence Platform</p>
            <p className="pub-footer-tagline">
              {isId
                ? 'Pendukung keputusan investasi harian: sinyal, peringatan, risiko, dan portofolio dalam satu app.'
                : 'A daily investment decision-support tool: signals, alerts, risk, and portfolio in one app.'}
            </p>
          </div>
          <nav
            className="pub-footer-links"
            aria-label={isId ? 'Tautan halaman publik' : 'Public page links'}
          >
            {links.map((link) => (
              <a
                key={link.href + link.id}
                href={link.href}
                onClick={(e) => {
                  if (link.onNavigate) {
                    e.preventDefault()
                    link.onNavigate()
                  }
                }}
              >
                {isId ? link.id : link.en}
              </a>
            ))}
          </nav>
        </div>

        <p className="pub-disclaimer" id="catatan">
          {isId
            ? 'AIDSS adalah alat bantu keputusan, bukan penasihat investasi. Anda dapat kehilangan sebagian atau seluruh modal Anda. Kinerja masa lalu tidak menjamin hasil di masa depan.'
            : 'AIDSS is a decision-support tool, not investment advice. You can lose part or all of your capital. Past performance does not guarantee future results.'}
        </p>

        <div className="pub-footer-bottom">
          <div className="pub-footer-bottom-left">
            <span className="pub-footer-copy">
              {isId
                ? '© 2026 AIDSS · MCASS. Seluruh hak dilindungi.'
                : '© 2026 AIDSS · MCASS. All rights reserved.'}
            </span>
            {/* Every public screen carries full id/en copy, and until now only a
                signed-in reader could switch. Same control, same voice, same
                aria contract as the dashboard's toggle. */}
            <button
              type="button"
              className="pub-footer-locale"
              onClick={toggleLocale}
              aria-label={isId ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'}
              aria-pressed={locale === 'en'}
            >
              <span className={isId ? 'is-on' : undefined}>ID</span>
              <span aria-hidden="true">/</span>
              <span className={isId ? undefined : 'is-on'}>EN</span>
            </button>
          </div>
          <span className="pub-footer-meta">
            {updatedAt && (
              <span>
                {isId ? 'Harga diperbarui ' : 'Prices updated '}
                {new Date(updatedAt).toLocaleDateString(isId ? 'id-ID' : 'en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            )}
            <span aria-hidden="true" className="pub-footer-meta-dot" />
            <span>{clock}</span>
            {(isId ? SESSIONS.id : SESSIONS.en).map((part) => (
              <span key={part} className="pub-footer-meta-keep">
                {part}
              </span>
            ))}
          </span>
        </div>
      </div>
    </footer>
  )
}
