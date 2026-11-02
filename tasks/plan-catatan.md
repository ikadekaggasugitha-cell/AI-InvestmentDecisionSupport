# Implementation Plan: Halaman Catatan Publik (`/catatan`)

## Gambaran

Permintaan awalnya: "mari kita buat halaman untuk Catatan, tetapi saya tidak tau
isinya apa", lalu diperjelas: "pastikan halaman Catatan yang dimaksud yang berada
pada tombol burger di halaman harga".

Yang ditemukan di kode: item "Catatan" di burger lembar harga **bukan halaman**.
Ia lompatan `href="#catatan"` ke satu kalimat penyangkalan di footer bersama
([`PublicFooter.tsx`](../src/app/features/public/PublicFooter.tsx) baris 96-100),
dan perilakunya dipin oleh tes. Jadi yang dibangun adalah layar ketiga dengan URL
sendiri, `/catatan`, mengikuti pola `/fitur` yang sudah ada, dan item burger itu
dipindahkan ke sana.

Isinya direkomendasikan dari nol, dengan satu aturan yang lahir dari temuan
terbesar: **`docs/legal-and-consent.md` tidak boleh dijadikan isi halaman.**
Dokumen itu menulis sendiri di baris 22 bahwa pengguna tidak boleh diarahkan
kepadanya sebagai syarat layanan, dan alasan ia berstatus draf sebagian sudah
basi (ia menyebut gerbang pembayaran belum punya kode, sementara
[`docs/status.md`](../docs/status.md) mencatatnya **Ada**). Keputusan ini
dicatat sebagai [ADR-0013](../docs/adr/0013-catatan-statis-tanpa-draft-legal.md).

## Temuan utama: penjaga tingkat-sumber ikut menentukan salinan

`src/app/test/dataHonesty.test.ts` memindai **seluruh** `src/app` dengan komentar
strip, dan menolak: nama algoritma (`LightGBM|XGBoost|CatBoost`), tally analis,
nama orang dan jabatan, glif piktograf Unicode (termasuk tanda panah), hex palet
gelap, dan `var(--token)` yang tidak dideklarasikan. Salinan halaman ini ditulis
setelah batas itu dibaca, bukan sesudahnya ditebak.

## Isi yang diputuskan

Sembilan bagian, berurutan seperti kebutuhan pembaca yang sedang memutuskan
berlangganan. Kolom kanan adalah tempat klaim itu dibuktikan hari ini.

| Bagian | `id` | Dibuktikan oleh |
| --- | --- | --- |
| Bukan penasihat investasi | `risiko` | gerbang OJK berjalan di `ConsentGate.tsx`; legal §1.1 diringkas, bukan dikutip |
| Angka yang Anda lihat adalah probabilitas | `probabilitas` | `servingSource` di `useAISignals.ts`; modal persetujuan di `AIAdvisorView` |
| Dari mana datanya, dan seberapa baru | `data` | `TabAbout` "Sumber data IDX / Yahoo Finance"; `DataFreshnessBadge`; `/health` menjawab `degraded` |
| Angka contoh dan angka Anda | `contoh` | pola label "Data contoh"; kontrak harness di `src/app/config/api.ts` |
| Apa yang dibuka langganan | `langganan` | `dependencies=paid` di `backend/api/main.py` baris 290-329; ADR-0009, ADR-0012 |
| Cara membayar dan apa yang terjadi setelahnya | `pembayaran` | `TabSubscription`, `payments_gateway.py`, `docs/status.md` |
| Pengembalian dana | `pengembalian-dana` | `docs/status.md`: refund hanya dicatat, memulangkan uang keputusan admin |
| Data pribadi Anda | `privasi` | `backend/db/schema.sql` (`users`, `sessions`, `consent_acceptances`, `portfolios`, `transactions`); `proof_image_url` sengaja kosong |
| Status layanan dan revisi catatan ini | `status` | `/health`; harga di `system_settings` (ADR-0010) |

Tiga hal sengaja tidak masuk, masing-masing karena tidak ada sumbernya: angka
harga, kanal kontak (nomor dan alamat yang belum dimiliki siapa pun), dan nama
algoritma.

## Bentuk teknis

- Komponen baru `src/app/features/public/PublicNotes.tsx`, meniru struktur
  `PublicFeatures.tsx`: `pub-shell` > `pub-topbar` (logo + `PublicNavMenu`) >
  `main` (hero + kolom baca) > `PublicFooter` bersama.
- Salinan inline `isId ? … : …`, mengikuti kedua layar publik. Tidak ada key baru
  di `translations.ts`, karena layar publik tidak membaca file itu.
- Bagian disimpan sebagai array `SECTIONS` di puncak berkas, supaya menambah
  bagian tidak menambah JSX.
- Routing mengikuti preseden: cabang `location.pathname === '/catatan'` di blok
  signed-out `App.tsx`, **bukan** entri `<Route>` baru. `/fitur` juga tidak punya.
- Perilaku signed-in dibiarkan seperti `/fitur` hari ini: `/catatan` jatuh ke
  shell. Tidak ada tautan mati, karena burger hanya ada di layar publik.
- `<p id="catatan">` di footer tidak disentuh. Halaman baru ini bergabung, ia
  tidak menggantikan pernyataan footer.

## Risiko yang diantisipasi

| Risiko | Cara cegah |
| --- | --- |
| Salinan jadi klaim hukum yang belum ditepati | Setiap bagian punya baris "dibuktikan oleh"; ADR-0013 melarang tiga hal spesifik, dan tesnya menggenggam larangan itu |
| Bagian "contoh" lebih dulu benar daripada aplikasinya | Ditulis sebagai aturan yang bila dilanggar berarti cacat, dan dicatat sebagai utang di Konsekuensi ADR |
| Tautan mati di commit tengah | Komponen, routing, empat titik masuk, dan tes yang dipin turun sebagai satu perubahan |
| Guard warna/ikon/teks gagal | Token yang dipakai sudah ada; tidak ada hex; tidak ada glif piktograf; lantai teks dijaga di 14px |
| `status.md` menyebut berkas yang belum ada | Barisnya turun bersama kodenya; `backend/tests/test_docs_status.py` memverifikasi setiap path yang disebut |

## Verifikasi

```bash
npx vitest run src/app/features/public src/app/test
npx tsc --noEmit
npx eslint .
npx prettier --check "src/**/*.{ts,tsx}"
npm run build
```

Jalan tangan: `/catatan` dimuat langsung dan di-refresh, lembar harga ke
`/catatan` lewat burger, `/fitur` ke `/catatan` lewat burger, lebar 1440 dan 390,
dan tepi kiri kolom baca sejajar dengan hero.
