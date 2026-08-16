import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useApp } from "../context/AppContext";
import type { NewsItem } from "../hooks/useNews";

interface Props { news: NewsItem[]; loading: boolean; }

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

export function NewsView({ news, loading }: Props) {
  const { locale, isDark } = useApp();
  const id = locale === "id";

  const [filter, setFilter] = useState<string>("all");
  const [active, setActive] = useState<string | null>(null);

  const categories = ["all", "market", "macro", "corporate"];

  const filtered = filter === "all" ? news : news.filter((n) => n.category === filter);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)", margin: 0 }}>
            {id ? "Berita Pasar" : "Market News"}
          </h2>
          <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>
            {id ? "Berita real-time saham Indonesia" : "Real-time Indonesian equity news"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted-foreground)", fontSize: 11 }}>
          <RefreshCw size={12} />
          {id ? "Otomatis diperbarui" : "Auto-refreshing"}
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
              border: `1px solid ${filter === c ? "var(--primary)" : "var(--border)"}`,
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
                  border: `1px solid ${isOpen ? "var(--primary)" : "var(--border)"}`,
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
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--muted-foreground)",
                      background: "var(--muted)",
                      borderRadius: 4,
                      padding: "3px 8px",
                    }}
                  >
                    {item.source}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--neutral)", display: "flex", alignItems: "center", gap: 3 }}>
                    {isOpen ? (id ? "Tutup" : "Collapse") : (id ? "Baca" : "Read")}
                    {!isOpen && <ExternalLink size={10} />}
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
