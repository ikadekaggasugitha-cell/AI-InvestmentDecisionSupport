# Task List: Pembayaran Manual dan Gerbang

Rencana lengkap: [plan-pembayaran.md](plan-pembayaran.md). Baca file itu dulu
untuk keputusan, batasan, dan risiko.

Perintah verifikasi:

```bash
# Backend
cd backend && .venv/bin/python -m pytest -q
cd backend && .venv/bin/python -m ruff check .

# Frontend
npx tsc --noEmit
npx vitest run
npx eslint src
```

---

## Fase 1: Satu tangan yang menulis Subscription

Masalah yang lebih dulu daripada pembayaran: tabel `subscriptions` tidak punya
penulis. Sampai ada, tidak ada pembayaran yang bisa menghasilkan akses, dan tidak
ada yang bisa menguji apakah gerbang bekerja.

## Task 1: `services/subscriptions.py` — satu-satunya penulis

**Deskripsi:** `grant()` membuat satu baris `subscriptions` dengan
`expires_at = NOW() + N days`, mengisi `transactions.subscription_id`, dan
tidak pernah menggeser baris yang sudah ada. Modul ini akan jadi tempat seluruh
pembayaran bertemu.

**Acceptance criteria:**
- [x] `grant()` adalah satu-satunya tempat yang menulis tabel `subscriptions`
- [x] `expires_at` dihitung dari waktu grant, dan baris lama tidak pernah diubah
- [x] Idempoten terhadap `transaction_id` yang sama — dipanggil dua kali, hasilnya
      satu baris
- [x] Mengembalikan baris Subscription yang dibuat, bukan hanya `True`
- [x] Days harus positif; days ≤ 0 ditolak, bukan membuat masa aktif yang sudah lewat

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_subscriptions_service.py -q` hijau
- [x] Test: dua grant dengan `transaction_id` sama menghasilkan satu baris
- [x] Test: grant kedua dengan `transaction_id` berbeda menghasilkan baris kedua,
      dan `MAX(expires_at)` memilih yang panjang
- [x] Test: `days=0` dan `days=-1` ditolak

**Dependencies:** None

**Files likely touched:**
- `backend/api/services/subscriptions.py`
- `backend/tests/test_subscriptions_service.py`
- `backend/tests/conftest.py` (fake pool recognising `INSERT INTO subscriptions`)

**Estimated scope:** M

---

## Task 2: Beri langganan tanpa pembayaran

**Deskripsi:** Endpoint admin untuk memberi masa aktif secara manual. Ini bukan bonus
dan bukan komisi — ini satu-satunya cara seseorang boleh punya Subscription di
instalasi yang belum punya pembayaran, dan cara operator membuka akses untuk
dirinya sendiri.

**Acceptance criteria:**
- [x] `POST /v1/admin/accounts/{account_id}/subscription` menerima hari dan opsional
      alasan, dan memanggil `grant()`
- [x] `require_admin`, bukan `require_entitlement` (aturan 6) — admin tanpa
      langganan tetap boleh memanggilnya
- [x] Non-admin mendapat **403**, bukan 402
- [x] Akun yang diblokir masih boleh diberi langganan — blokir mengatur akses,
      bukan hak Kauf (aturan 8)
- [x] Tidak ada kolom status baru di mana pun

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_admin_subscription.py -q` hijau
- [x] Test: setelah grant, `GET /v1/subscription/current` untuk akun itu
      melaporkan `active: true`
- [x] Test: akun yang sama diberi dua kali, `expires_at` tidak bergeser — masa
      kedua menambah baris baru
- [x] Manual check: `GET /v1/signals` untuk akun itu berhenti membalas 402
      (`test_the_paid_data_stops_refusing_after_the_grant`, 402 → grant → 200)

**Dependencies:** Task 1

**Files likely touched:**
- `backend/api/routers/admin.py`
- `backend/tests/test_admin_subscription.py`

**Estimated scope:** S

### Checkpoint: Fase 1

- [x] `subscriptions` punya penulis untuk pertama kalinya
- [x] Idempoten terhadap `transaction_id` yang sama
- [x] Admin tanpa langganan tetap boleh memanggilnya (aturan 6)
- [x] `cd backend && .venv/bin/python -m pytest -q` hijau (suite penuh: 752 passed,
      coverage 67,7%; Postgres local di port 55432 dinyalakan untuk verifikasi)

---

## Fase 2: Rekening tujuan

Nominal sudah ada dan bisa diubah admin. Tanpa rekening tujuan, tidak ada yang
bisa ditransfer ke.

## Task 3: `bank_accounts` di `system_settings`

**Deskripsi:** Kunci kedua di `system_settings`, dengan bentuk JSON yang sudah
ditentukan blueprint: `[{bank, account_number, holder_name}]`. Service dengan
satu fungsi tulis, mengikuti pola `pricing`.

**Acceptance criteria:**
- [x] Baca dan tulis lewat `api/services/settings.py`, bukan SQL di router
- [x] Bentuk divalidasi: `bank`, `account_number`, dan `holder_name` wajib ada;
      nomor rekening hanya digit
- [x] Daftar kosong **ditolak** saat menulis — menyimpannya berarti menghapus
      semua rekening, dan itu harus jadi pilihan sadar, bukan hasil accident
- [x] Tidak ada kolom status di samping daftar
- [x] Kunci `contact_support` **tidak** ikut — masih tertunda, bukan satu bundel

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_bank_accounts.py -q` hijau
- [x] Test: daftar kosong ditolak
- [x] Test: nomor rekening dengan huruf ditolak
- [x] Test: hanya `pricing` yang terisi di migrasi — `test_system_settings_schema.py` masih hijau

**Dependencies:** Task 1

**Files likely touched:**
- `backend/api/services/settings.py`
- `backend/api/routers/pricing.py` atau router baru
- `backend/tests/test_bank_accounts.py`

**Estimated scope:** M

---

## Task 4: Rekening bisa diisi admin dan dibaca semua orang

**Deskripsi:** Tab di panel admin untuk mengisi rekening, dan tempat menampilkannya
bagi pembaca tanpa sesi — seperti endpoint harga, alasan yang sama: orang yang
memutuskan membayar belum pernah masuk.

**Acceptance criteria:**
- [x] Admin dapat menambah dan menghapus rekening dari `/admin`
- [x] Pembaca tanpa sesi dapat membaca daftar rekening
- [x] Rekening yang belum diisi ditampilkan sebagai "belum ada", bukan daftar
      kosong yang terlihat seperti daftar
- [x] Setelah simpan, layar memuat ulang dari server, bukan menampilkan input
      lokal
- [x] Tidak ada tombol "verifikasi rekening" — tidak ada yang diverifikasi

**Verification:**
- [x] `npx vitest run src/app/components/AdminBankAccountsView.test.tsx` hijau
- [x] `npx tsc --noEmit` bersih
- [x] Test: daftar kosong → "belum ada rekening tujuan", bukan `<ul>` kosong

**Dependencies:** Task 3

**Files likely touched:**
- `src/app/components/AdminBankAccountsView.tsx`
- `src/app/components/AdminBankAccountsView.test.tsx`
- `src/app/components/AdminView.tsx`
- `src/app/config/api.ts`

**Estimated scope:** M

### Checkpoint: Fase 2

- [x] Rekening bisa diisi dan diubah dari panel admin
- [x] Pembaca tanpa sesi bisa membaca rekening tujuan
- [x] Rekening kosong dijawab "belum ada", bukan daftar kosong
- [x] `cd backend && .venv/bin/python -m pytest -q` dan `npx vitest run` hijau

---

## Fase 3: Transfer manual

## Task 5: Pengguna menyatakan transfer

**Deskripsi:** `POST /v1/payments/manual` membuat baris `transaction` dengan
`payment_gateway = 'manual'` dan `status = 'pending'`. **Tidak** ada Subscription
yang dibuat — uangnya belum diverifikasi, dan masa aktif yang sudah ditulis tidak
bisa ditarik kembali.

**Acceptance criteria:**
- [x] `status` mulai dari `'pending'`, bukan `'settlement'`
- [x] `payment_gateway = 'manual'`, `payment_method` distinguishes
- [x] `amount` diambil dari harga server saat itu, **bukan** dari body
- [x] `invoice_code` unik dan dibuat server
- [x] Tidak ada baris `subscriptions` yang tercipta
- [x] Satu akun bisa punya beberapa transaksi pending — itu bukan error

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_manual_payment.py -q` hijau
- [x] Test: body mengarang `amount: 1`, baris tetap berisi harga sebenarnya
- [x] Test: setelah request, `GET /v1/subscription/current` masih `active: false`
- [x] Test: `invoice_code` yang sama ditolak

**Dependencies:** Tasks 1, 3

**Files likely touched:**
- `backend/api/routers/payments.py`
- `backend/tests/test_manual_payment.py`

**Estimated scope:** M

---

## Task 6: Antrean admin dan persetujuan

**Deskripsi:** Halaman antrean di `/admin` plus approve dan deny. Approve
mengubah status transaksi **dan** menulis Subscription dalam satu jalan; deny
tidak menyentuh Subscription yang sedang berjalan.

**Acceptance criteria:**
- [x] `GET /v1/admin/transactions?status=pending` dengan nomor, catatan, waktu,
      dan tanggal kedaluwarsa
- [x] `POST .../approve` menulis `settlement` + `approved_by` + `approved_at`
      dan memanggil `grant()` dalam **satu transaksi database**
- [x] `POST .../deny` menulis `deny` + alasan, dan **tidak** menyentuh langganan
- [x] Approve transaksi yang sudah `settlement` tidak menghasilkan Subscription kedua
- [x] **Approve transaksi `expire` tetap diizinkan.** Kedaluwarsa adalah kebersihan
      antrean, bukan vonis akhir atas uang — transfer jam 22.00 tidak boleh
      menggantung tanpa jalan pada 22.59
- [x] Approve atas akun yang diblokir tetap menulis langganan (aturan 8)
- [x] Non-admin mendapat **403**

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_admin_transactions.py -q` hijau
- [x] Test: approve → `GET /v1/subscription/current` melaporkan `active: true`
- [x] Test: approve dua kali → satu Subscription, dan dua grant kedua memakai
      transaksi berbeda
- [x] Test: deny tidak mengubah langganan yang sedang berjalan
- [x] Test: approve transaksi `expire` tetap menulis Subscription
- [x] Test: kegagalan di tengah tidak meninggalkan `settlement` tanpa Subscription
- [x] Manual check: `GET /v1/signals` berhenti membalas 402 setelah approve

**Dependencies:** Tasks 1, 5

**Files likely touched:**
- `backend/api/routers/admin.py`
- `backend/api/services/subscriptions.py`
- `backend/tests/test_admin_transactions.py`

**Estimated scope:** M

---

## Task 7: "Sedang diverifikasi" dan transaksi pending di Tab 2

**Deskripsi:** Setelah declare, orang perlu tahu di mana pembeliannya berada. Tab 2
Settings sudah jadi tempat yang tepat — itu tab langganan.

**Acceptance criteria:**
- [x] Tab 2 menampilkan transaksi `pending` milik akun itu, dengan nominal dan waktu
- [x] Status **tidak** memblokir akses: akun tanpa langganan yang sedang
      menunggu verifikasi tetap bisa masuk dan melihat apa yang terjadi
- [x] Transaksi yang ditolak tampil sebagai ditolak, bukan menghilang
- [x] Tidak ada nomor rekening rekening hardcoded di frontend — semuanya dari server

**Verification:**
- [x] `npx vitest run src/app/components/SettingsView.test.tsx` hijau
- [x] Test: transaksi pending tampil, dan teksnya menyatakan akses belum aktif
- [x] `npx tsc --noEmit` bersih

**Dependencies:** Tasks 5, 6

**Files likely touched:**
- `src/app/components/SettingsView.tsx`
- `src/app/components/SettingsView.test.tsx`
- `src/app/hooks/usePayments.ts`

**Estimated scope:** M

---

## Task 8: Transaksi manual yang menggantung kedaluwarsa

**Deskripsi:** Transaksi `pending` yang tidak pernah disetujui akan menumpuk tanpa
batas. Beat menjadwalkannya `expire`. **Tenggatnya satu jam** (keputusan pemilik),
dan angka itu konfigurasi — bukan literal di dalam fungsi — supaya bisa diubah
tanpa menyentuh kode.

Satu jam tidak banyak, dan itu pilihan yang sadar. Yang membuatnya aman bukan
melonggarkan kendali, melainkan aturan di bawah: `expire` menghentikan tawaran,
bukan menutup pintu.

**Acceptance criteria:**
- [x] Ada task beat yang mengubah `pending` yang sudah lewat satu jam menjadi `expire`
- [x] `MANUAL_TRANSACTION_TTL_SECONDS` di konfigurasi, default 3600 — dinaikkan ke **86400 (24 jam)** di tinjauan 2026-10-18
- [x] Idempoten — menjalankan dua kali tidak mengubah apa pun
- [x] Hanya `pending` yang terpengaruh; `settlement` tidak pernah disentuh
- [x] Tidak ada Subscription yang dibuat atau dihapus
- [x] **`expire` bukan kondisi final.** Approve terhadap baris `expire` tetap
      menulis Subscription (Task 6). Kalau tidak, transfer di luar jam kerja akan
      menelan uang seseorang tanpa jejak — dan tidak ada tempat untuk melapor

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_transaction_expiry.py -q` hijau
- [x] Test: `pending` yang sudah lewat satu jam menjadi `expire`
- [x] Test: `pending` yang belum satu jam **tidak** berubah
- [x] Test: `settlement` lama tidak diubah
- [x] Test: menjalankan dua kali menghasilkan hasil yang sama
- [x] Test: approve setelah `expire` tetap menghasilkan Subscription
- [x] Test: `test_beat_schedule.py` masih hijau

**Dependencies:** Task 5

**Files likely touched:**
- `backend/workers/payment_worker.py`
- `backend/workers/celery_app.py`
- `backend/api/core/config.py`
- `backend/tests/test_transaction_expiry.py`

**Estimated scope:** M

### Checkpoint: Fase 3

- [x] Approve menulis Subscription dan mengubah status dalam satu jalan
- [x] Deny tidak menyentuh Subscription yang sedang berjalan
- [x] Transaksi expired tidak memblokir apa pun
- [x] Alur lengkap bisa dicoba tanpa gerbang pihak ketiga
- [x] `cd backend && .venv/bin/python -m pytest -q` dan `npx vitest run` hijau

---

## Fase 4: Gerbang dan QRIS dinamis

**SELESAI (2026-10-19).** Kredensial masuk lewat `backend/.env` — `MIDTRANS_SERVER_KEY`
(Sandbox) + `MIDTRANS_IS_PRODUCTION=false` — dan diverifikasi langsung dengan uji asap
pembuatan snap token ke sandbox Midtrans: `HTTP 201`, token + `redirect_url` diterima.
Keputusan handover yang dipilih pemilik: **`redirect_url`**, bukan Snap popup —
sehingga tidak ada Client Key yang terekspos ke frontend dan tidak ada `snap.js`.

Deviasi dari rincian di bawah (dipilih, bukan lupa):

- File tes bukan `test_midtrans_checkout.py`/`test_midtrans_webhook.py`
  terpisah, melainkan satu `tests/test_payments_gateway.py` (11 tes, terhadap
  fake identity pool, tanpa jaringan sungguhan).
- Layar checkout bukan `CheckoutView.tsx` — kartu **"Bayar lewat Midtrans"**
  di dalam Tab 2 Settings di bawah formulir transfer manual, tombol membuka
  tab baru ke `redirectUrl`. `App.tsx` tidak berubah (tidak ada route baru —
  keputusan berbeli tetap di dalam aplikasi).
- `midtrans_transaction_id` diisi **webhook** saat settlement/deny/expire
  (id-nya Midtrans yang memberi, bukan saat checkout), dan mimpi baris
  `pending` saat Midtrans menolak dipenuhi dengan urutan: page minted dulu,
  baris ditulis kemudian.

## Task 9: Konfigurasi dan pembuatan snap

**Deskripsi:** `POST /v1/payments/checkout` membuat `transaction` berstatus
`pending` lalu meminta snap token ke Midtrans. **Subscription belum dibuat.**

**Acceptance criteria:**
- [x] `ServerKey` dari konfigurasi, tidak pernah dari body atau query
- [x] `amount` dari harga server; `payment_gateway = 'midtrans'`
- [x] `midtrans_transaction_id` terisi dan unik — oleh webhook; kunci
      `uq_transactions_midtrans_transaction_id` menjaga satu payment Midtrans
      dari mengalias jadi baris lain
- [x] Kalau Midtrans menolak, tidak ada baris `pending` yang menggantung —
      halaman dimintakan **sebelum** INSERT; kegagalan mint dites tidak
      meninggalkan apa pun
- [x] Tidak ada Subscription yang tercipta

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_payments_gateway.py -q` hijau
- [x] Test: kegagalan Midtrans tidak meninggalkan transaksi menggantung

**Dependencies:** Task 1, **MIDTRANS_SERVER_KEY** — kedua-duanya sudah hadir

**Files touched:**
- `backend/api/config.py` → `backend/api/core/config.py` + `.env.example` (2 field baru)
- `backend/api/services/midtrans.py` (transport: mint + verifikasi signature)
- `backend/api/services/payments.py` (`open_gateway_transaction`, baris
  gateway dari satu penulis tabel yang sama)
- `backend/api/routers/payments_gateway.py` (router sendiri, **tanpa**
  dependensi auth lintas router — webhook tidak bisa memegang sesi)
- `backend/tests/test_payments_gateway.py`

**Estimated scope:** M

---

## Task 10: Webhook

**Deskripsi:** `POST /v1/payments/midtrans/webhook`. Dua pemeriksaan wajib, bukan
salah satu: signature SHA-512, dan nominal yang cocok.

**Acceptance criteria:**
- [x] Signature diverifikasi dengan `SHA512(order_id + status_code + gross_amount + ServerKey)`
- [x] `gross_amount` harus sama dengan `amount` baris — tidak cocok berarti menolak
- [x] Webhook berulang untuk `midtrans_transaction_id` yang sama tidak menulis
      Subscription kedua, dan tetap dijawab **200**
- [x] `subscription_id` terisi hanya pada transisi pertama ke `settlement`
- [x] Signature salah dan nominal salah sama-sama ditolak, dan tercatat

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_payments_gateway.py -q` hijau
- [x] Test: webhook identik dikirim ulang → satu Subscription (tes replay tersedia)
- [x] Test: `gross_amount` 1.00 untuk baris 15000 → ditolak 200 + `amount-mismatch`, tidak ada Subscription
- [x] Test: signature salah → **403** sebelum apa pun dibaca, status baris tidak berubah
- [x] Manual check: `GET /v1/signals` — digantikan dengan padanan otomatis dalam
      suite: settlement menulis via `grant()` (penulis yang sama seperti approve
      admin), dan kaki gerbang entitlement menghitung dari `subscriptions.expires_at`
      — berarti 402 hilang pada permintaan berikutnya. Baris `payments/me`
      berubah menjadi `settlement` di layar.

**Dependencies:** Task 9

**Files touched:**
- `backend/api/routers/payments_gateway.py`
- `backend/api/services/midtrans.py`
- `backend/tests/test_payments_gateway.py`

**Estimated scope:** M

---

## Task 11: Halaman checkout

**Deskripsi:** Halaman yang memanggil snap dan mengarahkan ke status setelahnya.
Dilaksanakan sebagai **kartu di dalam Tab 2** (handover `redirect_url`): tombol
membuka halaman Midtrans di tab baru; statusnya tumbuh di daftar milik sendiri.

**Acceptance criteria:**
- [x] Checkout adalah **langkah sendiri** setelah pendaftaran, bukan bagian dari
      nya — `test_signup_path_is_canonical` tetap hijau
- [x] Tidak ada tombol yang terlihat hidup tanpa jalan di belakangnya — tanpa
      kunci di server, kartu tetap ada tapi jawabannya statemen 503, bukan
      jendela kosong (`test_an_install_...aloud`)
- [x] Kehilangan focus jaringan tidak menghapus apa pun yang sudah dibuat —
      kegagalan jaringan dinyatakan di kartu; baris `pending` yang server sunting
      tetap daftar di bawah
- [x] Setelah `pending`, pengguna diberi tahu di mana pembayarannya berada —
      kop kartu: statusnya masuk daftar di bawah, dan akses menyala ketika
      pembayaran diterima

**Verification:**
- [x] `npx vitest run` hijau — **329 passed** (3 tes baru
      `SettingsViewGateway.test.tsx`)
- [x] `cd backend && .venv/bin/python -m pytest tests/test_docs_status.py -q` hijau

**Dependencies:** Task 9

**Files touched:**
- `src/app/components/SettingsView.tsx` (kartu "Bayar lewat Midtrans")
- `src/app/hooks/usePayments.ts` (`checkout`, `checkoutBusy`, `checkoutError`,
  tipe `CheckoutPage`)
- `src/app/config/api.ts` (`paymentsCheckout`)
- `src/app/components/SettingsViewGateway.test.tsx`

**Estimated scope:** M

### Checkpoint: Fase 4

- [x] Webhook berulang tidak menghasilkan Subscription kedua
- [x] Signature salah ditolak
- [x] Nominal tidak cocok ditolak
- [x] `cd backend && .venv/bin/python -m pytest -q` dan `npx vitest run` hijau —
      **878 passed** (coverage 69,21%) dan **329 passed**

---

## Fase 5: Bukti dan dokumen

## Task 12: `docs/status.md` dan ADR

**Deskripsi:** `transactions` dan `subscriptions` berhenti jadi tabel yang tidak
ada penulisnya, dan batas Fase 2–4 tercatat apa adanya.

**Acceptance criteria:**
- [x] `docs/status.md` mencatat siapa yang menulis `subscriptions` sekarang
- [x] `transactions.proof_image_url` dicatat sebagai kolom yang **tidak** diisi —
      sengaja, bukan oversight
- [x] Admin manual, transfer manual, dan gerbang dicatat apa adanya
- [x] ADR-0011 merekam keputusan satu penulis dan idempotensi di baris Transaction
- [x] `backend/tests/test_docs_status.py` hijau

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_docs_status.py -q` hijau
- [x] `git ls-files` mengonfirmasi setiap path yang diklaim ada

**Dependencies:** Tasks 1–11

**Files likely touched:**
- `docs/status.md`
- `docs/adr/0011-*.md`
- `docs/adr/README.md`

**Estimated scope:** S

### Checkpoint: Lengkap

- [x] Semua acceptance criteria di atas terpenuhi
- [x] `cd backend && .venv/bin/python -m pytest -q` hijau — 813 passed, coverage 68.77%
- [x] `cd backend && .venv/bin/python -m ruff check .` bersih
- [x] `npx tsc --noEmit`, `npx eslint src`, `npx vitest run` hijau — 306 passed
- [x] `git diff` tidak menambah kolom status ke `subscriptions`, dan tidak
      memblokir akses berdasarkan status pembayaran (aturan 1 dan 3)
- [x] Tinjau dengan manusia

---

## Fase 5 — Tiga slot paket: mingguan, bulanan, tahunan (2026-10-19)

**Task 12 — Backend slot ketiga:**
- [x] `backend/api/services/settings.py`: `Pricing` + `weekly`; `_validate`
      tiga field; `read_pricing` menuntut tiga kunci ("three usable prices",
      pecahah ditolak); `write_pricing(weekly, monthly, annual)` satu
      pernyataan tetap tiga kunci sekaligus
- [x] `backend/api/services/payments.py`: `PLAN_DAYS = {"weekly": 7, ...}`;
      `_plan_amount()` mengganti if/else dua-slot di titik nominal manual dan
      gateway; komentar kosakata diperbarui
- [x] Router `pricing.py` & `admin.py`: respons tiga harga; PUT wajib tiga —
      body parsial ditolak; docstring "Both prices" → "All three prices"

**Task 13 — Migrasi dan skema:**
- [x] `0014_pricing_weekly.sql`: CHECK `plan IN ('weekly','monthly','annual')`
      + keputusan harga (15rb/44rb/252rb) ke baris pricing yang masih seed
      0011; idempoten; baris kustom hanya mendapat kunci `weekly`
- [x] `schema.sql`: seed tiga-kunci + CHECK disamakan
- [x] `docs/saas-subscription-platform.md`: DDL plan tiga slot (dikunci
      `test_docs_status`), tabel harga 1.2, seed, radio checkout, penutup

**Task 14 — Frontend tiga slot:**
- [x] `usePayments.ts`: union `"weekly" | "monthly" | "annual"` di checkout
- [x] `SettingsView.tsx`: state/tipe + angka tiga; radio "Mingguan" di kedua
      kartu (default tetap bulanan); kalimat harga "Mingguan, bulanan, dan
      tahunan, dari server"
- [x] `PublicPricing.tsx`: tiga baris harga + kalimat pembayaran tak lagi
      transfer-saja; `AdminPricingView.tsx`: input mingguan, restore
      dan save tiga nilai

**Task 15 — Tes:**
- [x] `test_pricing_service.py`: seed disusun dari 0011+0014; kasus
      out-of-range mingguan; tulis tiga harga
- [x] `test_pricing_api.py`: body tiga kunci, default 44rb/252rb, PUT parsial
      422 tetap teruji
- [x] `test_payments_gateway.py`: checkout mingguan mengambil 15rb; plan
      `daily` ditolak sebelum manggil gateway
- [x] `test_manual_payment.py`: deklarasi mingguan ber-nominal mingguan;
      `daily` ditolak
- [x] `test_system_settings_schema.py + conftest`: seed & mirror konsisten

**Task 16 — Dokumen:**
- [x] `legal-and-consent.md`: §3.1 ID/EN tiga paket; versi dokumen 0.3.0-draft
- [x] `settings-module-spec.md`: pembilang harga di kalimat pembuka
- [x] `docs/status.md`: baris harga, endpoint publik, PUT admin, form admin,
      harga Tab 2

**Acceptance criteria:**
- [x] Tiga slot muncul di semua layar yang memilih paket; durasi 7/30/365
      hari datang dari satu sumber (`PLAN_DAYS`)
- [x] Harga tetap bisa diubah admin lewat panel; migrasi hanya membawa
      keputusan awal
- [x] Install lama tidak rusak setelah migrasi (baris pricing tiga kunci,
      CHECK memuat mingguan)
- [x] `docs/status.md` dan blueprint menyebut apa yang benar-benar ada

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests -q` — **890 passed**,
      coverage 69,24%
- [x] `cd backend && .venv/bin/python -m ruff check .` — All checks passed
- [x] `npx vitest run` — **329 passed** (30 berkas); `npx tsc --noEmit`
      bersih; `npx eslint src` — 10 warning pra-ada, 0 error
- [x] `pytest tests/test_docs_status.py` hijau (DDL plan = schema.sql)

**Dependencies:** Tasks 1–11 (Fase 1–4)

**Files touched:** `backend/api/services/settings.py`,
`backend/api/services/payments.py`, `backend/api/routers/pricing.py`,
`backend/api/routers/admin.py`, `backend/db/migrations/0014_pricing_weekly.sql`,
`backend/db/schema.sql`, `backend/tests/conftest.py`,
`backend/tests/test_pricing_service.py`, `backend/tests/test_pricing_api.py`,
`backend/tests/test_payments_gateway.py`,
`backend/tests/test_manual_payment.py`,
`backend/tests/test_admin_transactions.py`,
`backend/tests/test_system_settings_schema.py`,
`src/app/hooks/usePayments.ts`, `src/app/components/SettingsView.tsx`,
`src/app/components/PublicPricing.tsx`,
`src/app/components/AdminPricingView.tsx`, tes frontend terkait,
`docs/saas-subscription-platform.md`, `docs/legal-and-consent.md`,
`docs/settings-module-spec.md`, `docs/status.md`, dokumen tugas ini.