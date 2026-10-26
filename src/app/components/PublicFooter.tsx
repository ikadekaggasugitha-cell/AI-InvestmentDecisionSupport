/**
 * The navy footer, one surface shared by both public screens (the price sheet
 * and the features screen). Moving it out of PublicPricing keeps the two
 * pages from drifting apart: same brand block, same honest held-contact
 * entry, same live Jakarta clock, same disclaimer wording.
 *
 * The columns are a prop, not a constant, because the two pages anchor to
 * different places: the sheet's footer anchors its own sections, the
 * features footer anchors the features page plus cross-page targets like
 * /#harga. Columns themselves must obey the page rules: only anchors that
 * exist, "Hubungi kami" stays held (no href, [OWNER TO NAME] pending).
 */
import { useEffect, useState } from "react";
import type { Locale } from "../i18n/translations";
import logoUrl from "../../assets/aidss-logo.svg";

export interface NavColumn {
  headId: string;
  headEn: string;
  items: Array<{
    id: string;
    en: string;
    anchor: string;
    held?: boolean;
  }>;
}

/* The reference's footer shows a ticking Asia/Jakarta clock, seconds
   included. en-GB forces the colons: id-ID spells times with dots, and the
   artwork spells the clock with colons. h23, because h24 has leaked "24:xx"
   at midnight on other platforms. On the very first frame it shows the
   render-time time; that is honest, and one second later it ticks. */
const jakartaFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const jakartaClock = () => `${jakartaFormatter.format(new Date())} WIB`;

export interface PublicFooterProps {
  locale: Locale;
  columns: NavColumn[];
  /** The sheet passes the server's pricing date when prices are ready; the
   *  features page leaves it empty and the meta line shows the clock alone. */
  updatedAt?: string | null;
}

export function PublicFooter({ locale, columns, updatedAt = null }: PublicFooterProps) {
  const isId = locale === "id";
  const [clock, setClock] = useState(jakartaClock);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(jakartaClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <footer className="pub-footer">
      <div className="pub-container">
        <div className="pub-footer-top">
          <div className="pub-footer-brand">
            <img src={logoUrl} alt="AIDSS" style={{ height: "38px", width: "auto", display: "block" }} />
            <p className="pub-footer-eyebrow">Trading Intelligence Platform</p>
            <p className="pub-footer-tagline">
              {isId
                ? "Pendukung keputusan investasi harian: sinyal, peringatan, risiko, dan portofolio dalam satu app."
                : "A daily investment decision-support tool: signals, alerts, risk, and portfolio in one app."}
            </p>
          </div>
          {columns.map((column) => (
            <div key={column.headId} className="pub-footer-col">
              <p className="pub-footer-head">{isId ? column.headId : column.headEn}</p>
              <ul>
                {column.items.map((item) => (
                  <li key={item.id}>
                    {item.held ? (
                      <span className="pub-footer-link" aria-disabled="true">
                        {isId ? item.id : item.en}
                      </span>
                    ) : (
                      <a href={item.anchor}>{isId ? item.id : item.en}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="pub-footer-rule" />
        <p className="pub-disclaimer" id="catatan">
          {isId
            ? "AIDSS adalah alat bantu keputusan, bukan penasihat investasi. Anda dapat kehilangan sebagian atau seluruh modal Anda. Kinerja masa lalu tidak menjamin hasil di masa depan."
            : "AIDSS is a decision-support tool, not investment advice. You can lose part or all of your capital. Past performance does not guarantee future results."}
        </p>
        <div className="pub-footer-rule" />
        <div className="pub-footer-bottom">
          <span className="pub-footer-copy">
            {isId
              ? "© 2026 AIDSS · MCASS. Seluruh hak dilindungi."
              : "© 2026 AIDSS · MCASS. All rights reserved."}
          </span>
          <span className="pub-footer-meta">
            {updatedAt && (
              <span>
                {isId ? "Harga diperbarui " : "Prices updated "}
                {new Date(updatedAt).toLocaleDateString(isId ? "id-ID" : "en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            )}
            <span aria-hidden="true" className="pub-footer-meta-dot" />
            <span>{clock}</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
