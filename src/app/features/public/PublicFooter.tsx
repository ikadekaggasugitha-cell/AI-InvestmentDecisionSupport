/**
 * The navy footer, one surface shared by all three public screens (the price
 * sheet, the features screen, the notes screen). Moving it out of PublicPricing
 * keeps the pages from drifting apart: same brand block, same risk note wording,
 * same Jakarta clock.
 *
 * It carries no navigation and no call to action. The owner decided so on
 * 2026-11-02, after seeing the version that did: a footer on the page bottom is
 * not where the page's argument gets finished, and repeating Masuk / Buat akun
 * there only says the same thing the topbar and the plan cards already say. What
 * is left here is the part that cannot live anywhere else: who is speaking, how
 * to reach them, what the product is not, and the facts under the line.
 *
 * The contact address is the one thing in this footer that is not written in
 * code. It comes from `system_settings.contact_support`, set on the admin page,
 * and when the operator has set none there is no contact row at all — not a
 * `mailto:` with nothing after it. That is the rule `docs/settings-module-spec.md`
 * §4 already wrote for this feature, and the reason the entry stayed out of the
 * footer for as long as no channel had been named: an address invented here
 * would be a promise nothing keeps (ADR-0013).
 */
import { useEffect, useState } from 'react'
import type { Locale } from '@/app/i18n/translations'
import { useApp } from '@/app/context/AppContext'
import { useSupportContact } from '@/app/features/public/useSupportContact'
import logoUrl from '@/assets/aidss-logo.svg'

/* The reference's footer shows an Asia/Jakarta clock. Since 2026-11-02 it stops
   at the minute: seconds in a footer answer no question a visitor is asking, and
   the app itself speaks in minutes (Header.tsx, Sidebar.tsx). en-GB forces the
   colons, because id-ID spells times with dots and the artwork spells them with
   colons. The 1s poll is only how the roll gets noticed; the state setter
   returns the same string sixty times a minute, so the footer renders once per
   minute rather than once per second. */
const jakartaFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const jakartaClock = () => `${jakartaFormatter.format(new Date())} WIB`

/* Exchange sessions, printed not computed. These are the same hours the
   signed-in sidebar already shows. The footer deliberately does NOT say whether
   the market is open right now: isMarketOpen() in useLiveMarket.ts is a browser
   clock over weekday and lunch-break rules with no holiday table, so it would
   call the exchange open on roughly fifteen public holidays a year. That is
   tolerable inside the app; on a page whose whole argument is that it does not
   overstate, it would be a new claim (ADR-0013). Plain hyphens, not en dashes:
   the features screen bans dashes in its rendered text.
   Two parts, not one string, because a phone must be able to break the line
   between them rather than inside a session's own range. */
const SESSIONS = {
  id: ['Bursa Senin-Jumat', '09:00-12:00 dan 13:30-15:50'],
  en: ['Exchange Mon-Fri', '09:00-12:00 and 13:30-15:50'],
}

export interface PublicFooterProps {
  locale: Locale
  /** The sheet passes the server's pricing date when prices are ready; the
   *  other two screens leave it empty and the meta line skips that fact. */
  updatedAt?: string | null
}

export function PublicFooter({ locale, updatedAt = null }: PublicFooterProps) {
  const isId = locale === 'id'
  const { toggleLocale } = useApp()
  const email = useSupportContact()
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
        <div className="pub-footer-disclose">
          <div className="pub-footer-brand">
            {/* Held by class rather than inline size so the narrow-screen rule can
                shrink it, the way the topbar's mark has been since 2026-10-26. The
                white original glyph goes on navy untinted. */}
            <img src={logoUrl} alt="AIDSS" className="pub-footer-logo" />
            <p className="pub-footer-eyebrow">Trading Intelligence Platform</p>
            <p className="pub-footer-tagline">
              {isId
                ? 'Pendukung keputusan investasi harian: sinyal, peringatan, risiko, dan portofolio dalam satu app.'
                : 'A daily investment decision-support tool: signals, alerts, risk, and portfolio in one app.'}
            </p>
          </div>
          {/* Rendered only when the server holds an address. An empty value is a
              state, not a failure to report, and a link that goes nowhere is worse
              than no link. */}
          {email && (
            <div className="pub-footer-contact">
              <p className="pub-footer-contact-label">{isId ? 'Hubungi kami' : 'Contact us'}</p>
              <a href={`mailto:${email}`}>{email}</a>
            </div>
          )}
        </div>

        <div className="pub-footer-rule" />

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
