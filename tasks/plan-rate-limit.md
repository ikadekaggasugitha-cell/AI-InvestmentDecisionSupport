# Implementation Plan: Rate Limit yang Sebenarnya Bekerja

Gambaran

Permintaan awalnya "load balance data agar tidak penuh atau over". Setelah menelusuri
kodenya, ternyata yang Anda minta — batas request saat sibuk — **tidak pernah bekerja
sama sekali**, dan tidak ada yang mengetahuinya.

Ini bukan rewrites. Menyusun ulang prioritas: menyetel angka batas tidak berguna kalau
batasnya tidak ditegakkan, jadi itu yang dibetulkan lebih dulu.

Temuan Utama: Rate Limiter Sepenuhnya Pasif

Dibuktikan dengan eksekusi, bukan dibaca dari kode:

```
limiter.enabled           = True
limiter._default_limits   = [<LimitGroup>]
app.state.limiter         = terpasang
middleware registered     = ['SlowAPIMiddleware', 'CORSMiddleware']

# dengan RATE_LIMIT_DEFAULT=5/minute
12 request GET /v1/news  ->  [200, 200, 200, 200, 200, 200,
                               200, 200, 200, 200, 200, 200]
rate-limit headers        =  {}
```

Dua belas request terhadap anggaran lima per menit, semuanya berhasil, dan tidak ada
satu pun header batas. Limiter tidak memegang apa pun.

### Akar masalahnya

`_find_route_handler` milik slowapi 0.1.9 menelusuri `app.routes` mencari objek route
datar yang punya `.endpoint`:

```python
for route in routes:
    match, _ = route.matches(scope)
    if match == Match.FULL and hasattr(route, "endpoint"):
        handler = route.endpoint
```

FastAPI 0.141.1 tidak lagi meratakan router. `include_router()` membuat pembungkus
`_IncludedRouter`, jadi `app.routes` berisi:

```
{'Route': 4, '_IncludedRouter': 14, 'APIRoute': 2}
hits (FULL + punya endpoint): 0
```

Tidak ketemu -> `handler` bernilai `None` -> `_should_exempt(None)` mengembalikan
`True` secara langsung (kode slowapi sendiri yang menulis *"if we can't find the route
handler"*). Jadi **setiap route, tanpa kecuali, dianggap dikecualikan.**

Ini kompatibilitas versi, bukan logika yang salah. Dan tidak ada yang menangkapnya
karena `conftest.py:30` menyalakan `RATE_LIMIT_ENABLED=false` untuk seluruh suite,
dengan komentar:

> Rate limiting has its own dedicated tests — disable it everywhere else.

**Tes itu tidak pernah ada.** Satu-satunya rujukan `rate_limit` di `backend/tests/`
adalah `conftest.py` itu sendiri. Menyalakan limiter untuk seluruh suite tetap hijau,
karena limiter-nya memang tidak melakukan apa-apa.

### Klaim yang sekarang terbukti salah

- `requirements.txt:24` menulis `slowapi==0.1.9  # verified against the suite` —
  diverifikasi hanya terhadap suite yang mematikan limiter-nya sendiri
- `api/core/rate_limit.py` menjelaskan bahwa default limit berlaku untuk setiap route
  lewat middleware. Tidak ada route yang pernah menerimanya
- `api/main.py:263` menulis *"A global default applies to every route via the
  middleware"*. Tidak pernah berlaku

### Yang sebenarnya membatasi hari ini

Bukan rate limit, melainkan `asyncpg` pool `max_size=10` di `api/core/db.py:63`.
Sepuluh koneksi; request berikutnya mengantre. Tidak ada sinyal apa pun yang terlihat —
pengguna merasakan latensi, bukan 503, dan tidak ada yang bisa melihat panjang antrean.

Keputusan Arsitektur

**Bukti dulu, baru perbaikan.** Task pertama menulis tes yang gagal hari ini. Kalau
perbaikannya nanti dihapus, tes itu harus kembali merah. Tes yang bisa hijau dengan
limiter mati tidak berguna sebagai bukti apa pun.

**Jangan andalkan `conftest` untuk mematikan fitur yang sedang diuji.** Suite mematikan
rate limit karena ratusan request dari satu IP akan menghabiskan anggaran 120/menit dan
menghasilkan 429 di tengah-tengah tes yang tidak disarmai. Solusinya batas khusus tes
yang jauh lebih longgar, bukan mematikan fiturnya — supaya jalur yang diuji adalah
jalur yang berjalan di produksi.

**In-process storage sudah benar untuk sekarang.** Satu proses uvicorn, jadi tidak ada
anggaran yang tergandakan. Store bersama baru relevan kalau nanti ada lebih dari satu
instance, dan itu keputusan tersendiri.

Task List

### Fase 1: Buktikan (gagal hari ini, harus gagal)

- [x] Task 1: Tes yang membuktikan limiter tidak tegak
- [x] Task 2: Suite berjalan dengan limiter menyala

### Checkpoint: Bukti

- [x] Tes Task 1 merah sebelum perbaikan, hijau sesudahnya
- [x] Suite penuh tetap hijau dengan `RATE_LIMIT_ENABLED=true`

### Fase 2: Perbaikan

- [x] Task 3: Evaluasi opsi perbaikan dan pilih satu
- [x] Task 4: Terapkan perbaikan yang dipilih

### Checkpoint: Perbaikan

- [x] `GET /v1/news` mengembalikan 429 setelah anggaran habis
- [x] Header batas dikembalikan
- [x] `/health` tetap tidak pernah dibatasi

### Fase 3: Batas per-endpoint

- [x] Task 5: Batas ketat pada endpoint yang mahal
- [x] Task 6: Hapus angka batas yang tidak pernah dipakai

### Checkpoint: Lengkap

- [x] Semua test hijau dengan limiter menyala
- [x] `docs/status.md` dan komentar di kode tidak lagi mengklaim sesuatu yang salah

---

Opsi Perbaikan (untuk Task 3)

| Opsi | Trade-off |
|------|-----------|
| **Turunkan FastAPI** ke versi sebelum `_IncludedRouter` | Menghilangkan masalahnya, tapi versi yang lebih baru biasanya membawa perbaikan keamanan, dan path yang sama dipakai `--reload`. Memperbaiki satu fitur dengan mengurangi yang lain |
| **Bungkus `app.routes`** supaya slowapi bisa melihatnya | Kecil dan terarah, tapi mengikat ke simbol privat `_IncludedRouter` yang akan berubah lagi. Bug yang sama akan kembali dalam bentuk berbeda |
| **Ganti slowapi** dengan limiter kecil milik sendiri | Coupling ke pihak ketiga hilang, dan perilakunya bisa dibaca satu file. Biaya: kode yang harus dipelihara sendiri, termasuk hitungan window yang benar |
| **slowapi versi lebih baru**, kalau ada yang mendukung | Paling bersih kalau ada. Perlu diperiksa lebih dulu — dan kalau tidak ada, jangan dipaksa |

Rekomendasi: periksa apakah ada rilis slowapi yang mendukung FastAPI 0.141 lebih dulu.
Kalau tidak ada, ganti dengan limiter sendiri daripada menambal simbol privat — bug ini
bukan kebetulan, dan bentuknya akan berulang.

Apa pun yang dipilih, Task 1 harus sudah ada lebih dulu supaya perbaikannya bisa
diukur, bukan diasumsikan bekerja.

Yang Tidak Dicakup

- **Store bersama untuk rate limit.** Baru relevan kalau ada lebih dari satu instance.
- **Load balancer sungguhan.** Tidak ada instance yang bisa diseimbangkan; aplikasi
  berjalan sebagai satu proses uvicorn.
- **Redis `maxmemory`.** Redis hari ini tanpa batas memori dan akan tumbuh sampai OOM.
  Itu masalah nyata dan terpisah dari rate limit — kalau ini yang Anda maksud, katakan
  saja dan saya susun plan terpisah.
- **Ukuran pool database.** `max_size=10` adalah langit-langit throughput sebenarnya,
  dan tidak ada backpressure yang terlihat. Terpisah dari rate limit, dan layak punya
  plan sendiri.

Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Perbaikan membuat limiter aktif, lalu suite mulai 429 di tengah-tengah | Tinggi | Batas khusus tes (Task 2), bukan mematikan fiturnya. Semua suite harus hijau dengan limiter menyala sebelum dianggap selesai |
| Membungkus `app.routes` dan `_IncludedRouter` berubah lagi di rilis berikutnya | Sedang | Kalau opsi itu dipilih, tes harus gagal saat route tidak ditemukan — bukan tes yang hanya memeriksa 429 muncul |
| Perbaikan membuat Redis jadi titik gagal | Sedang | `memory://` dipakai, jadi tidak ada. Kalau nanti pindah ke store bersama, kegagalan limiter harus membuka, bukan menutup: cache yang turun bukan alasan API ikut mati |
| Angka batas belum pernah diuji terhadap beban nyata | Sedang | Nilainya sekarang tebakan. Setelah limiter tegak, catat di `status.md` bahwa angka itu belum diukur — bukan sudah optimal |

Pertanyaan yang Masih Terbuka

- **Batas per-IP atau per-akun?** Sekarang per-IP. Di belakang reverse proxy,
  `get_remote_address` adalah alamat proxy — dan ADR-0004 sudah menandai ini sebagai
  kondisi yang belum ditangani. Menyelesaikannya berarti mempercayai
  `X-Forwarded-For`, yang hanya benar kalau proxy itu memang dipercaya
- **Apakah 120/menit cukup untuk `/v1/technicals/*` dan
  `/v1/portfolio/equity?days=1000`?** Keduanya mahal dan keduanya hanya mendapat
  default. Tidak bisa dijawab tanpa mengukur
- **Apakah 429 perlu `Retry-After`?** Backoff yang sopan atau penolakan keras