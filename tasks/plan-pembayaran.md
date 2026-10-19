# Implementation Plan: Pembayaran Manual dan Gerbang

## Gambaran

Tabel `transactions` sudah ada sejak migrasi `0010`, lengkap dengan kunci
idempotensi webhook, `proof_image_url`, `approved_by`, dan `admin_notes`. Yang
belum ada bukan skema — jalannya.

Masalah yang lebih mendasar lebih dulu: **tidak ada satu pun kode yang menulis
tabel `subscriptions`.** Nol baris `INSERT` sejak hari pertama. Selama itu begitu,
tidak ada pembayaran apa pun yang bisa menghasilkan akses, dan tidak ada yang
bisa menguji apakah gerbang bekerja. Jadi yang pertama dibangun bukan checkout —
melainkan **satu-satunya penulis** `subscriptions`, supaya sisanya punya tempat
bertumpu.

Nomor harga sudah dibaca dari satu sumber sejak `0011`. Yang belum ada adalah
jalur yang mengubah nominal itu menjadi masa aktif.

## Keputusan yang Sudah Diambil

**Checkout adalah langkah sendiri, bukan bagian dari pendaftaran.** ADR-0004
membuat registrasi terbuka tanpa pembayaran, CONTEXT.md aturan 4 menyatakan
account tanpa Subscription tetap sah, dan `test_signup_path_is_canonical`
melarang `register-checkout`. Blueprint §4.1 masih menulis checkout menyatu di
formulir pendaftaran; itu sudah dilampaui oleh keputusan yang lebih baru.

**Tanpa unggah berkas bukti.** Pengguna menulis catatan; admin yang mencocokkan
nomornya. Volume satu operator tidak membenarkan adanya upload: verifikasi tipe
berkas, batas ukuran, dan nama berkas yang disajikan kembali ke peramban.

**Transaksi manual kedaluwarsa setelah satu jam.** Keputusan pemilik. Yang
menjaga dari akibatnya ada di bawah — satu jam tidak boleh berarti uang orang
hilang.

**Kedaluwarsa adalah kebersihan antrean, bukan vonis akhir atas uang.** Transaksi
`expire` berhenti muncul sebagai tawaran, tapi admin **tetap boleh** menyetujuinya.
Alasannya konkret: transfer bank di luar jam kerja — transfer jam 22.00, admin
melihat panel jam 09.00 keesokan harinya — akan kedaluwarsa sebelum sempat
disentuh. Kalau `expire` menutup persetujuan, sistemnya bisa menelan uang
seseorang tanpa jejak dan tanpa satu pun tempat untuk melapor. Satu operator
dengan rekening bank sendiri membuat verifikasi manual jadi kenyataan, bukan
formalitas, jadi kemampuan menyetujui yang sudah lewat tetap penting.

**Durasi mengikuti blueprint: 30 hari bulanan, 365 hari tahunan.** Satu baris
`subscriptions` per pembelian, `expires_at = NOW() + N days`, tidak pernah
digeser. Perpanjangan menulis baris baru, dan akses dibaca dari
`MAX(expires_at)` yang belum lewat — sudah berjalan di `entitlements.py`.

**Gerbang Midtrans masuk rencana, QRIS dinamis ikut.** `ServerKey` dan akun
aktif adalah prasyarat, bukan hal yang bisa dikerjakan di tengah.

## Yang Tidak Berubah

- `subscriptions` tetap tanpa kolom status (CONTEXT.md aturan 1). Masa aktif
  ditulis sekali.
- Payment Status tidak pernah memblokir akses (aturan 3). Transaksi `pending`
  yang menggantung tidak menutup apa pun.
- Transaksi yang gagal tidak pernah menutup akses. Menolak bukti transfer tidak
  menyentuh langganan yang sedang berjalan.
- Tidak ada unggah berkas, jadi `transactions.proof_image_url` **tidak akan
  punya penulis**. Kolomnya dibiarkan karena ada di blueprint; dicatat sebagai
  utang, bukan dipakai setengah.
- Role dan Entitlement tetap terpisah (aturan 6). Admin tidak otomatis punya
  akses berbayar.

## Keputusan Arsitektur

**Satu fungsi menulis `subscriptions`.** `grant()` di
`api/services/subscriptions.py`, dipanggil dari dua tempat: persetujuan admin
dan webhook gerbang. Kalau dua tempat menulis baris langganan, satu bisa menulis
tanpa mencatat transaksi mana yang membayarnya — dan `transactions.subscription_id`
menjadi kolom yang tidak bisa dipercaya.

**Idempotensi dipegang baris `transaction`, bukan `subscriptions`.** Dua masa
aktif yang tumpang tindih itu sah dan tidak bisa dibedakan satu sama lain, jadi
`subscriptions` tidak punya apa pun untuk ditegakkan. Webhook berulang berhenti
di baris yang sudah ada; Subscription baru hanya ditulis saat baris itu masuk
`settlement` untuk pertama kalinya. Webhook setelahnya tetap dijawab 200 supaya
penyedia tidak mengirim ulang.

**Nominal harus cocok saat webhook.** `amount` ditulis dari harga server saat
checkout, dan `gross_amount` dari webhook harus sama persis. Tidak cocok berarti
penolakan dan log — kalau dilewati, siapa pun bisa membuat transaksi
nominal kecil lalu mengirim webhook yang cocok dengan nominal kecil itu.

**Manual dan otomatis berbagi satu antrean admin.** Transaction `pending` dari
sumber mana pun muncul di tempat yang sama, karena tindakan berikutnya sama:
mencocokkan uang dan menekan approve.

**Antrean persetujuan adalah tempat bekerja, bukan halaman.** Admin yang menekan
Approve sedang mengaktifkan akses orang, jadi aksinya harus jelas dan
menghasilkan keadaan yang terlihat, bukan toast yang lewat.

## Task List

### Fase 1: Satu tangan yang menulis Subscription

- [x] Task 1: `services/subscriptions.py` — `grant()` sebagai satu-satunya penulis
- [x] Task 2: `POST /v1/admin/accounts/{id}/subscription` — beri langganan tanpa pembayaran

### Checkpoint: Fase 1
- [x] `subscriptions` punya penulis untuk pertama kalinya
- [x] Idempoten terhadap `transaction_id` yang sama
- [x] Admin tanpa langganan tetap boleh memanggilnya (aturan 6)

### Fase 2: Rekening tujuan

- [x] Task 3: `bank_accounts` di `system_settings` — baca, tulis, validasi
- [x] Task 4: UI admin untuk rekening + tampilan publik

### Checkpoint: Fase 2
- [x] Rekening bisa diisi dan diubah dari panel admin
- [x] Pembaca tanpa sesi bisa membaca rekening tujuan
- [x] Rekening kosong dijawab "belum ada", bukan daftar kosong yang terlihat seperti daftar

### Fase 3: Transfer manual

- [x] Task 5: `POST /v1/payments/manual` — pengguna menyatakan transfer
- [x] Task 6: Antrean admin + approve/deny
- [x] Task 7: Halaman "sedang diverifikasi" + Tab 2 menampilkan transaksi pending
- [x] Task 8: Kedaluwarsa transaksi manual yang menggantung

### Checkpoint: Fase 3
- [x] Approve menulis Subscription dan mengubah status transaksi dalam satu jalan
- [x] Deny tidak menyentuh Subscription yang sedang berjalan
- [x] Transaksi expired tidak memblokir apa pun
- [x] Alur lengkap bisa dicoba tanpa gerbang pihak ketiga

### Fase 4: Gerbang Midtrans — kredensial masuk 2026-10-19

- [x] Task 9: Konfigurasi Midtrans + `POST /v1/payments/checkout` → snap token
- [x] Task 10: `POST /v1/payments/midtrans/webhook` — signature, nominal, idempotensi
- [x] Task 11: Halaman checkout di frontend

### Checkpoint: Fase 4
- [x] Webhook berulang untuk satu transaksi tidak menghasilkan Subscription kedua
- [x] Signature salah ditolak
- [x] Nominal tidak cocok ditolak

### Fase 5: Bukti dan dokumen

- [x] Task 12: `docs/status.md`, ADR-0011

### Checkpoint: Lengkap
- [x] `cd backend && pytest` hijau, `ruff` bersih
- [x] `npm run typecheck && npm run lint && npm run test` hijau
- [x] Tinjau dengan manusia

### Hasil tinjauan (dilakukan 2026-10-18)

- TTL antrean manual **3600 → 86400 (24 jam)**: verifikasi dilakukan manusia
  membaca mutasi bank, dan cek esok pagi tidak boleh terbaca sebagai
  "Kedaluwarsa". Default di `config.py`, nilai contoh `.env.example`, dan
  baris status.md ikut diperbarui; "expired tetap approvable" tidak berubah.
  Fase 4 Midtrans tetap menunggu kredensial.

### Hasil eksekusi Fase 4 (2026-10-19)

Kredensial masuk di `backend/.env` dan uji asap langsung ke sandbox sukses
(`HTTP 201`, token + `redirect_url`). Yang dibangun, dengan satu deviasi yang
**dipilih pemilik** lewat pertanyaan langsung:

- **Handover = `redirect_url`**, bukan Snap popup: frontend membuka URL yang
  server minta ke Midtrans, jadi **tidak ada Client Key yang diekspos** ke
  browser dan tanpa `snap.js`. Popup embed ditunda — naik ke Snap popup kelak
  hanya menyentuh frontend.
- `MIDTRANS_SERVER_KEY` / `MIDTRANS_IS_PRODUCTION` masuk `config.py` +
  `.env.example` (template uji `test_env_template`). Key kosong = install tanpa
  gerbang: checkout menjawab **503** dengan kalimat, bukan tombol mati.
- `/open_gateway_transaction` di `services/payments.py`: harga server dulu,
  Midtrans dipanggil kedua (order_id = invoice_code, expiry 24 jam yang sama
  dengan TTL antrean), baris ditulis **setelah** page minted — checkout yang
  ditolak gateway tidak meninggalkan baris siasia. Transport di
  `services/midtrans.py` terpisah dan dimock di tes.
- Webhook: signature `SHA512(order_id + status_code + gross_amount +
  serverKey)` dibanding `hmac.compare_digest` **sebelum** apa pun dibaca;
  403 salah kunci, 404 order tak dikenal (Midtrans menunggu dan mengulang —
  race baris yang tertinggal menyembuhannya sendiri). Settlement dan deny
  `approved_by = NULL` dengan `midtrans_transaction_id` kutemukan di kolomnya
  (UNIQUE milik migrasi 0010 akhirnya yang berpemilik); `refund` hanya dicatat,
  akses tidak ditarik — Admin yang memutus balikan (ADR-0008/0011).
- Implementasi terhadap plan: QRIS dinamis tidak dibuat terpisah — memilih
  QRIS/kartu/e-wallet terjadi **di dalam** halaman Midtrans; baris
  `payment_method` gateway ditulis `'midtrans'`.
- Layar: kartu "Bayar lewat Midtrans" di Tab 2 (dibawah formulir manual),
  radio paket sendiri, tombol membuka tab baru; kegagalan dinyatakan dalam
  kalimat — 503 "belum aktif", jaringan, dan lainnya — dan tidak ada jendela
  yang dibuka. 3 tes baru di `SettingsViewGateway.test.tsx`; satu query tes
  lama yang jadi ambigu (`Tahunan`) dipersempit ke radio formulir manual.
- Verifikasi: backend 878 passed (coverage 69,21%), ruff bersih; vitest 329,
  tsc bersih, eslint 10 peringatan pra-ada (0 error).

## Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Webhook palsu dengan nominal kecil mengaktifkan akses | **Kritis** | `gross_amount` harus sama dengan `amount` baris. Signature SHA-512 diverifikasi. Keduanya wajib, bukan salah satu |
| Webhook diproses dua kali → dua masa aktif | Tinggi | Idempotensi di baris `transaction`; Subscription hanya ditulis saat masuk `settlement` untuk pertama kalinya |
| `subscriptions` punya dua penulis | Tinggi | Satu fungsi `grant()`, dua pemanggil. `transactions.subscription_id` jadi bisa dipercaya |
| Transaksi `pending` menggantung selamanya | Sedang | Beat menjadwalkan kedaluwarsa. Tidak memblokir akses, jadi aman dijalankan agresif |
| Admin menekan approve untuk transaksi yang salah | Sedang | Antrean menampilkan nominal, catatan, dan waktu — bukan hanya daftar. Aksi mengubah keadaan yang terlihat |
| Pengguna membayar dua kali | Sedang | Dua masa aktif tumpang tindih itu sah dan hanya satu yang terpakai. Ruganya di pengguna, bukan di sistem; dicatat sebagai utang |
| `proof_image_url` jadi kolom mati | Rendah | Sengaja tidak diisi. Dicatat di `status.md` sebagai utang yang ditunda dengan sadar |

## Yang Membuat Fase 4 Tertahan

**`ServerKey` Midtrans tidak ada di proyek ini.** Sudah diperiksa 2026-10-14:

- `backend/.env` tidak punya variabel Midtrans apa pun (yang ada: `APP_ENV`,
  `AUTH_BYPASS`, `PAYWALL_ENABLED`, `LLM_PROVIDER`, `GROQ_API_KEY`, `LLM_MODEL`,
  `LLM_MAX_TOKENS`, `DATABASE_URL`, `REDIS_URL`).
- `.env.local` hanya berisi `VITE_*`.
- `backend/api/core/config.py` tidak punya field untuk midtrans — belum ada
  tempat untuk meletakkannya.

Kemungkinan besar kuncinya ada di akun Midtrans tetapi belum pernah ditaruh di
sini. Yang perlu ada sebelum Fase 4 bisa jalan: `midtrans_server_key` di
`Settings`, `midtrans_is_production` untuk membedakan URL sandbox dan produksi,
dan keputusan apakah client key juga perlu dikirim ke frontend untuk Snap.

Fase 1–3 tidak butuh satu pun dari itu, dan bisa diselesaikan lebih dulu.

## Pertanyaan Terbuka

- **Apakah nominal bulanan dan tahunan perlu dibedakan di satu transaksi?** `amount`
  ada per baris, jadi satu orang bisa mencampur; pertanyaannya apakah itu perlu
  dilarang.
- **Apakah satu jam berlaku juga untuk transfer yang diunggah sore hari?** Kalau
  satu jam turunan dengan Watching, banyak transaksi nyata akan kedaluwarsa
  sebelum sempat diverifikasi — dan itu yang membuat approve-setelah-expire
  bukan sekadar kehati-hatian, melainkan keharusan.

---

## Fase 5 — Tiga slot paket: mingguan, bulanan, tahunan (2026-10-19)

Keputusan pemilik menjawab pertanyaan dua-slot yang menunggu: paket dilengkapi
slot mingguan, dan harga ditetapkan ulang — **mingguan Rp 15.000, bulanan
Rp 44.000, tahunan Rp 252.000**. Durasi mengikuti slotnya: 7 / 30 / 365 hari.
Panel admin tetap sumber pengaturan harga: ketiga angka tetap bisa diubah
kapan saja tanpa migrasi lagi.

Arsitekturnya tidak bergeser. Harga masih satu dokumen di `system_settings`,
dibaca oleh `read_pricing()` dan ditulis oleh `write_pricing()` dalam satu
pernyataan; yang berubah adalah jumlah kunci (dua menjadi tiga) dan kosakata
plan — `PLAN_DAYS` menambah `weekly: 7`, dan CHECK kolom `transactions.plan`
ikut. Penerimaan `plan` di deklarasi manual maupun checkout otomatis memakai
`PLAN_NAMES`, jadi slot baru tidak menambah validasi di dua lokasi.

Migrasinya `0014_pricing_weekly.sql`: menukar CHECK `transactions.plan`
(minggu masuk kosakata) dan menulis keputusan harga baru ke baris `pricing`
yang masih memuat seed 0011 persis. Baris yang adminnya sudah menetapkan harga
sendiri hanya mendapat kunci `weekly`, bukan harga titipan; install fresh
membaca dari seed `schema.sql` yang kini tiga-kunci. `schema.sql` disamakan
(seed dan CHECK), dan DDL di `docs/saas-subscription-platform.md` ikut — tes
dokumen (`test_docs_status.py`) mengunci DDL plan itu terhadap `schema.sql`.

Endpoint tidak bertambah: `GET /v1/subscriptions/pricing` kini memuat tiga
angka, `PUT /v1/admin/settings/pricing` wajib menerima ketiganya (body
parsial ditolak 422), jadi kombinasi harga campuran dari dua masa berbeda
tetap tidak mungkin muncul.

Slot tampil di semua layar yang memilih paket: Tab 2 (deklarasi manual dan
kartu Midtrans, default terpilih tetap bulanan), halaman publik `/harga`
(tiga baris), dan form admin tab Harga (tiga input). `/harga` sekalian
berhenti mengklaim pembayaran "transfer bank" saja — konfirmasi
settlement datang juga dari Midtrans.

Keputusan layar yang menyertai: teks catatan `AuthScreen` diperbarui pemilik
menjadi "Pembayaran dibuka setelah masuk — Midtrans (kartu, QRIS, e-wallet)
atau transfer manual" plus pasangan EN-nya, dan tesnya dibalik bersama
faktanya (komit `e13a7fa`).

### Hasil eksekusi Fase 5 (2026-10-19)

- Tidak ada berkas tes baru: kasus mingguan masuk ke berkas yang sudah ada
  (`test_payments_gateway.py`, `test_manual_payment.py`, `test_pricing_api.py`,
  `test_pricing_service.py`, tes frontend yang menyentuh slot).
- `test_pricing_service` kini menyusun seed dari dua migrasi (0011 lalu 0014)
  sebagaimana SQL menerapkannya — "yang berlaku" adalah komposisinya, bukan
  satu file. `test_system_settings_schema` membandingkan seed `schema.sql`
  dengan hasil komposisi yang sama.
- Nominal default di tes yang mengunci angka diadu ke seed baru (44.000 /
  252.000); asersi yang sama maknanya, bukan angkanya, yang diubah.
- Tes yang dulu mempermainkan `weekly` sebagai plan tak dikenal, kini
  mempermainkan `daily` supaya maknanya tetap "plan di luar kosakata".