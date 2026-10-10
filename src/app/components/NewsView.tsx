import { useState } from "react";
import { ExternalLink, RefreshCw, WifiOff } from "lucide-react";
import { useApp } from "../context/AppContext";
import type { NewsItem } from "../hooks/useNews";

interface Props {
  news: NewsItem[];
  loading: boolean;
  isLive: boolean;
  /** Non-null only when the request failed. An empty list with no error is a
   *  real answer: the exchange published nothing in the window. */
  error: string | null;
  retry: () => void;
}

const CAT_COLORS: Record<string, string> = {
  market:    "var(--neutral)",
  macro:     "var(--warning)",
  corporate: "var(--gain)",
  global:    "var(--muted-foreground)",
};

function timeLabel(minsAgo: number, locale: string): string {
  if (minsAgo < 1)  return locale === "id" ? "Baru saja" : "Just now";
  if (minsAgo < 60) return locale === "id" ? `${minsAgo} mnt lalu` : `${minsAgo}m ago`;
  const h = Math.floor(minsAgo / 60);
  return locale === "id" ? `${h} jam lalu` : `${h}h ago`;
}

function catLabel(cat: string, locale: string): string {
  const map: Record<string, [string, string]> = {
    market:    ["Pasar",     "Market"],
    macro:     ["Makro",     "Macro"],
    corporate: ["Korporasi", "Corporate"],
    global:    ["Global",    "Global"],
  };
  return locale === "id" ? map[cat]?.[0] : map[cat]?.[1] ?? cat;
}

export function NewsView({ news, loading, isLive, error, retry }: Props) {
  const { locale, isDark } = useApp();
  const id = locale === "id";

  const [filter, setFilter] = useState<string>("all");
  const [active, setActive] = useState<string | null>(null);

  const categories = ["all", "market", "macro", "corporate", "global"];

  const filtered = filter === "all" ? news : news.filter((n) => n.category === filter);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* No <h2> here: App.tsx already renders the view title in Header, so one
          printed the same line twice. The <p> below is kept because it is the
          only place the fetch-once caching behaviour is documented. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 11, color: "var(--muted-foreground)", margin: 0 }}>
            {isLive
              ? id ? "Keterbukaan informasi IDX: diambil sekali saat halaman dibuka" : "IDX disclosures: fetched once when this page opened"
              : error
                ? id ? "Keterbukaan informasi IDX" : "IDX disclosure filings"
                : id ? "Menunggu feed IDX" : "Waiting for the IDX feed"}
          </p>
        </div>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6,
            color: isLive ? "var(--muted-foreground)" : "var(--warning)",
            fontSize: 11,
          }}
          title={isLive
            ? (id ? "Daftar diambil sekali; Load ulang untuk mengambil ulang" : "Fetched once; reload to fetch again")
            : (id ? "Feed IDX tidak dapat dihubungi" : "IDX feed could not be reached")}
        >
          {isLive ? <RefreshCw size={12} /> : <WifiOff size={12} />}
          {isLive ? (id ? "Muat ulang untuk memperbarui" : "Reload to refresh") : (id ? "Feed tidak terjangkau" : "Feed unreachable")}
        </div>
      </div>

      {/* Category filters */}
      <div style={{ display: "flex", gap: 6 }}>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            style={{
              padding: "5px 12px",
              borderRadius: 5,
              border: `1px solid ${filter === c ? "var(--primary)" : "var(--control-border)"}`,
              background: filter === c ? "var(--accent)" : "var(--card)",
              color: filter === c ? "var(--accent-foreground)" : "var(--muted-foreground)",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: filter === c ? 500 : 400,
              transition: "all 0.1s",
            }}
          >
            {c === "all" ? (id ? "Semua" : "All") : catLabel(c, locale)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "64px 0", color: "var(--muted-foreground)", gap: 8, fontSize: 13 }}>
          <RefreshCw size={16} style={{ animation: "spin 1.5s linear infinite" }} />
          {id ? "Memuat berita…" : "Loading news…"}
        </div>
      ) : error ? (
        /* Error names the cause and offers the one action that can resolve it.
           Previously a failed fetch rendered the bundled sample, so an outage
           looked like a normal news page. */
        <div
          role="status"
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            padding: "56px 24px", textAlign: "center",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            background: "var(--card)",
          }}
        >
          <WifiOff size={18} style={{ color: "var(--warning)" }} aria-hidden="true" />
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>
            {id ? "Feed IDX tidak dapat diambil" : "Could not load the IDX feed"}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)", maxWidth: 420 }}>
            {error}
          </span>
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: 4, minHeight: 32, padding: "6px 14px",
              borderRadius: "var(--radius)", cursor: "pointer",
              background: "var(--primary)", color: "var(--primary-foreground)",
              border: "1px solid var(--primary)", fontSize: 12, fontWeight: 500,
            }}
          >
            {id ? "Coba lagi" : "Try again"}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        /* Empty is not an error: the feed answered and had nothing to report.
           With the bundled sample removed, this is what a genuine quiet day
           looks like, and it says so. */
        <div
          role="status"
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            padding: "56px 24px", textAlign: "center",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            background: "var(--card)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>
            {filter === "all"
              ? (id ? "Tidak ada keterbukaan informasi baru" : "No new disclosures")
              : (id ? `Tidak ada pengumuman kategori ${catLabel(filter, locale)}` : `No ${catLabel(filter, locale)} filings`)}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)", maxWidth: 420 }}>
            {filter === "all"
              ? (id
                  ? "Bursa Efek Indonesia tidak menerbitkan keterbukaan informasi baru dalam jendela ini. Daftar diambil sekali saat halaman dibuka, jadi muat ulang halaman untuk mengambil pengumuman terbaru."
                  : "The exchange published no disclosures in this window. The list is fetched once when the page opens, so reload to pick up anything filed since.")
              : (id ? "Pilih kategori lain, atau muat ulang halaman." : "Pick another category, or reload the page.")}
          </span>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {filtered.map((item) => {
            const isOpen  = active === item.id;
            const catCol  = CAT_COLORS[item.category] ?? "var(--muted-foreground)";
            const title   = id ? item.titleId : item.titleEn;
            const summary = id ? item.summaryId : item.summaryEn;

            return (
              <div
                key={item.id}
                onClick={() => setActive(isOpen ? null : item.id)}
                style={{
                  background: "var(--card)",
                  border: `1px solid ${isOpen ? "var(--primary)" : "var(--control-border)"}`,
                  borderRadius: 8,
                  padding: 20,
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
                onMouseEnter={(e) => {
                  if (!isOpen) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--muted-foreground)";
                }}
                onMouseLeave={(e) => {
                  if (!isOpen) (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
                }}
              >
                {/* Top row */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
                        background: `color-mix(in srgb, ${catCol} 12%, transparent)`,
                        color: catCol,
                        border: `1px solid color-mix(in srgb, ${catCol} 25%, transparent)`,
                        borderRadius: 3, padding: "2px 6px",
                      }}
                    >
                      {catLabel(item.category, locale).toUpperCase()}
                    </span>
                    {item.isFresh && (
                      <span
                        style={{
                          fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
                          background: "var(--gain-bg)", color: "var(--gain)",
                          border: "1px solid color-mix(in srgb, var(--gain) 25%, transparent)",
                          borderRadius: 3, padding: "2px 6px",
                        }}
                      >
                        {id ? "TERBARU" : "LATEST"}
                      </span>
                    )}
                    {item.symbols.slice(0, 2).map((s) => (
                      <span
                        key={s}
                        style={{
                          fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)",
                          background: "var(--neutral-bg)", color: "var(--neutral)",
                          borderRadius: 3, padding: "2px 6px",
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                    {timeLabel(item.minsAgo, locale)}
                  </span>
                </div>

                {/* Title */}
                <h3
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--foreground)",
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {title}
                </h3>

                {/* Expanded summary */}
                {isOpen && (
                  <p style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.65, margin: 0 }}>
                    {summary}
                  </p>
                )}

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 4 }}>
                  {item.url ? (
                    // Real source link — opens the original article/filing in a new
                    // tab. stopPropagation so it does not also toggle the card.
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: 11, fontWeight: 500, color: "var(--neutral)",
                        background: "var(--muted)", borderRadius: 4, padding: "3px 8px",
                        display: "flex", alignItems: "center", gap: 4, textDecoration: "none",
                      }}
                    >
                      {item.source}
                      <ExternalLink size={10} />
                    </a>
                  ) : (
                    <span
                      style={{
                        fontSize: 11, fontWeight: 500, color: "var(--muted-foreground)",
                        background: "var(--muted)", borderRadius: 4, padding: "3px 8px",
                      }}
                    >
                      {item.source}
                    </span>
                  )}
                  {/* Expand/collapse indicator — no external-link icon: expanding is
                      not navigation, and the misleading icon is what made "Baca"
                      look like it opened the article. */}
                  <span style={{ fontSize: 11, color: "var(--neutral)" }}>
                    {isOpen ? (id ? "Tutup" : "Collapse") : (id ? "Baca ringkasan" : "Read summary")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
