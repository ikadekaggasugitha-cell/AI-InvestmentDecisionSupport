# ADR-0013: Catatan adalah salinan statis yang hanya memuat klaim terbukti

**Status:** Diterima. Diterapkan.

## Masalah

Layar publik `/catatan` ditambahkan 2026-11-02 sebagai tujuan item "Catatan" di
tombol burger lembar harga. Sebelumnya item itu hanya lompatan ke `#catatan`,
satu kalimat penyangkalan di footer bersama ([`PublicFooter.tsx`](../../src/app/features/public/PublicFooter.tsx)
baris 96-100). Layar baru itu butuh isi, dan pemilik tidak menentukannya.

Dua jawaban tersedia, dan yang paling tampak benar adalah yang salah:

1. **Merender `docs/legal-and-consent.md`.** Dokumennya sudah ada, bilingual,
   dan menutupi tepat topik yang dibutuhkan pembaca lembar harga: status OJK,
   cara bayar, pengembalian dana, data pribadi. Menampilkannya berarti satu
   berkas sumber dan nol salinan.
2. **Menulis salinan baru dari nol.** Butuh effort, dan setiap kalimat adalah
   klaim baru yang belum tentu ditepati sistem.

Pilihan pertama gagal pada baris 22 dokumen itu sendiri:

> Sampai itu terjadi, jangan arahkan pengguna ke dokumen ini sebagai syarat dan
> ketentuan yang berlaku.

Alasannya dicatat di baris 12-18, dan sebagian sudah basi. Dokumen itu menyebut
Midtrans, QRIS, virtual account, dan verifikasi admin "belum ada satu baris kode
pun", sementara [`docs/status.md`](../status.md) mencatat gerbang pembayaran
sebagai **Ada** (`backend/api/routers/payments_gateway.py`, `POST
/v1/payments/checkout`, webhook dengan signature). Jadi dokumen itu bukan hanya
belum disahkan pengacara; ia juga menjelaskan dunia yang sudah berubah.

## Keputusan

**Halaman Catatan berisi kalimat yang bisa ditunjuk ke fakta di kode, skema, atau
`docs/status.md`. Tidak ada janji yang belum dijalankan sistemnya.**

Tiga turunan yang mengikat, dan masing-masing punya penjaga di
[`PublicNotes.test.tsx`](../../src/app/features/public/PublicNotes.test.tsx):

- **Tidak ada angka harga.** Harga tinggal di `system_settings` (ADR-0010) dan
  dibaca dari layar harga. Mengutipnya di halaman ini mencipta fakta kedua yang
  bisa berbeda dari yang pertama.
- **Tidak ada kanal kontak.** `docs/legal-and-consent.md` baris 17 mencatat
  nomor dan alamat yang dicantumkan di dalamnya belum pernah diterima siapa pun,
  dan footer sudah jujur tentang itu: "Hubungi kami" dirender sebagai `span`
  tanpa href (`held: true`). Halaman ini tidak menulis nomor atau alamat yang
  tidak dimiliki.
- **Tidak ada nama algoritma.** Kontrak API tidak bisa menopangnya, dan
  [`dataHonesty.test.ts`](../../src/app/test/dataHonesty.test.ts) sudah gagal
  kalau satu nama muncul di `src/app`.

**Isinya statis di kontrol versi, bukan dari basis data.** Salinan ini bahan
hukum dan produk: ia harus lewat review dan punya riwayat. Berbeda dari harga,
yang memang benar tinggal di server karena pemilik mengubahnya tanpa deploy.

**Dokumen legal tetap draf dan tidak dipublikasikan.** Halaman ini menyebut
statusnya apa adanya di kalimat kedua, karena menyembunyikan fakta itu akan
membuat halaman paling jujur di aplikasi menjadi halaman yang paling menyesatkan.

## Alternatif yang tidak dipilih

**Merender dokumen legal apa adanya.** Memublikasikan janji yang belum ditepati,
dan melanggar instruksi tertulis dokumen itu sendiri.

**Isi dari basis data dengan endpoint dan layar admin.** Menambah migrasi, penulis
kedua, dan pertanyaan paywall untuk bahan yang justru harus lewat review kode.
Dan halaman ini dibaca orang yang belum membayar, jadi ia tidak boleh berada di
balik gerbang yang ia jelaskan.

**Modal atau drawer di lembar harga.** Melanggar kontrak yang tertulis di
[`PublicNavMenu.tsx`](../../src/app/features/public/PublicNavMenu.tsx): tautan
menyimpan `href` nyata supaya middle-click dan berbagi tetap jalan. Modal tidak
bisa dibagikan.

**Memperbesar bagian `#catatan` di lembar harga menjadi lebih panjang.** Tetap
bukan halaman: tidak punya URL, tidak bisa ditaut, dan mendorong jalur pembelian
ke bawah.

## Konsekuensi

- Kalimat di halaman ini punya utang yang terukur. Bagian "Angka contoh dan angka
  Anda" menyatakan panel berisi contoh membawa label "Data contoh"; audit
  2026-11-02 menemukan dua tempat yang melanggarnya dalam harness offline
  (`Alokasi sektor` di Dashboard dan seluruh panel Risiko). Kalimat itu sudah
  ditulis supaya temuan seperti itu disebut cacat, bukan fitur, tetapi ia baru
  benar sepenuhnya setelah labelnya dipasang.
- Menambah atau mengubah satu bagian berarti mengubah berkas komponen, dan
  tanggal revisi dicetak di halaman (`REVISED`) bukan dihitung dari jam peramban.
  Ia tidak bisa lupa diperbarui dengan diam-diam: tes assertions
  "carries the revision stamp" menggenggam tanggal itu.
- Kalau dokumen legal suatu hari disahkan pengacara dan Fase 2 serta Fase 5 hijau,
  ADR ini tidak menghalangi halaman itu menampilkan isinya. Yang ia larang adalah
  menampilkannya sebelum itu.

## Yang paling mudah kembali

Kalau pemilik memutuskan halaman ini sebaiknya memang menjadi syarat layanan
penuh, jalan pulangnya adalah: sahkan `docs/legal-and-consent.md` (hapus status
draf dan baris 22), lalu pindahkan isinya ke layar ini dengan tetap menahan dua
larangan di atas (angka harga, kanal kontak). ADR ini dicabut, bukan dibalik.
