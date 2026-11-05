# DESIGN.md

Design direction for this project. Owned by the product owner. `antislop.md` is the
filter that runs on top of this file; this file is the soul, and the filter never
overrides it.

This file transcribes the owner's answers. All identity fields are named by the
owner; no agent-invented value is present.

> **Canonical location:** this design system now lives at `docs/adr/design.md`
> (it used to be `docs/DESIGN.md`). In-code comments that still say `docs/DESIGN.md`
> point here.

## Identity

- **Product name:** AIDSS, AI Investment Decision Support System.
- **Category:** investment analytics and decision support.
- **Design direction:** Institutional Finance x Modern Intelligence.
- **What it does:** decision support. It surfaces a scored BUY/HOLD/SELL call
  together with the reasoning and the data behind it.
- **Who it is for:** self-directed investors making their own investment decisions.
  Not a desk, not a team. The reader owns the capital and the consequence.
- **Source:** owner's own answer, transcribed 2026-10-10.

## Personality

Analytical, trustworthy, precise, restrained, and forward-looking.
Restrained and analytical: quiet, dense, unfussy. Data leads and decoration stays
out of the way. Nothing in the interface tries to impress the reader.

Visual principle: data-first. Clarity over decoration. Confidence without visual
noise.

- **Source:** owner's own answer, transcribed 2026-10-10.

## Color

Two core colors plus one accent, on a neutral ground. Neutrals do not count against
that budget.

- **Core color 1, Midnight Navy:** `#14243A`. Primary brand color, navigation, major
  headings, and dark surfaces.
- **Core color 2, Slate Blue:** `#344A64`. Secondary navigation, supporting surfaces,
  selected states, and visual hierarchy.
- **Accent, Emerald Teal:** `#0F9D78`. Primary actions, selected key moments, and
  important positive highlights. Use sparingly; never turn the interface into a
  green-heavy financial dashboard. Held to a contrast floor: on the light ground it
  is a fill with dark text and never white-on-teal, because white on `#0F9D78`
  measures about 3.4:1 and fails R-25 for normal text.
- **Ground, Cool Ivory:** `#F5F7FA`. Default application background.
- **Text, Graphite Ink:** `#17212F`. Primary text, figures, labels, and headings.

Supporting neutrals: surface `#FFFFFF`, border `#DCE2EA`, secondary text `#64748B`
(nudged darker to `#5E6C7E` so body text clears 4.5:1 on Cool Ivory), muted surface
`#EDF1F5`. Inline text links use a dedicated `--link` token — Slate Blue `#344A64`
on light, light blue `#7FB0E0` on dark — because `--primary` is a fill and reads
below 3:1 where its value would double as link text on the dark ground.

Financial semantics, distinct from the accent:

- **Positive:** `#16845B` (nudged to `#14764A`: `#15804F` measured 4.37:1 on the muted
  surface `#EDF1F5`, so the text colour is taken darker until gain clears 4.5:1 on both
  Cool Ivory and the muted surface).
- **Negative:** `#D14343` (nudged to `#C63B3B` for text on the light ground).
- **Neutral:** `#64748B` (nudged to `#5E6C7E` for text on the light ground).

Financial status colors are semantic, not decorative. Never communicate gain or loss
through color alone; include the sign, value, or label.

- **Source:** owner's own answer, transcribed 2026-10-10.

## Typography

- **Display face, Manrope (Google Fonts):** page titles, key metrics, section
  headings, and prominent summaries. Weights 500, 600, 700.
- **Workhorse sans, Inter (Google Fonts):** body text, navigation, forms, tables,
  labels, and analytical explanations. Weights 400, 500, 600.
- **Tabular-figures face, IBM Plex Mono (Google Fonts):** stock prices, portfolio
  values, percentages, timestamps, financial tables, and technical identifiers.
  Weights 400, 500. Tabular numerals enabled where supported so numeric columns and
  price ladders scan.

Figures must read as figures. The numbers are the product.

- **Source:** owner's own answer, transcribed 2026-10-10.

## Iconography

- **Library:** Lucide (`lucide-react`), minimal consistent outline icons.
- **Default stroke width:** 1.75 to 2px.
- **Usage:** icons must improve recognition or navigation, not fill empty space.
- **Restrictions:** no emoji icons, no decorative icon clusters, no gratuitous
  gradients, no mixed icon styles.
- **Fallback:** use clear text labels when an icon does not improve usability.

- **Source:** owner's own answer, transcribed 2026-10-10.

## Theme

Light default, with a working dark toggle. Both modes fully functional, both verified
by contrast check and by click-through before delivery. A mode that breaks the other
is a defect, not a preference.

Navigation is Midnight Navy in both themes: it is a brand surface, not a dark-mode
default. The admin portal follows this same rule. It is not a separate surface, and
it gets no theme of its own. An operator does the same job as a subscriber, so the
two portals share one ground.

- **Source:** owner's own answer, transcribed 2026-10-10, extended by the owner's
  decision on 2026-10-02 that the admin portal follows the light default.

## Dials

> Reading this as: investment decision support for self-directed investors, in an
> institutional-finance language, dial ENERGY 1 / RHYTHM 2 / MOTION 1.

- **ENERGY 1:** restrained, nothing tries to impress the reader.
- **RHYTHM 2:** composition varies between views while the voice stays level. A
  multi-view analytical tool whose views all compose identically reads as a template.
- **MOTION 1:** unfussy. Hover and state feedback only. Motion used to direct
  attention to a signal is still permitted under ENERGY 1, and still needs its
  purpose written down.

## Implementation Principles

- Prioritize information hierarchy and readable financial data.
- Midnight Navy and Slate Blue are the primary visual foundation.
- Reserve Emerald Teal for a limited number of meaningful interactions.
- Surfaces stay restrained, borders subtle, shadows minimal.
- Consistent spacing and alignment across tables and dashboards.
- Prefer explicit labels, units, and timestamps over ambiguous visual indicators.
- Ensure accessible contrast; never rely on color alone to convey financial outcomes.
- Avoid excessive rounded cards, ornamental gradients, glowing effects, and
  unnecessary animation.

## Glass UI modern + Mode Gelap (dark)

The in-session product runs on a restrained paper surface. Glass is applied as a
bounded accent, not a character trait: it marks the screens where the reader works
with live data, and it stays off the chrome, the console, and anything a reader has
to parse instantly. This section is the scannable spec. The measured history, the
test-enforced contrast numbers, and the honest open items live in the ledger at
`## Pengecualian terdokumentasi: glass di view dalam-sesi` near the end of this file.
Read the two together; this section never restates a number the ledger already proves.

**One principle.** Glass is dose-limited. `backdrop-filter` blur is paid for only
where dark content actually passes underneath, which today is the dashboard alone.
Everywhere else the translucent surface is tint-only, no blur. There is no gradient
on text or icons and no glow. `--sidebar`, `--control-border`, `--link`, and
`focus.css` are not touched by the glass system.

**Per-module surface matrix.** Single source of truth is `src/app/surfaces.ts`
(`GLASS_VIEWS`, `GLASS_SHELL_VIEWS`, `OPAQUE_ONLY_FILES`), enforced two directions by
`src/app/test/glassContrast.test.ts`:

| Screen | Class | Blur | Notes |
|---|---|---|---|
| Dashboard | `.glass-card` + sticky `.glass-bar` | yes, `blur(14px) saturate(1.35)` | the only glass shell: the column scrolls under a sticky header, so the bar has real content to refract |
| Portfolio, Risk, News, Reports, Settings, Advisor, Markets, Alerts (8) | `.surface-glass` | no, tint only | keep their own internal scroller and static header; blur would be GPU cost with nothing to bend |
| Admin console, sign-in / register, SuspensionScreen, public price sheet | opaque `var(--card)` | no | built and contrast-checked on paper; the console is light-only by owner decision |
| Dialogs, drawers, scrims, search dropdown, skeleton, error boundary | opaque `var(--card)` | no | small text over a moving backdrop must stay readable |

**Glass tokens.** Declared twice in `src/styles/theme.css`, once in `:root` and once
in `.dark`; `--glass-blur` and `--glass-radius` are declared once and inherited by
both themes.

| Token | Light | Dark |
|---|---|---|
| `--glass-surface` (cards) | `rgba(255,255,255,0.66)` | `rgba(20,36,58,0.62)` |
| `--glass-surface-raised` (header bar) | `rgba(255,255,255,0.7)` | `rgba(23,41,63,0.66)` |
| `--glass-border` | `rgba(20,36,58,0.16)` | `rgba(215,225,236,0.14)` |
| `--surface-hairline` (rules drawn on glass) | `rgba(20,36,58,0.18)` | `rgba(215,225,236,0.2)` |
| `--glass-sheen` (1px inset top edge) | `rgba(255,255,255,0.55)` | `rgba(215,225,236,0.22)` |
| `--glass-blur` | `14px` | `14px` |
| `--glass-radius` | `16px` | `16px` |
| `--glass-shadow` | `0 12px 32px rgba(20,36,58,0.1)` | `0 12px 32px rgba(0,0,0,0.34)` |
| `--glass-page` (ground) | lavender + mint pastel | slate + low-alpha Emerald Teal |

`.surface-glass` and `.glass-card` share the same background, hairline border, `16px`
radius, soft shadow, and 1px inset sheen; the only difference is that `.glass-card`
adds `backdrop-filter: blur(var(--glass-blur)) saturate(1.35)`.

**Mode Gelap (dark).** Both themes are fully functional, as the `## Theme` section
requires. The dark ground stays on brand hues, slate plus a low-alpha Emerald Teal,
never the light theme's pastel lavender and mint: a coloured ground behind green and
red financial figures is how a P&L starts to read as decoration. The dark card is kept
slightly cloudier than the light one (`0.62` against `0.66`) because clearing a dark
ground costs luminance instead of buying it.

**Accessibility.** `prefers-reduced-transparency: reduce` falls every glass surface
back to the opaque `var(--card)` with no blur and no shadow, so a system that asks for
reduced transparency still reads correctly. Contrast is not asserted here; it is
enforced by `src/app/test/glassContrast.test.ts`, which composites each card over the
real ground and holds the binding pairs at AA in both themes (guard floor `4.65`, text
floor `11px`). The lavender and mint hues are licensed for the background layer only,
never for text, icons, or accents.

> **Out-of-scope follow-up.** Thirteen in-code comments across ten files still
> reference the old `docs/DESIGN.md` path, and one names the section "dashboard
> glassy" rather than its real heading. Repointing them to `docs/adr/design.md` is a
> code change and was deliberately left out of this document-only edit.

## Pengecualian terdokumentasi: lembar harga publik (2026-10-21)

> Sejak rombak penuh **ronde sembilan (2026-10-22)** dari
> `referensi/design-harga-fix.png`, seluruh butir di bawah ini adalah
> **riwayat**, bukan keadaan berjalan: kartu navy, latar gambar, tombol
> gradien, CTA di baris judul, strip sorotan semua kartu, dan pusat vertikal
> sudah tidak ada. Keadaan berjalan dicatat di bagiannya sendiri di akhir
> berkas ini ("... rombak penuh ronde sembilan (2026-10-22)").

Sheet harga pengunjung (`PublicPricing.tsx`) dirancang ulang dari referensi
milik pemilik (`referensi/design-harga.png`). Itu disengaja, sehingga
aturan berikut terkandung pada lembar itu saja:

- **Formula warna dua lapis** dengan token halaman sendiri (`--public-*` di
  `src/styles/theme.css`): kartu tetap **navy gelap** dari sensus piksel
  referensi (kartu `#121a2b`, aksen `#7dd3fc`, hijau `#38e1a2`), tetapi sejak
  ronde ketiga **tanah halamannya milik pemilik** — gambar `image-bg.png`
  (gradasi pastel lavender → mint → pink) milik pemilik dipasang langsung di
  `.pub-shell`, dan teks yang menulis di atasnya berganti tinta gelap lewat
  token baru `--public-on-bg` `#10182b` / `--public-muted-on-bg` `#3f4f74`
  (kontras dihitung terhadap piksel aset: 11,1:1 dan 5,1:1, di atas AA).
  Token `--public-bg` `#0a0e1a` tinggal menumpang di bawah gambar selama
  belum termuat. Token tidak mengikuti varian terang/gelap karena lembar
  hanya dirender untuk pengunjung tanpa sesi.
- **Badge uppercase ter-track** (`FLEKSIBEL`, `POPULER`, label panel) dan
  **lebih dari satu momen aksen** (lapisan gradien sky-hijau kartu Tahunan,
  CTA gradien) diperbolehkan di lembar ini karena itu komposisi pemilik.
- **Batas tombol ghost** dinaikkan dari nilai referensi satu nada
  (`≈#2a3a58` menjadi `#5a6a85`) demi WCAG 1.4.11, batas kontrol interaktif
  3:1 terhadap kartu di sekitarnya; bentuk desain tidak berubah.
- Logo di bar atas adalah aset pemilik yang dilacak menjadi vektor; latar
  putihnya dihapus (satu jalur `#FEFEFE`) dan kotoran sisa pelacakan
  dicleaning agar transparan di atas latar apa pun — sekarang pastel, semula
  gelap.
- **Lembar memenuhi layar** (revisi pemilik, petang 2026-10-21): tanpa cap
  lebar konten; gutter mengalir `clamp(20px, 3vw, 56px)`. Kolom bawah
  3fr/2fr milik revisi pertama; sejak ronde ketiga kolom itu tidak ada lagi
  (lihat bawah).
- **Kartu berubah warna saat kursor di atasnya** (revisi pemilik): permukaan
  naik satu nada. Mekanismenya berpindah-pindah: revisi pertama warna flat
  (`--public-card-hover`), ronde keempat mencerahkan lapisan gambar
  (`::before`, `brightness(1.08)`), dan sejak ronde enam kembali ke warna
  flat satu not (tint sky `#f5f8fd`) karena lapisan gambar sudah pensiun.
  Kartu tetap bukan kontrol — radio dan tombolnya yang melayani klik — jadi
  kursor tetap default dan warna ini murni umpan balik sorotan.
- **Kilau biru → putih di atas gelap** (revisi kedua pemilik; digantikan
  aset latarnya di ronde ketiga): satu radial-gradient lembut dari tepi
  atas pada `.pub-shell`; judul besar tetap AA di dalam zona kilau, teks
  kecil di sudut tetap di luar zona paling terang.
- **Warna aksen menyimpan untuk interaksi** (revisi kedua pemilik): pita
  gradien atas kini dimiliki semua kartu, dan bersama titik radio serta isi
  tombol pilih paket hanya muncul saat sorotan/fokus (`.pub-strip`,
  `.pub-radio-dot`; sejak ronde kelima isi sky tombol dipicu kartu lewat
  `.pub-card:hover .pub-pick`, bukan hover tombolnya sendiri). Ring radio
  sejak ronde delapan satu tinta seperti ring lain — dotnya kembali ke
  aturan sorotan; pill `Nilai Terbaik` dan strip `Hemat p%` tetap berwarna
  di keadaan tenang atas putusan pemilik. Sejak ronde ketiga titik dirender
  pada **ketiga** radio (bukan hanya yang terpilih) sehingga sorotan kartu
  mana pun menampilkan titiknya; sejak ronde keempat isi sky tombol
  **disamakan di ketiga kartu** — aturan khusus `.pub-pick-annual` dihapus,
  ketiga tombol identik bentuk dan perilakunya.
- **Kartu: kertas putih, satu aksen** (revisi keenam pemilik, setelah uji
  `referensi/hasil-screen.png` yang terbaca "tidak balance, seperti pakai
  AI"): kombinasi ronde keempat menumpahkan tiga keluarga warna (pastel
  shell + kartu hijau-kuning + tombol navy-biru) dan kartulah yang paling
  nyaring, mengalahkan harga. Kini kartu memakai `--public-card` putih
  dengan sorot flat satu not `--public-card-hover` `#f5f8fd`; subtree
  tetap tinta gelap `#10182b` (15:1 di putih) dan redup turun ke
  `#5b6b88` (5,4:1); bingkai kartu jadi **bisikan** `rgba(16,24,43,0.08)`
  (pemilik pernah membacanya "outline hitam", jadi bayangan
  `0 12px 32px rgba(16,24,43,0.14)` yang memikul pemisahan, garis hanya
  memantapkan tepi); tile ikon jadi tint sky `--public-tile-bg` `#eef7fe`
  tanpa bingkai, ikon dekoratifnya memakai aksen deep, bukan chip navy
  gelap; pil `Nilai Terbaik` dan strip hemat memakai keluarga **hijau tua
  semantik** `#0e7a52` di tint 8% + tepi 30% (hijau terang referensi
  `#38e1a2` cuma 1,7:1 di putih) — satu aksen kaya (gradasi tombol
  pemilik) berdiri sendiri, hijau kecil hanya menandai nilai. Sejarah
  ronde keempat tetap hidup di lapisan sebelumnya: aset
  `image-card-bg.png` pernah memakai tinta `#10182b` (4,65:1 atas hijau
  tergelap) dengan ring sky beralo tinta — pola halo itu tetap dipakai
  (sky 1,7:1 di putih). Lapisan `::before` beserta aturan z-index dan
  hover brightness-nya dilepas; aset latar kartu dihapus dari
  `src/assets/` (aslinya masih di `referensi/`). Tekstur lain mengikuti
  kertas putih: pembatas kartu dan garis atas/bawah lembar dibisikkan ke
  rgba tinta 0,12-0,18; chip gagal-muat jadi kertas putih bertuliskan
  `--public-muted-on-bg` (8:1 di chip) karena `--public-muted` #8ca3c7
  tinggal 2,6:1 di putih. Token mati diangkat:
  `--public-muted`, `--public-border`, `--public-border-strong`,
  `--public-green-bg`, `--public-green-border`.
- **Isi lembar dipusatkan vertikal** (revisi keenam; topbar dilepas ronde
  delapan): `.pub-frame` kehilangan `flex: 1` dan memakai `margin: auto 0`
  di dalam shell — layar yang lebih tinggi dari lembar menyeimbangkan ruang
  kosong di atas dan bawah alih-alih menggantungkannya di bawah footer; bila
  isi lebih tinggi dari layar, margin auto itu nol dan aliran normal kembali.
  Sejak ronde delapan topbar berada **di luar** kerangka ini: ia pin di
  padding atas shell seperti header halaman biasa (garis bawah tetap), dan
  kerangka berpusat menghitung ruang setelahnya.
- **Header topbar menempel di atas** (revisi delapan pemilik): baris logo +
  "Trading Intelligence Platform" tidak lagi melayang mengikuti pusat; logo
  diperbesar ke **38px** (26px mulanya).
- **Tombol "Pilih paket" bergradasi, isi sky mengikuti sorot kartu**
  (revisi kelima pemilik): keadaan tenang memakai aset
  `referensi/tombol-bg.png` (navy → biru → teal, tanpa garis air,
  `src/assets/tombol-bg.png`) — hanya jendela atas 44% aset yang memuat
  tombol (`100% 228%`, posisi atas), karena komis piksel kawasan teks
  memberi putih 4,55:1 terburuk di jendela itu dan paruh teal bawah aset
  terlalu terang untuk teks mana pun (lum hingga 0,69); tinta label =
  token `--public-on-pick` `#ffffff`. Bingkai tinta awalnya berperan pemberi
  batas; sejak ronde enam latar sekitarnya putih dan tepi biru jendela itu
  sendiri sudah 4,5:1, jadi bingkainya kini sekadar memantapkan tepi. Isi sky
  kini dipicu **kartu**, bukan tombol — cursor atau fokus
  keyboard di mana pun dalam kartu menyalakan tombol (`.pub-card:hover
  .pub-pick:not(:disabled)` + `:focus-within`), menggantikan pemicu
  tombol-sendiri milik ronde keempat.
- **Manfaat masuk kartu** (revisi ketiga pemilik; label ronde tujuh dihapus):
  daftar manfaat dirender di dalam ketiga kartu — identik satu sama lain
  yang satu gerbang, karena yang dibuka sama untuk semua harga — dan kartu
  tumbuh tinggi; panel samping dan seluruh baris bawah (`.pub-grid`)
  dihapus. Tombol pilih tetap menempel dasar kartu (`margin-top: auto`).
  Sejak ronde tujuh label kecil "YANG DIBUKA LANGGANAN" beserta dot sky-nya
  dihapus atas putusan pemilik: daftarnya langsung di bawah harga dan
  strip hemat; makna itu tetap dibawa `aria-label` di `<ul>`.
- **Ikon manfaat telanjang di ink** (revisi tujuh pemilik): chip tint
  40×40 diangkat — ikon `aria-hidden` 22px menempel bareng teks dalam
  **satu warna bersama teks** (`--public-on-card`), stroke 2, rata optik
  `marginTop: 1px`; glyph `Zap` diganti `Activity` (denyut pasar, bukan
  petir pada baterai). Garnish warna dihapus; geometri lucide yang
  menanggung rasa didesain tangan.
- **Ring radio: satu tinta untuk semua; dot murni sorotan** (revisi
  delapan pemilik, dua putaran umpan): dulu ring aksen berhalo tinta 2px —
  pemilik membacanya "outliner"; lalu umpan "masih tidak seragam"
  mengantarkan ring ke **tinta tunggal `#10182b` di ketiga radio**;
  dan putaran penutup: dot terpilih yang sempat dibuat selalu tampil —
  ditanggap pemilik "warna muncul sedari awal" — **ditarik kembali ke
  aturan sorotan aslinya**: dot ketiga radio (terpilih ikut) tersembunyi
  di keadaan tenang dan tampil saat kursor/fokus masuk kartu, warna aksen
  seragam. Ring tinta 15:1 menanggung batas 1.4.11 sendirian;
  `--public-radio-checked` mati dan diangkat. Konsekuensi terekam: keadaan
  terpilih tak bertanda visual saat tenang — `aria-checked` dan tampilnya
  dot selama fokus (tepat setelah klik, misalnya) yang membawanya;
  bila kelak perlu penanda tenang, bentuknya dibicarakan dulu dengan
  pemilik.
- **CTA kecil di baris judul** (revisi ketiga pemilik): "Masuk atau buat
  akun" dari tombol gradien raksasa menjadi pil kecil di ujung kanan baris
  judul, sejajar Harga langganan. Kalimat pembayaran ("Pembayaran lewat
  transfer manual yang diperiksa admin, atau Midtrans...") yang tadinya
  menempatkan di bawahnya **dihapus ronde tujuh**
  atas putusan pemilik. Di ponsel tombol membungkus turun tetap rata
  kanan. Perilaku tetap `onEnter` — lembar masih tanpa jalur bayar.
- **Tagline dan topbar** (revisi tujuh pemilik): tagline
  "Keputusan investasi yang lebih tenang, berbekal data yang benar."
  (EN "Calmer investment decisions, backed by the right data.")
  menggantikan "Apa yang dibuka langganan, dan berapa harganya."; logo
  AIDSS di topbar naik 26px → **34px** di semua viewport.

## Pengecualian terdokumentasi: lembar harga rombak penuh ronde sembilan (2026-10-22)

Referensi pemilik berganti ke `referensi/design-harga-fix.png` (878x1332) dan
lembar dibangun ulang **penuh sebagai halaman**, bukan kanvas terpusat: bar
navigasi, kepala judul, tiga kartu harga, caption, band pilar, dan footer
navy. Satu-satunya perbedaan yang diizinkan dari karya adalah logonya —
halaman tetap memakai `src/assets/aidss-logo.svg` (aset pelacakan pemilik),
karya memuat olahan markanya sendiri. Semua aturan di bawah terkandung pada
lembar ini saja, dan masing-masing mencantumkan aturan lama yang digantikan.

- **Tiga zona ground flat** milik referensi, token baru `--public-*` di
  `src/styles/theme.css`: `--public-ground-top` `#dbe2fd` (bar nav),
  `--public-ground` `#e0e6fc` (kepala + kartu), `--public-ground-soft`
  `#f3f6fd` (band pilar), footer gradasi `--public-footer-top` `#1f3487` →
  `--public-footer` `#030e58`. Sensu piksel tangkapan 1920 menegaskan zona
  utama pas sampai piksel dan keluarga gradasi footer hidup.
- **Konten satu kolom ~1160px** (jawaban pemilik 2026-10-22): `.pub-container`
  `width: min(100% - 40px, 1160px)`. Ini **menggantikan** "Lembar memenuhi
  layar" milik ronde 6 petang 2026-10-21 **dan** pusat vertikal ronde 6
  (`.pub-frame` dihapus; halaman mengalir, `main` melar agar footer menutup
  dasar pada render pendek).
- **Bawaan radio Bulanan** (referensi) menggantikan Tahunan milik ronde 6.
- **Dot radio tampil di keadaan tenang — navy monokrom**: keberatan ronde 8
  adalah warna aksen yang muncul sedari awal, bukan pada penanda tenang itu
  sendiri; referensi tetap menunjukkan dot terpilih, jadi radio terpilih
  memakai ring navy + dot navy 10px yang selalu terlihat, dan dot idle
  `--public-accent` tetap murni garnish sorot/hapus kartu (aturan "dot
  murni sorotan" milik ronde 8 dibalik sebagian: hanya untuk kartu idle).
  Ring idle `#8a8a8a` (3,2:1) memikul batas 1.4.11, bentuk bulat tetap.
- **Strip Hemat statis khusus Tahunan**, duduk di bawah catatan "Setara …
  per bulan" dan di atas garis pemisah (posisi terekam dari karya):
  **menggantikan** aturan reveal-sorot ronde 2-8 milik semua kartu dan
  pil gradien atas kartu; ikon `Play` → `Activity` (denyut, seperti ronde
  7 di daftar). Teks dan pil memakai mint `--public-mint` `#e4f3ec` +
  hijau tua `--public-green` `#275136` (8,2:1), menggantikan hijau tua
  `#0e7a52` milik ronde 6.
- **Tombol datar navy** menggantikan tombol gradien `tombol-bg.png` milik
  ronde 5: memakai `--public-navy-deep` `#17226a`, hover satu not ke
  `--public-navy-hover` `#232e7a` dipicu kartu (pola ronde 5 bertahan,
  warnanya flat), putih label ≥7:1. Bingkai tinta ronde 5 ikut pensiun dan
  bentuk pil 999px dari tombol lawas bertahan. Aset `tombol-bg.png` dan
  `image-bg.png` **dihapus dari `src/assets/`** atas jawaban pemilik
  2026-10-22; lembar tak lagi memuat gambar latar apa pun.
- **CTA pindah ke topbar**: pil gradien "Masuk atau buat akun" di baris
  judul milik ronde 3 pensiun; topbar membawa **Masuk** (tombol teks) dan
  **Buat akun** (pil navy, ikon panah miring). Mulanya keduanya satu gerbang
  `onEnter`; sejak umpan pemilik 2026-10-23 gerbangnya dibelah — **Masuk**
  membuka form masuk, **Buat akun** membuka form daftar langsung
  (`onSignUp` sendiri di pengawatan App), dan pilihan kartu tetap masuk ke
  form daftar membawa intent paket (`/daftar?plan=…`). Lembar tetap
  **tanpa jalur bayar** (aturan asli, tetap).
- **Badge tiga nada**: `FLEKSIBEL` lavender `#e9ecfb` + navy, `POPULER`
  solid navy saat kartunya terpilih (karya memuat pil solid karena
  Bulanan adalah bawaannya; aturan umum: pil kartu terpilih selalu solid),
  `Nilai Terbaik` mint + hijau tua. Data menyimpan kasusnya sendiri
  ("Nilai Terbaik"); CSS yang meng-uppercase-kan tampilannya.
- **Caption pajak** (kata pemilik 2026-10-22: harga sudah termasuk pajak):
  baris caption di bawah kartu menyatakan cakupan paket dan "Harga dalam
  Rupiah dan sudah termasuk pajak." — pernyataan pemilik, **bukan**
  komputasi; redupnya `--public-muted-ground` `#5b6166` (5,4:1 di
  `#e0e6fc`; referensi lebih redup dan hanya 3,8:1).
- **"Setara Rp X per bulan"** di kartu Tahunan dihitung dari harga server
  (annual ÷ 12 lewat formatter mata uang yang sama), hanya tampil saat
  harga siap — tidak ada salinan angka kedua di kode (aturan lama tetap).
- **Band pilar "Yang Anda dapatkan"** di zona `#f3f6fd`: empat pilar dengan
  ikon navy dan **deskripsi kalimat** — deskripsi yang keluar dari kartu
  (butir "Manfaat masuk kartu" ronde 3 sekarang menyisakan baris nama-saja
  di kartu); band menamai persis yang gerbang refus dan tidak mengklaim
  lain (aturan lama tetap).
- **Footer navy menyatakan, tidak menavigasi** (dibangun ulang 2026-11-02,
  lihat *Pengecualian terdokumentasi* di bawah): blok merek, baris kontak, kalimat
  risiko di `id="catatan"`, dan baris bawah. Tidak membawa call to action dan
  tidak membawa sitemap — kolom PRODUK/LANGGANAN/BANTUAN milik lama dibuang
  (sebelas tautan, lima menunjuk `#harga` yang sama), dan band penutup yang sempat
  dipasang di atasnya ikut dibuang atas keputusan pemilik. Satu-satunya tautan di
  dalamnya adalah alamat bantuan, dan ia ada **hanya kalau** operator menulisnya
  di `/admin`: `system_settings.contact_support` dibaca lewat
  `GET /v1/subscriptions/contact`, dan jawaban kosong berarti barisnya tidak
  dirender, bukan menjadi `mailto:` yang tidak ke mana-mana. Tidak ada alamat yang
  diketik di kode, dan tidak ada span `aria-disabled` lagi. Jam Asia/Jakarta
  presisi menit; baris bawah memuat saklar ID/EN dan jam bursa statis, bukan klaim
  buka/tutup.
- **Nav topbar adalah jangkar**: FITUR dan CATATAN menunjuk `#pilar` dan
  `#catatan`; label platform + dot + garis pisah + gerbang di kanan;
  jangkar dan labelnya disembunyikan di bawah 840px — logo, Masuk, dan pil
  Buat akun bertahan. Umpan pemilik 2026-10-23 menghapus entri HARGA:
  topbar berdiri tepat di atas bagian harga itu sendiri, jadi jangkarnya
  menunjuk ke tempat pembaca sudah berdiri; `#harga` tetap jadi target
  kolom LANGGANAN di footer. Senadaan wewenang pemilik hari itu juga
  menyempurnakan kedua jangkarnya: dengan dua butir, nav berpindah ke
  **tengah bar** (`margin-inline: auto` mengapungkannya antara logo dan
  gerbang di setiap lebar; centering absolut dihindari supaya tidak pernah
  menabrak gerbang), dan sorot/fokus keyboard memunculkan **garis bawah
  1.5px navy `offset 7px`** peralihan 140ms bersama warna navy keadaan
  teraktif (kontras 6,7:1 tenang dan 9,6:1 aktif di latar topbar) —
  affordance lompatan yang jaga tanpa pergeseran tata letak, garis bawaan
  cincin fokus global tetap milik `focus.css`.
- **Headline ganti nama panjang** (2026-10-23 pemilik): "Harga langganan"
  menjadi "Subscription AI Investment Decision Support by Meta Cash Asset."
  — sama untuk kedua bahasa (kalimat merek). Ukurannya kalang viewport
  (`clamp(27px, 1.8vw + 10px, 40px)`, jauh di bawah 44px milik judul
  pendek, karena enam kata + variasi merek), dan `text-wrap: balance`
  merapikan baris di layar sempit. Umpan kedua hari itu ("terlalu rapat ke
  kiri, panjangkan ke kanan") membuka kandrahnya: cap `24ch` yang sempat
  dipasang dihapus, kalimat utama melintang penuh kolom (satu baris di
  desktop), dan nama rumah "by Meta Cash Asset." dipakukan jadi baris
  kedua sendiri (span blok, `margin-top: 6px`, `white-space: nowrap`),
  tetap `--public-navy` — kalimat utama tinta, merek navy, keduanya family
  display yang sama. Override ponsel 34px milik media query lama diangkat
  (kalang menguruskannya).
- **Kontras nudge** terbaca dari sensu (bentuk dan komposisi tetap): ring
  idle `#8a8a8a` (kontrol 3:1), tagline/nav `--public-muted` `#4b4f52`
  (6,4:1 di ground), sub/suffix `--public-muted-soft` `#6f7275` (5:1 di
  kertas putih), caption/alis `--public-muted-ground` `#5b6166`, tautan
  footer `--public-footer-strong` `#c9d2ee` dan disclaimer/jam
  `--public-footer-muted` `#9aa6d6` (keduanya ≥7:1 di `#030e58`; karya
  lebih redup dan berhenti di bawah AA, jadi token membawanya naik tanpa
  mengubah nada desainnya). Token mati ronde 8 (`--public-on-card`,
  `--public-on-bg`, `--public-on-pick`, `--public-accent-deep`,
  `--public-bg` dan kawan-kawannya) diangkat.
- **Uji**: 21 tes PublicPricing (bawaan Bulanan, uji setara + suffix,
  caption pajak, band pilar, jangkar nav, footer + tahan kontak, jam
  berdenyut dengan timer palsu deterministik `17:38:48 WIB → :49`), 353
  total `vitest` hijau; `tsc` bersih; eslint 0 pada MV yang disentuh;
  tangkapan 1920/1280/390 disegarkan di `session-public-pricing-redesign/`
  lewat wrapper iframe sementara + pangkas tinggi `CONTENT_HEIGHT`
  (wrapper tak di-commit).

## Pengecualian terdokumentasi: screen fitur, nav hamburger (2026-10-24)

Keputusan pemilik sesi ini (grilling 2026-10-24), semua di permukaan
publik (kedua layar: lembar harga dan screen fitur):

- **Nav pindah ke hamburger** (keputusan pemilik: "nav Fitur dan Catatan
  menjadi hamburger menu di paling kanan header, jika di klik akan pop up
  kecil"): tautan halaman di **kedua header** keluar dari bar dan masuk ke
  popup kecil di ujung paling kanan, pada **semua breakpoint** (bukan
  pola mobile-only). Teks nav `pub-nav` dan gayanya dihapus dari
  `auth.css`. Komponen bersama `PublicNavMenu.tsx`.
- **Gerbang tidak pernah ikut ke dalam** (keputusan pemilik, jawaban
  2026-10-24): Masuk dan Buat akun tetap terlihat di sebelah hamburger;
  hanya nav (Fitur/Catatan atau Harga/Catatan) yang pindah. `.pub-topbar-right`
  dapat `margin-left: auto` karena tidak ada lagi elemen di tengah bar.
- **Isi popup per layar, tidak link ke halaman yang sedang dibuka**
  (keputusan pemilik: "tiap screen menampilkan nav yang bisa dituju
  pengguna"): lembar harga memuat **Fitur + Catatan**; screen fitur memuat
  **Harga + Catatan** (dirinya sendiri tidak ditawarkan).
- **Perilaku popup**: `Escape` menutup dan mengembalikan fokus ke tombol,
  klik di luar menutup, `aria-expanded`/`aria-controls` pada tombol,
  visibility (bukan display) supaya tautan keluar dari tab order saat
  tertutup; baris tautan 44px (sentuh minimum), naik-turun 160ms dan mati
  di bawah `prefers-reduced-motion`. Ikon `Menu`/`X` Lucide.
- **Video demo naik ke hero** (keputusan pemilik: "di screen fitur di
  awal"): perekaman layar keluar dari band `.pubf-demo` dan kini duduk
  di dalam `.pub-hero` screen fitur, tepat di bawah tagline, supaya
  terlihat tanpa scroll. Lebar pemain dibatasi `calc(62vh * 16 / 9)`
  sehingga caption adegan di bawahnya masih muat di layar pertama; hook
  `useDemoVideo` (sekali lihat, jeda saat keluar, tanpa autoplay untuk
  reduced motion) tidak berubah.
- **Aset video** (konfirmasi pemilik 2026-10-24 untuk R-23):
  `public/fitur-demo.mp4` disalin dari rekaman milik sesi
  `session-public-pricing-redesign/fitur-demo-final.mp4`;
  `public/fitur-demo-poster.jpg` dibuat dari frame rekaman itu sendiri
  (bukan aset karangan). Sebelumnya keduanya hanya dirujuk kode, 404 di
  `public/`.
- **Konten baru screen fitur, kelima-limanya disetujui pemilik**
  (jawaban "isi konten baru semua lengkap"): (1) band alur **"Dari
  sinyal ke keputusan"**, empat langkah karena produk punya empat pilar
  (bukan pola template tiga langkah), angka sampelnya persis angka yang
  dipakai kartu contoh (ADRO 76%, Keuangan 40,2% vs 38%); (2) langkah
  pemakaian bernomor di tiap pilar (`pubf-steps`, chip navy, motif
  identitas); (3) band **"Sebelum dan sesudah"**, dua kartu kualitatif
  tanpa janji kinerja, kalimat kanan memakai kalimat layar aplikasi
  sendiri; (4) FAQ dari fakta produk nyata (5 pertanyaan, dijawab lalu
  direview pemilik), memakai `details/summary` native; (5) tiap kartu
  tools membuka satu contoh singkat lewat `details` native.
- **Animasi dipoles di MOTION 2, tanpa library baru** (pilihan pemilik
  3c): reveal 12px/420ms dengan kurva ease-out khusus, stagger baris
  untuk grid tools (`nth-child` 70ms) dan langkah alur (90ms), tetap
  satu kali jalan, tetap tidak pernah mengangkat untuk reduced motion.
  Dial layar fitur tetap ENERGY 2 / RHYTHM 3 / MOTION 2 (pengecualian
  terhadap MOTION 1 global yang sudah tercatat di atas).
- **Ritme ground baru**: pilar (putih/soft berselang) → alur (putih) →
  sebelum-sesudah (soft) → tools (putih) → FAQ (putih) → CTA (navy),
  supaya band baru tidak mengulang komposisi satu sama lain (RHYTHM 3).
- **Nav topbar publik di ponsel sempit** (penyempurnaan 2026-10-26): logo
  dua header kini memakai class `pub-logo` (bukan size inline) supaya
  media query bisa mengecilkannya; di ≤460px marka 38px menjadi 30px,
  gap bar diperketat, "Buat akun" ditahan satu baris (`white-space:
  nowrap`) dan panahnya (murni dekoratif) mundur; di 360px header tetap
  satu baris tanpa overflow, terverifikasi 390px dan 360px. Logo footer
  tetap berukuran inline.
- **Uji**: PublicFeatures 28 tes dan PublicPricing 22 tes hijau (menu
  buka/Esc/isi per layar, video di hero, lima band konten baru, gates
  di luar menu, dua tes gerbang MOTION 2: penolakan reduced motion dan
  arming yang mengamati seluruh reveal + video), `tsc` bersih, eslint 0
  pada MV yang disentuh, `vite build` sukses. Kunjungan browser sungguhan
  memverifikasi alur klik harga → menu → fitur dengan tangkapan
  1440px desktop dan 390px/360px ponsel, overflow 0 di ketiganya.
  Kegagalan `contrast.test.ts` pada `PositionModal.tsx:163`
  (`outline: "none"`) berasal dari pekerjaan lain yang belum di-commit,
  di luar cakupan sesi ini.
- **Video hero direkam ulang dengan langganan aktif** (keputusan pemilik
  2026-10-26): rekaman lama menangkap banner "Analisis berbayar tidak aktif"
  karena akun demo memang belum berlangganan. `public/fitur-demo.mp4` dan
  poster (frame 3,0 dtk Pasar tanpa banner, kartu statistik dan tabel) kini
  dibuat dari kunjungan sungguhan: Pasar tanpa banner, Dashboard, Risiko dan
  Portofolio dengan panel berbayar terbuka, AI Advisor dengan persetujuan
  OJK beserta daftar sinyal, lalu Pengaturan tab Langganan & Tagihan yang
  menampilkan "Masa aktif" (potongan penutup). H.264 1280x698, 29,7 dtk,
  964KB. Bonus perbaikan dari perekaman: setelah Masuk dari layar publik,
  status langganan tidak pernah ditanya ulang (menggantung `unknown` dari
  hasil pra-login, memakai jalur yang baru terbuka karena sedia dev
  AUTH_BYPASS dimatikan), jadi `App.tsx` kini memanggil
  `refreshSubscription()` saat `onAuthed` pada kedua mode AuthScreen.
  Perekam puppeteer-core menyeret Chrome lokal via CDP screencast;
  semua frame asli, tanpa aset buatan (R-23).
- **Logo resmi (keputusan pemilik 2026-10-26)**: pemilik menamai logo via
  `LOGO - AIDSS.svg` di folder referensi — versi ganda AIDSS + MCASS dengan
  pemisah garis, glyph putih; kini tersimpan byte-identik sebagai
  `src/assets/aidss-logo.svg`. Menindaklanjuti penegasan pemilik: file asli
  dipakai apa adanya, warna asli tidak diubah, yang disesuaikan hanya
  ukuran lebar-tinggi — pengeditan satu-satunya pada file adalah atribut
  ukuran root (viewBox dipangkas ke bbox konten presisi alpha, kanvas
  1500×1500 → rasio 3,34:1; width/height intrinsik ikut rasio). Semua
  permukaan memakai mark ini:
  sidebar app (26px + keterangan "AI Decision Support"), layar Masuk
  (34px di panel navy), topbar lembar harga dan fitur (glyph 24px; 19px di
  ≤460px; di halaman fitur dicangkung dalam chip navy publik
  `.pub-brand-chip` agar warna putih asli tetap kontras di latar terang —
  tanpa tint apa pun; sejak 2026-11-02 lembar harga melepas warna latar
  chip itu lewat `.pub-brand-chip-bare`, geometri dan posisinya tetap
  sama), footer harga (38px, putih asli di atas navy), footer konsol
  operator (glyph 14px dalam chip navy app `.brand-chip` yang mengikuti
  tema), dan favicon (`public/favicon.png`: perenderan file asli pada
  kotak brand berlatar putih — arahan pemilik 2026-11-02, sebelumnya navy
  warna publik; warna glyph asli tetap dipertahankan, tanpa invert).
  Komentar-komentar era "logo belum dinamai, jangan mengarang" di
  Sidebar, auth.css, dan index.html dicabut karena keputusan itu kini
  sah. Front install tidak menyentuh teks salinan lain: disclaimers,
  copyright "© 2026 AIDSS · MCASS", label pengirim chat "AIDSS", dan
  data pemilik rekening tetap teks/data aslinya.

## Pengecualian terdokumentasi: layar Catatan publik `/catatan` (2026-11-02)

Atas permintaan pemilik ("buat halaman untuk Catatan… pastikan yang berada pada
tombol burger di halaman harga"). Item itu sebelumnya bukan halaman: lompatan
`href="#catatan"` ke satu kalimat penyangkalan di footer bersama, dan perilakunya
dipin tes. Yang dibangun adalah layar publik ketiga dengan URL sendiri, mengikuti
pola `/fitur`.

- **Isi direkomendasikan, bukan dikutip.** `docs/legal-and-consent.md` tidak
  dipakai sebagai isi: dokumen itu menulis sendiri di baris 22 bahwa pengguna
  jangan diarahkan kepadanya sebagai syarat layanan, dan alasan drafnya sebagian
  sudah basi (ia menyebut gerbang pembayaran belum punya kode, sementara
  `docs/status.md` mencatatnya **Ada**). Aturan dan tiga larangan turunannya
  (angka harga, kanal kontak, nama algoritma) ada di
  [ADR-0013](adr/0013-catatan-statis-tanpa-draft-legal.md), dan keempatnya
  dijaga `PublicNotes.test.tsx`.
- **Sembilan bagian, masing-masing menunjuk satu fakta di kode**: `risiko`,
  `probabilitas`, `data`, `contoh`, `langganan`, `pembayaran`,
  `pengembalian-dana`, `privasi`, `status`. Daftar yang dibuka langganan dibaca
  dari `dependencies=paid` di `backend/api/main.py`, bukan dari perkiraan.
- **Menyusul pola yang ada, tidak menciptakan pola baru.** Komponen di
  `src/app/features/public/PublicNotes.tsx`; salinan inline `isId ? … : …` seperti
  dua layar publik lain (bukan key `translations.ts`); routing berupa cabang
  `location.pathname` di blok signed-out `App.tsx`, bukan entri `<Route>`;
  pengguna yang sudah masuk melihat `/catatan` sebagai shell, sama seperti
  `/fitur` hari ini.
- **Footer bersama tidak diubah.** `<p id="catatan">` tetap di
  `PublicFooter.tsx`; layar baru bergabung, ia tidak menggantikan pernyataan itu.
  Empat titik masuk pindah bersamaan: burger lembar harga, burger layar fitur, dan
  item "Catatan risiko" di kedua footer.
- **Kolom baca 760px di dalam `.pub-container`**, bukan `.pub-container` penuh:
  1160px meregangkan prosa, dan kolom terpusat membuat tepi kirinya tidak sejajar
  hero. Sekarang keduanya terukur di x=135 pada 1440px. Tidak ada hex baru, tidak
  ada token baru, tidak ada glif piktograf; teks terkecil 14px.
- **Utang yang diakui di halaman itu sendiri.** Bagian `contoh` menyatakan panel
  berisi contoh membawa label "Data contoh", dan audit hari yang sama menemukan
  dua pelanggaran dalam harness offline (Alokasi sektor di `DashboardView.tsx`,
  seluruh panel `RiskView.tsx`). Kalimatnya ditulis supaya pelanggaran disebut
  cacat, bukan fitur; tercatat sebagai task terbuka di
  `tasks/todo-catatan.md`.
- **Uji**: `PublicNotes` 12 tes hijau, `PublicPricing` 22 dan `PublicFeatures` 28
  tetap hijau dengan assertion anchor lama diubah dengan sengaja; suite penuh 423
  tes, `tsc` bersih, eslint 0 error, `prettier` bersih, `vite build` sukses tanpa
  peringatan bundle. Kunjungan browser sungguhan memverifikasi muat langsung +
  refresh `/catatan`, alur burger dari `/` dan dari `/fitur`, overflow 0 di 1440
  dan 390px, dan empat tepi sejajar hero.

## Pengecualian terdokumentasi: footer publik tidak menavigasi dan tidak menutup (2026-11-02)

Atas permintaan pemilik ("perbaiki footer yang ada pada halaman publik, buat
lebih baik dan cocok"). Rencana awalnya, diputuskan lewat interview, adalah
**convert lalu disclose**; itu dibangun, dilihat pemilik di browser, lalu
**dibatalkan**: "seharusnya pada footer tidak ada: buat akun, Masuk … juga tidak
ada Fitur dan Catatan." Yang berdiri sekarang adalah footer tanpa satu pun
tautan dan tanpa call to action. Rencana lengkap, termasuk keputusan yang
kemudian dibatalkan, ada di
[`tasks/plan-footer-publik.md`](../tasks/plan-footer-publik.md).

- **Yang ditemukan di render, bukan dari asumsi, dan tetap benar.** Lembar harga
  mencetak 11 tautan footer dan **5 menunjuk `#harga` yang sama** (Mingguan,
  Bulanan, Tahunan, Bandingkan paket, Pembaruan harga); `/fitur` 5 menunjuk
  `/#harga`. Kolom bernama BANTUAN dibuka oleh entri mati. Grid
  `1.5fr 1fr 1fr 1fr` membuat kepala kolom sejajar dengan *atas* logo, sehingga
  blok merek terbaca sebagai daftar keempat. Di 390px sebelas tautan menumpuk dan
  disclaimer terdorong ke dasar dinding tautan.
- **Yang jadi: merek, pernyataan risiko, baris bawah.** Tidak ada tautan, tidak
  ada heading, satu kontrol (saklar bahasa). Cara melanjutkan hidup di tempat
  yang memang tugasnya: gerbang topbar, kartu paket, dan burger — semuanya punya
  tes sendiri. Ini jawaban yang lebih jujur daripada sitemap maupun CTA kedua,
  karena keduanya mengulang apa yang sudah dikatakan halaman itu.
- **`/fitur` kini berakhir tanpa CTA sama sekali.** Band `.pubf-cta` miliknya
  ("Siap mengujinya?") dihapus pada ronde pertama, ketika footer akan memegang
  gerak penutup; footer lalu kehilangan gerak itu juga. Band tersebut **tidak
  dikembalikan** sampai pemilik memutuskan halaman itu harus berakhir di mana —
  dicatat sebagai pertanyaan terbuka, bukan lupa.
- **Kontak dijatuhkan, lalu dipasang lagi dari sumber yang benar.** Ronde dua
  membuang entri itu sama sekali, dan alasannya tetap benar untuk kode: tidak ada
  seorang pun yang pernah menamai kanalnya. Ronde tiga pemilik meminta "Hubungi
  Kami serta Email" dan **memutuskan alamat itu miliknya, bukan milik kode** — ia
  tinggal di `system_settings.contact_support`, ditulis di tab keempat `/admin`, dan
  dibaca footer lewat endpoint publik. Presedennya sudah ada dua: harga
  ([ADR-0010](adr/0010-harga-di-system-settings.md)) dan rekening tujuan.
  Yang tidak berubah adalah larangannya: `docs/settings-module-spec.md` §4 sudah
  menulis aturan mainnya — nilai kosong berarti baris tidak dirender, karena
  `wa.me/628...` yang tidak lengkap adalah link mati. Service menolak string yang
  bukan satu alamat, jadi tautan yang sampai ke pembaca selalu bisa dikirimi surat.
  Tiga tes "kontak ditahan" tetap terhapus; yang berdiri sekarang adalah
  `PublicFooter.test.tsx` yang menuntut barisnya **hilang** saat server menjawab
  null, dan penjaga bahwa sumber komponen itu tidak memuat alamat apa pun.
- **Jam berhenti di menit, dan tidak mengklaim apa pun tentang hari ini.**
  `isMarketOpen()` di `useLiveMarket.ts` murni jam peramban atas aturan hari
  kerja + istirahat siang, **tanpa tabel libur bursa** — ia menyebut pasar buka
  pada ±15 hari libur setahun. Tolerabel di dalam aplikasi; di halaman publik itu
  klaim baru, dan ADR-0013 ada untuk menghentikannya. Yang dicetak jam bursa
  statis milik `Sidebar.tsx`, dua bagian supaya baris tidak pernah putus di tengah
  `13:30-15:50`. Hyphen ASCII, bukan en dash, karena `PublicFeatures.test.tsx`
  melarang keduanya di seluruh container.
- **Saklar bahasa pertama di sisi signed-out, dan ia tinggal di footer.** Ketiga
  layar membawa salinan id/en lengkap dan tidak ada cara menukarnya; `ID / EN`
  hanya ada di `Header.tsx`. Footer membacanya dari `useApp()` (`toggleLocale`
  sudah ada, sudah persist ke `localStorage`, sudah menjaga
  `document.documentElement.lang`), jadi `App.tsx` tidak disentuh — pola yang
  sama dipakai `Sidebar.tsx`. Diverifikasi di browser sungguhan: klik →
  `lang="en"`, h1 "Notes", `aria-pressed="true"`. Ia satu-satunya kontrol yang
  tersisa di footer, jadi ia satu-satunya yang punya cincin fokus.
- **Tanpa hex baru, tanpa token baru.** Semua warna sudah dipakai footer
  sebelumnya, sehingga `contrast.test.ts` hijau tanpa perlu ditebak; tidak ada
  glif piktograf. Tidak ada lagi grid di footer, jadi satu breakpoint (`760px`)
  hanya mengatur spasi.
- **Ukuran terukur.** Footer 1440px: 452px → **376px**. Footer 390px: ~740px →
  **516px**. Ujung halaman `/fitur`, yang dulu band CTA + footer = 720px, sekarang
  376px. Tautan footer: 11 → **0**. Overflow horizontal 0 di 320/360/390/1440.
- **Uji**: **445 tes hijau** (36 berkas), `tsc` bersih, eslint 0 error,
  `prettier` bersih. Assertion lama diubah karena memang tidak lagi benar, bukan
  untuk melewati: hitungan `Sinyal` 5 → 4, jam timer palsu ke presisi menit, dan
  tes footer kini justru **menuntut ketiadaan** — nol tautan navigasi, nol heading,
  tidak ada `Masuk`/`Buat akun`/`Fitur`/`Catatan` di dalam `contentinfo`. Kontrak
  `#catatan` di `App.test.tsx`, `PublicFeatures.test.tsx`, dan
  `PublicNotes.test.tsx` tetap lulus tanpa disentuh. Ronde tiga menambah
  `PublicFooter.test.tsx` (12) dan `AdminContactView.test.tsx` (11), plus mock
  `apiFetch` di dua suite halaman yang kini ikut merender footer.

## Konsol operator: tujuh tab, satu URL, tanpa angka karangan (2 November 2026)

Atas permintaan pemilik ("buat Admin Panel lengkap"). Yang ternyata paling
bukan desain melainkan lubang: `GET /v1/admin/transactions`, `.../approve`, dan
`.../deny` sudah selesai dan sudah diuji, dan **tidak ada satu layar pun yang
memanggilnya**. Uang masuk, operator seharusnya memutuskan, dan tidak ada tempat
untuk melakukannya. Jadi urutan pengerjaan mengikuti fakta itu, bukan urutan
blueprint; rencananya di [`tasks/plan-admin-panel.md`](../tasks/plan-admin-panel.md).

- **Satu URL dengan tab, bukan route per modul.** Keputusan lama (`AdminView.tsx`
  dan dipin `AdminView.test.tsx`) dipertahankan dan dipegang sampai tujuh tab.
  Blueprint §5 meminta sidebar sendiri di `/admin/users`; itu tidak diambil
  karena layar ini alat operasional tanpa entry navigasi, dan route kedua akan
  menambah routing untuk masalah yang tidak ada.
- **Tidak ada pustaka grafik.** Ringkasan adalah angka, bukan garis. Chart di atas
  segelintir baris settlement adalah dekorasi, dan dial ENERGY 1 di atas bilang
  tidak boleh ada yang mencoba terkesan. Angka mono dengan
  `fontVariantNumeric: tabular-nums`, sama seperti footer dan lembar harga.
- **Setiap kolom harus menelusuri kolom database yang ada.** Ini aturan lama
  (`AdminView.tsx` baris 20-23) dan kini diuji dari dua sisi: tes frontend
  menuntut daftar header persis, dan tes database sungguhan menjalankan
  statement-nya. Kolom "Paket" **tidak** dibuat: `subscriptions` menyimpan
  `user_id` dan `expires_at` saja ([ADR-0002](adr/0002-ganti-owner-sub-dengan-user-id-uuid.md)),
  dan grant manual menghasilkan periode tanpa paket — menampilkannya di bawah
  kepala "Paket" akan membaca fakta lain sebagai fakta ini.
- **Yang sudah dikirim server tapi dibuang layar, sekarang ditampilkan.**
  `blocked_reason` sudah lama ada di `AdminAccountResponse`; konsol hanya
  mencetak "Diblokir". Dua jenis penutupan punya pintu buka yang berbeda
  ([ADR-0012](adr/0012-alasan-pada-blokir.md)), jadi status kini tiga keadaan.
- **Dialog menyebut akibatnya, tombolnya tidak berbohong.** Setujui berkata
  settlement + masa aktif dalam satu transaksi database dan panjangnya dari
  paket di baris, bukan dari angka operator. Tolak mewajibkan alasan: field kosong
  tidak pernah dikirim ke jaringan, dan server tetap yang memutuskan apa yang
  dihitung sebagai alasan. Kegagalan apa pun disertai "Transaksi tidak berubah",
  karena itu janji endpoint-nya dan operator yang menduga approve setengah jalan
  lebih buruk daripada yang tahu tidak.
- **Rupiah persis, bukan ringkas.** `fmtIdr` mencetak "Rp 44Rb"; mencocokkan
  transfer bank dengan angka yang dibulatkan adalah cara baris yang salah
  disetujui. Layar uang memakai `toLocaleString('id-ID')` penuh.
- **Tiga keadaan yang tidak boleh disamakan**: nol (fakta tentang usaha), 403
  (bukan peran Anda), dan gagal baca (kita tidak tahu). Ringkasan dan integrasi
  sama-sama menolak menampilkan nol ketika jawabannya "tidak dapat dibaca" —
  garis datar membuat operator berhenti melihat.
- **Kosong yang terpotong menyatakan dirinya.** Ekspor CSV dibatasi dan baris
  terakhir berkasnya menulis batas itu beserta offset berikutnya; berkas yang
  tampak lengkap padahal terpenggal lebih buruk dari tidak ada berkas, karena
  seseorang akan merekonsiliasi terhadapnya. Setiap sel dikutip dan nilai yang
  diawali `= + - @` diberi apostrof — `admin_notes` adalah teks bebas dari
  pembayar, dan spreadsheet mengeksekusi formula.
- **Hanya-baca untuk kredensial gateway, dan hanya yang ada.** Panel integrasi
  memakai predikat yang sama dengan jalur checkout (`gateway_configured()` /
  `gateway_environment()`), supaya keduanya tidak bisa berbeda jawaban. Tidak ada
  kolom input untuk kunci Midtrans: `get_settings()` di-cache saat import, jadi
  formulir apa pun akan tampak menyimpan tanpa mengubah apa pun — itu bohong,
  bukan fitur separuh jadi. WhatsApp tetap tidak ditampilkan karena tidak ada
  field di `Settings` dan tidak ada transport untuknya. **Email tidak lagi masuk
  aturan ini**: baris `smtp` di `system_settings` bisa disunting operator dan
  transport membacanya saat mengirim ([ADR-0014](adr/0014-smtp-di-database.md)),
  dan editornya pintu terpisah dari panel status itu — lihat
  `Konsol operator: palet sendiri` di bawah.
- **Butir blueprint yang tidak dibangun dan dikatakan kenapa**: pratinjau bukti
  transfer (`proof_image_url` sengaja kosong, [ADR-0011](adr/0011-satu-penulis-subscriptions.md)),
  notifikasi WhatsApp saat approve (tidak ada transportnya), dan pengaturan kunci
  **gateway** (email sudah bisa, Midtrans tidak). Ditulis di §5.1 dokumen itu
  sendiri, bukan didiamkan.
- **Modal mengikuti idiom yang sudah dipakai aplikasi, bukan shadcn.** Tidak ada
  satu pun file di `src/app/features/` mengimpor `components/ui/dialog`;
  `PositionModal.tsx` sudah mengerjakan focus-in, Escape, dan focus-return dengan
  tangan. Jadi satu `AdminModal.tsx` untuk tiga dialog konsol, bukan idiom kedua.
- **SQL-nya dijalankan di Postgres sungguhan.** Fake pool mencocokkan teks query
  dan menjawab dalam Python, jadi ia tidak bisa menangkap query yang bukan
  Postgres sah — `LEFT JOIN LATERAL`, `FILTER (WHERE…)`, `AT TIME ZONE` semuanya
  baru terbukti di `backend/tests/test_admin_live_sql.py`, dalam transaksi yang
  di-rollback sehingga database pengembang tidak berubah. Pelajaran ini sudah
  pernah dibayar sekali (`test_bank_accounts.py`, jsonb sebagai teks).
- **Satu predikat, satu tempat.** Denominator MRR dibangun dari `PLAN_DAYS`,
  bukan diketik ulang; kalau dua-duanya berbeda, lajur bulanan salah tanpa ada
  yang notice. Percobaan pertama bagian ini mengetiknya dan komentarnya bilang
  sebaliknya — dikoreksi sebelum jadi kebiasaan.
- **Uji**: **485 tes frontend hijau** (38 berkas) dan **957 backend** dengan
  coverage 70%, `tsc` bersih, eslint 0 error, `ruff` bersih, `prettier` bersih,
  `vite build` sukses. Kedua endpoint baru menjawab **401** untuk anonim dan
  route-nya terlihat di `/openapi.json`; diverifikasi lewat HTTP pada proses yang
  berjalan. **Yang belum**: layar konsol belum dilewati di browser sebagai
  operator yang benar-benar masuk — `ADMIN_EMAIL` kosong dan tidak ada sesi admin
  yang bisa saya buat tanpa kredensial pemilik, dan membuat akun admin atau
  mengeset ulang sandi demi kenyamanan verifikasi adalah efek samping yang bukan
  saya ambil.

## Konsol operator: palet sendiri, terkunci terang (4 November 2026)

Atas permintaan pemilik ("buat design lebih baik untuk admin panel, termasuk
pemilihan palet warna"). Empat hal ditanyakan dan dijawab yang mengikat irisan
ini: palet **baru khusus konsol**, cakupan **tujuh tab penuh**, struktur **tetap
tujuh tab**, dan **konsol terang saja**.

Yang paling menentukan bentuk hasil akhirnya bukan selera, melainkan angka yang
dihitung lebih dulu dengan rumus luminansi yang sama dipakai
`src/app/test/contrast.test.ts` — bukan angka yang dikutip dari kebiasaan.

- **Ground dipagari dari dua sisi, dan yang membayar adalah warna merah kita.**
  Setiap ground lebih gelap dari `#EEF2F6` menjatuhkan `--loss #C63B3B` di bawah
  4,5:1 (di `#EBEFF4` tinggal 4,45). Membagi `--loss` jadi dua merah di produk
  yang seluruh isinya uang adalah biaya yang tidak dibayar oleh permukaan yang
  lebih cantik. Jadi `#EEF2F6` bukan "warna yang dipilih" — itu batas bawah yang
  tersisa. Dikunci tes: `holds money semantics readable on the console ground`.
- **Zebra striping ditolak dengan angka, bukan preferensi.** Band `#F6F8FB` di
  atas card `#FFFFFF` = 1,06. Tidak terlihat. Baris tabel dipisah hairline
  `--border`.
- **Hierarki bukan soal hex.** Masalahnya nyata dan terukur: `--muted-foreground`
  dipakai 88 kali di konsol vs `--foreground` 43 — mayoritas layar adalah teks
  sekunder, jadi tidak ada yang memimpin. Tapi memperbaiki dengan *mencerahkan*
  sekunder adalah jalan salah: makin gelap sekunder, makin kecil separasinya
  terhadap ink (3,03 → 2,34). Yang menyelesaikan adalah **penugasan peran** —
  nilai yang memutuskan memakai ink, label dan stempel waktu memakai
  `--console-secondary` — plus satu skala tipografi (`text.meta` 11 s/d
  `text.lead` 26) mengganti sekitar 60 literal `fontSize` yang tersebar. Setelah
  lipatan: 0 literal, 77 rujukan skala, 0 pemakaian `--muted-foreground`.
- **Aksen akhirnya sampai ke konsol, dan karena itu bisa dipakai.** Teal merek
  `#0F9D78` dengan label putih mengukur 3,43:1 — gagal — dan itulah sebabnya
  setiap tombol primer konsol selama ini jatuh ke Navy, dan DESIGN.md sudah
  menuliskan larangannya sendiri ("white-on-teal … about 3.4:1"). `#0F7A5E`
  mengukur 5,30:1, jadi aksen bisa menjadi aksi primer sungguhan.
- **Tabrakan hue-nya nyata dan tidak bisa dihindari, jadi dilucuti dengan aturan
  yang sudah ada.** Teal itu 11° dari `--gain`: di layar uang, "hijau" bisa
  terbaca dua hal. Biru 1° dari `--slate` (tidak beda dari navy merek), amber 2°
  dari `--warning`. Satu-satunya hue yang lolos kontras *dan* hue-nya sendiri
  adalah violet 250°, dan violet bukan arah produk institutional-finance
  sekaligus tell antisllop. Karena teal tidak bisa dihindari (ia warna merek),
  tabrakannya dilucuti aturan DESIGN.md yang sudah berlaku — *never communicate
  gain or loss through color alone* — dengan konsekuensi keras yang kini tertulis:
  **aksen tidak pernah jadi warna status**, dan ia satu aksi per layar. Aksi baris
  `Setujui` tetap Navy (`rowActionStyle('confirm')`) karena dua puluh tombol teal
  di satu layar bukan aksen, itu banjir.
- **Terang saja bukan soal menghapus satu kelas.** `AppContext` menempel
  `.dark` di `documentElement`, bukan di subtree konsol, jadi konsol akan mewarisi
  token teks gelap di atas kertas terang (`--foreground` gelap di atas putih =
  1,32:1). Blok `.admin-console` di `src/styles/theme.css` menyatakan ulang
  ramp yang dipakai konsol merender teks dan semantik — mengikuti preseden yang
  sudah ada di file yang sama untuk lembar harga publik ("token ini tidak
  mengikuti varian terang/gelap aplikasi").
- **Dua token sengaja tidak ikut dinyatakan ulang, dan itu bukan kelalaian.**
  `contrast.test.ts` menuntut `--control-border` dan `--link` masing-masing
  **tepat dua deklarasi** di theme.css — itu penjaga yang memastikan nilainya
  diketahui untuk kedua tema. Menimpa keduanya dari scope konsol akan menjatuhkan
  penjaga itu, dan menyerahkan penjaga demi estetika adalah pertukaran yang salah arah. Untuk `--link` konsol punya
  tokennya sendiri (`--console-link`);
  `--control-border` diwarisi saja, dan itu aman karena nilai gelapnya terukur
  3,79-4,26 pada permukaan terang — di atas lantai 3:1 ADR-0007. Penjaga baru
  mengunci keduanya: ia menuntut empat token teks ikut dinyatakan **dan**
  menuntut dua token ini tidak, plus tidak ada satu pun token konsol yang boleh
  kebetulan sama nilainya dengan nilai gelap.
- **Satu resep, bukan delapan.** Konsol menyalin resep kontrol-nya sendiri di
  delapan tempat, dan ia melandai persis seperti dugaan: input harga 14px dan
  setiap input lain 13px. Semua pindah ke
  [`src/app/features/admin/consoleStyles.ts`](../src/app/features/admin/consoleStyles.ts),
  dan namanya (`controlStyle`, `buttonStyle`) dipilih supaya scanner
  `contrast.test.ts` masih melihatnya. Scanner itu sendiri ternyata buta `.ts` —
  begitu resep pindah ke modul `.ts`, menunjuk `controlStyle` ke `--border`
  **lulus** di 23 tesnya. Diukur, tidak disimpulkan; glob-nya kemudian dilebarkan
  dan mutasinya dipastikan gagal lagi.
- **Isi layar: `Ringkasan` berhenti menjadi enam kartu setara.** Tell
  "default dashboard" itu juga tidak jujur pada datanya: pendapatan hari ini dan
  akun yang sudah berakhir dapat kotak sama besar, dan satu-satunya angka turunan
  di layar dapat kotak sama besar dengan jumlah langsung. Yang menunggu keputusan
  operator sekarang memimpin layar (26px, `Buka antrean` satu-satunya aksi
  aksen), sisanya turun jadi daftar label/nilai rapat. Sekalian menghapus bug
  lama: grid `auto-fill` sebelumnya membuat track kosong di baris terakhir
  menampilkan cat `--border` kontainer — slab abu selebar empat kartu yang terbaca
  sebagai panel yang kehilangan angkanya. Satu kolom dengan hairline per baris
  tidak punya track untuk dibiarkan kosong.
- **Lantai 32px untuk semua yang dibidik.** Aksi baris di kedua tabel terukur 28
  px pada sesi browser; naik ke angka yang sudah dipakai sisa konsol.
- **Yang tidak diubah, dan alasannya.** Tujuh tab tetap satu URL (keputusan lama,
  dipin tesnya); nama tab `Rekening` tetap (pernyataan pemilik 2 November);
  label `Midtrans` di panel integrasi **harus** tetap ada —
  `src/app/test/noGatewayBrand.test.ts` menuntutnya verbatim, karena yang dilarang
  menyebut merek pemroses adalah layar payer, bukan konsol yang tugasnya justru
  menyebut integrasi mana yang terpasang. Teks yang memuat janji kejujuran
  ("uangnya tetap ada, masih bisa disetujui", "Hanya administrator yang bisa…",
  "terisi — kosongkan untuk mempertahankan") tidak dibuang demi konsistensi gaya.
- **Tiga keputusan yang hanya terbukti di peramban, dan sekarang dijaga di sana.**
  Angka token yang benar tidak menjamin token itu terpakai: `--console-link` lulus
  tes rasionya sambil satu-satunya tautan di konsol masih membaca `var(--link)` dan
  terukur **2,29 di atas kertas putih** — nilai tema gelap yang justru jadi alasan
  token itu dibuat. Penjaganya kini menuntut minimal satu konsumen dan nol file
  admin yang masih membaca `var(--link)`. Kedua, "satu aksi primer per layar" tidak
  bisa dijaga per-file karena sebuah layar bisa berisi dua view: tab Rekening
  memasang dua tombol `Simpan` teal sekaligus, dan penjaganya kini membaca komposisi
  tab dari `src/app/features/admin/AdminView.tsx`. Ketiga, kolom yang di-pin
  (`right: 0`) memang membuat tombol aksi selalu terlihat di 390 dan memang
  memotong angka nominal di belakangnya — dua-duanya terlihat pada screenshot yang
  sama, dan yang kedua adalah kegagalan yang lebih buruk. Pinnya dilepas; konsekuensi
  yang belum selesai (baris yang menumpuk di lebar ponsel) dicatat di
  `tasks/plan-admin-panel.md`, bukan dinyatakan lulus.
- **Dokumen ini tidak mengarang satu pun angka kontras.** Semua rasio di atas
  dihitung ulang dari nilai token, dan empat di antaranya kini dijaga otomatis oleh tes:
  lantai `--loss` di ground, lantai `--control-border` di ground kedua tema,
  aksen yang harus bisa menampung label putih, dan **satu kegagalan yang
  dipertahankan sengaja** — `--console-meta` di bawah 4,5 di atas ground, dicatat
  seperti tes "still fails as a divider colour" yang sudah ada, supaya teks kecil
  tidak pernah dipindah ke latar itu dengan alasan sudah "cukup kontras".

## Pengecualian terdokumentasi: glass di view dalam-sesi (2026-11-01, diperluas 2026-11-02)

Atas arahan pemilik ("ganti desain UI untuk dasbor saja menjadi Glassy Dashboard
clean minimalis", dipilih **glassmorphism penuh**, Header boleh ikut glass,
**struktur isi dipertahankan**, kedua tema wajib berfungsi). Ini adalah satu-satunya
penyimpangan dari aturan "shadows minimal" dan "avoid ornamental gradients, glowing
effects" di atas; pengecualian ini tercatat, tidak diam-diam. **Cakupannya diperluas
pada 2026-11-02** dari satu layar menjadi **sembilan view dalam-sesi** ("ya saya ingin
memperluas Glass", dipilih: bertahap tetapi pasti, tanpa mengubah struktur gulung,
permukaan non-kartu tetap opaque, layar di luar shell tidak ikut) — lihat
"Perluasan" di bawah. Portal Admin, layar masuk/daftar, SuspensionScreen, dan lembar
harga publik tetap kertas.

**Rujukan pemilik.** `referensi/contoh-desain-ui.png` (dasbor e-commerce kertas
translucent di atas latar pastel) mengatur tema **terang**;
`referensi/contoh-desain-ui-2.png` (Clasy, charcoal, border halus satu warna)
mengatur tema **gelap**. Dari dua gambar itu pemilik memilih: glassmorphism penuh,
Header ikut glass, **latar terbatas 2 hue**, radius **16px**, dan **struktur isi
AIDSS tetap** — yang berubah hanya kulit.

**Bentuk yang dipakai.** Kosakata token `--glass-*` di `src/styles/theme.css`
(didefinisikan dua kali: `:root` dan `.dark`) plus empat kelas utility di
`@layer components`: `.surface-glass` dan `.glass-card` — keduanya membaca aturan
properti yang sama (`background: var(--glass-surface)` + hairline
`var(--glass-border)` + `border-radius: var(--glass-radius)` 16px + shadow lembut +
sheen inset 1px di tepi atas), dan **satu-satunya perbedaan keduanya adalah
`backdrop-filter`**, yang hanya dimiliki `.glass-card` — `.glass-bar` (Header, lebih
opak, `position: sticky`) — `.glass-page` (dua sapuan radial lebar). Daftar layar yang
ikut glass ditentukan di satu tempat, `src/app/surfaces.ts` (`GLASS_VIEWS`,
`isGlassView`, `isGlassShell`), yang dibaca `App.tsx` **dan** dijaga oleh
`glassContrast.test.ts`. Sidebar, `--control-border`, `--link`, dan `focus.css` tidak
disentuh. Fallback `prefers-reduced-transparency: reduce` jatuh ke `var(--card)`
opaque tanpa blur/shadow, jadi sistem yang meminta transparansi dikurangi tetap
utuh. Opasitas kartu `0,66` (terang) / `0,62` (gelap), bilah header `0,70` /
`0,66`, dengan `saturate(1.35)`; bukan gradien pada teks atau ikon, dan bukan
glow. Angka KPI dinaikkan 26/20 → **30/24** mengikuti bobot referensi: DESIGN.md
§Typography sudah bilang "the numbers are the product".

**Satu perubahan struktur, atas izin pemilik — dan tetap satu.** Hanya pada
dashboard kolom shell yang menggulung (`.glass-page`) dan Header menjadi `sticky` di
dalamnya (`isGlassShell`), sehingga konten benar-benar lewat di bawah bilah kaca —
tanpa ini `backdrop-filter` tidak punya bahan bias sama sekali. `scroll-padding-top:
112px` menutup cacat keyboard nyata yang dibawanya: tanpanya elemen terfokus
tertinggal tersembunyi penuh di bawah bilah (clearance terukur −44,5px). Delapan view
lain yang kini ikut glass **tidak** mengubah struktur gulungnya: masing-masing tetap
menggulung di dalam tampilannya sendiri dan Header tetap `static` di sana —
terverifikasi di peramban pada sembilan layar (`position: static`, tanpa kelas
glass-bar, `backdrop-filter: none` di setiap permukaan).

**Perluasan (2026-11-02).** Sembilan view dalam-sesi kini berdiri di atas latar
`--glass-page` dan memakai kartu `.surface-glass`: terukur per layar pada aplikasi
berjalan — Dashboard 9 kartu (tetap `.glass-card`, 10 lapisan blur), Risiko 10,
Portofolio 9, AI Advisor 9, Peringatan 5, Pasar 4, Pengaturan 2, Berita 1, Laporan 1.
**Nol `backdrop-filter` baru di luar dashboard.** Alasannya keputusan, bukan
kemalasan: pemilik memilih tidak mengubah struktur gulung, jadi di layar-layar itu
tidak ada konten yang lewat di bawah permukaan mana pun — menyalin blur akan berarti
±45 lapisan `backdrop-filter` di atas gradien 2700px tanpa perbedaan yang terbaca
mata, persis cacat "blur dekoratif" yang dicatat jujur di bilah dashboard. Guard
menegakkannya: aturan bersama `.surface-glass, .glass-card` tidak boleh memuat
`backdrop-filter`.

Yang **tidak** ikut glass, dan mengapa: modal (`PositionModal`, dialog rebalance,
`ConsentGate`) dan drawer (`StockDetailPanel`) karena berada di atas scrim dengan teks
kecil; dropdown pencarian dan `ViewSkeleton`/`ErrorBoundary` karena status yang harus
terbaca seketika; kartu dalam `TabSubscription` karena komponen itu dipakai ulang
SuspensionScreen, layar yang dikecualikan pemilik — mengonversinya akan
menyelundupkan glass lewat impor bersama; panel `AdvisorChat` karena tepinya
`--control-border` (batas kontrol, bukan kartu). Empat berkas pertama dijaga
otomatis lewat `OPAQUE_ONLY_FILES` di `src/app/surfaces.ts`.

**Koreksi kedua pada guard glass.** Perluasan ini menemukan dua kesalahan di
`src/app/test/glassContrast.test.ts` yang masing-masing sudah saya tulis di sesi
sebelumnya:

1. **Ambang terlalu longgar untuk modelnya sendiri.** Diukur dari piksel screenshot
   (bukan model), `--loss` pada kartu α 0,60 di atas sapuan lavender memakai
   **4,40:1** — di bawah AA untuk angka 18px di Risiko — sementara guard menyebut
   pasangan yang sama 4,62. Model analitik ini 0,15–0,22 terlalu optimis dibanding
   render Chrome. Ambang test kini **4,65** dan menanggung galat terukur itu,
   bukan berdebat dengannya; palet disesuaikan mengikutinya (kartu 0,60 → 0,66,
   lavender `#cfc4f0` → `#d6cef5` pada α 0,50, bilah gelap 0,60 → 0,66), dipilih
   dari pencarian pada frontier: wilayah di mana `--loss` lolos 4,65 sambil kaca
   tetap tembus dan tepi tetap terbaca.
2. **Satu assertion mengukur pasangan yang salah.** Test "jarak kartu dari latar"
   membandingkan kartu dengan `--background` — warna di *bawah* gradien, yang tidak
   dilihat siapa pun di layar glass; kartu justru harus mendekati warna itu. Lebih
   buruk, pasangan itu **lolos untuk kartu opaque penuh** (ΔE ~3 dari `#f5f7fa`),
   yaitu kegagalan yang justru ada untuk dicegahnya. Diganti dua pasangan yang
   berarti: kartu vs tanah lokal di bawahnya (tepi terlihat, ≥ 4) dan kartu vs putih
   murni (tanah benar-benar tembus, ≥ 2,5). Dibuktikan dengan mutasi:
   `--glass-surface` ber-alpha 1 kini gagal pada ΔE 0.

**Hairline di atas permukaan glass.** Pemisah baris tabel memakai
`1px solid var(--border)`, yang dituning untuk kartu putih opaque (ΔE ~12). Di atas
kartu translucent kompositnya sudah berdekatan: terukur **ΔE 0,94** di Pasar —
garisnya hilang, tepat di tempat kolom angka paling membutuhkan pemisah. Token baru
`--surface-hairline` (`rgba(20,36,58,.18)` terang / `rgba(215,225,236,.2)` gelap)
dipasang pada 16 garis di dalam surface; `--border` **tidak** diubah karena ia tepi
setiap kontrol di aplikasi, dan mengubahnya akan menggeser tombol di layar yang bukan
kaca. Garis translusen ini berkomposit terhadap apa pun di bawahnya, jadi tetap
terlihat di kartu kertas maupun kaca — diprediksi (203,209,214), terukur
(202,208,214), dan dijaga: ΔE ≥ 8 terhadap setiap warna kartu di dua tema (mutasi
ke α 0,02 gagal di 1,49). Setelah perbaikan, pemisah baris Pasar terukur **ΔE 9,18**
(median) pada piksel nyata.

Yang belum terverifikasi oleh mata pada perluasan ini: **baris tabel posisi dan baris
berita terisi** — akun uji berada pada 402 dan feed IDX tidak terjangkau, jadi kedua
layar menampilkan state kosong/error (karena itu Berita dan Laporan hanya
menghasilkan 1 surface terukur masing-masing); konversinya ada di source dan lolos
tipe. Dan satu temuan **pra-eksisting** yang dilaporkan, tidak diperbaiki: pemisah
dekoratif `|` di baris meta advisor memakai `--border` di atas chip `--muted`
(1,15:1). Ia sudah ada sebelum glass (markup sama di `AIAdvisorView` sebelum commit
glass pertama), duduk di atas chip opaque sehingga glass tidak bisa mengubahnya, dan
tidak membawa informasi — tapi nyaris tak terlihat, dan itu layak diputuskan
sengaja.

**Perluasan palet, terbatas.** Dua hue baru — lavender (kini `#d6cef5`, awalnya
`#cfc4f0`) dan mint `#bfe6d2` — disahkan pemilik lewat gambar rujukan, **hanya untuk
lapisan latar** `--glass-page`. Tidak untuk teks, ikon, aksen, atau warna semantik.
Tema gelap
tetap hue merek (slate + Emerald Teal alpha rendah): latar berwarna di belakang
angka hijau/merah adalah cara P&L mulai terbaca sebagai dekorasi.

**Batas yang terukur, dan ditegakkan test.** `contrast.test.ts` membandingkan
heksa token terhadap heksa permukaan; ia **buta** terhadap hasil blend, sehingga
tetap hijau walaupun composite di bawah AA. Karena itu opacity ditentukan lewat
komposit dan dijaga `src/app/test/glassContrast.test.ts` (**27 assertion**: validasi
known-answer matematika test itu sendiri, parsing token kedua blok tema, jumlah
deklarasi `--control-border`/`--link`/`--surface-hairline`, penolakan skin rusak,
AA pada 9 pusat kartu maupun 98 titik di dua lebar kolom, AA teks bilah di atas
latar maupun di atas kartu yang lewat, tepi kartu vs tanah lokal, tanah yang
benar-benar tembus, hairline yang bertahan di atas surface, larangan blur pada
aturan bersama, `GLASS_VIEWS` ditegakkan **dua arah** (view hanya boleh masuk
daftar jika source-nya benar-benar memakai surface, dan source yang memakai
surface tidak boleh hilang dari daftar), tidak ada surface class pada elemen
dialog/drawer/scrim, dropdown pencarian tetap `var(--card)`, dan **setiap warna
yang benar-benar dicetak sumber tabel di atas surface** — dibaca dari source,
bukan dipilih tangan — lolos AA pada ukuran sebenarnya, dengan lantai 11px.
`OPAQUE_ONLY_FILES` juga harus tetap kertas).
Nilai terukur model analitik, dengan **token warna aplikasi apa adanya** — ambang
yang dituntut test adalah **4,65**, bukan 4,5, karena selisih model-vs-render
terukur 0,15–0,22:

| Permukaan | Terburuk | Pemecatnya |
|---|---|---|
| Kartu terang `rgba(255,255,255,0.66)` | **4,75:1** | `--loss` |
| Sapuan seluruh kolom terang (98 titik) | **4,73:1** | `--loss` |
| Bilah terang `rgba(255,255,255,0.70)` | **4,78:1** | `--loss` |
| Kartu gelap `rgba(20,36,58,0.62)` | **4,91:1** | `--loss` |
| Sapuan seluruh kolom gelap | **4,82:1** | `--loss` |
| Bilah gelap `rgba(23,41,63,0.66)` | **4,67:1** | `--loss` |
| ΔE tepi kartu vs tanah lokal | 6,00 (terang) · 5,55 (gelap) | ambang test ≥ 4 |
| ΔE kartu vs putih murni (tembus) | 3,08 (terang) · 84,05 (gelap) | ambang test ≥ 2,5 |
| ΔE `--surface-hairline` vs kartu | 13,60 (terang) · 16,11 (gelap) | ambang test ≥ 8 |
| Sebaran ΔE76 antar sembilan kartu | 3,03 (terang) · 4,02 (gelap) | ambang terlihat ~2,3 |

Angka test ini **diverifikasi silang pada piksel screenshot** (bukan hanya model):
pasangan konten-nyata terburuk per layar terukur 4,52–14,76:1 di tema terang dan
5,00–11,49:1 di tema gelap. Yang di bawah 4,5 pada pembacaan piksel hanyalah
glif dekoratif `|` yang pra-eksisting (lihat "belum terverifikasi" di atas).

Percabangan token tinta (`--glass-ink-muted`, `--glass-loss`) yang sempat dibuat
untuk membenarkan kartu 0,50 **dihapus**: pada 0,60 dengan latar pastel terang,
token asli aplikasi sudah lolos AA, dan "merah kedua" di produk keuangan adalah
biaya tanpa keuntungan. Kartu kini memakai `--muted-foreground` dan `--loss` yang
sama seperti delapan layar lain.

Koreksi yang wajib dicatat, dua-duanya hasil mutasi, bukan pembacaan kode:
versi pertama bagian ini melaporkan ΔE 1,11/3,7 dan menyimpulkan "AA dibayar
seluruhnya oleh opasitas kartu, kaca tidak terlihat" — salah, karena fungsi Lab
membagi kanal ke sRGB dua kali. Dan guard pertama saya `css.indexOf('.dark')`
menemukan `@custom-variant dark (&:is(.dark *))` di baris 1, jadi seluruh
assertion "gelap" sebenarnya membaca token **terang**; mutasi opacity bilah yang
menyalakan test gelap adalah yang membuktikannya. Selektor kini di-anchor ke
awal baris dan test menuntut kedua blok benar-benar berbeda. Angka lama di pesan
commit `11d58e5`/`f81bcdd`/`2d22470` dibatalkan catatan ini; history itu tidak
ditulis ulang karena `38a37c8` sudah ada di remote.

**Yang sengaja TIDAK disalin dari referensi.** Emoji pada baris sapaan
(`dataHonesty.test.ts` menolak glif piktografis di seluruh `src/app`); donut
tumpang-tindih dan tabel produk (struktur isi tetap); Sidebar glass; dan palet
charcoal global (akan merembet ke sembilan view dan menggeser assertion permukaan
`contrast.test.ts`). Radius 24px gambar rujukan diturunkan ke 16px atas pilihan
pemilik.

**Belum terverifikasi, dua hal.** Pertama, kaca di atas kurva intraday yang
**berisi data**: saat verifikasi feed tidak mengirim titik (WebSocket gagal, akun
uji belum berlangganan sehingga positions/signals menjawab 402) — kartu chart hanya
menampilkan state kosongnya; kelas `.glass-card` pada kartu itu terverifikasi,
piksel chart di bawah blur belum. Kedua, dan ini temuan jujur dari screenshot
terarah: **frost pada bilah header belum terbaca mata**. Pada `0,86` bilah
berpenampilan identik baik saat ada kartu lewat di belakangnya maupun saat latar
kosong; diturunkan ke `0,70` pun perbedaannya masih kecil, karena backdrop-nya
serba terang (kartu putih bening di atas latar pastel) sehingga tidak ada
kontras luminance untuk dibiaskan. Momen frost yang sesungguhnya butuh konten
gelap lewat di bawah bilah — yaitu kurva berisi data, hal yang sedang tidak bisa
direproduksi di sini. Angka AA di atas tetap aman; klaim "kaca buram" di bilah
belum boleh dianggap terbukti.

Verifikasi: `tsc` bersih, `vitest` **411/411** (384 + 27 guard glass, termasuk sembilan
mutasi yang membuktikan guard bisa gagal di kedua tema), `eslint` 0 error,
`format:check` bersih, `vite build` sukses, `ruff` bersih, `pytest` backend **890
lulus tanpa error**, baik saat Redis hidup maupun saat `REDIS_URL` menunjuk port
mati. Error teardown yang sempat dilaporkan di `backend/tests/test_rate_limit.py`
bukanlah bising lingkungan dan tidak dibiarkan: guard suite itu menangkap test
yang benar-benar menulis `news:idx:disclosures` lewat jalur Redis asli —
tidak terlihat selama Redis mati (tulisnya gagal diam-diam), dan muncul begitu
Docker menaikkan server. Perbaikannya ke penyebabnya, `mock_redis` diminta pada
fixture `limited_client` dan pada test yang membangun client sendiri, bukan
membungkam guard-nya. Diukur pada aplikasi nyata lewat Playwright/Chrome, screenshot
tersimpan di 1440×900 dan 390×844, terang dan gelap: 9 kartu `.glass-card`
berradius **16px** di dashboard dengan latar `rgba(255,255,255,0.66)` /
`rgba(20,36,58,0.62)`, dua radial-gradient terkomputasi, **10 permukaan ber-blur
dengan 0 sarang blur** dan bilah gulung itu sendiri tidak ber-blur; plus **41
permukaan `.surface-glass` di delapan view lain dengan `backdrop-filter: none` pada
setiap permukaan** dan **0 lapisan blur baru**. Header `sticky` terkunci di y=0
sementara kartu lewat di bawahnya (overlap 29px pada scrollTop 120) hanya di
dashboard; delapan view lain terverifikasi `position: static`. `scroll-padding-top:
112px` terbukti bekerja — tanpanya elemen terfokus tertinggal **tersembunyi penuh**
di bawah bilah (clearance −44,5px), dengannya browser menggulung hingga elemen
keluar (+15,0px), **nol teks di bawah 11px**, `scrollWidth` 390 = `clientWidth`
(tanpa luapan horizontal). Pemisah baris tabel Pasar terukur ΔE 9,18 (median) setelah
`--surface-hairline`, dari 0,94 sebelumnya. Console hanya memuat 402 paywall yang
jujur.

**Temuan pra-eksisting pada tabel Pasar: rampa warna tier.** Audit piksel menemukan
teks terburuk di atas surface glass adalah label tier-3: **1,54:1** (terang) dan
**2,11:1** (gelap). Ini bukan buatan glass dan glass tidak bisa memperbaikinya:
garis `TIER_RAMP` yang sama sudah ada di commit sebelum glass pertama, dan pada
kartu putih opaque langkah paling tenang itu sudah **1,75:1**. Guard kini melihat
kelas ini (sebelumnya buta, karena ia hanya mengenali `var(--x)` dan rampa ditulis
sebagai `color-mix(...)`), dan kedua langkah yang gagal dicatat sebagai **utang
bernama** di test — exact-match, sehingga menggeser 35% ke 34% pun membuat run
merah. Memperbaikinya berarti merancang ulang rampa tiga langkah yang adalah bahasa
warna semantik produk (butuh ~95% untuk lolos AA, yaitu menghapus tingkatan itu),
dan itu keputusan pemilik, bukan efek samping mengganti kulit. Ditanyakan, belum
diputuskan.

**Tepi kartu besar, diukur bukan diasumsikan.** Rencana menyiapkan fallback
`--glass-border-strong` bila `--glass-border` (α 0,16) terlalu lemah untuk kartu
tabel besar. Tidak diperlukan: pemisah baris Pasar kini terukur ΔE 9,18 dan
dipastikan mata pada screenshot 1440 maupun 390, tepi kartu tetap terbaca lewat
ΔE kartu-vs-tanah (≥ 4, ditegakkan test) plus shadow — menambah kekuatan border
hanya akan mengejar angka yang tidak sedang bermasalah.

Pada 390×844 (drawer navigasi dibuka lewat tombolnya, judul `h1` tiap langkah
diverifikasi agar angka tidak datang dari layar yang salah): **kesembilan view**
menampilkan surface glass dengan tint yang sama (`rgba(255,255,255,0.66)` /
`rgba(20,36,58,0.62)`), radius **16px**, **0 lapisan blur di luar dashboard**, dan
`scrollWidth == clientWidth` di semua layar (tanpa luapan horizontal). Catatan
pra-eksisting yang terlihat di rekaman ini, bukan regresi glass: kolom kanan tabel
Pasar terpotong di 390 — tabel punya penggulung horizontalnya sendiri, dan itu
perilaku yang sudah ada sebelum kulit glass.
