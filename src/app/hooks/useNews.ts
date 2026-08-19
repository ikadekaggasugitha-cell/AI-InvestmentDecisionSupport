import { useState, useEffect } from "react";
import { USE_LIVE_API, ENDPOINTS, FETCH_TIMEOUT_MS, apiFetch } from "../config/api";
import { SEED_NEWS } from "../data/idxData";

export interface NewsItem {
  id: string;
  titleId: string;
  titleEn: string;
  summaryId: string;
  summaryEn: string;
  source: string;
  category: "market" | "macro" | "corporate" | "global";
  symbols: string[];
  minsAgo: number;
  isFresh?: boolean;
}

/* Rotate news items to simulate freshness */
const EXTRA_HEADLINES: NewsItem[] = [
  {
    id: "live1",
    titleId: "Volume Transaksi BEI Capai Rp 18,4 Triliun pada Sesi Pertama",
    titleEn: "IDX Transaction Volume Reaches Rp 18.4 Trillion in Morning Session",
    summaryId: "Volume transaksi di Bursa Efek Indonesia (BEI) mencapai Rp 18,4 triliun pada sesi pertama hari ini, meningkat 14% dibandingkan rata-rata 30 hari terakhir. Asing membukukan net buy sebesar Rp 342 miliar.",
    summaryEn: "Transaction volume at the Indonesia Stock Exchange (IDX) reached Rp 18.4 trillion in the morning session today, up 14% versus the 30-day average. Foreign investors recorded net buying of Rp 342 billion.",
    source: "Kontan.co.id",
    category: "market",
    symbols: [],
    minsAgo: 5,
    isFresh: true,
  },
  {
    id: "live2",
    titleId: "Rupiah Menguat ke Rp 15.712 per USD Didukung Surplus Neraca Dagang",
    titleEn: "Rupiah Strengthens to Rp 15,712 per USD on Trade Surplus Support",
    summaryId: "Rupiah menguat ke level Rp 15.712 per dolar AS pada perdagangan hari ini, didukung oleh data surplus neraca perdagangan Indonesia yang mencapai USD 3,8 miliar pada bulan Juni 2026.",
    summaryEn: "The rupiah strengthened to Rp 15,712 per US dollar today, supported by Indonesia's trade surplus data reaching USD 3.8 billion in June 2026.",
    source: "Bisnis.com",
    category: "macro",
    symbols: [],
    minsAgo: 23,
    isFresh: true,
  },
  {
    id: "live3",
    titleId: "ANTM Temukan Cadangan Nikel Baru 12 Juta Ton di Sulawesi Tengah",
    titleEn: "ANTM Discovers New 12 Million Tonne Nickel Reserve in Central Sulawesi",
    summaryId: "PT Aneka Tambang Tbk (ANTM) mengumumkan penemuan cadangan nikel baru sebesar 12 juta ton di Sulawesi Tengah, meningkatkan total cadangan perseroan sebesar 18%. Saham ANTM menguat 3,2% merespons berita ini.",
    summaryEn: "PT Aneka Tambang Tbk (ANTM) announced the discovery of a new 12 million tonne nickel reserve in Central Sulawesi, increasing the company's total reserves by 18%. ANTM shares rallied 3.2% on the news.",
    source: "Reuters Indonesia",
    category: "corporate",
    symbols: ["ANTM"],
    minsAgo: 67,
    isFresh: false,
  },
];

const ALL_NEWS: NewsItem[] = [
  ...EXTRA_HEADLINES,
  ...SEED_NEWS.map((n) => ({ ...n, symbols: [...n.symbols], isFresh: false })),
];

/* ── Live IDX disclosures ────────────────────────────────────────────────────
 *
 * Replaces a browser fetch to Yahoo news through the allorigins.win CORS proxy.
 * That proxy now returns a GitHub Pages 404, so the call failed on every load
 * and the panel silently fell back to seed items — looking like a quiet news
 * day, permanently.
 *
 * The backend now serves IDX keterbukaan informasi: primary filings, each with
 * an issuer code and an exchange timestamp.
 */

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

async function fetchIdxDisclosures(): Promise<NewsItem[]> {
  if (!USE_LIVE_API) return [];
  try {
    const res = await apiFetch(ENDPOINTS.news(20), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json();
    if (data?.source !== "idx" || !Array.isArray(data?.items)) return [];

    return (data.items as ApiNewsItem[]).map((item, i) => ({
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
      category: mapCategory(item.category),
      symbols: item.symbol ? [item.symbol] : [],
      minsAgo: minutesSince(item.publishedAt),
      isFresh: i === 0,
    }));
  } catch {
    return [];
  }
}

export function useNews() {
  const [news, setNews]       = useState<NewsItem[]>(ALL_NEWS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const live = await fetchIdxDisclosures();
      if (!cancelled) {
        setNews(live.length > 0 ? [...live, ...ALL_NEWS] : ALL_NEWS);
        setLoading(false);
      }
    }

    load();

    /* Age existing news + occasionally inject a fresh one */
    const id = setInterval(() => {
      setNews((prev) => {
        const aged = prev.map((n) => ({ ...n, minsAgo: n.minsAgo + 1, isFresh: false }));
        return aged;
      });
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { news, loading };
}
