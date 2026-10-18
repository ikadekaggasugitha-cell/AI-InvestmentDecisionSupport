# Task List: Suspend Akun yang Langganannya Habis

Rencana lengkap: [plan-suspend-lapsed.md](plan-suspend-lapsed.md). Baca file itu
dulu — khususnya bagian *Bahaya yang Dihindari* dan *Konsekuensi yang Dipaksakan
Logika*, karena keduanya menjelaskan bentuk kode ini.

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

## Fase 1: Alasan pada blokir

## Task 1: Migrasi 0013 — `users.blocked_reason`

> Catatan nomor: plan aslinya menyebut 0012, tetapi 0012 sudah dipakai
> `0012_transactions_plan.sql` (plan-pembayaran). Migrasi ini menjadi 0013.

**Deskripsi:** Kolom nullable dengan dua nilai: `'admin'` dan
`'subscription_expired'`. Backfill baris yang sudah terblokir ke `'admin'`,
karena mereka ditangguhkan oleh admin dan tidak boleh bisa dibuka pembayaran.

**Acceptance criteria:**
- [x] `blocked_at IS NOT NULL` dengan `blocked_reason IS NULL` tidak mungkin
      terjadi — CHECK constraint, bukan aturan di kode
- [x] `blocked_at IS NULL` dengan `blocked_reason` terisi juga dilarang
- [x] Baris yang sudah terblokir saat migrasi berjalan menjadi `'admin'`
- [x] Ada di `db/schema.sql` **dan** `db/migrations/0013_subscription_suspension.sql`
- [x] Tidak ada kolom status di `subscriptions` (aturan 1)

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_blocked_reason_schema.py -q` hijau
- [x] Test: `blocked_reason` ada di kedua berkas
- [x] Test: CHECK ada, dan diuji terhadap kombinasi yang tidak valid
- [x] Test: migrasi tidak menimpa baris yang sudah ada

**Dependencies:** None

**Files likely touched:**
- `backend/db/migrations/0013_subscription_suspension.sql`
- `backend/db/schema.sql`
- `backend/tests/test_blocked_reason_schema.py`

**Estimated scope:** S

---

## Task 2: `set_blocked()` membawa alasan

**Deskripsi:** Satu-satunya penulis `blocked_at` sekarang menerima alasannya.
Pembukaannya dipisah: hanya `subscription_expired` yang boleh dibuka oleh
pembayaran, dan itu bukan bagian dari fungsi ini.

**Acceptance criteria:**
- [x] `set_blocked()` wajib menerima alasan; `blocked=False` berarti `'admin'`
      (catatan: `reason` keyword-only `Literal["admin"]` — penulis blokir
      per-akun hanyalah jalur admin; beat menulis lewat UPDATE massalnya sendiri)
- [x] Fungsi **tidak** pernah mengosongkan `blocked_at` yang alasannya `'admin'`
- [x] Ada fungsi terpisah untuk membuka blokir langganan, dan ia menolak
      `blocked_reason = 'admin'` tanpa efek samping apa pun
      (`accounts.reopen_after_payment`, guard di dalam WHERE, satu pernyataan;
      menerima `conn=` agar jalan dalam transaksi pembayaran)
- [x] Endpoint admin `/unblock` tetap satu-satunya jalan membuka ban admin

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_blocked_reason.py -q` hijau
- [x] Test: pembuka langganan pada akun beralasan `'admin'` tidak mengubah apa pun
- [x] Test: pembuka langganan pada `'subscription_expired'` mengosongkan keduanya
- [x] Test: memblokir selalu mencatat `'admin'`

**Dependencies:** Task 1

**Files likely touched:**
- `backend/api/services/accounts.py`
- `backend/tests/test_blocked_reason.py`

**Estimated scope:** M

### Checkpoint: Fase 1

- [x] Baris `blocked_at` yang sudah ada ter-backfill ke `'admin'`
- [x] Ban admin tidak bisa dibuka oleh kode mana pun selain endpoint admin
- [x] `cd backend && .venv/bin/python -m pytest -q` hijau (822 passed + 7 blocked-reason)

---

## Fase 2: Menangguhkan yang jatuh tempo

## Task 3: Beat menangguhkan akun yang langganannya habis

**Deskripsi:** Task beat yang membaca akun dengan `MAX(expires_at)` sudah lewat dan
menangguhkannya. **Hanya** yang pernah punya subscription — kalau tidak, setiap
pendaftaran gratis langsung jadi ban, dan `subscriptions` yang kosong di
instalasi baru akan menutup pintu untuk semua orang.

**Acceptance criteria:**
- [x] Hanya akun dengan **setidaknya satu** subscription yang pernah ada
- [x] Baris dengan `blocked_reason = 'admin'` tidak pernah disentuh
      (`blocked_at IS NULL` adalah guard pertama predicate-nya)
- [x] Akun tanpa subscription sama sekali tidak pernah ikut
- [x] Idempoten — dua kali jalan menghasilkan hasil yang sama
- [x] Tidak ada Subscription yang dibuat, diubah, atau dihapus
- [x] CLI manual dengan `--dry-run`, mengikuti pola `db/purge_positions.py`
      (`backend/db/suspend_lapsed.py`; SQL ada di `services.accounts` supaya
      penulis `users` tetap satu modul — deviasi kecil dari daftar file,
      `subscriptions.py` tidak menyentuh `users`)

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_suspend_lapsed.py -q` hijau
- [x] Test: akun tanpa subscription **tidak** ikut, walau tidak punya langganan aktif
- [x] Test: akun dengan langganan aktif tidak ikut
- [x] Test: akun dengan subscription yang sudah lewat ikut
- [x] Test: akun beralasan `'admin'` tidak ikut
- [x] Test: `test_beat_schedule.py` masih hijau
      (beat `suspend-lapsed-subscriptions` hourly di menit :05, luar jam pasar)

**Dependencies:** Tasks 1, 2

**Files likely touched:**
- `backend/workers/payment_worker.py`
- `backend/workers/celery_app.py`
- `backend/api/services/subscriptions.py`
- `backend/db/suspend_lapsed.py`
- `backend/tests/test_suspend_lapsed.py`

**Estimated scope:** M

---

## Task 4: Gerbang membedakan dua alasan

**Deskripsi:** Akun beralasan `subscription_expired` boleh masuk untuk membayar,
tapi tidak melihat isi aplikasi. Akun beralasan `admin` tidak masuk sama sekali.

**Acceptance criteria:**
- [x] `subscription_expired` boleh melewati route autentikasi, `/v1/me`,
      pricing, dan pembayaran
      (login juga boleh — cookie hilang bukan akses hilang; klausa suspensi
      `require_entitlement` jalan lebih dulu dari flag paywall)
- [x] `subscription_expired` **ditolak** di semua route analisis dan data
      (403 dengan kalimatnya sendiri, lewat dependency yang dilampirkan di
      `main.py` ke semua router berbayar; dibalik menjadi **402** di
      tinjauan 2026-10-18 — catatan di plan-suspend-lapsed)
- [x] `admin` ditolak di mana pun, termasuk route autentikasi (403, termasuk
      POST login; suspension boleh login)
- [x] `admin` menutup WebSocket dengan 1008, seperti sekarang
- [x] WebSocket untuk `subscription_expired` ditutup dengan kode 4404
      (`WS_CLOSE_SUBSCRIPTION_ENDED`) — bukan 1008, bukan 4403
- [x] Responsnya tidak sama dengan "kamu tidak punya langganan" (bukan 402, dan
      detailnya "This account's subscription has ended", bukan "This account
      is blocked.")

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_suspension_gate.py -q` hijau
- [x] Test: `subscription_expired` → `/v1/auth/me` 200, `/v1/signals` ditolak
- [x] Test: `admin` → `/v1/auth/me` 403
- [x] Test: kode close WebSocket berbeda antara kedua alasan (1008 vs 4404)

**Dependencies:** Tasks 1, 2

**Files likely touched:**
- `backend/api/core/auth.py`
- `backend/api/routers/market_ws.py`
- `backend/routers/auth.py` juga (login reason-aware + `blockedReason` di
  `/v1/auth/me`, di luar daftar awal)
- `backend/tests/test_suspension_gate.py`

**Estimated scope:** M

### Checkpoint: Fase 2

- [x] Akun yang belum pernah berlangganan tidak pernah tersuspend
- [x] Ban admin tidak pernah disentuh beat
- [x] Akun tersuspend bisa masuk tapi tidak melihat data apa pun
- [x] `cd backend && .venv/bin/python -m pytest -q` hijau (854 passed)

---

## Fase 3: Membuka dengan membayar

## Task 5: Penyelesaian pembayaran membuka hanya yang tertangguh

**Deskripsi:** Saat transaksi masuk `settlement`, akun yang tertangguh karena
langganannya habis dibuka. Yang dibayar admin **tidak** — itu celah yang membuat
seluruh plan ini tidak bisa dikerjakan tanpa `blocked_reason`.

**Acceptance criteria:**
- [x] `settlement` membuka `blocked_at` hanya saat `blocked_reason = 'subscription_expired'`
      (`reopen_after_payment` dipanggil dari `_create_period` — pintu sukses
      tunggal semua grant)
- [x] `settlement` pada akun beralasan `'admin'` tidak mengubah apa pun
      (termasuk tidak menimpa `blocked_reason`)
- [x] `blocked_at` dan `blocked_reason` dikosongkan bersama, dalam satu pernyataan
- [x] Akun yang tidak sedang tertangguh tidak tersentuh sama sekali
- [x] Berlaku untuk webhook dan approve admin, karena keduanya memanggil satu
      fungsi yang sama (endpoint grant manual admin ikut jalan pintu yang sama)

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_settlement_reopens.py -q` hijau
- [x] Test: `settlement` membuka akun `subscription_expired`
- [x] Test: `settlement` **tidak** membuka akun `admin` ← ini tes yang paling penting
- [x] Test: dua alasan itu tidak bisa tertukar (dua akun diproses berdampingan)
- [x] Test: crash dalam approve mengembalikan suspensi juga (rollback snapshot
      fake kini mencakup `users`)

**Dependencies:** Tasks 2, 4

**Files likely touched:**
- `backend/api/services/subscriptions.py`
- `backend/tests/test_settlement_reopens.py`

**Estimated scope:** S

---

## Task 6: Layar "langganan berakhir"

**Deskripsi:** Akun yang tertangguh melihat satu layar, bukan aplikasi kosong:
bahasa yang benar, cara membayar, dan tidak ada tombol mati.

**Acceptance criteria:**
- [x] `/v1/auth/me` melaporkan alasan blokir, bukan hanya `blocked: true`
      (`blockedReason` di `AccountResponse`; `useAuth` membawanya di `Account`)
- [x] Pesan layar berbeda untuk `'admin'` dan `'subscription_expired'`
      (SuspensionScreen dua cabang; ban admin juga diucapkan di AuthScreen
      saat auth/me 403 — "ditutup administrator, pembayaran tidak dapat
      membukanya")
- [x] Layar menautkan ke harga dan ke halaman pembayaran
      (panel billing `TabSubscription` dirender langsung di layar — harga,
      rekening tujuan, dan formulir deklarasi dari server; bukan tautan ke
      shell yang penuh kontrol mati, R-26)
- [x] **Tidak** ada kontrol yang terlihat hidup tanpa fungsi (R-26)
- [x] Ban admin **tidak** menampilkan jalan pembayaran apa pun

**Verification:**
- [x] `npx vitest run src/app/components/SuspensionScreen.test.tsx` hijau (7 test)
- [x] `npx tsc --noEmit` bersih
- [x] `npx vitest run` hijau (313 passed) dan `npx eslint src` 0 error
- [x] Test: alasan `'admin'` tidak menampilkan tombol bayar (dan endpoint
      pricing bahkan tidak pernah ditanya)

**Dependencies:** Tasks 4, 5

**Files likely touched:**
- `src/app/components/SuspensionScreen.tsx`
- `src/app/components/SuspensionScreen.test.tsx`
- `src/app/hooks/useAuth.ts`
- `src/app/App.tsx`
- `src/app/components/AuthScreen.tsx` (pesan ban untuk auth/me 403) dan
  `SettingsView.tsx` (ekspor `TabSubscription`) — di luar daftar awal

**Estimated scope:** M

### Checkpoint: Fase 3

- [x] Membayar membuka akun tertangguh
- [x] Membayar **tidak** membuka ban admin
- [x] Penyebab yang salah tidak dibaca sebagai langganan habis
- [x] `cd backend && .venv/bin/python -m pytest -q` (862 passed) dan
      `npx vitest run` (313 passed) hijau

---

## Fase 4: Bukti dan dokumen

## Task 7: CONTEXT.md, `docs/status.md`, ADR-0012

> Catatan nomor: todo aslinya menulis ADR-0011, tetapi 0011 sudah dipakai
> keputusan "satu penulis subscriptions" (plan-pembayaran). Penangguhan
> menjadi ADR-0012.

**Deskripsi:** Penangguhan adalah keputusan yang mengubah aturan main. Kalau
dokumentasinya tidak menyusul, kode dan dokumentasi akan berbeda dalam dua minggu.

**Acceptance criteria:**
- [x] CONTEXT.md mencatat perbedaan antara "belum pernah berlangganan" (sah,
      tidak tersuspend) dan "pernah berlangganan lalu habis" (tersuspend)
      (istilah **Tertangguh** di kamus)
- [x] Aturan 3 diperjelas: yang memblokir adalah masa aktif yang habis, bukan
      Payment Status — transaksi yang gagal tidak menyuspend siapa pun
      (aturan 4 juga: akun tanpa Subscription tidak pernah tersuspend;
      aturan 8: dua alasan, dua pintu)
- [x] Kamus menambah istilah untuk alasan blokir (**Blocked Reason**, plus
      **Tertangguh**)
- [x] `docs/status.md` mencatat siapa yang menulis `blocked_at` sekarang, dan
      bahwa pembukaannya punya dua jalan berbeda (baris tabel users,
      WebSocket, antrean admin, baris baru "Penangguhan langganan habis",
      baris CLI, tabel keputusan, utang sesi)
- [x] ADR-0012 merekam keputusan `blocked_reason` dan alasan jangan sampai
      pembayaran membuka ban admin (`docs/adr/0012-alasan-pada-blokir.md`,
      barisnya di `docs/adr/README.md`)
- [x] `backend/tests/test_docs_status.py` hijau

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_docs_status.py -q` hijau
- [x] Manual check: setiap aturan di CONTEXT.md masih cocok dengan kodenya

**Dependencies:** Tasks 1–6

**Files likely touched:**
- `CONTEXT.md`
- `docs/status.md`
- `docs/adr/0012-alasan-pada-blokir.md` (0011 sudah terpakai)
- `docs/adr/README.md`

**Estimated scope:** S

### Checkpoint: Lengkap

- [x] Semua acceptance criteria di atas terpenuhi
- [x] `cd backend && .venv/bin/python -m pytest -q` hijau
- [x] `cd backend && .venv/bin/python -m ruff check .` bersih
- [x] `npx tsc --noEmit`, `npx eslint src`, `npx vitest run` hijau
- [x] `git diff` tidak menambah kolom status ke `subscriptions`, dan tidak
      memblokir akses berdasarkan status transaksi (aturan 1 dan 3) —
      penangguhan menulis `users` saja, dan menurunkan dari
      `subscriptions.expires_at`
- [x] Manual check: scenarios manual — admin banned + membayar **tetap** banned
      (`test_settlement_reopens.py::TestSettlementNeverOpensAnAdminBan`,
      `TestTheOperatorGrantAlsoReopens`)
- [x] Tinjau dengan manusia