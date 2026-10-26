# DESIGN.md

Design direction for this project. Owned by the product owner. `antislop.md` is the
filter that runs on top of this file; this file is the soul, and the filter never
overrides it.

This file transcribes the owner's answers. All identity fields are named by the
owner; no agent-invented value is present.

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
- **Footer navy** memulangkan navigasi bawah: kolom PRODUK/LANGGANAN/
  BANTUAN dengan jangkar **in-page saja** (`#pilar`, `#harga`, `#catatan`
  milik band/kartu/disklaimer); "Hubungi kami" ditahan sebagai span
  `aria-disabled` **tanpa href** sampai kanalnya dinamakan pemilik
  ([OWNER TO NAME] masih terbuka) — tampil seperti taunan tapi tak bisa
  diklik, supaya bukan kontrol mati; disklaimer memakai titik antar kalimat
  (em dash fisik dimutasikan ke kalimat); baris dasar memuat hak cipta,
  tanggal diperbarui server, dan **jam hidup** Asia/Jakarta berakhir "WIB"
  (format `en-GB` + `hourCycle: "h23"` — id-ID menulis jam dengan titik,
  karya menulis dengan kolon; `hour12: false` bisa bocor `24:xx` di
  tengah malam), berdenyut per detik atas jawaban pemilik.
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
