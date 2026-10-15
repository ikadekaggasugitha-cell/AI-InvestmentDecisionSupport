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

## Task 1: Migrasi 0012 — `users.blocked_reason`

**Deskripsi:** Kolom nullable dengan dua nilai: `'admin'` dan
`'subscription_expired'`. Backfill baris yang sudah terblokir ke `'admin'`,
karena mereka ditangguhkan oleh admin dan tidak boleh bisa dibuka pembayaran.

**Acceptance criteria:**
- [ ] `blocked_at IS NOT NULL` dengan `blocked_reason IS NULL` tidak mungkin
      terjadi — CHECK constraint, bukan aturan di kode
- [ ] `blocked_at IS NULL` dengan `blocked_reason` terisi juga dilarang
- [ ] Baris yang sudah terblokir saat migrasi berjalan menjadi `'admin'`
- [ ] Ada di `db/schema.sql` **dan** `db/migrations/0012_*.sql`
- [ ] Tidak ada kolom status di `subscriptions` (aturan 1)

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_blocked_reason_schema.py -q` hijau
- [ ] Test: `blocked_reason` ada di kedua berkas
- [ ] Test: CHECK ada, dan diuji terhadap kombinasi yang tidak valid
- [ ] Test: migrasi tidak menimpa baris yang sudah ada

**Dependencies:** None

**Files likely touched:**
- `backend/db/migrations/0012_subscription_suspension.sql`
- `backend/db/schema.sql`
- `backend/tests/test_blocked_reason_schema.py`

**Estimated scope:** S

---

## Task 2: `set_blocked()` membawa alasan

**Deskripsi:** Satu-satunya penulis `blocked_at` sekarang menerima alasannya.
Pembukaannya dipisah: hanya `subscription_expired` yang boleh dibuka oleh
pembayaran, dan itu bukan bagian dari fungsi ini.

**Acceptance criteria:**
- [ ] `set_blocked()` wajib menerima alasan; `blocked=False` berarti `'admin'`
- [ ] Fungsi **tidak** pernah mengosongkan `blocked_at` yang alasannya `'admin'`
- [ ] Ada fungsi terpisah untuk membuka blokir langganan, dan ia menolak
      `blocked_reason = 'admin'` tanpa efek samping apa pun
- [ ] Endpoint admin `/unblock` tetap satu-satunya jalan membuka ban admin

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_blocked_reason.py -q` hijau
- [ ] Test: pembuka langganan pada akun beralasan `'admin'` tidak mengubah apa pun
- [ ] Test: pembuka langganan pada `'subscription_expired'` mengosongkan keduanya
- [ ] Test: memblokir selalu mencatat `'admin'`

**Dependencies:** Task 1

**Files likely touched:**
- `backend/api/services/accounts.py`
- `backend/tests/test_blocked_reason.py`

**Estimated scope:** M

### Checkpoint: Fase 1

- [ ] Baris `blocked_at` yang sudah ada ter-backfill ke `'admin'`
- [ ] Ban admin tidak bisa dibuka oleh kode mana pun selain endpoint admin
- [ ] `cd backend && .venv/bin/python -m pytest -q` hijau

---

## Fase 2: Menangguhkan yang jatuh tempo

## Task 3: Beat menangguhkan akun yang langganannya habis

**Deskripsi:** Task beat yang membaca akun dengan `MAX(expires_at)` sudah lewat dan
menangguhkannya. **Hanya** yang pernah punya subscription — kalau tidak, setiap
pendaftaran gratis langsung jadi ban, dan `subscriptions` yang kosong di
instalasi baru akan menutup pintu untuk semua orang.

**Acceptance criteria:**
- [ ] Hanya akun dengan **setidaknya satu** subscription yang pernah ada
- [ ] Baris dengan `blocked_reason = 'admin'` tidak pernah disentuh
- [ ] Akun tanpa subscription sama sekali tidak pernah ikut
- [ ] Idempoten — dua kali jalan menghasilkan hasil yang sama
- [ ] Tidak ada Subscription yang dibuat, diubah, atau dihapus
- [ ] CLI manual dengan `--dry-run`, mengikuti pola `db/purge_positions.py`

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_suspend_lapsed.py -q` hijau
- [ ] Test: akun tanpa subscription **tidak** ikut, walau tidak punya langganan aktif
- [ ] Test: akun dengan langganan aktif tidak ikut
- [ ] Test: akun dengan subscription yang sudah lewat ikut
- [ ] Test: akun beralasan `'admin'` tidak ikut
- [ ] Test: `test_beat_schedule.py` masih hijau

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
- [ ] `subscription_expired` boleh melewati route autentikasi, `/v1/me`,
      pricing, dan pembayaran
- [ ] `subscription_expired` **ditolak** di semua route analisis dan data
- [ ] `admin` ditolak di mana pun, termasuk route autentikasi
- [ ] `admin` menutup WebSocket dengan 1008, seperti sekarang
- [ ] WebSocket untuk `subscription_expired` ditutup dengan kode yang **bukan** 1008,
      supaya klien tidak salah membaca sebagai sesi habis
- [ ] Responsnya tidak sama dengan "kamu tidak punya langganan" — orang ini
      **punya** langganan, sudah habis

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_suspension_gate.py -q` hijau
- [ ] Test: `subscription_expired` → `/v1/auth/me` 200, `/v1/signals` ditolak
- [ ] Test: `admin` → `/v1/auth/me` 403
- [ ] Test: kode close WebSocket berbeda antara kedua alasan

**Dependencies:** Tasks 1, 2

**Files likely touched:**
- `backend/api/core/auth.py`
- `backend/api/routers/market_ws.py`
- `backend/tests/test_suspension_gate.py`

**Estimated scope:** M

### Checkpoint: Fase 2

- [ ] Akun yang belum pernah berlangganan tidak pernah tersuspend
- [ ] Ban admin tidak pernah disentuh beat
- [ ] Akun tersuspend bisa masuk tapi tidak melihat data apa pun
- [ ] `cd backend && .venv/bin/python -m pytest -q` hijau

---

## Fase 3: Membuka dengan membayar

## Task 5: Penyelesaian pembayaran membuka hanya yang tertangguh

**Deskripsi:** Saat transaksi masuk `settlement`, akun yang tertangguh karena
langganannya habis dibuka. Yang dibayar admin **tidak** — itu celah yang membuat
seluruh plan ini tidak bisa dikerjakan tanpa `blocked_reason`.

**Acceptance criteria:**
- [ ] `settlement` membuka `blocked_at` hanya saat `blocked_reason = 'subscription_expired'`
- [ ] `settlement` pada akun beralasan `'admin'` tidak mengubah apa pun
- [ ] `blocked_at` dan `blocked_reason` dikosongkan bersama, dalam satu pernyataan
- [ ] Akun yang tidak sedang tertangguh tidak tersentuh sama sekali
- [ ] Berlaku untuk webhook dan approve admin, karena keduanya memanggil satu
      fungsi yang sama

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_settlement_reopens.py -q` hijau
- [ ] Test: `settlement` membuka akun `subscription_expired`
- [ ] Test: `settlement` **tidak** membuka akun `admin` ← ini tes yang paling penting
- [ ] Test: dua alasan itu tidak bisa tertukar

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
- [ ] `/v1/auth/me` melaporkan alasan blokir, bukan hanya `blocked: true`
- [ ] Pesan layar berbeda untuk `'admin'` dan `'subscription_expired'`
- [ ] Layar menautkan ke harga dan ke halaman pembayaran
- [ ] **Tidak** ada kontrol yang terlihat hidup tanpa fungsi (R-26)
- [ ] Ban admin **tidak** menampilkan jalan pembayaran apa pun

**Verification:**
- [ ] `npx vitest run src/app/components/SuspensionScreen.test.tsx` hijau
- [ ] `npx tsc --noEmit` bersih
- [ ] Test: alasan `'admin'` tidak menampilkan tombol bayar

**Dependencies:** Tasks 4, 5

**Files likely touched:**
- `src/app/components/SuspensionScreen.tsx`
- `src/app/components/SuspensionScreen.test.tsx`
- `src/app/hooks/useAuth.ts`
- `src/app/App.tsx`

**Estimated scope:** M

### Checkpoint: Fase 3

- [ ] Membayar membuka akun tertangguh
- [ ] Membayar **tidak** membuka ban admin
- [ ] Penyebab yang salah tidak dibaca sebagai langganan habis
- [ ] `cd backend && .venv/bin/python -m pytest -q` dan `npx vitest run` hijau

---

## Fase 4: Bukti dan dokumen

## Task 7: CONTEXT.md, `docs/status.md`, ADR-0011

**Deskripsi:** Penangguhan adalah keputusan yang mengubah aturan main. Kalau
dokumentasinya tidak menyusul, kode dan dokumentasi akan berbeda dalam dua minggu.

**Acceptance criteria:**
- [ ] CONTEXT.md mencatat perbedaan antara "belum pernah berlangganan" (sah,
      tidak tersuspend) dan "pernah berlangganan lalu habis" (tersuspend)
- [ ] Aturan 3 diperjelas: yang memblokir adalah masa aktif yang habis, bukan
      Payment Status — transaksi yang gagal tidak menyuspend siapa pun
- [ ] Kamus menambah istilah untuk alasan blokir
- [ ] `docs/status.md` mencatat siapa yang menulis `blocked_at` sekarang, dan
      bahwa pembukaannya punya dua jalan berbeda
- [ ] ADR-0011 merekam keputusan `blocked_reason` dan alasan jangan sampai
      pembayaran membuka ban admin
- [ ] `backend/tests/test_docs_status.py` hijau

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_docs_status.py -q` hijau
- [ ] Manual check: setiap aturan di CONTEXT.md masih cocok dengan kodenya

**Dependencies:** Tasks 1–6

**Files likely touched:**
- `CONTEXT.md`
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
      memblokir akses berdasarkan status transaksi (aturan 1 dan 3)
- [ ] Manual check: scenarios manual — admin banned + membayar **tetap** banned
- [ ] Tinjau dengan manusia