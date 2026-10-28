/**
 * The public features screen, reached from the price sheet's "Fitur" link
 * (owner, 2026-10-23). It expands what the sheet's pillar band compresses:
 * every device the signed-in app actually ships, described in sentences and
 * shown as examples built from real app wording, with the sample-data label
 * the app itself uses. Nothing here is invented: every claim names a view
 * that exists, and the numbers in the examples are labelled as samples.
 *
 * Motion: this screen runs dial ENERGY 2 / RHYTHM 3 / MOTION 2 (the sheet
 * stays at hover-only). The motion is one-time scroll reveal, no loops, and
 * it refuses to arm under prefers-reduced-motion, where everything renders
 * in its final state and the demo video waits for the visitor's play.
 * The demo itself is a real screen recording of the app, not a mockup.
 */
import { useEffect, useRef } from "react";
import type { MouseEvent, RefObject } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Brain,
  FileBarChart2,
  LayoutDashboard,
  Newspaper,
  PieChart,
  Settings,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import type { Locale } from "../i18n/translations";
import { PublicFooter, type NavColumn } from "./PublicFooter";
import { PublicNavMenu } from "./PublicNavMenu";
import logoUrl from "../../assets/aidss-logo.svg";

export interface PublicFeaturesProps {
  locale: Locale;
  /** Topbar gates, same wiring as the price sheet. */
  onEnter: () => void;
  onSignUp: () => void;
  /** Back to the price sheet: the logo and the nav's Harga. */
  onViewPricing: () => void;
  /** Cross-page hash: the disclaimer on the price sheet. */
  onViewNotes: () => void;
}

/* One-time scroll reveal. Arming only happens when the browser runs
   IntersectionObserver and the visitor has not asked for reduced motion;
   otherwise the page stays in its final state with zero moving parts. */
function useReveal() {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") return;
    root.dataset.motion = "armed";
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    root.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return rootRef;
}

/* The demo recording plays once when the visitor scrolls to it, pauses when
   they move on, and never autoplays for reduced-motion visitors: there,
   controls stay and the poster waits for a touch. */
function useDemoVideo(videoRef: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [videoRef]);
}

/* The footer's columns. Everything anchors to this page's four pillars or
   crosses to the sheet's own targets; "Hubungi kami" stays held here too,
   the same span without href as the sheet's footer. */
const FEATURE_COLUMNS: NavColumn[] = [
  {
    headId: "PRODUK",
    headEn: "PRODUCT",
    items: [
      { id: "Sinyal", en: "Signals", anchor: "#sinyal" },
      { id: "Peringatan otomatis", en: "Automatic alerts", anchor: "#peringatan" },
      { id: "Panel risiko", en: "Risk panel", anchor: "#risiko" },
      { id: "Optimasi portofolio", en: "Portfolio optimisation", anchor: "#optimasi" },
    ],
  },
  {
    headId: "LANGGANAN",
    headEn: "PLANS",
    items: [
      { id: "Mingguan", en: "Weekly", anchor: "/#harga" },
      { id: "Bulanan", en: "Monthly", anchor: "/#harga" },
      { id: "Tahunan", en: "Annual", anchor: "/#harga" },
      { id: "Bandingkan paket", en: "Compare plans", anchor: "/#harga" },
    ],
  },
  {
    headId: "BANTUAN",
    headEn: "SUPPORT",
    items: [
      { id: "Hubungi kami", en: "Contact us", anchor: "", held: true },
      { id: "Catatan risiko", en: "Risk notes", anchor: "/#catatan" },
      { id: "Pembaruan harga", en: "Price updates", anchor: "/#harga" },
    ],
  },
];

export function PublicFeatures({
  locale,
  onEnter,
  onSignUp,
  onViewPricing,
  onViewNotes,
}: PublicFeaturesProps) {
  const isId = locale === "id";
  const rootRef = useReveal();
  const videoRef = useRef<HTMLVideoElement>(null);
  useDemoVideo(videoRef);

  /* In-page and cross-page links: the href stays real for middle-click and
     sharing, the click handler keeps the walk inside the app. */
  const link = (handler: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    handler();
  };

  return (
    <div className="pub pubf" ref={rootRef}>
      {/* Same visitor gate as the sheet, tuned for this screen: anchors back
          to the price sheet, the disclaimer, and the same double gate. */}
      <header className="pub-topbar">
        <div className="pub-container">
          <a href="/" onClick={link(onViewPricing)} className="pubf-logo" aria-label={isId ? "Ke lembar harga" : "To the price sheet"}>
            <span className="pub-brand-chip">
              <img src={logoUrl} alt="AIDSS" className="pub-logo" />
            </span>
          </a>
          <div className="pub-topbar-right">
            <span aria-hidden="true" className="pub-topbar-dot" />
            <span className="pub-topbar-label">Trading Intelligence Platform</span>
            <span aria-hidden="true" className="pub-topbar-sep" />
            <button type="button" className="pub-topbar-link" onClick={onEnter}>
              {isId ? "Masuk" : "Sign in"}
            </button>
            <button type="button" className="pub-enter" onClick={onSignUp}>
              {isId ? "Buat akun" : "Create account"}
              <span aria-hidden="true">
                <ArrowUpRight size={16} strokeWidth={2.4} />
              </span>
            </button>
          </div>
          {/* Far right of the bar (owner, 2026-10-24): the page links in a
              small popup, the gates left standing beside it. This screen
              offers Harga (a real way out) and Catatan; it never links to
              the page the reader is already on. */}
          <PublicNavMenu
            locale={locale}
            ariaLabel={isId ? "Navigasi layar fitur" : "Features screen navigation"}
            targets={[
              { href: "/", label: isId ? "Harga" : "Pricing", onNavigate: onViewPricing },
              { href: "/#catatan", label: isId ? "Catatan" : "Notes", onNavigate: onViewNotes },
            ]}
          />
        </div>
      </header>

      <main>
        {/* A short hero: the sheet already carries the long brand sentence,
            so this one states the screen's job in one breath, then hands the
            first screen to the recording itself (owner, 2026-10-24): the
            demo now opens the page instead of waiting a scroll deeper.
            Classes reuse the sheet's hero so the two pages share one type
            system. */}
        <section className="pub-hero pubf-hero">
          <div className="pub-container">
            <p className="pub-eyebrow">{isId ? "FITUR" : "FEATURES"}</p>
            <h1 data-reveal>
              {isId ? "Setiap alat bantu datang dengan alasannya." : "Every decision aid comes with its reasoning."}
            </h1>
            <p className="pub-tagline" data-reveal>
              {isId
                ? "Empat pilar yang mengarah keputusan harian Anda, ditopang perangkat pasar, portofolio, advisor, berita, laporan, dan pengaturan. Semua di dalam satu aplikasi."
                : "Four pillars around your daily decisions, backed by market, portfolio, advisor, news, report, and settings tools. All in one app."}
            </p>

            {/* The demo, on the first screen: a real screen recording of the
                app, captured from signed-in views the visitor will get.
                Captions beneath it name the scenes. */}
            <div className="pubf-hero-demo" id="fitur-demo" data-reveal>
              <div className="pubf-video-wrap">
                <video
                  ref={videoRef}
                  className="pubf-video"
                  src="/fitur-demo.mp4"
                  poster="/fitur-demo-poster.jpg"
                  controls
                  muted
                  playsInline
                  preload="none"
                  aria-label={isId ? "Video pratinjau aplikasi AIDSS, proses merekam layar nyata" : "AIDSS app preview video, a real screen recording"}
                />
              </div>
              <div className="pubf-demo-copy">
                <h2>{isId ? "Lihat aplikasi berjalan" : "See the app working"}</h2>
                <ul className="pubf-demo-list">
                  <li><strong>{isId ? "Ringkasan" : "Summary"}</strong>: {isId ? "nilai portofolio, P&L harian, IHSG." : "portfolio value, daily P&L, market index."}</li>
                  <li><strong>{isId ? "Pasar" : "Markets"}</strong>: {isId ? "pencarian saham dan daftar pantau." : "stock search and the watchlist."}</li>
                  <li><strong>Sinyal AI</strong>: {isId ? "alasan di balik setiap sinyal." : "the reasons behind every signal."}</li>
                </ul>
                <p className="pubf-demo-note">
                  {isId
                    ? "Rekaman layar nyata aplikasi. Warna dan angka mengikuti data contoh lingkungan uji."
                    : "A real screen recording of the app. Colors and figures follow the test environment's sample data."}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* THE FOUR PILLARS, expanded. The same icons as the price sheet's
            band: one motif, carried through. Each block states what it does,
            then shows one real-shaped example the app itself shows. */}
        <section className="pubf-feature" id="sinyal">
          <div className="pub-container pubf-feature-grid">
            <div className="pubf-copy" data-reveal>
              <Activity aria-hidden="true" size={22} color="var(--public-navy)" strokeWidth={2} />
              <h2>{isId ? "Sinyal AI" : "AI signals"}</h2>
              <p>
                {isId
                  ? "Sinyal masuk dan keluar untuk saham yang Anda pantau lengkap dengan alasannya. Di dalamnya, model AI menilai probabilitas naik, tier likuiditas, dan dividend yield per saham, jadi keputusan berasal dari alasan yang bisa Anda periksa."
                  : "Entry and exit calls for the stocks you track, with the reasons attached. A model grades rise probability, liquidity tier, and dividend yield per stock, so your decision rests on reasons you can check."}
              </p>
              <p className="pubf-steps-head">{isId ? "Alur pemakaian di aplikasi" : "How it runs in the app"}</p>
              <ol className="pubf-steps">
                <li>{isId ? "Buka panel Sinyal AI dari sidebar." : "Open the AI signals panel from the sidebar."}</li>
                <li>{isId ? "Baca alasan tiap sinyal: probabilitas naik, tier likuiditas, dan dividend yield per saham." : "Read each signal's reasoning: rise probability, liquidity tier, and dividend yield per stock."}</li>
                <li>{isId ? "Tambahkan yang layak ke daftar pantau, lalu putuskan sendiri kapan masuk." : "Keep the worthy ones on the watchlist, then decide your own entry."}</li>
              </ol>
            </div>
            <div className="pubf-example" data-reveal>
              <p className="pubf-example-head">{isId ? "Contoh dari panel Sinyal AI" : "From the AI signals panel"}</p>
              <ul className="pubf-example-list">
                <li>{isId ? "BREN mendekati target Rp 10.200, pertimbangan ambil untung sebagian" : "BREN is nearing its Rp 10,200 target; taking partial profit is worth weighing"}</li>
                <li>{isId ? "Model AI: Probabilitas Naik ADRO = 76%, dividend yield 8,4% (Tier 1, LQ45)" : "AI model: ADRO upside probability = 76%, dividend yield 8.4% (Tier 1, LQ45)"}</li>
                <li>{isId ? "Eksposur Keuangan naik ke 40,2%, di atas ambang batas 38%" : "Financials exposure rose to 40.2%, above the 38% threshold"}</li>
              </ul>
              <p className="pubf-example-note">{isId ? "Data contoh, seperti pada aplikasi." : "Sample data, as labelled in the app."}</p>
            </div>
          </div>
        </section>

        <section className="pubf-feature pubf-feature-alt" id="peringatan">
          <div className="pub-container pubf-feature-grid">
            <div className="pubf-example" data-reveal>
              <p className="pubf-example-head">{isId ? "Contoh kotak peringatan" : "From the alerts inbox"}</p>
              <ul className="pubf-example-alerts">
                <li>
                  <Bell aria-hidden="true" size={16} color="var(--public-navy)" strokeWidth={2} />
                  <span>{isId ? "Rebalancing disarankan: bobot Keuangan 40,2% melampaui target 38%" : "Rebalancing suggested: the financials weight at 40.2% passed the 38% target"}</span>
                </li>
              </ul>
              <p className="pubf-example-note">{isId ? "Setiap butir bisa ditandai telah dibaca, dihapus, atau dibersihkan semuanya." : "Each row can be marked read, dismissed, or cleared with the rest."}</p>
            </div>
            <div className="pubf-copy" data-reveal>
              <Bell aria-hidden="true" size={22} color="var(--public-navy)" strokeWidth={2} />
              <h2>{isId ? "Peringatan otomatis" : "Automatic alerts"}</h2>
              <p>
                {isId
                  ? "Peringatan terbit saat kondisi pasar memenuhi aturan yang Anda tetapkan, dan menu Peringatan menjaga setiap notifikasi hingga Anda membaca atau menghapusnya. Catatan telah dibaca disimpan, jadi lencana penghitung hanya berisi yang benar-benar baru."
                  : "Alerts fire when market conditions meet the rules you set, and the alerts view keeps each one until you read or remove it. The read state persists, so the badge count only holds what is genuinely new."}
              </p>
              <p className="pubf-steps-head">{isId ? "Alur pemakaian di aplikasi" : "How it runs in the app"}</p>
              <ol className="pubf-steps">
                <li>{isId ? "Tetapkan aturan peringatan Anda di Pengaturan." : "Set your alert rules in Settings."}</li>
                <li>{isId ? "Peringatan terbit saat kondisi pasar memenuhi aturan itu." : "Alerts fire when market conditions meet those rules."}</li>
                <li>{isId ? "Tandai telah dibaca atau hapus; lencana penghitung hanya berisi yang baru." : "Mark one read or dismiss it; the badge only ever holds what is new."}</li>
              </ol>
            </div>
          </div>
        </section>

        <section className="pubf-feature" id="risiko">
          <div className="pub-container pubf-feature-grid">
            <div className="pubf-copy" data-reveal>
              <ShieldCheck aria-hidden="true" size={22} color="var(--public-navy)" strokeWidth={2} />
              <h2>{isId ? "Panel risiko" : "Risk panel"}</h2>
              <p>
                {isId
                  ? "Ringkasan risiko portofolio Anda dalam satu tampilan: skor risiko, rasio Sharpe, perbandingan dengan benchmark IHSG, dan rincian probabilitas skenario beserta dampaknya dalam Rupiah. Data yang menolak hadir tidak direka: yang tampil dijelaskan apa adanya."
                  : "Your portfolio's risk in one view: risk scores, the Sharpe ratio, a comparison against the IHSG benchmark, and the scenario probability detail with its Rupiah impact. Refused data is never invented: what is absent is stated plainly."}
              </p>
              <p className="pubf-steps-head">{isId ? "Alur pemakaian di aplikasi" : "How it runs in the app"}</p>
              <ol className="pubf-steps">
                <li>{isId ? "Buka menu Risiko dari sidebar." : "Open the Risk menu from the sidebar."}</li>
                <li>{isId ? "Baca skor risiko, rasio Sharpe, dan posisi portofolio terhadap benchmark IHSG." : "Read the risk scores, the Sharpe ratio, and the portfolio against the IHSG benchmark."}</li>
                <li>{isId ? "Telusuri rincian probabilitas skenario beserta dampaknya dalam Rupiah." : "Walk the scenario probability detail and its Rupiah impact."}</li>
              </ol>
            </div>
            <div className="pubf-example" data-reveal>
              <p className="pubf-example-head">{isId ? "Contoh dari panel risiko" : "From the risk panel"}</p>
              <ul className="pubf-example-list">
                <li>{isId ? "Skor Risiko · rasio Sharpe · portofolio vs benchmark IHSG" : "Risk scores · Sharpe ratio · portfolio vs the IHSG benchmark"}</li>
                <li>{isId ? "Rincian Probabilitas Skenario: skenario, dampak, probabilitas, dampak IDR" : "Scenario Probability Detail: scenario, impact, probability, IDR impact"}</li>
              </ul>
              <p className="pubf-example-note">{isId ? "Judul kolom persis seperti di aplikasi." : "Column titles exactly as in the app."}</p>
            </div>
          </div>
        </section>

        <section className="pubf-feature pubf-feature-alt" id="optimasi">
          <div className="pub-container pubf-feature-grid">
            <div className="pubf-example" data-reveal>
              <p className="pubf-example-head">{isId ? "Contoh dari panel optimasi" : "From the optimisation panel"}</p>
              <ul className="pubf-example-alerts">
                <li>
                  <PieChart aria-hidden="true" size={16} color="var(--public-navy)" strokeWidth={2} />
                  <span>{isId ? "Rebalancing disarankan: bobot Keuangan 40,2% melampaui target 38%" : "Rebalancing suggested: the financials weight at 40.2% passed the 38% target"}</span>
                </li>
              </ul>
              <p className="pubf-example-note">{isId ? "Target bobot berasal dari aturan Anda, bukan angka bawaan." : "Target weights come from your own rules, not factory numbers."}</p>
            </div>
            <div className="pubf-copy" data-reveal>
              <PieChart aria-hidden="true" size={22} color="var(--public-navy)" strokeWidth={2} />
              <h2>{isId ? "Optimasi portofolio" : "Portfolio optimisation"}</h2>
              <p>
                {isId
                  ? "Alokasi ulang yang disarankan untuk portofolio Anda, disusun dari bobot sektor terhadap target. Ketika sebuah sektor melampaui batas, saran rebalancing muncul dengan angka yang bisa Anda telusuri kembali ke aturan itu."
                  : "Suggested reallocation for your portfolio, built from sector weights against your targets. When a sector passes its threshold, the rebalancing suggestion arrives with numbers you can trace back to that rule."}
              </p>
              <p className="pubf-steps-head">{isId ? "Alur pemakaian di aplikasi" : "How it runs in the app"}</p>
              <ol className="pubf-steps">
                <li>{isId ? "Bandingkan bobot sektor portofolio dengan target yang Anda tetapkan." : "Compare the portfolio's sector weights against the targets you set."}</li>
                <li>{isId ? "Saat sebuah sektor melampaui batas, saran rebalancing muncul dengan angkanya." : "When a sector passes its threshold, the rebalancing suggestion arrives with its numbers."}</li>
                <li>{isId ? "Telusuri angka itu ke aturan Anda sebelum menyetujui saran." : "Trace those numbers back to your own rule before agreeing."}</li>
              </ol>
            </div>
          </div>
        </section>

        {/* One scenario through all four pillars: the page explains each
            device in isolation above, so this band shows them in sequence
            on one trading morning. The sample figures are the same ones the
            example cards quote, labelled the same way. Four steps, because
            the product has four pillars, not because a template says three. */}
        <section className="pubf-flow">
          <div className="pub-container">
            <div className="pubf-flow-head" data-reveal>
              <h2>{isId ? "Dari sinyal ke keputusan" : "From signal to decision"}</h2>
              <p>{isId ? "Satu skenario, empat pilar, satu pagi kerja." : "One scenario, four pillars, one working morning."}</p>
            </div>
            <ol className="pubf-flow-steps">
              <li className="pubf-flow-step" data-reveal>
                <span className="pubf-flow-num" aria-hidden="true">1</span>
                <h3>{isId ? "Sinyal masuk" : "A signal arrives"}</h3>
                <p>{isId ? "ADRO bernilai Probabilitas Naik 76% di panel Sinyal AI, lengkap dengan tier likuiditas dan dividend yield-nya. Saham ini Anda tahan di daftar pantau." : "ADRO shows a 76% upside probability in the AI signals panel, with its liquidity tier and dividend yield attached. You hold it on the watchlist."}</p>
              </li>
              <li className="pubf-flow-step" data-reveal>
                <span className="pubf-flow-num" aria-hidden="true">2</span>
                <h3>{isId ? "Peringatan terbit" : "An alert fires"}</h3>
                <p>{isId ? "Aturan Anda menyatakan bobot Keuangan di atas 38% wajib ditinjau. Ketika bobot itu mencapai 40,2%, peringatan rebalancing muncul di kotak masuk." : "Your rule says a financials weight above 38% must be reviewed. When it reaches 40.2%, a rebalancing alert lands in the inbox."}</p>
              </li>
              <li className="pubf-flow-step" data-reveal>
                <span className="pubf-flow-num" aria-hidden="true">3</span>
                <h3>{isId ? "Risiko dibaca dulu" : "Risk gets read first"}</h3>
                <p>{isId ? "Sebelum bertindak, panel risiko dibuka: skor risiko, rasio Sharpe, dan rincian probabilitas skenario beserta dampaknya dalam Rupiah." : "Before acting, the risk panel opens: risk scores, the Sharpe ratio, and the scenario probability detail with its Rupiah impact."}</p>
              </li>
              <li className="pubf-flow-step" data-reveal>
                <span className="pubf-flow-num" aria-hidden="true">4</span>
                <h3>{isId ? "Alokasi disesuaikan" : "The allocation shifts"}</h3>
                <p>{isId ? "Panel optimasi menyarankan menurunkan bobot Keuangan ke target 38%, dengan angka yang telusur ke aturan yang sama." : "The optimisation panel suggests bringing the financials weight down to the 38% target, with numbers traceable to that same rule."}</p>
              </li>
            </ol>
            <p className="pubf-flow-note" data-reveal>
              {isId
                ? "Data contoh, seperti pada aplikasi. Urutannya bahan pertimbangan; keputusan akhir tetap di tangan Anda."
                : "Sample data, as labelled in the app. The sequence is material for your consideration; the final call stays in your hands."}
            </p>
          </div>
        </section>

        {/* The honest comparison: two columns, qualitative rows, no invented
            numbers (the rows repeat the app's own sentences, so both sides
            stay checkable against the screens named above). */}
        <section className="pubf-compare">
          <div className="pub-container">
            <div className="pubf-compare-head" data-reveal>
              <h2>{isId ? "Sebelum dan sesudah" : "Before and after"}</h2>
              <p>{isId ? "Pekerjaan yang sama, dua cara mengerjakannya." : "The same work, two ways of doing it."}</p>
            </div>
            <div className="pubf-compare-grid">
              <article className="pubf-compare-card" data-reveal>
                <h3>{isId ? "Tanpa satu aplikasi" : "Without one app"}</h3>
                <ul>
                  <li>
                    <strong>{isId ? "Menyaring saham" : "Filtering stocks"}</strong>
                    <span>{isId ? "Membuka satu per satu, membaca berita dan laporannya sendiri." : "Opening them one by one, reading the news and filings yourself."}</span>
                  </li>
                  <li>
                    <strong>{isId ? "Memantau kondisi" : "Watching conditions"}</strong>
                    <span>{isId ? "Menyegari layar sepanjang hari agar tidak kelewatan." : "Refreshing the screen all day so nothing slips past."}</span>
                  </li>
                  <li>
                    <strong>{isId ? "Membaca risiko" : "Reading the risk"}</strong>
                    <span>{isId ? "Angka tersebar di beberapa tempat, sulit dibandingkan dengan benchmark." : "Figures scattered across places, hard to weigh against the benchmark."}</span>
                  </li>
                  <li>
                    <strong>{isId ? "Menyesuaikan alokasi" : "Adjusting the allocation"}</strong>
                    <span>{isId ? "Menghitung bobot sektor dengan tangan, mengingat aturannya sendiri." : "Weighing sectors by hand, remembering your own rules."}</span>
                  </li>
                </ul>
              </article>
              <article className="pubf-compare-card pubf-compare-card-lead" data-reveal>
                <h3>{isId ? "Dengan AIDSS" : "With AIDSS"}</h3>
                <ul>
                  <li>
                    <strong>{isId ? "Menyaring saham" : "Filtering stocks"}</strong>
                    <span>{isId ? "Sinyal masuk dan keluar datang dengan alasan yang bisa Anda periksa." : "Entry and exit calls arrive with reasons you can check."}</span>
                  </li>
                  <li>
                    <strong>{isId ? "Memantau kondisi" : "Watching conditions"}</strong>
                    <span>{isId ? "Peringatan terbit saat kondisi pasar memenuhi aturan yang Anda tetapkan." : "Alerts fire when market conditions meet the rules you set."}</span>
                  </li>
                  <li>
                    <strong>{isId ? "Membaca risiko" : "Reading the risk"}</strong>
                    <span>{isId ? "Skor risiko, rasio Sharpe, dan perbandingan IHSG dalam satu tampilan." : "Risk scores, the Sharpe ratio, and the IHSG comparison in one view."}</span>
                  </li>
                  <li>
                    <strong>{isId ? "Menyesuaikan alokasi" : "Adjusting the allocation"}</strong>
                    <span>{isId ? "Saran rebalancing dengan angka yang telusur ke aturan Anda sendiri." : "Rebalancing suggestions whose numbers trace back to your own rules."}</span>
                  </li>
                </ul>
              </article>
            </div>
            <p className="pubf-compare-note" data-reveal>
              {isId
                ? "Kolom kanan memakai kalimat yang dipakai layar aplikasi sendiri, tanpa janji kinerja."
                : "The right column uses the app's own screen wording, with no performance promise attached."}
            </p>
          </div>
        </section>

        {/* Supporting devices, alternating composition again but tighter: each
            names its real view and stays one paragraph long. */}
        <section className="pubf-tools">
          <div className="pub-container">
            <div className="pubf-tools-head" data-reveal>
              <h2>{isId ? "Dan sisanya yang satu aplikasi kerjakan" : "The rest of what the app carries"}</h2>
            </div>
            <div className="pubf-tools-grid">
              <article className="pubf-tool" data-reveal>
                <LayoutDashboard aria-hidden="true" size={20} color="var(--public-navy)" strokeWidth={2} />
                <h3>Dashboard</h3>
                <p>{isId ? "Nilai portofolio, P&L hari ini, IHSG, dan kenaikan tertinggi di layar pertama, disertai kepemilikan utama dan transaksi terakhir." : "Portfolio value, the day's P&L, the market index, and top gainers on the first screen, with key holdings and recent transactions."}</p>
                <details className="pubf-tool-more">
                  <summary>{isId ? "Contoh" : "Example"}</summary>
                  <p>{isId ? "Di aplikasi: layar pertama menjawab 'berapa nilai portofolio saya hari ini?' bersama P&L harian dan IHSG, tanpa membuka menu lain." : "In the app: the first screen answers 'what is my portfolio worth today?' alongside the daily P&L and the index, without opening another menu."}</p>
                </details>
              </article>
              <article className="pubf-tool" data-reveal>
                <TrendingUp aria-hidden="true" size={20} color="var(--public-navy)" strokeWidth={2} />
                <h3>{isId ? "Pasar" : "Markets"}</h3>
                <p>{isId ? "Harga BEI dalam dua sesi WIB, satuan tukar, dan daftar saham dunia; cari, telusuri, dan tahan saham yang menarik ke daftar pantau." : "IDX prices across the two WIB sessions, the exchange rate, and world markets; search, browse, and keep interesting stocks on the watchlist."}</p>
                <details className="pubf-tool-more">
                  <summary>{isId ? "Contoh" : "Example"}</summary>
                  <p>{isId ? "Di aplikasi: cari saham yang ingin Anda pantau, tahan yang menarik, pindahkan ke daftar pantau." : "In the app: search for a stock you want to follow, hold the interesting one, move it to the watchlist."}</p>
                </details>
              </article>
              <article className="pubf-tool" data-reveal>
                <PieChart aria-hidden="true" size={20} color="var(--public-navy)" strokeWidth={2} />
                <h3>{isId ? "Portofolio" : "Portfolio"}</h3>
                <p>{isId ? "Posisi, harga pokok, dan transaksi Anda, sehingga nilai portofolio dan P&L hari ini bercerita tentang keputusan yang sama." : "Your positions, cost basis, and transactions, so portfolio value and daily P&L tell the same story as your decisions."}</p>
                <details className="pubf-tool-more">
                  <summary>{isId ? "Contoh" : "Example"}</summary>
                  <p>{isId ? "Di aplikasi: posisi dan harga pokok berdampingan dengan P&L hari ini dan transaksi terakhir yang membentuknya." : "In the app: positions and cost basis sit beside the daily P&L and the recent transactions that shaped it."}</p>
                </details>
              </article>
              <article className="pubf-tool" data-reveal>
                <Brain aria-hidden="true" size={20} color="var(--public-navy)" strokeWidth={2} />
                <h3>AI Advisor</h3>
                <p>{isId ? "Tanya apa pun tentang pasar dan portofolio Anda dalam obrolan; jawaban selalu memakai konteks posisi yang ada." : "Ask anything about the market and your portfolio in chat; answers always draw from the positions you hold."}</p>
                <details className="pubf-tool-more">
                  <summary>{isId ? "Contoh" : "Example"}</summary>
                  <p>{isId ? "Di aplikasi: 'kenapa bobot Keuangan saya di atas target?' dijawab dengan konteks posisi yang sedang Anda pegang." : "In the app: 'why is my financials weight above target?' answered with the context of the positions you hold."}</p>
                </details>
              </article>
              <article className="pubf-tool" data-reveal>
                <Newspaper aria-hidden="true" size={20} color="var(--public-navy)" strokeWidth={2} />
                <h3>{isId ? "Berita" : "News"}</h3>
                <p>{isId ? "Aliran berita pasar dengan indikator data hidup; kini bila sumber lambat, tombol segarkan tampil dan bekerja." : "A market news feed with a live-data flag; when the source stalls, a refresh button appears and works."}</p>
                <details className="pubf-tool-more">
                  <summary>{isId ? "Contoh" : "Example"}</summary>
                  <p>{isId ? "Di aplikasi: umpan berita pasar dengan penanda data hidup; bila sumbernya lambat, tombol segarkan tampil dan bekerja." : "In the app: a market news feed with the live-data flag; when its source stalls, the refresh button appears and works."}</p>
                </details>
              </article>
              <article className="pubf-tool" data-reveal>
                <FileBarChart2 aria-hidden="true" size={20} color="var(--public-navy)" strokeWidth={2} />
                <h3>{isId ? "Laporan" : "Reports"}</h3>
                <p>{isId ? "Laporan berkala dari perjalanan portofolio, siap dibaca ringkas di dalam aplikasi." : "Periodic reports from the portfolio's journey, readable in summary inside the app."}</p>
                <details className="pubf-tool-more">
                  <summary>{isId ? "Contoh" : "Example"}</summary>
                  <p>{isId ? "Di aplikasi: ringkasan perjalanan portofolio dibaca ringkas tanpa meninggalkan layar." : "In the app: a summary of the portfolio's journey, read without leaving the screen."}</p>
                </details>
              </article>
              <article className="pubf-tool" data-reveal>
                <Bell aria-hidden="true" size={20} color="var(--public-navy)" strokeWidth={2} />
                <h3>{isId ? "Peringatan" : "Alerts"}</h3>
                <p>{isId ? "Kotak masuk peringatan dengan lencana yang menghilang saat terbaca: tiga keadaan, kosong, memuat, dan gagal, dibedakan dengan jelas." : "An alerts inbox with a badge that dies as you read: empty, loading, and failed states are clearly distinct."}</p>
                <details className="pubf-tool-more">
                  <summary>{isId ? "Contoh" : "Example"}</summary>
                  <p>{isId ? "Di aplikasi: satu peringatan baru masuk, Anda tandai telah dibaca, lencana penghitung langsung berkurang." : "In the app: one new alert arrives, you mark it read, and the counter badge drops."}</p>
                </details>
              </article>
              <article className="pubf-tool" data-reveal>
                <Settings aria-hidden="true" size={20} color="var(--public-navy)" strokeWidth={2} />
                <h3>{isId ? "Pengaturan & langganan" : "Settings & subscription"}</h3>
                <p>{isId ? "Aturan peringatan, preferensi bahasa, profil akun, dan Langganan & Tagihan: dokumen langganan berikut aturannya hidup di dalam aplikasi, bukan di halaman publik ini." : "Alert rules, language preference, the account profile, and Subscription & Billing: the subscription document and its terms live inside the app, not on this public page."}</p>
                <details className="pubf-tool-more">
                  <summary>{isId ? "Contoh" : "Example"}</summary>
                  <p>{isId ? "Di aplikasi: atur aturan peringatan dan preferensi bahasa, lalu buka Langganan & Tagihan untuk dokumen langganannya." : "In the app: set the alert rules and the language preference, then open Subscription & Billing for the subscription document."}</p>
                </details>
              </article>
            </div>
            <p className="pubf-tools-note" data-reveal>
              {isId
                ? "Semua layar memakai perabot yang sama: pencarian di baris judul, pemilih IDR/USD, dan tombol bahasa Indonesia/Inggris mengikuti ke mana pun Anda menjelajah."
                : "Every screen shares the same furniture: search in the title row, the IDR/USD selector, and the Indonesian/English switch going wherever you go."}
            </p>
          </div>
        </section>

        {/* The questions this product's readers actually ask, answered from
            how the app behaves (never template filler): native details/summary
            so keyboard and screen readers get the disclosure for free. */}
        <section className="pubf-faq">
          <div className="pub-container pubf-faq-grid">
            <div className="pubf-faq-intro" data-reveal>
              <h2>{isId ? "Pertanyaan yang benar-benar muncul" : "The questions that actually come up"}</h2>
              <p>{isId ? "Jawabannya mengikuti cara kerja aplikasi, bukan jawaban umum." : "The answers follow how the app works, not generic reassurance."}</p>
            </div>
            <div className="pubf-faq-list" data-reveal>
              <details className="pubf-faq-item">
                <summary>{isId ? "Apakah AIDSS yang membeli dan menjual saham untuk saya?" : "Does AIDSS buy and sell stocks for me?"}</summary>
                <p>{isId
                  ? "Tidak. AIDSS adalah alat bantu keputusan, bukan penasihat investasi: sinyal, peringatan, dan saran rebalancing datang lengkap dengan alasannya, dan keputusan beli atau jual tetap di tangan Anda."
                  : "No. AIDSS is a decision aid, not an investment adviser: signals, alerts, and rebalancing suggestions arrive with their reasoning, and the buy or sell call stays in your hands."}</p>
              </details>
              <details className="pubf-faq-item">
                <summary>{isId ? "Apa bedanya data contoh di halaman ini dengan data di aplikasi?" : "What separates this page's sample data from the app's data?"}</summary>
                <p>{isId
                  ? "Contoh di halaman ini dilabeli 'Data contoh, seperti pada aplikasi'. Di dalam aplikasi, panel menampilkan angka dari data yang tersedia; ketika sebuah data menolak hadir, aplikasi menyatakannya apa adanya, tidak direka."
                  : "Examples here carry the label 'Sample data, as labelled in the app.' Inside the app, panels show figures from the data available; when data refuses to appear, the app states that plainly instead of inventing it."}</p>
              </details>
              <details className="pubf-faq-item">
                <summary>{isId ? "Untuk apa AI Advisor dipakai?" : "What is the AI Advisor for?"}</summary>
                <p>{isId
                  ? "Untuk bertanya tentang pasar dan portofolio Anda dalam obrolan. Jawabannya selalu memakai konteks posisi yang ada, sebagai bahan pertimbangan, bukan sebagai nasihat."
                  : "Asking about the market and your portfolio in chat. Answers always draw from the positions you hold, as material for your consideration, not as advice."}</p>
              </details>
              <details className="pubf-faq-item">
                <summary>{isId ? "Kapan peringatan saya terbit?" : "When do my alerts fire?"}</summary>
                <p>{isId
                  ? "Saat kondisi pasar memenuhi aturan yang Anda tetapkan di Pengaturan. Setiap peringatan bertahan di kotak masuk hingga Anda membacanya atau menghapusnya."
                  : "When market conditions meet the rules you set in Settings. Each alert stays in the inbox until you read or remove it."}</p>
              </details>
              <details className="pubf-faq-item">
                <summary>{isId ? "Bagaimana langganan dan pembayarannya bekerja?" : "How do the subscription and payment work?"}</summary>
                <p>{isId
                  ? "Pilihan paket membawa Anda ke form daftar, dan pembayaran dimulai dari dalam aplikasi, di menu Langganan & Tagihan. Semua paket mencakup keempat pilar, dan harga dalam Rupiah sudah termasuk pajak."
                  : "Picking a plan carries you into the signup form, and payment begins inside the app, under Subscription & Billing. Every plan includes the four pillars, and prices in Rupiah already include tax."}</p>
              </details>
            </div>
          </div>
        </section>

        {/* The way out: back to the price the whole journey started at. */}
        <section className="pubf-cta" data-reveal>
          <div className="pub-container">
            <h2>{isId ? "Siap mengujinya?" : "Ready to weigh it?"}</h2>
            <a
              className="pubf-cta-link"
              href="/#harga"
              onClick={(e) => {
                e.preventDefault();
                onViewPricing();
              }}
            >
              {isId ? "Lihat harga, masuk ke paket" : "See the pricing, pick a plan"}
              <ArrowUpRight size={17} strokeWidth={2.4} aria-hidden="true" />
            </a>
            <p className="pubf-cta-note">
              {isId ? "Pilihan paket membawa intent ke form daftar; pembayaran dimula dari dalam aplikasi." : "A plan pick carries its intent into the signup form; payment begins inside the app."}
            </p>
          </div>
        </section>
      </main>

      <PublicFooter locale={locale} columns={FEATURE_COLUMNS} updatedAt={null} />
    </div>
  );
}
