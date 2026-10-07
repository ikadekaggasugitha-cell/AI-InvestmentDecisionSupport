# Plan: Batas Memori Redis dan Batas Koneksi Database

Status: siap dikerjakan. Dua masalah terpisah yang kebetulan sama-sama
"benda-benda yang tidak dig Governed", jadi dikelompokkan di satu plan.

Keduanya **bukan** bagian dari rate limit. Rate limit mengatur *berapa banyak
request*, sedangkan keduanya mengatur *berapa banyak sumber daya yang boleh
dipakai* oleh request-request itu sendiri.

---

## Task 1: Redis tidak punya batas memori

### Temuan

`redis:7-alpine` di `docker-compose.yml:164` tidak punya `--maxmemory` maupun
`--maxmemory-policy`. Dikonfirmasi ke Redis yang hidup:

```
maxmemory : 0B          <- 0 berarti tidak ada batas sama sekali
used     : 827 KB (hampir semuanya market:snapshot)
jumlah key: 5
```

Tidak ada batas, tidak ada kebijakan evict. Kalau Redis kehabisan memori, tidak
ada yang memangkas. OOM killer akan membunuh prosesnya, dan itucontact bukan
error yang bisa ditangani — itu halaman mati.

### Ruang kunci yang bisa tumbuh

Kunci cache OHLCV: `ohlcv:{symbol}:{days}`.

- `symbol` divalidasi terhadap ~962 ticker.
- `days` divalidasi `ge=20, le=400` (`api/routers/technicals.py:93`), jadi 381 nilai.

962 × 381 = **~366.000 kunci**. Satu kunci 400 candles sekitar 40 KB, jadi
worst case-nya sekitar **14 GB** — semuanya masih sah, semua lolos validasi.

Yang membuatnya lebih buruk: TTL-nya 3600 detik (satu jam). Jadi satu akun
yang mengulang `days=20..400` untuk seluruh ticker sudah bisa menulis 366.000
kunci dalam satu jam, dan tidak ada yang hilang sampai jam ke-12.

### Mekanisme TTL-nya sendiri sudah benar

Dikonfirmasi langsung, bukan dari komentar:

```
redis_set_json(..., ttl=3600) -> ttl = 3600
redis_set_json(...)           -> ttl = -1
```

`setex` dipanggil dengan benar. Satu kunci `ohlcv:BBCA:120` yang masih hidup
punya `ttl: -1`, jadi itu artefak lama dari sebelum TTL ada, bukan bug yang
berulang. Tidak perlu perjalanan kalau tidak perlu.

### Temuan yang menentukan desain: Redis punya dua jenis data

Ini yang tidak boleh terlewat.

**Yang boleh di-evict:** `ohlcv:*`, `market:snapshot`, `drift:latest`,
`risk:portfolio:*`. Semuanya bisa dibangun ulang dari TimescaleDB. Evict = hemat
memori, dan justru itu gunanya.

**Yang tidak boleh di-evict:** `chat:{user_id}:{session_id}`. Riwayat
percakapan. Dikonfirmasi — tidak ada tabel chat/message di `db/migrations/`,
dan tidak ada penulisan ke Postgres dari `advisor_service.py`. **Redis satu-
satunya tempatnya**, dengan `SESSION_TTL = 3600` (satu jam).

Akibatnya `allkeys-lru` — kebijakan yang paling umum untuk cache — **salah**
untuk instalasi ini. Ia akan menghapus percakapan orang diam-diam pada saat
memori penuh. `noeviction` juga tidak menolong: Redis akan mulai menolak
perintah dengan `OOM command not allowed`, yang berarti chat berhenti tersimpan
dan pengguna melihat kesalahannya.

Jawaban jujur soal ini bukan teknis, tapi keputusan pemilik:

> Percakapan chat sudah hilang setelah satu jam dan tidak ada cadangan. Meng-evict
> tidak menciptakan kelas kehilangan baru — ia hanya membuat kehilangan yang
> sudah pasti terjadi terjadi lebih awal. Tapi kalau ada orang yang mengira
> percakapan theirs tersimpan, ituaglia adalah informasi yang salah.

### Temuan tambahan

`multi_loop_probe` ada di Redis produksi. Itu artefak dari test suite yang
menulis ke Redis sungguhan. Bukan bobot yang besar, tapi artinya tes dan
produksi berbagi satu cache — jadi ada yang perlu dipisahkan.

### Yang akan dikerjakan

Tunggu keputusan pemilik soal chat, lalu:

1. Set `--maxmemory` dan kebijakan evict di `docker-compose.yml`.
2. Pastikan tiap kunci jatuh ke kelas yang benar.
3. Hapus artefak `multi_loop_probe`, dan mencegah tes menulis ke Redis produksi.
4. Uji: isi Redis sampai melewati batas, pastikan terjadi evict — bukan OOM kill.
5. Tulis angka batasnya sebagai titik awal, bukan hasil ukur.

---

## Task 2: Pool database tidak punya batas antrean

### Temuan

`api/core/db.py:67`:

```python
_pool = await asyncpg.create_pool(
    dsn=_dsn(),
    min_size=1,
    max_size=10,
    command_timeout=30,
)
```

### Koreksi atas klaim sebelumnya

Saya sebelumnya menyebut `max_size=10` "langit-langit throughput" dan
memperkirakan maksimum 20 koneksi dari `max_overflow`. **Itu salah.**
asyncpg 0.31.0 tidak punya parameter `max_overflow` sama sekali — diverifikasi
dari `inspect.signature`. `max_size=10` adalah batas keras, bukan 20.

### Yang sebenarnya terjadi saat pool penuh

```
Pool.acquire(timeout=None)   # default asyncpg
```

Ketika 10 koneksi semuanya sibuk, `acquire()` **menunggu selamanya**. Tidak ada
batas tunggu. `command_timeout=30` hanya membatasi satu query, bukan antrean
menunggu di depannya.

Jadi bukan "pengguna dapat 503 yang bersih". Yang terjadi: 15 request pertama
berjalan, 6 sisanya menumpuk tanpa batas, latency naik tanpa henti, dan semua
pada akhirnya timeout di sisi klien sementara server tetap memegang them.
Respons yang lambat lebih merusak daripada yang ditolak.

### Koneksi yang menembus pool

Tiga tempat melakukan `asyncpg.connect()` langsung, melewati pool:

| Lokasi | Kapan |
|---|---|
| `api/main.py:368` | healthcheck `/health` |
| `api/services/market_service.py:103` | seed data pasar |
| `api/services/market_service.py:397` | `_fetch_latest_foreign_net` |

Semuanya sudah punya `finally: await conn.close()`, jadi tidak bocor. Dan
semuanya ada di jalur refresh/startup, bukan per-request. Jadi ini **bukan**
saturasi yang saya kira sebelumnya — dampaknya jauh lebih kecil dari yang saya
perkirakan.

Masalah sebenarnya cuma satu: `max_size=10` tidak pernah diukur, dan antreannya
tidak pernah dibatasi.

### Angka yang diukur

Diukur di mesin pengembangan (10 CPU, TimescaleDB lokal, data kecil), memakai
query yang mewakili jalur terpanas yang ada:

```
SELECT 1                      0.68 ms/query
users LIMIT 200               0.70 ms/query
sessions join users           0.73 ms/query
```

Satu koneksi cukup untuk lebih dari seribu query per detik pada beban ini.
`max_size=10` bukan langit-langit throughput — pada kondisi ini, sepuluh koneksi
adalah cadangan besar. Yang menentukan adalah jumlah request yang menunggu
bersamaan, bukan jumlah CPU.

Perilaku setelah batas dipasang, dengan pool dikuras:

```
 5 koneksi dipegang -> terlayani dalam   31 ms
10 koneksi dipegang -> PoolExhausted setelah 5.0 s
15 koneksi dipegang -> PoolExhausted setelah 5.0 s
20 koneksi dipegang -> PoolExhausted setelah 5.0 s
```

Antrean tanpa akhir sudah tidak ada. Yang berubah adalah bentuk kegagalannya.

### Koreksi: `/health` memang sudah benar sejak awal

Concern awal saya bahwa healthcheck akan ikut gagal saat pool penuh **tidak
terjadi**, dan bukan karena kebetulan. `api/core/db.py` sejak awal disengaja
memakai `asyncpg.connect()` sendiri untuk `/health`, dengan alasannya tertulis di
docstring: probe harus bisa menguji konektivitas mentah justru ketika pool
sibuk atau macet, karena di situlah readiness paling dibutuhkan. Tidak perlu
diubah. Sama untuk tiga bypass lainnya.

### Yang dikerjakan

1. **Batas tunggu dipasang.** `BoundedPool` membuat
   `fetch`/`fetchrow`/`fetchval`/`execute` punya deadline, dan kegagalan bernama
   `PoolExhausted` — bukan `TimeoutError` yang tidak bisa dibedakan dari query
   lambat.
2. **Metode tanpa koneksi diteruskan apa adanya** (`close`, `get_size`,
   `is_closing`). Membungkusnya akan mengirim koneksi palsu sebagai argumen
   pertama; `close()` melempar error, bukan bocor diam-diam. Ini yang membuat
   versi pertama salah.
3. **`max_size` tetap 10.** Sudah diukur, dan ternyata longgar. Tidak ada alasan
   menaikkan angka tanpa beban nyata yang lain.
4. **Tes `test_live_paths.py` diperbaiki.** Ia membandingkan `id()`, dan dua
   objek berbeda bisa berbagi `id()` setelah yang pertama di-garbage-collect.
   Sekarang membandingkan identitas dan loop-nya.