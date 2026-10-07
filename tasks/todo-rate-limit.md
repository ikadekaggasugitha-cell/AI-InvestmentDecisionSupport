# Task List: Rate Limit yang Sebenarnya Bekerja

Rencana: [plan-rate-limit.md](plan-rate-limit.md).

Pekerjaan berbeda dari plan lain di folder ini, jadi file-nya terpisah:
[plan.md](plan.md) sudah selesai, [plan-keputusan-owner.md](plan-keputusan-owner.md)
juga.

**Tidak ada task yang bisa dikerjakan sebelum Task 1.** Menyetel angka batas sebelum
batasnya ditegakkan hanya sia-sia.

Perintah verifikasi:

```bash
cd backend && .venv/bin/python -m pytest -q
cd backend && .venv/bin/python -m ruff check .

# Lengkap: suite dengan limiter menyala — ini yang tidak pernah dilakukan
RATE_LIMIT_ENABLED=true .venv/bin/python -m pytest -q
```

---

Fase 1: Buktikan


### Task 1: Tes yang membuktikan limiter tidak tegak

**Deskripsi:** Menulis tes yang harus gagal hari ini. Hari ini limiter menyala,
terpasang, punya default limit — dan tetap meloloskan dua belas request terhadap
anggaran lima per menit. Tes ini adalah satu-satunya bukti bahwa itu benar, dan satu
-satunya bukti bahwa perbaikannya berhasil nanti.

**Acceptance criteria:**
- [x] Tes mengirim lebih banyak request daripada anggaran, dan mengharapkan 429
- [x] Header batas ada di respons, bukan hanya status
- [x] Tes menguji default limit pada route yang tidak punya decorator sendiri
- [x] Tes GAGAL sekarang, dan alasannya tercatat: bukan karena request ditolak, tapi karena tidak pernah ditolak
- [x] `/health` diuji sebagai yang TIDAK boleh dibatasi — health check yang dibatasi membuat orkestrator mematikan instance yang sehat

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_rate_limit.py -q` → merah, dengan pesan yang menyebut respons apa adanya
- [x] Manual check: jalankan tes dengan `RATE_LIMIT_DEFAULT=2/minute`, lalu hitung sendiri berapa request yang lolos

**Dependencies:** None

**Files likely touched:**
- `backend/tests/test_rate_limit.py` (baru)

**Estimated scope:** S


### Task 2: Suite berjalan dengan limiter menyala

**Deskripsi:** `conftest.py` mematikan rate limit untuk seluruh suite, dengan alasan
bahwa akan ada tes khusus untuknya. Tes itu tidak pernah ada, jadi tidak ada yang pernah
menjalankan suite dalam kondisi yang sama dengan produksi. Mulai sekarang suite harus
berjalan dengan limiter menyala.

**Acceptance criteria:**
- [x] Limiter menyala di suite, dengan batas khusus tes yang jauh lebih longgar dari 120/menit produksi
- [x] Tidak ada `RATE_LIMIT_ENABLED=false` di conftest sebagai cara mematikan fitur
- [x] Semua test yang ada tetap hijau tanpa perubahan pada test itu sendiri
- [x] Alasannya ditulis di conftest: suite mematikan limiter karena semua request datang dari satu IP

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest -q` hijau tanpa flag
- [x] `RATE_LIMIT_ENABLED=true .venv/bin/python -m pytest -q` juga hijau
- [x] Manual check: bachelor tidak ada test yang bergantung pada 429 secara tidak sengaja

**Dependencies:** Task 1

**Files likely touched:**
- `backend/tests/conftest.py`

**Estimated scope:** S

---

Checkpoint: Bukti

- [x] Tes Task 1 merah sebelum perbaikan
- [x] Suite penuh hijau dengan limiter menyala
- [x] Ditolak dengan manusia

---

Fase 2: Perbaikan


### Task 3: Evaluate opsi dan pilih

**Deskripsi:** Empat opsi ada di plan. Yang menentukan: apakah ada rilis slowapi yang
mendukung FastAPI 0.141. Kalau tidak ada, menambal `_IncludedRouter` akan menjadi bug
yang kembali dengan bentuk lain.

**Acceptance criteria:**
- [x] Rilis slowapi terbaru diperiksa, dan hasilnya dicatat (ada yang mendukung, atau tidak ada)
- [x] Kalau ada yang mendukung: naikkan ke sana, dan jalankan Task 1 untuk mengukur
- [x] Kalau tidak ada: alasannya tercatat, dan pilihan ada di ADR atau komentar
- [x] Pilihannya bukan menambal simbol privat tanpa alasan tertulis

**Verification:**
- [x] Manual check: `pip index versions slowapi` atau yang setara
- [x] Keputusan tertulis, supaya tidak perlu ditebak ulang nanti

**Dependencies:** Task 1, Task 2

**Files likely touched:**
- `backend/requirements.txt`
- `docs/adr/` (kalau perbaikannya layak jadi keputusan)

**Estimated scope:** S


### Task 4: Terapkan perbaikannya

**Deskripsi:** Membuat limiter benar-benar tegak. Yang diukur dengan Task 1, bukan
diasumsikan bekerja.

**Acceptance criteria:**
- [x] Request melebihi anggaran mengembalikan 429
- [x] Header `X-RateLimit-*` ada di respons
- [x] Route yang di-exempt (`/health`) tetap tidak pernah dibatasi
- [x] Limit khusus route (advisor) tetap jalan dan lebih ketat dari default
- [x] Kegagalan limiter tidak membuat API mati — limiter yang gagal membuka, bukan menutup

**Verification:**
- [x] `cd backend && .venv/bin/python -m pytest tests/test_rate_limit.py -q` hijau
- [x] Suite penuh hijau
- [x] Manual check: `RATE_LIMIT_DEFAULT=2/minute` lalu bombardir endpoint, lihat 429 muncul

**Dependencies:** Task 3

**Files likely touched:**
- `backend/api/core/rate_limit.py`
- `backend/api/main.py`
- `backend/tests/test_rate_limit.py`

**Estimated scope:** M

---

Checkpoint: Perbaikan

- [x] 429 muncul pada anggaran yang terlampaui
- [x] Header batas dikembalikan
- [x] `/health` tidak pernah dibatasi
- [x] Suite hijau dengan limiter menyala
- [x] Ditinjau dengan manusia

---

Fase 3: Batas per-endpoint


### Task 5: Batas ketat pada endpoint yang mahal

**Deskripsi:** Hanya advisor punya batas sendiri. `/v1/technicals/ohlcv` (sampai 400
sesi), `/v1/portfolio/equity?days=1000`, dan `/v1/symbols?limit=2000` mendapat 120
per menit yang sama dengan `/health` yang dikecualikan — padahal tidak ada yang
sebanding.

**Acceptance criteria:**
- [x] Setiap endpoint mahal punya batasnya sendiri, dan alasannya tercatat
- [x] Angkanya bukan tebakan yang ditulis seolah sudah diukur
- [x] Batas advisor yang sudah ada tidak berubah tanpa alasan

**Verification:**
- [x] Tes: endpoint mahal di luar anggarannya mengembalikan 429
- [x] Manual check: `docs/status.md` mencatat bahwa angka ini belum diukur terhadap beban nyata

**Dependencies:** Task 4

**Files likely touched:**
- `backend/api/routers/technicals.py`
- `backend/api/routers/portfolio.py`
- `backend/api/core/config.py`

**Estimated scope:** S


### Task 6: Hapus angka batas yang tidak pernah dipakai

**Deskripsi:** Kalau Task 3 berakhir dengan mengganti slowapi, ada kode yang harus
dibuang — dan ada komentar yang mengklaim sesuatu yang tidak lagi benar.

**Acceptance criteria:**
- [x] Komentar `verified against the suite` di requirements.txt diperbaiki, karena memang belum pernah diverifikasi
- [x] Komentar di `api/core/rate_limit.py` dan `api/main.py` yang mengklaim default berlaku untuk semua route dicocokkan dengan kenyataan
- [x] Tidak ada setting batas yang dibaca tapi tidak dipakai

**Verification:**
- [x] Manual check: setiap klaim di `api/main.py` dan `api/core/rate_limit.py` bisa dibuktikan dengan tes yang menyala
- [x] `docs/status.md` mencatat rate limit sebagai ada dan teruji

**Dependencies:** Task 4

**Files likely touched:**
- `backend/requirements.txt`
- `backend/api/core/rate_limit.py`
- `backend/api/main.py`
- `docs/status.md`

**Estimated scope:** S

---

Checkpoint: Lengkap

- [x] Semua test hijau dengan limiter menyala
- [x] 429 terbukti muncul, bukan diklaim
- [x] Tidak ada komentar di kode yang lebih optimistis daripada kenyataan
- [x] Ditinjau dengan manusia

---

Tidak Dicakup

- **Store bersama untuk rate limit.** Baru relevan kalau ada lebih dari satu instance.
  `memory://` sudah benar untuk satu proses
- **Redis `maxmemory`.** Redis tanpa batas memori akan tumbuh sampai OOM. Masalah nyata,
  terpisah dari rate limit — plan sendiri
- **Ukuran pool database.** `max_size=10` adalah langit-langit throughput sebenarnya,
  dan tidak ada backpressure yang terlihat. Terpisah dari rate limit
- **Load balancer.** Tidak ada instance yang bisa diseimbangkan; satu proses uvicorn