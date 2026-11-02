# Implementation Plan: Footer publik berhenti menjadi sitemap (2 November 2026)

> **Ronde dua membatalkan sebagian ronde satu.** Pemilik melihat hasil di browser
> lalu memerintahkan: tidak ada `Buat akun`, tidak ada `Masuk`, tidak ada kalimat
> penutup, tidak ada `Fitur`/`Catatan`. Bagian "Bentuk baru" di bawah adalah
> ronde satu dan **tidak lagi menggambarkan kode**; bagian
> "Pembatalan ronde dua" adalah keadaan sekarang. Yang bertahan dari ronde satu:
> kontak dijatuhkan, jam presisi menit + jam bursa statis, saklar bahasa,
> `1.5fr 1fr 1fr 1fr` dibuang, dan temuan di bawah tetap benar.

## Gambaran

Permintaan awalnya: "perbaiki footer yang ada pada halaman publik, buat lebih
baik dan cocok", lalu diperjelas pemilik menjadi **redesign penuh** dengan satu
pekerjaan: **menutup (convert), lalu menyatakan (disclose)**. Footer bersama
dipakai tiga layar (`/`, `/fitur`, `/catatan`), jadi redesign ini mendarat di
ketiganya sekaligus; memperbaiki satu saja berarti memecah komponen yang justru
dibuat supaya ketiga halaman tidak saling menjauh.

## Yang ditemukan di kode sebelum memutuskan

Dibaca langsung dari render di 1440px, 960px, dan 390px, bukan dari asumsi:

- **Lima dari sebelas tautan footer lembar harga menunjuk ke jangkar yang sama**
  (`#harga`: Mingguan, Bulanan, Tahunan, Bandingkan paket, Pembaruan harga). Di
  `/fitur`, lima menunjuk `/#harga`. Ini perabot, bukan navigasi.
- **"Hubungi kami" adalah entri mati** di kolom bernama BANTUAN. `docs/status.md`
  mencatat `contact_support` masih kosong dan belum punya endpoint, dan
  `docs/settings-module-spec.md` sudah menulis aturannya sendiri: nilai kosong =
  baris tidak dirender, karena `wa.me/628...` yang tidak lengkap adalah link mati.
- **`/fitur` sudah menutup dirinya sendiri.** Band `.pubf-cta` ("Siap mengujinya?")
  menempel langsung ke footer; komentar `auth.css` baris 1090 sudah menyebutnya
  "the footer's navy arriving early". Keduanya navy, tanpa jahitan, ~720px.
- **Jam berdenyut per detik** adalah satu-satunya isi baris meta di `/fitur` dan
  `/catatan`: dekorasi tanpa nilai bagi pembaca, dan satu render per detik.
- **Grid `1.5fr 1fr 1fr 1fr`** membuat blok brand jauh lebih pendek dari tiga
  kolom tautan, sehingga kepala kolom sejajar dengan *atas* logo: brand terbaca
  sebagai daftar keempat, bukan kepala. Di 390px sebelas tautan menumpuk jadi
  footer ~800px dan disclaimer terdorong ke dasar dinding tautan.
- **`id="catatan"` itu kontrak yang hidup**: `App.test.tsx` mendokumentasikan
  bahwa `/#catatan` mengandalkan scroll ke elemen itu, dan dua tes asserting-nya
  ada. Kalimat disclaimer dan id-nya bertahan apa adanya.
- **Tidak ada saklar bahasa di layar publik**, padahal ketiga halaman membawa
  salinan id/en lengkap; `ID / EN` hanya ada di `Header.tsx` (sisi ber-sesi).
  `AppContext` sudah mengekspor `toggleLocale`, menyimpannya di `localStorage`,
  dan menjaga `document.documentElement.lang`.

## Keputusan pemilik (sesi ini)

1. Cakupan: redesign penuh, bukan tambal tata letak.
2. Pekerjaan footer: convert lalu disclose.
3. Footer yang memiliki CTA penutup; band `.pubf-cta` milik `/fitur` **dihapus**.
4. Kontak: **dijatuhkan** sampai pemilik menamai kanal. Bukan span `aria-disabled`
   lagi. Kalau kanal itu ada nanti, barisnya pulang sendiri.

## Bentuk baru

Satu permukaan navy, tiga pita, dari atas ke bawah:

**Pita 1, penutup.** Kalimat di kiri (keputusan apa yang sedang dibaca), dua
aksi di kanan: CTA primer milik layar itu (`Buat akun` di lembar harga,
`Lihat harga` di `/fitur` dan `/catatan`) + `Masuk` sebagai sekunder. Di
bawahnya satu kalimat jujur tentang mekanika bayar, dipindah apa adanya dari
band yang dihapus (typo `dimula` -> `dimulai` diperbaiki saat pindah).

**Pita 2, pernyataan.** Blok brand (marka, `Trading Intelligence Platform`,
tagline) di kiri; di kanan satu baris teks berisi **hanya tujuan yang berbeda
tempat**: tidak pernah menyebut halaman tempat pembaca berdiri (aturan yang
sudah ditulis `PublicNavMenu.tsx`), dan tidak pernah mengulang target CTA.
Lembar harga -> Fitur, Catatan. `/fitur` -> Catatan. `/catatan` -> Fitur.

**Pita 3, meta.** Hak cipta + saklar `ID / EN` di kiri; tanggal harga (lembar
saja) + jam WIB presisi menit + jam bursa statis di kanan.

## Jam dan jam bursa

Presisi menit, satu render per menit. **Tidak ada klaim buka/tutup**:
`isMarketOpen()` di `useLiveMarket.ts` murni jam peramban atas aturan hari kerja
+ istirahat siang, **tanpa tabel libur bursa**, jadi ia menyebut pasar buka pada
±15 hari libur setahun. Itu utang yang bisa diterima di aplikasi ber-sesi;
menaruhnya di halaman publik berarti klaim baru, dan ADR-0013 ada untuk itu.
Yang ditulis adalah jam bursa statis, angka yang sama yang sudah dicetak
`Sidebar.tsx`: `09:00-12:00` dan `13:30-15:50`, Senin-Jumat.

Hyphen ASCII, bukan en dash: `PublicFeatures.test.tsx` melarang `–` dan `—` di
seluruh container, meskipun `dataHonesty.test.ts` mengizinkannya.

Jam bursa dicetak sebagai **dua** bagian (`Bursa Senin-Jumat` dan
`09:00-12:00 dan 13:30-15:50`), bukan satu string: di 390px satu string putus di
tengah angka (`13:30-` / `15:50`). Tiap bagian `white-space: nowrap`, jadi baris
boleh berpindah di antara keduanya tetapi tidak pernah memotong satu sesi.

## Tata letak

Tidak ada hex baru, tidak ada token baru: semua warna sudah dipakai footer
sebelumnya, sehingga `contrast.test.ts` hijau tanpa perlu ditebak.

- Kedua pita atas: `grid-template-columns: minmax(0, 1fr) auto`. Frame inilah
  yang menghapus void milik `1.5fr 1fr 1fr 1fr`.
- Pita 2 `align-items: end`, bukan `start`. Satu-dua tautan yang sejajar dengan
  baris terakhir tagline terbaca sebagai ditempatkan; sejajar dengan atas logo
  terbaca sebagai kolom yang isinya hilang.
- Satu `.pub-footer-rule` saja, di antara pita 1 dan 2. Baris meta dipisah
  spasi. Desain lama membakar dua garis pada 44px teks disclaimer.
- Dua aturan grid footer (`960px`, `560px`) runtuh jadi satu di `760px`: pita
  menumpuk, tombol lebar penuh, baris tautan wrap dengan `row-gap`.
- Cincin dekoratif `::before`/`::after` dipertahankan, diperkecil, dan digeser
  ke bawah garis kedua supaya tidak pernah memotong hairline atau berdiri di
  bawah teks meta.
- Target sentuh kedua tombol `min-height: 44px`, mengikuti preseden hamburger.

## Ukuran yang benar-benar terukur (bukan yang dijanjikan di atas)

Angka di bagian "Tata letak" tadi ditebak sebelum render; ini hasil pengukuran
setelah dibangun, di browser sungguhan:

| | Sebelum | Sesudah |
| --- | --- | --- |
| Footer, 1440px | 452px | 534px |
| Ujung halaman `/fitur`, 1440px (band CTA + footer) | 720px | 534px |
| Footer, 390px | ~740px | 750px |
| Tautan footer lembar harga | 11 (5 ke `#harga`) | 3 (1 CTA + 2 tujuan) |
| Overflow horizontal 320-1440px | 0 | 0 |

Footer itu **sendiri** lebih tinggi, dan itu memang rencananya: band penutup
`/fitur` pindah ke dalamnya, dan baris meta bertambah jam bursa. Yang mengecil
adalah ujung halaman, dan yang berubah sifat adalah isinya. Di ponsel tingginya
hampir sama karena yang dibuang (sebelas tautan) digantikan oleh yang dipasang
(satu kalimat penutup, dua tombol, satu baris mekanika bayar, jam bursa). Dua
perkiraan di atas yang salah dan sudah dikoreksi, bukan dibuang diam-diam.

## Pembatalan ronde dua (keputusan pemilik terakhir)

Yang berdiri sekarang, dan ini yang ada di kode:

```text
[ merek: marka + eyebrow + tagline ]
─────────────────────────────  satu hairline
[ kalimat risiko di id="catatan" ]

© 2026 AIDSS · MCASS   [ID / EN]     Harga diperbarui … · 22:55 WIB · Bursa …
```

- **Nol tautan, nol heading, satu kontrol.** `PublicFooterProps` kembali menjadi
  `{ locale, updatedAt }`; `FooterCta` dan `FooterLink` dihapus.
- **Cara melanjutkan ada di tempat yang memang tugasnya**: gerbang topbar, kartu
  paket, burger — semuanya sudah punya tes sendiri.
- **Tiga tes footer kini menuntut ketiadaan**, bukan kehadiran: `queryAllByRole
  ('link')` panjangnya 0, tidak ada heading di dalam `contentinfo`, tidak ada
  `Masuk`/`Buat akun`/`Fitur`/`Catatan`, dan tepat satu tombol.
- **Ukuran**: footer 1440px 452px → **376px**; 390px ~740px → **516px**; tautan
  11 → **0**. Tidak ada grid tersisa, jadi breakpoint `760px` hanya mengatur spasi.
- **Pertanyaan terbuka, sengaja tidak dijawab**: `/fitur` berakhir tanpa CTA sama
  sekali, karena band `.pubf-cta` miliknya dihapus pada ronde satu dengan alasan
  "footer yang memegang gerak penutup" — dan footer lalu kehilangan gerak itu.
  Band itu tidak dipasang kembali tanpa keputusan pemilik; halaman itu sekarang
  berhenti di band FAQ.

## Ronde tiga: kontak dipasang lagi, dari server (pemilik, 2 November 2026)

Permintaan: "pada footer tambahkan Hubungi Kami serta Email yang mana bisa saya
input melalui halaman Admin". Yang diputuskan pemilik bukan sekadar "tampilkan
alamat" — ia meminta **kanal input**, jadi alamatnya miliknya, bukan milik kode.

- **Bentuknya persis dua fitur yang sudah ada.** `system_settings.contact_support`
  sebagai satu-satunya tempat nilai ditulis (`ADR-0010` untuk harga, dan
  `bank_accounts` untuk rekening), satu pembaca publik
  `GET /v1/subscriptions/contact`, satu penulis admin
  `GET`/`PUT /v1/admin/settings/contact`, dan satu form sebagai tab keempat
  `/admin`. Tidak ada ADR baru: `docs/adr/README.md` menyaring hanya keputusan yang
  sulit dibalik dan lahir dari trade-off sungguhan, dan ini mengulang pola yang
  sudah punya ADR — cukup satu baris di `docs/status.md`.
- **Publik, bukan ber-sesi, dan itu disengaja.** Footer berdiri di layar
  signed-out; alamat yang hanya bisa dibaca setelah masuk bukan alamat bantuan bagi
  orang yang belum memutuskan. Endpoint ini menambah satu string dan satu
  timestamp, tidak lebih.
- **Kosong berarti tidak ada baris.** `docs/settings-module-spec.md` §4 sudah
  menuliskan aturannya sebelum fitur ini ada: nilai kosong = baris tidak dirender,
  karena `mailto:` tanpa alamat adalah kontrol mati. Service menjawab
  `"email": null`, hook mengembalikan `null`, komponen me-render nol elemen. Tidak
  ada `aria-disabled` lagi di footer mana pun.
- **Validasi di service, bukan di router.** Satu alamat, tanpa prefix `mailto:`,
  tanpa spasi dalam, domain berlabel, maksimum 254 karakter (local 64). Ditolak =
  422 dan nilai lama tidak berubah. Dibaca ulang juga divalidasi: baris yang
  diedit tangan tidak boleh diterbitkan sebagai alamat.
- **Menghapus adalah tindakan yang dinamai.** Beda dari rekening tujuan (daftar
  kosong ditolak, karena menyimpannya = menghapus semua rekening tanpa pilihan),
  satu kotak kosong adalah satu-satunya cara menurunkan alamat dari halaman. Jadi
  tombolnya berubah menjadi **"Hapus dari footer"** saat field dibersihkan di atas
  alamat yang sedang berlaku, bukan diam-diam bertuliskan "Simpan".
- **Tidak ada tombol "verifikasi"**. Tidak ada yang memeriksa deliverability;
  kontrol yang mengimplikasikan server sudah mengeceknya adalah bohong.

## Berkas yang disentuh

| Berkas | Perubahan |
| --- | --- |
| `src/app/features/public/PublicFooter.tsx` | ditulis ulang; `columns: NavColumn[]` -> `cta` + `links`; `NavColumn` dihapus; jam menit; saklar bahasa lewat `useApp()` |
| `src/app/features/public/PublicFeatures.tsx` | `.pubf-cta` dihapus, `FEATURE_COLUMNS` dihapus, prop baru |
| `src/app/features/public/PublicPricing.tsx` | `NAV_COLUMNS` dihapus, prop baru |
| `src/app/features/public/PublicNotes.tsx` | `NOTES_COLUMNS` dihapus, prop baru |
| `src/styles/auth.css` | blok footer diganti; aturan `.pubf-cta*` pindah ke dalamnya |

Tabel di atas ronde satu dan dua. Yang ditambahkan ronde tiga:

| Berkas | Perubahan |
| --- | --- |
| `backend/api/services/system_settings_service.py` | `contact_support`: baca, tulis, validasi alamat |
| `backend/api/routers/contact.py` | **baru** — `GET /v1/subscriptions/contact` (publik) |
| `backend/api/routers/admin/contact.py` | **baru** — `GET`/`PUT /v1/admin/settings/contact` |
| `backend/api/main.py`, `backend/api/routers/admin/__init__.py` | kedua router dipasang |
| `backend/tests/conftest.py` | fake pool mengenal bentuk `{"email": ...}` |
| `backend/tests/test_contact.py` | **baru** — service + kedua endpoint lewat HTTP |
| `src/app/config/api.ts` | `contact`, `adminContact` |
| `src/app/features/public/useSupportContact.ts` | **baru** — satu baca; semua kegagalan jadi `null` |
| `src/app/features/public/PublicFooter.tsx` | baris kontak, hanya saat ada alamat |
| `src/app/features/admin/AdminContactView.tsx` (+ tes) | **baru** — tab keempat `/admin` |
| `src/app/features/public/PublicFooter.test.tsx` | **baru** — 12 tes footer, termasuk larangan mengarang alamat |
| `src/app/features/public/Public{Features,Notes}.test.tsx` | mock `apiFetch`, karena keduanya kini merender komponen yang meng-fetch |

Tidak ada migrasi baru: `system_settings` sudah ada, dan `contact_support` sengaja
**tidak** di-seed — install yang belum dikonfigurasi harus menjawab "belum ada",
bukan mengirim baris yang tidak bisa dibaca siapa pun. Itu justru yang dijaga
`test_system_settings_schema.py` (seed tetap `{"pricing"}`).

`App.tsx` **tidak** disentuh: footer membaca `toggleLocale` dari `useApp()`,
pola yang sudah dipakai `Sidebar.tsx`. `locale` tetap prop, karena tiga tes
halaman menukar bahasa lewat prop (`renderNotes('en')`).

## Tes

Yang berubah karena memang tidak lagi benar:

- Tiga tes "kontak ditahan" (features, notes, pricing) **dihapus**: tidak ada
  span mati lagi untuk dijaga kejujurannya.
- `PublicFeatures.test.tsx` "closes with the way back to the price" pindah ke
  footer, assertion-nya tetap.
- Hitungan `getAllByText('Sinyal').length` di pricing turun 5 -> 4; kolom
  PRODUK tidak ada lagi.
- Tes jam timer palsu ditulis ulang untuk presisi menit.
- Tes gerbang topbar discoping ke `.pub-topbar`, karena footer kini juga punya
  tombol `Masuk` dan `getByRole` melempar kalau ganda.
- Kontrak `#catatan` di kedua halaman tetap lulus tanpa diubah.

Guard yang berdiri sesudah ronde tiga: tes footer menuntut **ketiadaan** (nol
tautan navigasi, nol heading, tidak ada `Masuk`/`Buat akun`/`Fitur`/`Catatan`),
dan `PublicFooter.test.tsx` menjaga dua hal sekaligus — baris kontak hilang saat
server menjawab null, dan sumber komponen tidak memuat satu pun alamat email
(meniru penjaga `PublicNotes.test.tsx`, dengan alasan yang sama: yang layak
 diperiksa adalah bahwa tidak ada yang dikarang).
