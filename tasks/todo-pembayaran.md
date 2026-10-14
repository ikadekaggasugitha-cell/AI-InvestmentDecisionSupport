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
- [ ] `grant()` adalah satu-satunya tempat yang menulis tabel `subscriptions`
- [ ] `expires_at` dihitung dari waktu grant, dan baris lama tidak pernah diubah
- [ ] Idempoten terhadap `transaction_id` yang sama — dipanggil dua kali, hasilnya
      satu baris
- [ ] Mengembalikan baris Subscription yang dibuat, bukan hanya `True`
- [ ] Days harus positif; days ≤ 0 ditolak, bukan membuat masa aktif yang sudah lewat

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_subscriptions_service.py -q` hijau
- [ ] Test: dua grant dengan `transaction_id` sama menghasilkan satu baris
- [ ] Test: grant kedua dengan `transaction_id` berbeda menghasilkan baris kedua,
      dan `MAX(expires_at)` memilih yang panjang
- [ ] Test: `days=0` dan `days=-1` ditolak

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
- [ ] `POST /v1/admin/accounts/{account_id}/subscription` menerima hari dan opsional
      alasan, dan memanggil `grant()`
- [ ] `require_admin`, bukan `require_entitlement` (aturan 6) — admin tanpa
      langganan tetap boleh memanggilnya
- [ ] Non-admin mendapat **403**, bukan 402
- [ ] Akun yang diblokir masih boleh diberi langganan — blokir mengatur akses,
      bukan hak Kauf (aturan 8)
- [ ] Tidak ada kolom status baru di mana pun

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_admin_subscription.py -q` hijau
- [ ] Test: setelah grant, `GET /v1/subscription/current` untuk akun itu
      melaporkan `active: true`
- [ ] Test: akun yang sama diberi dua kali, `expires_at` tidak bergeser — masa
      kedua menambah baris baru
- [ ] Manual check: `GET /v1/signals` untuk akun itu berhenti membalas 402

**Dependencies:** Task 1

**Files likely touched:**
- `backend/api/routers/admin.py`
- `backend/tests/test_admin_subscription.py`

**Estimated scope:** S

### Checkpoint: Fase 1

- [ ] `subscriptions` punya penulis untuk pertama kalinya
- [ ] Idempoten terhadap `transaction_id` yang sama
- [ ] Admin tanpa langganan tetap boleh memanggilnya (aturan 6)
- [ ] `cd backend && .venv/bin/python -m pytest -q` hijau

---

## Fase 2: Rekening tujuan

Nominal sudah ada dan bisa diubah admin. Tanpa rekening tujuan, tidak ada yang
bisa ditransfer ke.

## Task 3: `bank_accounts` di `system_settings`

**Deskripsi:** Kunci kedua di `system_settings`, dengan bentuk JSON yang sudah
ditentukan blueprint: `[{bank, account_number, holder_name}]`. Service dengan
satu fungsi tulis, mengikuti pola `pricing`.

**Acceptance criteria:**
- [ ] Baca dan tulis lewat `api/services/settings.py`, bukan SQL di router
- [ ] Bentuk divalidasi: `bank`, `account_number`, dan `holder_name` wajib ada;
      nomor rekening hanya digit
- [ ] Daftar kosong **ditolak** saat menulis — menyimpannya berarti menghapus
      semua rekening, dan itu harus jadi pilihan sadar, bukan hasil accident
- [ ] Tidak ada kolom status di samping daftar
- [ ] Kunci `contact_support` **tidak** ikut — masih tertunda, bukan satu bundel

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_bank_accounts.py -q` hijau
- [ ] Test: daftar kosong ditolak
- [ ] Test: nomor rekening dengan huruf ditolak
- [ ] Test: hanya `pricing` yang terisi di migrasi — `test_system_settings_schema.py` masih hijau

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
- [ ] Admin dapat menambah dan menghapus rekening dari `/admin`
- [ ] Pembaca tanpa sesi dapat membaca daftar rekening
- [ ] Rekening yang belum diisi ditampilkan sebagai "belum ada", bukan daftar
      kosong yang terlihat seperti daftar
- [ ] Setelah simpan, layar memuat ulang dari server, bukan menampilkan input
     lokal
- [ ] Tidak ada tombol "verifikasi rekening" — tidak ada yang diverifikasi

**Verification:**
- [ ] `npx vitest run src/app/components/AdminBankAccountsView.test.tsx` hijau
- [ ] `npx tsc --noEmit` bersih
- [ ] Test: daftar kosong → "belum ada rekening tujuan", bukan `<ul>` kosong

**Dependencies:** Task 3

**Files likely touched:**
- `src/app/components/AdminBankAccountsView.tsx`
- `src/app/components/AdminBankAccountsView.test.tsx`
- `src/app/components/AdminView.tsx`
- `src/app/config/api.ts`

**Estimated scope:** M

### Checkpoint: Fase 2

- [ ] Rekening bisa diisi dan diubah dari panel admin
- [ ] Pembaca tanpa sesi bisa membaca rekening tujuan
- [ ] Rekening kosong dijawab "belum ada", bukan daftar kosong
- [ ] `cd backend && .venv/bin/python -m pytest -q` dan `npx vitest run` hijau

---

## Fase 3: Transfer manual

## Task 5: Pengguna menyatakan transfer

**Deskripsi:** `POST /v1/payments/manual` membuat baris `transaction` dengan
`payment_gateway = 'manual'` dan `status = 'pending'`. **Tidak** ada Subscription
yang dibuat — uangnya belum diverifikasi, dan masa aktif yang sudah ditulis tidak
bisa ditarik kembali.

**Acceptance criteria:**
- [ ] `status` mulai dari `'pending'`, bukan `'settlement'`
- [ ] `payment_gateway = 'manual'`, `payment_method` distinguishes
- [ ] `amount` diambil dari harga server saat itu, **bukan** dari body
- [ ] `invoice_code` unik dan dibuat server
- [ ] Tidak ada baris `subscriptions` yang tercipta
- [ ] Satu akun bisa punya beberapa transaksi pending — itu bukan error

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_manual_payment.py -q` hijau
- [ ] Test: body mengarang `amount: 1`, baris tetap berisi harga sebenarnya
- [ ] Test: setelah request, `GET /v1/subscription/current` masih `active: false`
- [ ] Test: `invoice_code` yang sama ditolak

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
- [ ] `GET /v1/admin/transactions?status=pending` dengan nomor, catatan, waktu,
      dan tanggal kedaluwarsa
- [ ] `POST .../approve` menulis `settlement` + `approved_by` + `approved_at`
      dan memanggil `grant()` dalam **satu transaksi database**
- [ ] `POST .../deny` menulis `deny` + alasan, dan **tidak** menyentuh langganan
- [ ] Approve transaksi yang sudah `settlement` tidak menghasilkan Subscription kedua
- [ ] Approve atas akun yang diblokir tetap menulis langganan (aturan 8)
- [ ] Non-admin mendapat **403**

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_admin_transactions.py -q` hijau
- [ ] Test: approve → `GET /v1/subscription/current` melaporkan `active: true`
- [ ] Test: approve dua kali → satu Subscription, dan dua grant kedua memakai
      transaksi berbeda
- [ ] Test: deny tidak mengubah langganan yang sedang berjalan
- [ ] Test: kegagalan di tengah tidak meninggalkan `settlement` tanpa Subscription
- [ ] Manual check: `GET /v1/signals` berhenti membalas 402 setelah approve

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
- [ ] Tab 2 menampilkan transaksi `pending` milik akun itu, dengan nominal dan waktu
- [ ] Status **tidak** memblokir akses: akun tanpa langganan yang sedang
      menunggu verifikasi tetap bisa masuk dan melihat apa yang terjadi
- [ ] Transaksi yang ditolak tampil sebagai ditolak, bukan menghilang
- [ ] Tidak ada nomor rekening rekening hardcoded di frontend — semuanya dari server

**Verification:**
- [ ] `npx vitest run src/app/components/SettingsView.test.tsx` hijau
- [ ] Test: transaksi pending tampil, dan teksnya menyatakan akses belum aktif
- [ ] `npx tsc --noEmit` bersih

**Dependencies:** Tasks 5, 6

**Files likely touched:**
- `src/app/components/SettingsView.tsx`
- `src/app/components/SettingsView.test.tsx`
- `src/app/hooks/usePayments.ts`

**Estimated scope:** M

---

## Task 8: Transaksi manual yang menggantung kedaluwarsa

**Deskripsi:** Transaksi `pending` yang tidak pernah disetujui akan menumpuk tanpa
batas. Beat menjadwalkannya `expire` setelah sejumlah hari.

**Acceptance criteria:**
- [ ] Ada task beat yang mengubah `pending` yang sudah lewat tenggat menjadi `expire`
- [ ] Idempoten — menjalankan dua kali tidak mengubah apa pun
- [ ] Hanya `pending` yang terpengaruh; `settlement` tidak pernah disentuh
- [ ] Tidak ada Subscription yang created atau dihapus
- [ ] Nilai tenggat berasal dari konfigurasi, bukan literal di dalam fungsi

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_transaction_expiry.py -q` hijau
- [ ] Test: `settlement` lama tidak diubah
- [ ] Test: menjalankan dua kali menghasilkan hasil yang sama
- [ ] Test: `test_beat_schedule.py` masih hijau

**Dependencies:** Task 5

**Files likely touched:**
- `backend/workers/payment_worker.py`
- `backend/workers/celery_app.py`
- `backend/api/core/config.py`
- `backend/tests/test_transaction_expiry.py`

**Estimated scope:** M

### Checkpoint: Fase 3

- [ ] Approve menulis Subscription dan mengubah status dalam satu jalan
- [ ] Deny tidak menyentuh Subscription yang sedang berjalan
- [ ] Transaksi expired tidak memblokir apa pun
- [ ] Alur lengkap bisa dicoba tanpa gerbang pihak ketiga
- [ ] `cd backend && .venv/bin/python -m pytest -q` dan `npx vitest run` hijau

---

## Fase 4: Gerbang dan QRIS dinamis

**BLOCKED sampai `MIDTRANS_SERVER_KEY` dan akun aktif tersedia.** Fase 1–3 tidak
perlu apa pun dari pihak ketiga. Jangan mulai fase ini lebih dulu — setiap test
yang bisa ditulis tanpa kredensial hanya akan menguji mock.

## Task 9: Konfigurasi dan pembuatan snap

**Deskripsi:** `POST /v1/payments/checkout` membuat `transaction` berstatus
`pending` lalu meminta snap token ke Midtrans. **Subscription belum dibuat.**

**Acceptance criteria:**
- [ ] `ServerKey` dari konfigurasi, tidak pernah dari body atau query
- [ ] `amount` dari harga server; `payment_gateway = 'midtrans'`
- [ ] `midtrans_transaction_id` terisi dan unik
- [ ] Kalau Midtrans menolak, tidak ada baris `pending` yang menggantung
- [ ] Tidak ada Subscription yang tercipta

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_midtrans_checkout.py -q` hijau
- [ ] Test: kegagalan Midtrans tidak meninggalkan transaksi menggantung

**Dependencies:** Task 1, **MIDTRANS_SERVER_KEY**

**Files likely touched:**
- `backend/api/routers/payments.py`
- `backend/api/services/midtrans.py`
- `backend/api/core/config.py`

**Estimated scope:** M

---

## Task 10: Webhook

**Deskripsi:** `POST /v1/payments/midtrans/webhook`. Dua pemeriksaan wajib, bukan
salah satu: signature SHA-512, dan nominal yang cocok.

**Acceptance criteria:**
- [ ] Signature diverifikasi dengan `SHA512(order_id + status_code + gross_amount + ServerKey)`
- [ ] `gross_amount` harus sama dengan `amount` baris — tidak cocok berarti menolak
- [ ] Webhook berulang untuk `midtrans_transaction_id` yang sama tidak menulis
      Subscription kedua, dan tetap dijawab **200**
- [ ] `subscription_id` terisi hanya pada transisi pertama ke `settlement`
- [ ] Signature salah dan nominal salah sama-sama ditolak, dan tercatat

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_midtrans_webhook.py -q` hijau
- [ ] Test: webhook identik dikirim lima kali → satu Subscription
- [ ] Test: `gross_amount` 1000 untuk baris 15000 → ditolak, tidak ada Subscription
- [ ] Test: signature salah → ditolak, status baris tidak berubah
- [ ] Manual check: `GET /v1/signals` berhenti membalas 402 setelah webhook

**Dependencies:** Task 9

**Files likely touched:**
- `backend/api/routers/payments.py`
- `backend/api/services/midtrans.py`
- `backend/tests/test_midtrans_webhook.py`

**Estimated scope:** M

---

## Task 11: Halaman checkout

**Deskripsi:** Halaman yang memanggil snap dan mengarahkan ke status setelahnya.

**Acceptance criteria:**
- [ ] Checkout adalah **langkah sendiri** setelah pendaftaran, bukan bagian dari
     nya — `test_signup_path_is_canonical` tetap hijau
- [ ] Tidak ada tombol yang terlihat hidup tanpa jalan di belakangnya
- [ ] Kehilangan focus jaringan tidak menghapus apa pun yang sudah dibuat
- [ ] Setelah `pending`, pengguna diberi tahu di mana pembayarannya berada

**Verification:**
- [ ] `npx vitest run` hijau
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_docs_status.py -q` hijau

**Dependencies:** Task 9

**Files likely touched:**
- `src/app/components/CheckoutView.tsx`
- `src/app/components/CheckoutView.test.tsx`
- `src/app/App.tsx`

**Estimated scope:** M

### Checkpoint: Fase 4

- [ ] Webhook berulang tidak menghasilkan Subscription kedua
- [ ] Signature salah ditolak
- [ ] Nominal tidak cocok ditolak
- [ ] `cd backend && .venv/bin/python -m pytest -q` dan `npx vitest run` hijau

---

## Fase 5: Bukti dan dokumen

## Task 12: `docs/status.md` dan ADR

**Deskripsi:** `transactions` dan `subscriptions` berhenti jadi tabel yang tidak
ada penulisnya, dan batas Fase 2–4 tercatat apa adanya.

**Acceptance criteria:**
- [ ] `docs/status.md` mencatat siapa yang menulis `subscriptions` sekarang
- [ ] `transactions.proof_image_url` dicatat sebagai kolom yang **tidak** diisi —
      sengaja, bukan oversight
- [ ] Admin manual, transfer manual, dan gerbang dicatat apa adanya
- [ ] ADR-0011 merekam keputusan satu penulis dan idempotensi di baris Transaction
- [ ] `backend/tests/test_docs_status.py` hijau

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_docs_status.py -q` hijau
- [ ] `git ls-files` mengonfirmasi setiap path yang diklaim ada

**Dependencies:** Tasks 1–11

**Files likely touched:**
- `docs/status.md`
- `docs/adr/0011-*.md`
- `docs/adr/README.md`

**Estimated scope:** S

### Checkpoint: Lengkap

- [ ] Semua acceptance criteria di atas terpenuhi
- [ ] `cd backend && .venv/bin/python -m pytest -q` hijau
- [ ] `cd backend && .venv/bin/python -m ruff check .` bersih
- [ ] `npx tsc --noEmit`, `npx eslint src`, `npx vitest run` hijau
- [ ] `git diff` tidak menambah kolom status ke `subscriptions`, dan tidak
      memblokir akses berdasarkan status pembayaran (aturan 1 dan 3)
- [ ] Tinjau dengan manusia