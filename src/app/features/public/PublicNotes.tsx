/**
 * The public Catatan screen (owner, 2026-11-02): the third signed-out surface,
 * the destination of the burger's "Catatan" on the price sheet. It used to be a
 * jump to the footer's one-sentence disclaimer, which asked a reader to trust a
 * page with no room to explain itself.
 *
 * What is allowed here is decided by one rule, and ADR-0013 records it: every
 * sentence must point at something the running system already does. That is why
 * this page is NOT a rendering of docs/legal-and-consent.md. That document
 * carries its own instruction on line 22 — do not point users at it as the
 * applicable terms — because it is a draft whose reasons are partly stale: it
 * says the payment gateway has no code, while docs/status.md lists it as built.
 * Publishing it here would ship promises nothing keeps.
 *
 * Three things are deliberately absent, each for a reason that lives in code:
 * no price numbers (the price is set in `system_settings` and read from the
 * sheet, so quoting it twice creates two answers), no contact channel (the
 * footer's "Hubungi kami" is a held span because no number or address has ever
 * been given to anyone), and no model name (the API contract cannot support a
 * named algorithm, and src/app/test/dataHonesty.test.ts fails the build over
 * one).
 */
import type { MouseEvent } from 'react'
import type { Locale } from '@/app/i18n/translations'
import { PublicFooter } from '@/app/features/public/PublicFooter'
import { PublicNavMenu } from '@/app/features/public/PublicNavMenu'
import logoUrl from '@/assets/aidss-logo.svg'

export interface PublicNotesProps {
  locale: Locale
  /** Topbar gates, wired the same way as the other two screens. */
  onEnter: () => void
  onSignUp: () => void
  /** Back to the price sheet: the logo and the menu's Harga. */
  onViewPricing: () => void
  /** The features screen, the other page this menu can actually serve. */
  onViewFeatures: () => void
}

/** Printed, not computed. A revision stamp that moved with the browser clock
 *  would be the defect dataHonesty.test.ts already guards against elsewhere. */
const REVISED = { id: '2 November 2026', en: '2 November 2026' }

interface NoteSection {
  id: string
  /** Short label for the wide-screen jump rail. The heading itself is a
   *  sentence and does not fit a 208px column without wrapping oddly. */
  navId: string
  navEn: string
  titleId: string
  titleEn: string
  bodyId: string
  bodyEn: string
}

/* The whole page is this list. Order is the order a deciding reader needs:
   what it is not, then what the numbers mean, then where they come from, then
   money, then data, then status. */
const SECTIONS: NoteSection[] = [
  {
    id: 'risiko',
    navId: 'Bukan penasihat',
    navEn: 'Not an adviser',
    titleId: 'Bukan penasihat investasi',
    titleEn: 'Not an investment adviser',
    bodyId:
      'AIDSS adalah perangkat lunak analitik dan sistem pendukung keputusan. Platform ini bukan ' +
      'penasihat investasi, bukan perantara pedagang efek, dan bukan manajer investasi berizin ' +
      'menurut Undang-Undang Pasar Modal dan peraturan Otoritas Jasa Keuangan. Skor, probabilitas, ' +
      'dan jawaban AI Advisor disajikan untuk edukasi dan referensi analitis. Tidak ada satu pun yang ' +
      'merupakan instruksi, rekomendasi, atau ajakan mengikat untuk membeli, menjual, atau menahan ' +
      'saham tertentu di Bursa Efek Indonesia. Keputusan dan risikonya ada pada Anda.',
    bodyEn:
      'AIDSS is analytics software and a decision-support system. The platform is not an investment ' +
      'adviser, not a licensed broker-dealer, and not a licensed investment manager under the Capital ' +
      'Markets Law and OJK regulations. Scores, probabilities, and AI Advisor answers are provided for ' +
      'education and analytical reference. None of it is an instruction, a recommendation, or a binding ' +
      'invitation to buy, sell, or hold any particular stock on the Indonesia Stock Exchange. The ' +
      'decision, and the risk, are yours.',
  },
  {
    id: 'probabilitas',
    navId: 'Probabilitas',
    navEn: 'Probabilities',
    titleId: 'Angka yang Anda lihat adalah probabilitas',
    titleEn: 'The numbers you see are probabilities',
    bodyId:
      'Skor dan probabilitas dihitung sebuah model dari data pasar. Probabilitas yang tinggi berarti ' +
      'model menilai peluangnya lebih besar, bukan bahwa keuntungan dijamin dan bukan bahwa harga akan ' +
      'naik sebesar angka itu. Setiap kartu sinyal menyebut dari mana angkanya berasal, dan layar AI ' +
      'Advisor meminta Anda menyetujui penyangkalan ini sebelum isinya tampil.',
    bodyEn:
      'Scores and probabilities are computed by a model from market data. A high probability means the ' +
      'model judges the odds larger. It does not mean a gain is guaranteed, and it does not mean the ' +
      'price will rise by that number. Every signal card names where its figure came from, and the AI ' +
      'Advisor screen asks you to accept this disclaimer before any of its content appears.',
  },
  {
    id: 'data',
    navId: 'Sumber data',
    navEn: 'Data sources',
    titleId: 'Dari mana datanya, dan seberapa baru',
    titleEn: 'Where the data comes from, and how fresh',
    bodyId:
      'Harga penutupan harian, daftar efek, dan metadata sektor berasal dari data pasar IDX dan Yahoo ' +
      'Finance. Feed bisa tertinggal: hari libur bursa, jadwal pembaruan harian yang belum selesai, ' +
      'atau sumber yang sedang tidak menjawab. Header aplikasi membawa lencana kesegaran, dan status ' +
      'layanan menjawab degraded ketika bar terakhir terlalu tua, lengkap dengan umurnya dalam jam.',
    bodyEn:
      'Daily closing prices, the listed universe, and sector metadata come from IDX market data and ' +
      'Yahoo Finance. The feed can fall behind: an exchange holiday, a daily update that has not ' +
      'finished, or a source that is not answering. The app header carries a freshness badge, and the ' +
      'service status answers degraded once the newest bar is too old, with its age in hours.',
  },
  {
    id: 'contoh',
    navId: 'Data contoh',
    navEn: 'Sample data',
    titleId: 'Angka contoh dan angka Anda',
    titleEn: 'Sample figures and your figures',
    bodyId:
      'Panel yang isinya contoh membawa label "Data contoh". Yang tidak berlabel seharusnya angka Anda ' +
      'sendiri atau angka dari feed langsung. Kalau Anda menemukan angka yang tidak keduanya, itu cacat ' +
      'yang ingin kami terima, bukan fitur yang harus Anda maklumi. Nilai portofolio Anda hanya ' +
      'berasal dari posisi yang Anda catatkan.',
    bodyEn:
      'A panel holding sample content carries the "Sample data" label. Anything unlabelled should be ' +
      'either your own figure or a live feed figure. If you find a number that is neither, that is a ' +
      'defect we want reported, not a quirk to forgive. Your portfolio value comes only from positions ' +
      'you recorded.',
  },
  {
    id: 'langganan',
    navId: 'Yang dibuka langganan',
    navEn: 'What opens',
    titleId: 'Apa yang dibuka langganan',
    titleEn: 'What a subscription opens',
    bodyId:
      'Butuh langganan aktif: sinyal, panel risiko, portofolio Anda beserta posisi, optimasi, dan ' +
      'kurva ekuitasnya, AI Advisor, ringkasan broker, data teknis dan candlestick, laporan, umpan ' +
      'Peringatan, serta feed harga langsung. Cukup dengan akun yang masuk: daftar efek dan ' +
      'pencariannya, berita keterbukaan IDX, status langganan Anda sendiri, dan layar harga. ' +
      'Penolakan dibedakan menurut sebabnya: belum pernah berlangganan, langganan berakhir, atau ' +
      'akun ditutup administrator. Dua yang pertama diselesaikan dengan pembayaran; yang terakhir tidak.',
    bodyEn:
      'Requires an active subscription: signals, the risk panel, your portfolio with its positions, ' +
      'optimisation, and equity curve, the AI Advisor, broker summary, technicals and candles, ' +
      'reports, the alerts feed, and the live price stream. A signed-in account alone is enough for: ' +
      'the stock list and its search, IDX disclosure news, your own subscription status, and the ' +
      'pricing sheet. Refusals are told apart by cause: never subscribed, subscription ended, or the ' +
      'account was closed by an administrator. Payment fixes the first two. It does not fix the third.',
  },
  {
    id: 'pembayaran',
    navId: 'Cara membayar',
    navEn: 'How payment works',
    titleId: 'Cara membayar dan apa yang terjadi setelahnya',
    titleEn: 'How payment works, and what happens after',
    bodyId:
      'Uang berpindah di luar aplikasi. Anda transfer ke rekening yang tampil di Pengaturan, lalu ' +
      'menyatakan transfernya dari dalam aplikasi dengan nomor dan nama pengirim. Administrator ' +
      'mencocokkannya dengan mutasi, dan akses menyala setelah pembayaran diperiksa. Tidak ada tombol ' +
      'perpanjang atau upgrade: memperpanjang berarti menyatakan transfer baru. Gerbang pembayaran ' +
      'daring hanya aktif bila server dipasang dengan kunci gerbang; tanpa itu aplikasi menjawab ' +
      'bahwa pembayaran daring belum aktif di server ini dan jalur transfer manual tetap berjalan.',
    bodyEn:
      'Money moves outside the application. You transfer to the account shown in Settings, then declare ' +
      'the transfer from inside the app with the number and the name of the sender. An administrator matches it ' +
      'against the bank statement, and access turns on once the payment is checked. There is no renew ' +
      'or upgrade button: renewing means declaring a new transfer. The online payment gateway is live ' +
      'only where the server was installed with a gateway key; without one the app says online payment ' +
      'is not active on this server, and the manual transfer path keeps working.',
  },
  {
    id: 'pengembalian-dana',
    navId: 'Pengembalian dana',
    navEn: 'Refunds',
    titleId: 'Pengembalian dana',
    titleEn: 'Refunds',
    bodyId:
      'Belum ada mekanisme pengembalian dana otomatis. Status pengembalian pada sebuah transaksi hanya ' +
      'mencatat bahwa pengembalian itu disepakati; uangnya dipulangkan administrator di luar aplikasi. ' +
      'Karena itu, periksa lagi paket dan nominal yang tampil di layar harga sebelum menyatakan transfer.',
    bodyEn:
      'There is no automatic refund mechanism yet. A refund status on a transaction only records that ' +
      'the refund was agreed; returning the money is done by an administrator outside the app. So check ' +
      'the plan and the amount shown on the pricing sheet again before declaring a transfer.',
  },
  {
    id: 'privasi',
    navId: 'Data pribadi',
    navEn: 'Personal data',
    titleId: 'Data pribadi Anda',
    titleEn: 'Your personal data',
    bodyId:
      'Yang disimpan untuk menjalankan akun: alamat email, nama lengkap, nomor ponsel, hash sandi ' +
      '(bukan sandinya), hash token sesi (bukan token mentah), pencatatan persetujuan beserta versi ' +
      'teks dan waktunya, portofolio yang Anda catatkan, dan riwayat pembayaran. Yang tidak ' +
      'dikumpulkan: alamat IP, penanda peramban, log audit, nomor invoice, dan gambar bukti transfer. ' +
      'Bukti transfer dicatat sebagai teks. Persetujuan berlaku per akun, bukan per perangkat.',
    bodyEn:
      'Stored to run your account: email address, full name, phone number, a password hash (not the ' +
      'password), a session token hash (not the token), your consent record with the text version and ' +
      'its timestamp, the portfolio you recorded, and your payment history. Not collected: IP address, ' +
      'browser identifiers, audit logs, invoice numbers, or proof-of-transfer images. Payment proof is ' +
      'kept as text. Consent applies per account, not per device.',
  },
  {
    id: 'status',
    navId: 'Status & revisi',
    navEn: 'Status & revisions',
    titleId: 'Status layanan dan revisi catatan ini',
    titleEn: 'Service status, and when these notes changed',
    bodyId:
      'Data pasar dimuat oleh jadwal harian pada jam bursa. Kalau jadwal itu tidak berjalan, aplikasi ' +
      'tetap menampilkan angka terakhir yang ada dan status layanan menyebutnya basi, lengkap dengan ' +
      'umurnya; halaman ini tidak menjanjikan kesegaran yang tidak bisa dibuktikan sistem. Harga ' +
      'langganan ditetapkan di server dan selalu dibaca dari layar harga, jadi catatan ini tidak ' +
      'mengutip angka harga apa pun. Kanal kontak belum dibuka: tautan "Hubungi kami" di footer ' +
      'sengaja tidak bisa diklik, dan nomor atau alamat yang belum kami miliki tidak akan ditulis di ' +
      'sini.',
    bodyEn:
      'Market data is loaded by a daily schedule during exchange hours. If that schedule does not run, ' +
      'the app still shows the last figures it has and the service status calls them stale, with their ' +
      'age; this page does not promise freshness the system cannot prove. Subscription prices are set ' +
      'on the server and always read from the pricing sheet, so these notes quote no price figure. The ' +
      'contact channel is not open: the "Contact us" link in the footer is deliberately not clickable, and a ' +
      'number or address we do not have will not be written here.',
  },
]

/* The shared footer carries no links and no call to action (owner,
   2026-11-02). This screen's own nine sections stay reachable through the jump
   rail in the body, which is where that job belongs. "Hubungi kami" is absent
   for the reason this page already states in its own copy: a number we do not
   have is not written here. */

export function PublicNotes({
  locale,
  onEnter,
  onSignUp,
  onViewPricing,
  onViewFeatures,
}: PublicNotesProps) {
  const isId = locale === 'id'
  const revised = isId ? REVISED.id : REVISED.en

  /* Real href for middle-click and sharing, the app's own handler for the
     walk. Same contract the other two screens keep. */
  const link = (handler: () => void) => (e: MouseEvent) => {
    e.preventDefault()
    handler()
  }

  return (
    <div className="pub-shell pubnotes">
      <header className="pub-topbar">
        <div className="pub-container">
          <a
            href="/"
            onClick={link(onViewPricing)}
            className="pubnotes-logo"
            aria-label={isId ? 'Ke lembar harga' : 'To the price sheet'}
          >
            <span className="pub-brand-chip pub-brand-chip-bare">
              <img src={logoUrl} alt="AIDSS" className="pub-logo" />
            </span>
          </a>
          <div className="pub-topbar-right">
            <span aria-hidden="true" className="pub-topbar-dot" />
            <span className="pub-topbar-label">Trading Intelligence Platform</span>
            <span aria-hidden="true" className="pub-topbar-sep" />
            <button type="button" className="pub-topbar-link" onClick={onEnter}>
              {isId ? 'Masuk' : 'Sign in'}
            </button>
            <button type="button" className="pub-enter" onClick={onSignUp}>
              {isId ? 'Buat akun' : 'Create account'}
            </button>
          </div>
          {/* The menu never offers the page the reader is standing on, so this
              screen serves Harga and Fitur and nothing else. */}
          <PublicNavMenu
            locale={locale}
            ariaLabel={isId ? 'Navigasi layar catatan' : 'Notes screen navigation'}
            targets={[
              { href: '/', label: isId ? 'Harga' : 'Pricing', onNavigate: onViewPricing },
              { href: '/fitur', label: isId ? 'Fitur' : 'Features', onNavigate: onViewFeatures },
            ]}
          />
        </div>
      </header>

      <main>
        <section className="pub-hero pubnotes-hero">
          <div className="pub-container">
            <h1>{isId ? 'Catatan' : 'Notes'}</h1>
            {/* The revision stamp belongs to the whole page, so it rides the
                subtitle as printed text. A date computed from the browser clock
                would be the defect dataHonesty.test.ts already guards against. */}
            <p className="pub-tagline">
              {isId
                ? `Catatan ini direvisi ${revised}. Halaman ini bukan syarat layanan. Dokumen syarat ` +
                  'dan ketentuan AIDSS masih draf internal dan belum mengikat, jadi kami tidak ' +
                  'menampilkannya di sini sebagai perjanjian. Yang Anda baca di bawah hanya hal yang ' +
                  'sudah dilakukan sistem yang berjalan hari ini.'
                : `These notes were revised ${revised}. This page is not the terms of service. The terms ` +
                  'document for AIDSS is still an internal draft and binds no one, so we do not show it ' +
                  'here as an agreement. Everything below is something the running system already does.'}
            </p>
          </div>
        </section>

        <section className="pubnotes-body">
          <div className="pub-container">
            {/* Jump rail for a nine-part page, shown only from 1024px where
                there is room beside the prose. Every heading is still in
                reading order at every width, so this rail is a shortcut and
                never the only way to reach a section. */}
            <nav
              className="pubnotes-index"
              aria-label={isId ? 'Daftar bagian catatan' : 'Notes section list'}
            >
              <ul>
                {SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{isId ? section.navId : section.navEn}</a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="pubnotes-col">
              {SECTIONS.map((section) => (
                <article className="pubnotes-section" id={section.id} key={section.id}>
                  <h2>{isId ? section.titleId : section.titleEn}</h2>
                  <p>{isId ? section.bodyId : section.bodyEn}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <PublicFooter locale={locale} updatedAt={null} />
    </div>
  )
}
