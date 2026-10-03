import { useState, useEffect } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";

export interface NewsItem {
  id: string;
  titleId: string;
  titleEn: string;
  summaryId: string;
  summaryEn: string;
  source: string;
  /** Link to the original filing. Present on live IDX items. */
  url?: string;
  category: "market" | "macro" | "corporate" | "global";
  symbols: string[];
  minsAgo: number;
  isFresh?: boolean;
}

/* ── Live IDX disclosures ────────────────────────────────────────────────────
 *
 * There is no bundled news any more.
 *
 * This hook used to seed itself with eleven invented headlines attributed to
 * Kontan, Bisnis.com, Reuters Indonesia, CNBC Indonesia and Bloomberg
 * Indonesia, then append them to the live feed on every load. Naming real
 * publications for events that did not happen is the one kind of fabrication
 * here that reaches outside the app and damages third parties, so the seed is
 * gone rather than labelled. Consequence, accepted deliberately: with no
 * backend the page is empty. An empty page is the truth; a plausible page is
 * not.
 *
 * Replaces an earlier browser fetch to Yahoo news through the allorigins.win
 * CORS proxy. That proxy returned a GitHub Pages 404 on every load, so the call
 * failed permanently and the panel fell back to those seed items, looking like
 * a quiet news day forever.
 *
 * The backend serves IDX keterbukaan informasi: primary filings, each with an
 * issuer code and an exchange timestamp.
 */

/** How recently a filing must be to earn the "TERBARU" badge.
 *  Sixty minutes, which is the same boundary the relative-time string already
 *  uses when it prints "Baru saja". The badge used to be `i === 0`, which
 *  marked array position rather than recency. */
const FRESH_WINDOW_MIN = 60;

interface ApiNewsItem {
  id: string;
  title: string;
  category: string;
  symbol: string;
  publishedAt: string;
  url: string;
  source: string;
}

/**
 * Map IDX's filing categories onto the four buckets the UI filters by.
 * Anything unrecognised is "corporate": these are company filings by
 * definition, so that is the truthful default rather than a catch-all.
 */
function mapCategory(jenis: string): NewsItem["category"] {
  const k = jenis.toLowerCase();
  if (k.includes("saham") || k.includes("perdagangan") || k.includes("suspen")) return "market";
  if (k.includes("obligasi") || k.includes("sukuk") || k.includes("bunga")) return "macro";
  return "corporate";
}

function minutesSince(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 60_000));
}

interface FetchOutcome {
  items: NewsItem[];
  ok: boolean;
  error: string | null;
}

async function fetchIdxDisclosures(): Promise<FetchOutcome> {
  if (!USE_LIVE_API) {
    return {
      items: [],
      ok: false,
      error: "offline",
    };
  }
  try {
    const res = await apiFetch(ENDPOINTS.news(20), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      return {
        items: [],
        ok: false,
        error: res.status === 404 ? "Feed IDX tidak ditemukan di backend." : `Feed IDX menjawab dengan status ${res.status}.`,
      };
    }
    const data = await res.json();
    if (data?.source !== "idx" || !Array.isArray(data?.items)) {
      return { items: [], ok: false, error: "Backend tidak mengembalikan keterbukaan informasi IDX." };
    }

    const mapped: NewsItem[] = (data.items as ApiNewsItem[]).map((item) => {
      const minsAgo = minutesSince(item.publishedAt);
      return {
        id: `idx-${item.id}`,
        // IDX files in Indonesian and publishes no English version. The same
        // title is used for both locales rather than machine-translating a legal
        // filing into wording the issuer never submitted.
        titleId: item.title,
        titleEn: item.title,
        // IDX supplies no abstract, only the filing title. Rather than invent a
        // summary, state what the document is.
        summaryId: item.symbol
          ? `Keterbukaan informasi ${item.symbol} — ${item.category || "pengumuman resmi"}.`
          : `Pengumuman resmi Bursa Efek Indonesia — ${item.category || "keterbukaan informasi"}.`,
        summaryEn: item.symbol
          ? `IDX disclosure filed by ${item.symbol} — ${item.category || "official announcement"}.`
          : `Official Indonesia Stock Exchange announcement — ${item.category || "disclosure"}.`,
        source: item.source || "IDX",
        url: item.url || undefined,
        category: mapCategory(item.category),
        symbols: item.symbol ? [item.symbol] : [],
        minsAgo,
        // Recency, not position: a filing inside the window is badged whether or
        // not it happens to be first in the response.
        isFresh: minsAgo <= FRESH_WINDOW_MIN,
      };
    });
    // `source === "idx"` is what the backend sets when it actually reached the
    // IDX feed, so a truthy check is more precise than "did we get rows".
    return { items: mapped, ok: data.source === "idx", error: null };
  } catch {
    return { items: [], ok: false, error: "Backend tidak dapat dihubungi." };
  }
}

export function useNews() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinguishes "the IDX feed answered and had no filings" from "we could not
  // ask". Without it a backend outage renders as a quiet news day.
  const [isLive, setIsLive] = useState(false);
  /** Non-null only when the request failed. An empty list with no error is a
   *  real answer: the exchange published nothing in the window. */
  const [error, setError] = useState<string | null>(null);
  /** Bumped to re-run the effect. Exposed so the view can offer a retry. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const { items, ok, error: err } = await fetchIdxDisclosures();
      if (cancelled) return;
      setNews(items);
      setIsLive(ok);
      setError(err);
      setLoading(false);
    }

    load();

    /* Age the existing filings. This does NOT re-request: the list is fetched
     * once per page load, which the view states. */
    const id = setInterval(() => {
      setNews((prev) =>
        prev.map((n) => {
          const minsAgo = n.minsAgo + 1;
          return { ...n, minsAgo, isFresh: minsAgo <= FRESH_WINDOW_MIN };
        }),
      );
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [attempt]);

  return { news, loading, isLive, error, retry: () => setAttempt((n) => n + 1) };
}