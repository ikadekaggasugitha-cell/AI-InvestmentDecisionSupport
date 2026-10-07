# Task List: Tiga Keputusan Owner

Rencana: [plan-keputusan-owner.md](plan-keputusan-owner.md).

Plan ini berbeda dari [plan.md](plan.md) yang sudah selesai. Dua file itu terpisah
dengan sengaja: yang satu berisi pekerjaan yang sudah di-commit, yang ini berisi
keputusan yang belum diambil.

**Semua task di sini memblokir satu sama lain dan tidak bisa dikerjakan sebelum
keputusan diambil.** Yang bisa langsung dikerjakan tidak ada — dan itu memang
poinnya: ketiganya hanya bisa dijawab owner.

Perintah verifikasi:

```bash
cd backend && .venv/bin/python -m pytest -q
cd backend && .venv/bin/python -m ruff check .
npx tsc --noEmit && npx vitest run && npx eslint src
```

---

## Keputusan 1: Apakah memblokir juga mengakhiri sesi


### Task 1: Catat keputusan blokir di ADR-0004

**Deskripsi:** Apa pun yang Anda pilih,ADR-0004 sekarang diam-diam tidak
menjelaskan apa yang terjadi pada sesi saat akun diblokir..today itu terlihat
seperti kelalaian; besok terlihat seperti keputusan. Satu kalimat yang eksplisit
menghilangkan kedua kemungkinan itu.

**Acceptance criteria:**
- [x] ADR-0004 menyatakan secara eksplisit apa yang terjadi pada baris `sessions` ketika `blocked_at` diisi
- [x] Pernyataan itu konsisten dengan apa yang kodenya lakukan saat ini
- [x] Kalau jawabannya B, `set_blocked()` memanggil `revoke_all_sessions()` dan tesnya ada

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_admin_api.py -q` hijau
- [x] Test untuk penghapusan sesi benar-benar gagal ketika pemanggilan `revoke_all_sessions()` dihapus

**Dependencies:** Keputusan owner

**Files likely touched:**
- `docs/adr/0004-session-opaque-postgres-hash-fail-closed.md`
- `backend/api/services/accounts.py` (hanya kalau jawabannya B)
- `backend/tests/test_admin_api.py`

**Estimated scope:** S

---

## Keputusan 2: Retensi consent log


### Task 2: Tetapkan kebijakan retensi

**Deskripsi:** Tabel `consent_acceptances` tidak pernah dihapus, dan `ON DELETE
CASCADE` sudah menangani akun yang dihapus. Yang belum ada adalah kebijakan untuk
akun yang masih hidup. retaining selamanya perlu dapat dijelaskan ke regulator;
menghapus punya konsekuensi pembuktian.

**Acceptance criteria:**
- [x] Kebijakan tertulis: simpan selamanya, atau hapus setelah N bulan dengan menyisakan yang terakhir
- [x] Kalau hapus: N ditetapkan dan dicatat di ADR atau `status.md`, bukan hanya di kode
- [x] `docs/status.md` mencatat kebijakan itu sebagai keputusan, bukan sebagai utang

**Verification:**
- [x] Tidak ada kode yang menghapus consent tanpa kebijakan tertulis
- [x] Manual check: `docs/status.md` dan ADR mana pun yang menyebut retensi tidak saling bertentangan

**Dependencies:** Keputusan owner

**Files likely touched:**
- `docs/status.md`
- `docs/legal-and-consent.md` (kalau kebijakan retensi masuk ke dokumen legal)

**Estimated scope:** XS


### Task 3: Implementasikan purge consent (hanya kalau Task 2 = hapus setelah N)

**Deskripsi:** Satu operasi, mengikuti pola `db/purge_sessions.py` yang sudah ada.
Menyisakan baris terbaru per akun, menghapus sisanya yang lebih tua dari N.

**Acceptance criteria:**
- [x] Perintah `--dry-run` melaporkan berapa baris akan dihapus, tanpa menghapus
- [x] Idempoten: dijalankan dua kali, hasil kedua melaporkan 0
- [x] Baris terbaru per akun tidak pernah dihapus
- [x] Akun dengan satu baris saja tidak tersentuh

**Verification:**
- [x] Test untuk keempat acceptance criteria
- [x] `cd backend && .venv/bin/python -m pytest tests/test_maintenance_cli.py -q` hijau

**Dependencies:** Task 2

**Files likely touched:**
- `backend/db/purge_consent.py` (baru)
- `backend/tests/test_maintenance_cli.py`

**Estimated scope:** S

---

## Keputusan 3: Bentuk `/admin`


### Task 4: Bangun view admin sesuai bentuk yang dipilih

**Deskripsi:** Endpoint sudah ada dan teruji. Yang belum ada adalah view-nya. App
ini punya satu state `view`, bukan routing sungguhan, jadi ini view baru dan bukan
route baru.

**Acceptance criteria:**
- [x] View menampilkan daftar akun: nama, email, role, status blokir
- [x] Paginasi ditangani, dan `hasMore: false` berhenti dengan benar
- [x] Kalau bentuknya termasuk aksi: konfirmasi sebelum memblokir, dan daftar disegarkan setelah aksi
- [x] Kegagalan pemuatan menampilkan pesan, bukan daftar kosong
- [x] Tidak ada nomor atau nama yang dikarang di baris tabel

**Verification:**
- [x] Test: daftar ter-render; aksi memblokir memanggil endpoint yang benar
- [x] Test: `hasMore: false` tidak menampilkan tombol "further"
- [x] `npx vitest run` hijau

**Dependencies:** Keputusan owner

**Files likely touched:**
- `src/app/components/AdminView.tsx` (baru)
- `src/app/App.tsx`
- `src/app/config/api.ts`

**Estimated scope:** M


### Task 5: Entry sidebar (hanya kalau halaman butuh jalan masuk)

**Deskripsi:** Tanpa entry, halaman admin hanya bisa ditemukan dengan mengetik
URL. Sidebar sudah menerima `account` dan sudah menampilkan label role, jadi
menambahkan item yang hanya muncul untuk admin adalah perubahan kecil.

**Acceptance criteria:**
- [x] Item "Admin" tidak muncul untuk akun dengan role `user`
- [x] Item muncul untuk role `admin`
- [x] Menembak endpoint 403 (bukan 404) kalau diakses paksa, supaya tidak menyamarkan akses

**Verification:**
- [x] Test: `role: 'user'` → tidak ada item admin; `role: 'admin'` → ada
- [x] Test manual: klik item, halaman terbuka; non-admin yang mengetik URL tidak melihat apa pun yang berguna

**Dependencies:** Task 4

**Files likely touched:**
- `src/app/components/Sidebar.tsx`
- `src/app/components/Sidebar.test.tsx`

**Estimated scope:** S

---

## Checkpoint: Keputusan

- [x] Ketiga keputusan tercatat, entah di ADR atau di `status.md`
- [x] Tidak ada lagi pertanyaan terbuka yang berasal dari plan ini
- [x] Semua test hijau
- [x] Siap ditinjau

---

## Tidak Dicakup

- **Fase 2 penagihan.** `docs/status.md` mencatat "ADR-nya belum ditulis". ADR-nya
  yang harus ditulis lebih dulu, bukan task-nya.
- **Commit, jadwal purge, dan deployment migrasi.** Daftar kerja operasional,
  bukan sesuatu yang perlu planning.