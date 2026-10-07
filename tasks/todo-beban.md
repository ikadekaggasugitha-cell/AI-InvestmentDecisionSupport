# Todo: Batas Memori Redis dan Batas Koneksi Database

Rencana di `tasks/plan-beban.md`. Task 2 selesai. Task 1 menunggu satu
keputusan yang sudah diberikan pemilik.

---

## Task 1: Redis tidak punya batas memori

**Keputusan pemilik: cache boleh di-evict, percakapan chat boleh hilang.**
Redis memakai `allkeys-lru`. `docs/status.md` harus mencatat bahwa riwayat chat
tidak dijamin, karena ia hanya ada di Redis dengan TTL satu jam.

### Task 1.1: Mengukur, bukan menebak

- [x] `maxmemory_human` terukur `0B`, 5 key, 827 KB. Tidak ada kebijakan evict.
- [x] Ruang kunci `ohlcv` dihitung: 962 ticker x 381 nilai `days` = ~366.000
      kunci, semuanya lolos validasi dan semuanya sah.
- [x] Mekanisme TTL diverifikasi langsung, bukan dari komentar:
      `redis_set_json(ttl=3600)` menghasilkan `ttl=3600`. Kunci `ttl:-1` yang
      masih hidup adalah artefak dari sebelum TTL ada, bukan bug berulang.
- [x] `chat:*` dikonfirmasi tidak punya salinan di Postgres — dicek lewat
      `CREATE TABLE` di seluruh migration dan penulisan di `advisor_service.py`.
- [x] `multi_loop_probe` ditemukan di Redis produksi: test suite menulis ke cache
      sungguhan.
- [x] ~~Men-fill Redis lewat kontainer~~ — diganti pengukuran langsung ke Redis
      yang hidup. Lebih jujur daripada simulasi, dan angkanya nyata.

### Task 1.2: Tetapkan batas dan kebijakan

- [ ] `--maxmemory` di `backend/docker-compose.yml`.
- [ ] `--maxmemory-policy allkeys-lru`, sesuai keputusan pemilik.
- [ ] Pastikan tidak ada key pattern yang ikut hilang akibat keputusan ini
      selain `chat:*` yang memang sudah tidak dijamin.
- [ ] Catat di `docs/status.md` bahwa riwayat chat tidak dijamin: hanya di
      Redis, TTL satu jam, sekarang juga bisa ter-evict.
- [ ] Cegah test suite menulis ke Redis produksi, atau beri prefix test
      (`multi_loop_probe` adalah buktinya).

### Task 1.3: Terapkan dan buktikan

- [ ] `docker compose up -d redis`, verifikasi `maxmemory_human` bukan lagi `0B`.
- [ ] Uji evict: isi sampai melewati batas, pastikan terjadi evict dan **tidak**
      ada OOM kill.
- [ ] Pastikan `/health` tetap hijau saat Redis penuh — limiter sudah gagal
      terbuka, cache harus ikut tidak menggigit juga begitu.
- [ ] Angka batas ditulis sebagai titik awal, bukan hasil pengukuran.

---

## Task 2: Pool database tidak punya batas antrean

### Task 2.1: Membuktikan antreannya tidak terbatas

- [x] `Pool.acquire(timeout=None)` — tidak ada batas tunggu di default asyncpg.
- [x] Pool yang dikuras tidak melempar error, hanya menunggu tanpa akhir.
- [x] Koreksi atas klaim sebelumnya: asyncpg 0.31.0 **tidak punya**
      `max_overflow`. `max_size=10` adalah batas keras, bukan 20.
- [x] `command_timeout=30` tidak membatasi antrean, hanya satu query.
- [x] ~~Test: healthcheck ikut gagal saat pool penuh~~ — **tidak terjadi**, dan
      memang sudah dicegah sejak awal di `api/core/db.py` secara sengaja,
      dengan alasannya tertulis di docstring. Tidak perlu diubah.

### Task 2.2: Membatasi antrean

- [x] `BoundedPool` membungkus pool sehingga `fetch`, `fetchrow`, `fetchval`
      dan `execute` punya deadline. Satu titik ubahan, 33 call site ikut terlindungi.
- [x] Kegagalan bernama `PoolExhausted`, dibedakan dari `asyncio.TimeoutError`
      yang berarti query lambat.
- [x] `close`, `get_size`, `is_closing` diteruskan apa adanya — metode-metode ini
      tidak menerima koneksi, dan membungkusnya mengirim koneksi palsu sebagai
      argumen pertama. `close()` melempar error, bukan bocor diam-diam.
- [x] `DB_ACQUIRE_TIMEOUT` dan `DB_POOL_MAX_SIZE` masuk `.env.example`.

### Task 2.3: Mengukur, lalu menentukan ukuran

- [x] Query terukur di mesin pengembangan (10 CPU, TimescaleDB lokal):
      `SELECT 1` 0.68 ms, `users LIMIT 200` 0.70 ms, `sessions join users`
      0.73 ms.
- [x] `max_size` **tetap 10**. Sepuluh koneksi ternyata longgar pada beban ini;
      tidak ada alasan menaikkan angka tanpa beban yang lain.
- [x] Perilaku saat pool dikuras dicatat: 5 koneksi → terlayani 31 ms;
      10, 15, 20 koneksi → `PoolExhausted` setelah 5.0 s.

### Task 2.4: Tes yang menangkap perbaikannya

- [x] Meneruskan `timeout=None` ke `pool.acquire()` membuat tes merah.
      Diverifikasi dengan mematikan perbaikan sementara.
- [x] Keempat metode ter-cover.
- [x] `get_pool()` mengembalikan `BoundedPool` — tanpa ini semua tes di atas
      hanya menggambarkan pool yang tidak dipakai aplikasi.
- [x] `test_live_paths.py` diperbaiki: ia membandingkan `id()`, dan dua objek
      berbeda bisa berbagi `id()` setelah yang pertama di-garbage-collect.
      Sekarang membandingkan identitas dan loop. Terbukti menangkap regresi
      ketika pemeriksaan loop sengaja dimatikan.