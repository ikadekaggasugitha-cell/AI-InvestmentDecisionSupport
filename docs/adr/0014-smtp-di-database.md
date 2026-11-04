# ADR-0014: Konfigurasi email tinggal di `system_settings`, termasuk kredensialnya

**Status:** Diterima. Diterapkan. Keputusan ini **membalikkan** bagian dari
keputusan yang tercatat sebelumnya di `docs/status.md` dan di docstring
`src/app/features/admin/AdminIntegrationsView.tsx` — bahwa kredensial tinggal di
`.env` dan tidak ada formulir untuknya. Yang dibalik hanya email; kunci gateway
tetap pada aturan lama, dan alasannya tetap berlaku di sana.

## Masalah

Sistem sudah punya transport email: outbox (`0015_notification_outbox.sql`),
`backend/api/services/email_transport.py`, dan beat yang mengeringkannya. Yang
belum ada adalah cara menyebutkan **alamat pengirimnya** dari dalam produk.
Satu-satunya jalan hari itu adalah menyunting `backend/.env` di server dan
memulai ulang proses — artinya pemilik yang ingin tagihan berangkat dari
`billing@namaproduk.com` harus punya akses shell ke deploy-nya.

Dua hal membuat ini bukan pekerjaan satu kolom:

1. **`get_settings()` di-*cache* saat import** (`backend/api/core/config.py`,
   `lru_cache`). Formulir yang menulis ke database sementara transport tetap
   membaca `Settings` akan **tampak menyimpan dan tidak mengubah apa pun**.
   Kegagalannya tidak muncul di layar: muncul seminggu kemudian, pada konfirmasi
   pembayaran yang tidak pernah sampai, di antrean yang tidak sedang dilihat
   siapa pun. Ini persis kegagalan yang dulu mendasari keputusan "kredensial
   tinggal di `.env`", dan ia bukan alasan untuk tidak membuat formulirnya — ia
   alasan untuk membaca barisnya saat mengirim.
2. **Panel Integrasi dijaga oleh tesnya sendiri.**
   `backend/tests/test_admin_integrations.py` menegakkan bahwa endpoint status itu
   tidak mengembalikan teks apa pun selain nama site (`"sandbox"`). Editor email,
   secara definisi, harus mengembalikan host dan username yang sedang ia tampilkan.
   Memakai pintu yang sama akan menghancurkan penjaga yang baru saja diperkuat.

## Keputusan

**Konfigurasi email disimpan di `system_settings` di key `smtp`, dan
`mail_config()` di `backend/api/services/email_transport.py` adalah satu-satunya
pembacanya.** Ia membaca baris itu **pada saat mengirim**, dan menjatuhkan setiap
field ke nilai lingkungan bila barisnya tidak menyebutkan field itu.
`email_status()` dan `email_configured()` ikut pindah ke pembacaan yang sama,
sehingga panel, jalur approve, worker, dan editor tetap satu predikat — pola yang
sudah dipakai `gateway_configured()` — dan berubah **tanpa restart**.

**Editor adalah pintu terpisah dari panel status.**
`GET`/`PUT /v1/admin/settings/smtp` (`backend/api/routers/admin/smtp.py`)
dikunci `AdminUser`. Panel Integrasi tetap melaporkan status
(`emailConfigured`, `emailMissing`, `emailSenderStored`) dan tetap tidak
mengembalikan satu pun nilai konfigurasi.

**Password disimpan sebagai plaintext di jsonb.** Ini konsekuensi langsung dari
yang pemilik pilih ("semua field SMTP bisa disunting"), bukan kelalaian
implementasi, dan dokumen ini ada supaya konsekuensinya tertulis sebelum ada yang
menemukannya sendiri. Yang tidak bisa dimitigasi:

- nilai itu ada di **setiap backup** basis data ini, dan
- terbaca oleh **akun mana pun dengan hak baca Postgres**, termasuk pembacaan
  satu baris yang tidak butuh aplikasi sama sekali.

Yang dimitigasi, dan ditegakkan dengan tes:

- tidak ada endpoint yang mengembalikan nilainya, dalam bentuk apa pun —
  `hasPassword` adalah boolean, bukan panjang, bukan prefiks, bukan masker. Sebuah
  prefiks cukup untuk menyisakan kandidat pada kredensial pendek, dan layar ini
  tidak punya penggunaan untuk itu;
- tidak masuk log: `write_smtp` mencatat **nama field yang berubah**, bukan
  nilainya, dan itu yang diuji;
- `repr` dataclass-nya dibuang (`field(repr=False)` di `SmtpStored` dan
  `MailConfig`), karena objek itulah yang akan tercetak di log atau debugger;
- `PUT` dengan password kosong **mempertahankan** yang tersimpan. Kalau tidak,
  admin yang hanya mengoreksi hostname akan menghapus kredensialnya sendiri dan
  baru tahu pada kegagalan kirim berikutnya;
- penulisannya tercatat dengan siapa dan field mana yang berubah.

**Nilai yang ditampilkan form adalah nilai yang berlaku** — baris bila baris itu
bicara, lingkungan bila tidak. Menampilkan kolom kosong di instalasi yang
sebenarnya mengirim akan membuatnya terlihat "belum dikonfigurasi", dan operator
akan "memperbaiki" sesuatu yang tidak rusak.

**`enabled` ikut bisa ditulis.** Baris `smtp` menyimpan `enabled`, dan itu satu
konsekuensi yang dipilih sadar: kolom host dan sender saja tidak cukup, karena
dengan `NOTIFICATIONS_ENABLED=false` formulir akan lengkap, tersimpan, dan tetap
tidak mengirim apa pun. Itu kegagalan bentuk pertama — layar yang tampak menyimpan
tanpa mengubah perilaku — di pintu lain. Field ini mengikuti aturan override yang
sama: kosong berarti lingkungan menjawabnya lagi.

## Yang ditolak

**Menaruh editor di panel Integrasi yang ada.** Penjaga "tidak ada teks selain nama
site" ada di tes itu, dan ia ada untuk alasan yang benar. Pintu kedua punya alasannya
sendiri, keduanya tetap berlaku.

**Formulir yang menulis ke DB tapi dibaca dari `Settings`.** Bukan alternatif;
ini kegagalan yang pasti, dan lebih buruk dari tidak ada fitur.

**Hanya alamat pengirim yang bisa disunting, host/user/password tetap di `.env`.**
Ini yang lebih aman dan tetap tersedia sebagai jalan kembali: tidak ada plaintext di
rest, tidak ada backup yang membocorkan kredensial. Ia ditolak oleh pemilik. Kalau
keputusan itu dibalik, `SmtpStored`, `backend/api/routers/admin/smtp.py`, dan
`src/app/features/admin/AdminSmtpView.tsx` tinggal dipotong sampai host/port/
username/`from_address` saja — `mail_config()` tidak berubah, dan tidak ada
keputusan lain yang bergantung pada field yang hilang.

**Menyimpan kredensial terenkripsi dengan kunci di lingkungan.** Menambah satu
lapis yang tidak menjawab apa pun di sini: siapa pun yang bisa membaca baris dan
menjalankan aplikasi dengan kunci itu bisa membongkarnya, dan kunci itu sendiri
kembali ke `.env` — keputusan ini hanya berpindah tempat, dengan biaya berupa
mode kegagalan baru (kunci salah → email berhenti dan layar tetap bilang
"tersimpan").

**Cache pada `mail_config()`.** Konfigurasi email yang basi mengirim dari alamat
lama. Repo ini sudah menolak cache pada hal yang harus benar saat itu juga
(badge antrean di `src/app/features/admin/AdminDashboardView.tsx`). Yang dibayar
adalah satu pembacaan baris per beat pengirikan, dan itu dibayar di tempat yang
sudah memegang koneksi.

## Konsekuensi

- **Backup basis data ini sekarang berisi kredensial surat.** Rotasi password SMTP
  tidak lagi cukup dilakukan di provider; nilai di barisnya harus diganti lewat
  editor atau `PUT /v1/admin/settings/smtp`.
- **Hak baca Postgres = hak baca kredensial email.** Itu batasan ancaman yang
  sekarang eksplisit, sebelumnya tidak.
- **Ganti provider tanpa restart.** Itulah yang dibayar untuk formulirnya, dan ia
  ada: perubahan berlaku pada pengiriman berikutnya.
- **Kunci Midtrans tetap di lingkungan.** Bedanya bukan inkonsistensi: gateway
  mengirim uang, dan kredensial yang bisa membaca saldo atau membuat refund tidak
  seharusnya ada di baris yang terbaca siapa pun dengan hak SELECT. Email hanya
  bisa mengirim sebagai satu alamat, dan itu pilihan yang operator ini buat
  sadari. Kalau pemilik kelak ingin kunci gateway ikut bisa disunting, itu ADR
  tersendiri, bukan perluasan diam-diam dari yang ini.
- **Layar yang dibuka halaman bayar tetap halaman gateway.** Yang bisa dijanjikan
  dan dijaga dengan tes adalah layar kita, bukan milik pihak ketiga
  (`docs/status.md` mencatat batasan itu).
