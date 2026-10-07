# Task List: Menutup Sisa Gap yang Tidak Tertunda ke Fase 2

Rencana lengkap: [plan.md](plan.md). Baca `plan.md` dulu untuk keputusan arsitektur
dan batasan scope.

Perintah verifikasi yang dipakai di bawah ini:

```bash
# Backend
cd backend && .venv/bin/python -m pytest -q
cd backend && .venv/bin/python -m ruff check .

# Frontend
npx tsc --noEmit
npx vitest run
npx eslint src

# Migrasi
cd backend && .venv/bin/python -m db.migrate --status
```

---

## Fase 1: Dokumen yang Sudah Salah


## Task 1: Perbaiki baris `docs/status.md` yang stale

**Deskripsi:** `docs/status.md` adalah SSOT, tapi beberapa baris sudah tidak cocok
dengan kode. Yang terverifikasi salah: "Pembersihan sesi otomatis | Belum | belum ada
skrip" — CLI-nya sudah ada di `backend/db/purge_sessions.py` lengkap dengan tesnya.
Baris lain perlu diperiksa ulang satu per satu, bukan diasumsikan benar.

**Acceptance criteria:**
- [x] Setiap baris tabel "Yang Belum Ada" diverifikasi ulang terhadap kodenya, dan yang sudah ada dipindahkan ke tabel "Yang Sudah Ada"
- [x] Baris tentangipur sesi otomatis tidak lagi menyatakan tidak ada skrip
- [x] `docs/settings-module-spec.md` §12 tidak lagi menandai file yang tidak ada sebagai deliverable
- [x] Tidak ada baris di `docs/status.md` yang menyebut path yang tidak ada di repo

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_docs_status.py -q` hijau
- [x] `git ls-files` mengonfirmasi setiap path yang diklaim status.md memang ada
- [x] Manual check: baca setiap baris "Belum Ada" dan cari kodenya

**Dependencies:** None

**Files likely touched:**
- `docs/status.md`
- `docs/settings-module-spec.md`

**Estimated scope:** S


## Task 2: Bersihkan alias `localStorage` — DIBATALKAN

**Dibatalkan 2026-10-07 setelah verifikasi.** Plan ini salah soal premisnya: alias
`aidss-portfolio` tidak ditulis dan tidak dirujuk kode mana pun sejak posisi pindah ke
server. Satu-satunya sebutan ada di `tasks/todo.md` ini. Yang tersisa hanya data lama
di peramban orang, yang tidak dibaca siapa pun.

**Keputusan owner: lewati.** Alasannya, supaya tidak diulang nanti:

- Datanya milik orang itu sendiri, di peramban sendiri. Ini bukan kebocoran.
- `removeItem` permanen adalah kode yang satu-satunya tugasnya menghapus data yang
  tidak dipakai — lengkap dengan tesnya, dan tidak akan bisa dihapus lagi.
- `aidss_token` diperiksa terpisah dan memang aman: `src/app/config/api.test.ts:15`
  sudah menjadi guard yang memastikan kode tidak pernah membacanya.

Dicatat di `docs/status.md` sebagai utang, dengan sifat sebenarnya.

## Checkpoint: Fase 1

- [x] Semua test hijau
- [x] `npx tsc --noEmit` bersih
- [x] Tidak ada klaim di dokumen yang lebih optimistis daripada kodenya
- [x] Tinjau dengan manusia sebelum lanjut

---

## Fase 2: Menulis `blocked_at`


## Task 3: Fungsi writer `blocked_at` di `accounts.py`

**Deskripsi:** Menambahkan `set_blocked_state()` ke `accounts.py`. Satu fungsi,
dipakai dua arah (blokir dan buka blokir), supaya tidak ada dua jalur menulis kolom
yang sama. `authenticate()` sudah membaca `blocked_at` dalam satu JOIN, jadi tidak
ada perubahan di jalur otorisasi.

**Acceptance criteria:**
- [x] Satu fungsi menerima `account_id` dan `blocked: bool`, atau `None` untuk buka blokir
- [x] Fungsi mengembalikan 404 kalau akun tidak ada — bukan diam-diam berhasil
- [x] Tidak ada `UPDATE users SET blocked_at` di tempat lain
- [x] Gagal database menjadi exception, bukan `None` yang disalahartikan sukses

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_identity_service.py -q` hijau
- [x] Test baru: akun tidak ada → 404; akun ada → kolom berubah; akun terblokir → bisa dibuka lagi
- [x] `grep -rn "blocked_at =" backend/api/` hanya menemukan fungsi ini

**Dependencies:** None

**Files likely touched:**
- `backend/api/services/accounts.py`
- `backend/tests/test_identity_service.py`

**Estimated scope:** S


## Task 4: Endpoint admin daftar akun, blokir, buka blokir

**Deskripsi:** Router `admin.py` dengan tiga endpoint, semuanya memakai `AdminUser`
yang sudah ada di `api/core/auth.py:135` tapi belum pernah dipakai. Path parameter
hanya UUID — email tidak boleh jadi parameter path karena berubah dan tidak unik
case-insensitive.

**Acceptance criteria:**
- [x] `GET /v1/admin/accounts` mengembalikan daftar akun dengan `role` dan status blokir
- [x] `POST /v1/admin/accounts/{id}/block` dan `DELETE` untuk buka blokir
- [x] Semua endpoint menolak akun non-admin dengan 403
- [x] Path parameter divalidasi sebagai UUID, dan nilai bukan UUID menghasilkan 422
- [x] `require_admin` benar-benar dipakai, bukan hanya tersedia

**Verification:**
- [x] Test: admin bisa memblokir akun lain; akun biasa mendapat 403; UUID ngawur mendapat 422
- [x] Test: admin tidak bisa memblokir dirinya sendiri, atau jawabannya disengaja dan tertulis
- [x] `cd backend && .venv/bin/python -m pytest tests/test_admin_api.py -q` hijau
- [x] `curl` manual: `/openapi.json` memuat ketiga endpoint

**Dependencies:** Task 3

**Files likely touched:**
- `backend/api/routers/admin.py` (baru)
- `backend/api/main.py` (Daftar router)
- `backend/tests/test_admin_api.py` (baru)

**Estimated scope:** M


## Task 5: Bukti blokir berlaku seketika di HTTP dan WebSocket

**Deskripsi:** Membuktikan aturan CONTEXT.md nomor 8 — menonaktifkan akses adalah
urusan Account, berlaku seketika. Tes harus gagal kalau `authenticate()` berhenti
memeriksa `blocked_at`, dan harus mencakup WebSocket karena jalurnya terpisah.

**Acceptance criteria:**
- [x] Blokir, lalu request HTTP dengan session yang sedang hidup mendapat 403
- [x] Blokir, lalu WebSocket yang di-upgrade dengan session yang sedang hidup mendapat 1008
- [x] Membuka blokir mengembalikan akses pada request berikutnya
- [x] Tes gagal kalau pemeriksaan `blocked_at` dihapus dari `authenticate()`

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_paywall.py -q` hijau
- [x] Manual check: hapus baris `blocked_at` dari query `authenticate`, pastikan tes merah
- [x] `npx vitest run` hijau (tidak ada regresi frontend)

**Dependencies:** Task 4

**Files likely touched:**
- `backend/tests/test_paywall.py`
- `backend/api/services/accounts.py` (hanya kalau tes menemukan celah)

**Estimated scope:** S

---

## Checkpoint: Fase 2

- [x] `cd backend && .venv/bin/python -m pytest -q` hijau
- [x] Akun terblokir kehilangan akses pada request berikutnya, HTTP dan WebSocket
- [x] Non-admin tidak bisa memanggil endpoint admin
- [x] Tinjau dengan manusia sebelum lanjut

---

## Fase 3: Integritas Posisi


## Task 6: Validasi simbol posisi terhadap tabel `instruments`

**Deskripsi:** `PUT /v1/portfolio/positions` menerima simbol apa pun. Tabel
`instruments` berisi 962 saham IDX, dan posisi yang menunjuk ke simbol di luar itu
membuat VaR, beta, dan alokasi menghitung atas sesuatu yang tidak ada. Validasi
dilakukan di server.

**Acceptance criteria:**
- [x] `PUT` menolak simbol yang tidak ada di `instruments`, dengan 422 dan menyebut simbol yang salah
- [x] Kalau `instruments` kosong (fresh deploy), posisi **diterima** dengan warning di log — bukan ditolak semua
- [x] Validasi menolak seluruh payload, bukan menulis sebagian lalu mengembalikan error
- [x] Pesan error menyebut simbol mana yang tidak dikenal, bukan "invalid input"

**Verification:**
- [x] Test: `FAKEPOS` ditolak; `BBCA` diterima; `instruments` kosong → diterima
- [x] Test: payload `{valid, invalid}` tidak menghasilkan write sama sekali
- [x] `cd backend && .venv/bin/python -m pytest tests/test_positions_api.py -q` hijau

**Dependencies:** None

**Files likely touched:**
- `backend/api/routers/portfolio.py` atau `backend/api/services/portfolio_access.py`
- `backend/tests/test_positions_api.py`

**Estimated scope:** S


## Task 7: Hapus posisi yang menunjuk saham yang sudah tidak tercatat

**Deskripsi:** Task 6 hanya mencegah write baru. Posisi yang sudah tertulis sebelum
validasi ada — atau yang tercatat saat `instruments` belum terisi — akan tetap
mengganggu analitik. Butuh operasi yang menghapusnya, dan yang mengatakannya.

**Acceptance criteria:**
- [x] Ada operasi yang menghapus posisi yang simbolnya tidak ada di `instruments`
- [x] Operasi melaporkan jumlah baris yang tersentuh, dan 0 bukan error
- [x] Idempoten: menjalankannya dua kali tidak mengubah apa pun
- [x] CLI-nya tidak menghapus posisi yang simbolnya masih tercatat

**Verification:**
- [x] Test: satu posisi fake dan satu posisi valid → hanya yang fake hilang
- [x] Test: jalankan dua kali → hasil kedua melaporkan 0
- [x] `cd backend && .venv/bin/python -m db.migrate --status` hijau (tidak menambah migrasi)

**Dependencies:** Task 6

**Files likely touched:**
- `backend/db/purge_positions.py` (baru, mengikuti pola `purge_sessions.py`)
- `backend/tests/test_maintenance_cli.py`

**Estimated scope:** S

---

## Checkpoint: Fase 3

- [x] `cd backend && .venv/bin/python -m pytest -q` hijau
- [x] `PUT /v1/portfolio/positions` menolak simbol yang tidak dikenal
- [x] Operasi pembersihan idempoten dan dilaporkan

---

## Fase 4: Audit Log Gate 2


## Task 8: Tabel `consent_acceptances` dan fungsi tulis

**Deskripsi:** Gate 2 menyimpan persetujuan di `localStorage` saja, sehingga
sistem tidak bisa membuktikan kepada regulator bahwa seseorang menyetujui apa dan
kapan. Menambahkan tabel untuk mencatatnya. Tabel baru, jadi tidak menyentuh tabel
yang sudah ada.

**Acceptance criteria:**
- [x] Tabel punya `account_id`, `version`, `accepted_at`; satu baris per penerimaan
- [x] `user_id` dengan `ON DELETE CASCADE`, jadi menghapus akun ikut menghapus log-nya
- [x] Index pada `(account_id, version)` untuk bacaaccept terakhir
- [x] Fungsi tulis menerima `account_id` dari server, **bukan** dari body request
- [x] Menghapus akun benar-benar menghapus consent-nya — tes yang memastikan

**Verification:**
- [x] `cd backend && .venv/bin/python -m db.migrate --status` menunjukkan migrasi baru `applied`
- [x] Test: tulis lalu baca balik menghasilkan nilai yang sama
- [x] Test: `DELETE users` membuat `consent_acceptances` ikut terhapus (cascade)
- [x] `cd backend && .venv/bin/python -m ruff check .` hijau

**Dependencies:** None

**Files likely touched:**
- `backend/db/migrations/0009_consent_acceptances.sql` (baru)
- `backend/db/schema.sql`
- `backend/api/services/consent.py` (baru)
- `backend/tests/test_consent_service.py` (baru)

**Estimated scope:** M


## Task 9: Endpoint consent dan pengiriman dari frontend

**Deskripsi:** Gate 2 harus mengirim persetujuannya ke server setelah tombol ditekan.
Kalau pengiriman gagal, modal harus muncul lagi pada load berikutnya — lebih benar
daripada menganggap seseorang sudah menyetujui sesuatu yang tidak tercatat.

**Acceptance criteria:**
- [x] `POST /v1/auth/consent` menulis log dengan `account_id` milik caller
- [x] Frontend mengirim setelah `writeConsent()`, bukan sebelum
- [x] Kegagalan pengiriman tidak menghapus penanda lokal, dan modal muncul lagi di load berikutnya setelah localStorage dihapus manual
- [x] Endpoint menolak caller anonim dengan 401
- [x] Teks modal menyatakan bahwa persetujuan tercatat di server

**Verification:**
- [x] Test: POST anonim → 401; POST dari akun → baris tersimpan dengan `account_id` yang benar
- [x] Test: body yang mencoba mengirim `account_id` lain diabaikan
- [x] `npx vitest run` hijau
- [x] Manual check: DevTools → Network, klik "Saya Mengerti & Setuju", ada POST ke `/v1/auth/consent`

**Dependencies:** Task 8

**Files likely touched:**
- `backend/api/routers/auth.py`
- `src/app/components/ConsentGate.tsx`
- `src/app/components/consent.ts`
- `src/app/config/api.ts`
- `src/app/components/ConsentGate.test.tsx`

**Estimated scope:** M

---

## Checkpoint: Fase 4

- [x] Persetujuan dapat dibaca balik dari database
- [x] Kegagalan pencatatan tidak membuat persetujuan hilang bagi pengguna
- [x] `docs/legal-and-consent.md` §5 diperbarui: audit log server sekarang ada
- [x] Tinjau dengan manusia sebelum lanjut

---

## Fase 5: Jalur Baca Subscription


## Task 10: `GET /v1/subscription/current`

**Deskripsi:** Tab 2 Settings menampilkan empty state karena tidak ada endpoint yang
memberi tahu masa aktif langganan. Tanpa pembayaran, ini endpoint baca saja — dan
harus bisa menjawab "tidak ada langganan" dengan jujur, bukan dengan angka nol.

**Acceptance criteria:**
- [x] Mengembalikan masa aktif berjalan dengan tanggal mulai, tanggal berakhir, dan sisa hari
- [x] Akun tanpa Subscription mendapat `null`, **bukan** `daysRemaining: 0` dengan status aktif
- [x] Endpoint hanya dibaca, tidak pernah menulis
- [x] `daysRemaining` dihitung dari `expires_at` di server, tidak dikembalikan mentah dari frontend
- [x] Endpoint tunduk pada paywall seperti route data lain

**Verification:**
- [x] Test: tanpa Subscription → `subscription: null`
- [x] Test: dengan Subscription → `daysRemaining` benar, dan 0 saat kedaluwarsa
- [x] Test: akun non-subscriber tetap 403 saat paywall aktif
- [x] `cd backend && .venv/bin/python -m pytest -q` hijau

**Dependencies:** None

**Files likely touched:**
- `backend/api/routers/subscription.py` (baru) atau `portfolio.py`
- `backend/api/services/entitlements.py`
- `backend/tests/test_paywall.py`

**Estimated scope:** S


## Task 11: Tab 2 Settings menampilkan status dan sisa hari

**Deskripsi:** Tab 2 memakai data dari Task 10. Karena belum ada cara mendapatkan
Subscription, sebagian besar isinya tetap kosong — dan itu harus terlihat sebagai
"belum ada langganan", bukan sebagai tabel kosong atau angka nol.

**Acceptance criteria:**
- [x] Tab 2 menampilkan masa aktif dan sisa hari dari `GET /v1/subscription/current`
- [x] Tanpa langganan: empty state yang menyebut tidak ada langganan aktif, bukan angka 0
- [x] Error dan "tidak ada langganan" menghasilkan pesan berbeda
- [x] Tidak ada tombol "Perpanjang" atau "Upgrade" yang bisa diklik dan tidak melakukan apa pun (R-26)
- [x] Tidak ada progress bar atau persentase yang berasal dari angka karangan

**Verification:**
- [x] Test: `subscription: null` → empty state menyebut tidak ada langganan
- [x] Test: ada Subscription → tanggal dan sisa hari tampil
- [x] Test: fetch gagal → pesan error, bukan empty state
- [x] `npx vitest run` hijau

**Dependencies:** Task 10

**Files likely touched:**
- `src/app/components/SettingsView.tsx`
- `src/app/components/SettingsView.test.tsx`
- `src/app/i18n/translations.ts`

**Estimated scope:** M

---

## Checkpoint: Lengkap

- [x] `cd backend && .venv/bin/python -m pytest -q` hijau
- [x] `npx vitest run` hijau
- [x] `npx tsc --noEmit` bersih
- [x] `npx eslint src` tidak menambah warning di atas baseline
- [x] `cd backend && .venv/bin/python -m ruff check .` bersih
- [x] `docs/status.md` mencerminkan keadaan sebenarnya
- [x] Tidak ada klaim di dokumen yang lebih optimistis daripada kodenya
- [x] Siap ditinjau

---

## Di Luar Plan Ini

Tidak dicakup, dan alasannya tercatat di [plan.md](plan.md#batasan-plan-ini):

- Tabel `transactions`, `system_settings`, `notification_logs`
- Checkout dan pembayaran (Midtrans, QRIS, virtual account, upload bukti)
- Integrasi email dan WhatsApp
- Portal admin di frontend — Task 4 hanya memberi endpoint