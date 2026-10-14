# Status Implementasi AIDSS

Satu-satunya sumber kebenaran tentang apa yang sudah ada dan apa yang belum. Kalau ada klaim tentang AIDSS di dokumen lain yang bertentangan dengan file ini, file ini yang benar.

Diverifikasi terhadap kode pada **2026-10-07**, setelah migrasi `0008` diterapkan. Cara verifikasi: setiap path file dan setiap nama endpoint yang disebut di bawah harus benar-benar ada, dan itu diperiksa oleh `backend/tests/test_docs_status.py`.

---

## Yang Sudah Ada

| Area | Status | Bukti |
| --- | --- | --- |
| Skema data pasar | Ada | 14 tabel dan 1 continuous aggregate di `backend/db/schema.sql`. Tambah 2 dari 12: `consent_acceptances` (migrasi `0009`) dan `transactions` (migrasi `0010`). Angka 12 yang ada sebelumnya sudah basi sejak `0009` |
| Tabel `users` | Ada | `backend/db/migrations/0005_auth_and_sessions.sql`. Email unik per `lower(email)`, role hanya `user` dan `admin`, `blocked_at` nullable |
| Tabel `sessions` | Ada | `backend/db/migrations/0005_auth_and_sessions.sql`. Menyimpan `SHA-256` token, bukan token mentah |
| Tabel `subscriptions` | Ada | `backend/db/migrations/0005_auth_and_sessions.sql`. Hanya `user_id` dan `expires_at`, tanpa kolom status. Dipakai untuk menilai akses. **Tidak ada yang menulisnya**: nol baris `INSERT`/`UPDATE` di seluruh backend, jadi belum ada jalur yang bisa menghasilkannya ([ADR-0008](adr/0008-transaksi-kunci-idempotensi-webhook.md)) |
| Tabel `transactions` | Ada, tapi kosong | `backend/db/migrations/0010_transactions.sql` dan `backend/db/schema.sql`. Alur uang saja, tidak menyentuh hak akses. `uq_transactions_midtrans_transaction_id` adalah kunci idempotensi webhook. **Belum ada yang menulisnya**: nol baris endpoint pembayaran dan webhook, jadi tabel ini kosong di setiap install dan batasan itu belum pernah dieksploitasi ([ADR-0008](adr/0008-transaksi-kunci-idempotensi-webhook.md)) |
| Kepemilikan portfolio | Selesai | `owner_sub` dicabut di `0006`. `user_id` sekarang `NOT NULL` dengan foreign key, dan kedua index sudah pindah |
| Migrasi DB | Ada | `backend/db/migrations/0001` sampai `0008`, runner `backend/db/migrate.py` dengan ledger sha256 |
| Worker latar | Ada | 7 task terjadwal di `backend/workers/celery_app.py:66-144`, zona `Asia/Jakarta` |
| Redis | Ada | `backend/api/core/redis_client.py`, 14 key namespace |
| Feed berita IDX | Ada | `backend/api/services/news_service.py` |
| Kebersihan data | Ada | Seed berita fiktif dihapus, `useNews` mengembalikan `error` dan `retry` |
| Gate 2 persetujuan di dalam aplikasi | Ada | `src/app/components/ConsentGate.tsx`, dipakai AI Advisor dan `StockDetailPanel`. Penanda peramban per akun di `src/app/components/consent.ts` |
| Paywall WebSocket | Ada | `backend/api/routers/market_ws.py:138-152` memeriksa session, status blokir, lalu entitlement sebelum accept, fail-closed |
| Endpoint admin akun | Ada | `backend/api/routers/admin.py`: daftar akun, blokir, buka blokir. Role-gated lewat `AdminUser`, path parameter hanya UUID, dan admin tidak bisa memblokir dirinya sendiri |
| Audit log persetujuan Gate 2 | Ada | Tabel `consent_acceptances` (migrasi `0009`), `backend/api/services/consent.py`, dan `POST`/`GET /v1/auth/consent`. Versi teks yang disetujui ikut disimpan, jadi persetujuan versi lama tetap terbaca tanpa dihitung sebagai persetujuan atas teks sekarang |
| Jalur baca Subscription | Ada | `GET /v1/subscription/current`. Authenticated tapi **tidak** entitlement-gated, karena account yang sudah ditolak tidak bisa bertanya kenapa. Hari tersisa dihitung di server; tanggal mulai tidak dilaporkan karena `subscriptions` tidak menyimpannya |
| Tab 2 Settings | Ada, sebagian | Status, tanggal berakhir, dan sisa hari dari server, dengan tiga keadaan terpisah (aktif / tidak ada / gagal ditanyakan) — `unknown` bukan `none`, supaya orang dengan langganan aktif tidak diberi tahu bahwa langganannya habis. Tidak ada tombol perpanjang atau invoice — endpoint pembayaran belum ada, dan kontrol yang tampak hidup tapi tidak berfungsi lebih buruk daripada tidak ada (R-26) |
| Portal admin | Ada | `/admin` di frontend: daftar akun plus blokir/buka blokir. Backend `backend/api/routers/admin.py`. URL tersendiri, tanpa entry sidebar — alat operasional, bukan navigasi. Non-admin mendapat 403 dan halamannya mengatakannya sendiri |
| Retensi consent | Ada | 24 bulan, sisakan yang terbaru (`CONSENT_RETENTION_MONTHS`). `backend/db/purge_consent.py`. Angka adalah kebijakan, configurable tanpa menyentuh kode ([ADR-0004](adr/0004-session-opaque-postgres-hash-fail-closed.md)) |
| Rate limit | Ada, teruji | `backend/api/core/rate_limit.py` (sliding window, in-process) plus `backend/api/core/rate_limit_middleware.py`. 8 tes di `backend/tests/test_rate_limit.py` proving 429 muncul. Suite berjalan dengan limiter menyala — `RATE_LIMIT_TEST_BUDGET` menaikkan ceiling, bukan mematikan fiturnya. Pergantian dari slowapi dicatat di ADR-0004 |
| Batas endpoint mahal | Ada | `/v1/advisor/chat` 10/menit, `/v1/technicals/ohlcv`, `/v1/portfolio/equity`, `/v1/symbols` 30/menit. **Angka ini belum diukur terhadap beban nyata** — titik awal, bukan hasil pengukuran |
| Batas memori Redis | Ada, teruji | `maxmemory 256mb` + `allkeys-lru` di `backend/docker-compose.yml`. Tanpa ini Redis tumbuh sampai OOM kill — halaman mati, bukan error yang bisa ditangani. Diuji: 20.000 kunci 20 KB melewati batas → 17.286 key ter-evict, container tetap hidup, `/health` tetap 200 |
| Antrean pool database | Ada, teruji | `BoundedPool` di `backend/api/core/db.py` memberi deadline pada `fetch`/`fetchrow`/`fetchval`/`execute`; kegagalan bernama `PoolExhausted`. asyncpg 0.31.0 **tidak punya** `max_overflow`, jadi `DB_POOL_MAX_SIZE` (10) adalah batas keras. Diukur 0.68–0.73 ms/query, jadi 10 koneksi longgar pada beban ini. Plan: [tasks/plan-beban.md](../tasks/plan-beban.md) |
| Test tidak menulis ke cache produksi | Ada | `no_live_redis` (autouse) di `backend/tests/conftest.py` gagalkan test yang menulis ke Redis sungguhan. Pernah `signals:latest`, `drift:latest`, dan `risk:portfolio:default` muncul di cache produksi setelah suite jalan |
| Kode penolakan per penyebab | Ada | `backend/api/routers/market_ws.py` memakai 1008 untuk penolakan identitas dan **4403** untuk sesi sah tanpa langganan. Sebelumnya ketiganya 1008 dan `useLiveMarket` membaca setiap 1008 sebagai sesi habis, sehingga paywall **melogout akun yang sah**. `src/app/hooks/useLiveMarket.ts` sekarang membedakan keduanya; `reason` tetap dibawa sebagai teks, bukan pembeda ([ADR-0009](adr/0009-kode-penolakan-per-penyebab.md)) |
| 402 diproses sebagai sinyal, bukan string | Ada | `src/app/config/api.ts` memancarkan `PAYWALL_EVENT` dengan latch dan reset seperti `AUTH_EXPIRED_EVENT`. Sebelumnya `apiFetch` hanya menangani 401; delapan hook melempar `HTTP 403` mentah dan penolakan langganan sampai ke layar sama bentuknya dengan bug server |
| Penyebab kegagalan dibawa oleh hook | Ada, sebagian | `useRiskMetrics`, `usePortfolio`, `useAISignals`, `usePortfolioOptimisation`, `useEquityCurve`, `useReports`, dan `useTechnicals` menyimpan `failure: { kind: "locked" \| "unreachable" }`. Klasifikasi tunggal ada di `classifyLoadError` (`src/app/config/api.ts`). `useAccumulationMap`, `useAlerts`, dan `useUniverse` belum — error mereka tidak pernah sampai ke layar sebagai penyebab, jadi belum Prioritas |
| Penolakan langganan dibedakan dari penolakan lain | Ada | Gerbang entitlement menjawab **402**, bukan 403. Akun yang diblokir dan non-admin di route admin juga 403, jadi membaca 403 sebagai "butuh langganan" akan memberi tahu orang yang diblokir untuk mengecek tagihannya, dan memberi tahu pengguna biasa bahwa tagihannya sebab halaman admin tidak terbuka. `apiFetch` dan `classifyLoadError` hanya mengenali 402 ([ADR-0009](adr/0009-kode-penolakan-per-penyebab.md)) |
| Angka simulasi diberi label yang benar | Ada | `RiskView` dan `AIAdvisorView` menampilkan "langganan belum aktif" untuk 402 dan "backend tidak terjangkau" hanya untuk kegagalan jaringan. `ReportsView` dan `AllocationPanel` berhenti menampilkan status mentah. `DataFreshnessBadge` membedakan feed yang terkunci dari yang mati. Angka seed tetap tampil dan tetap berlabel — yang diperbaiki adalah penyebabnya |
| Banner langganan di shell | Ada | `src/app/components/PaywallNotice.tsx`, satu elemen di `src/app/App.tsx`, mengarah ke Tab 2 Settings. **Tanpa tombol beli** — tidak ada jalur pembayaran (R-26) |
| Peringatan kombinasi dev | Ada | `AUTH_BYPASS=true` + `PAYWALL_ENABLED=true` memunculkan peringatan saat start: gerbang tidak akan pernah menyala di proses itu. Peringatan, bukan penolakan boot — berhenti boot akan menghentikan kerja lokal dan menambah satu alasan gerbang tidak pernah diuji |
| Harga langganan dan endpoint publiknya | **Sudah diputuskan, belum ada kodenya** | Harga **sudah diputuskan**: Rp 15.000/bulan dan Rp 150.000/tahun (`docs/saas-subscription-platform.md:16-19`). Endpoint `GET /v1/subscriptions/pricing` **sudah dispesifikasikan sebagai publik** (`docs/saas-subscription-platform.md:371`). Yang belum ada adalah tabel `system_settings` tempat harga dibaca, jadi halaman harga untuk pengunjung tanpa sesi masuk Fase 2. Bukan "harga belum diputuskan" |
| **Riwayat chat tidak dijamin** | **Diserahkan** | Hanya ada di Redis, TTL satu jam, tanpa salinan di Postgres. Sekarang juga bisa ter-evict oleh `allkeys-lru`. **Keputusan pemilik: boleh hilang.** Kalau percakapan perlu bertahan, ia harus pindah ke Postgres dulu — lihat Task 1 di [tasks/plan-beban.md](../tasks/plan-beban.md) |
| CLI operasional | Ada | `backend/db/promote_admin.py` membaca `ADMIN_EMAIL`, `backend/db/purge_sessions.py` menghapus session kedaluwarsa, `backend/db/purge_consent.py` membersihkan consent lama, `backend/db/purge_positions.py` membersihkan posisi yang ticker-nya tidak tercatat. Semuanya punya `--dry-run` dan tes. Belum dijadwalkan di Celery beat |
| Analytics per portfolio | Ada | `backend/api/services/portfolio_access.py` `load_lots` adalah satu-satunya jalur baca posisi. Risk, kurva ekuitas, snapshot WebSocket, dan risk worker semuanya memakainya ([ADR-0005](adr/0005-analytics-baca-baris-portfolio.md)) |
| Tidak ada posisi fabricated di layar | Ada | `PORTFOLIO_HOLDINGS` di `src/app/data/idxData.ts` dihapus. `usePortfolio` membaca server, dan `useLiveMarket` tidak lagi menghitung total portofolio dari seed, meneruskan nilai yang dihitung server per akun |
| Validasi ticker posisi | Ada | `PUT /v1/portfolio/positions` menolak simbol yang tidak ada di `instruments`. Universe kosong berarti fresh deploy, jadi validasi dilewati dengan warning — menolak semua posisi di install baru lebih berbahaya daripada menerima satu ticker nakal |
| Positions API | Ada | `GET`/`PUT /v1/portfolio/positions`. Whole-portfolio replace, jadi daftar kosong berarti menghapus. `avgPrice` ikut disimpan di `lots_json`, karena harga beli tidak bisa diturunkan dari feed harga |
| Cost basis yang tidak diketahui | Ada | `avgPrice` null, bukan 0. Kolom P&L menampilkan `—`, dan total biaya hanya muncul kalau semua posisi punya harga |
| Invalidasi cache saat posisi berubah | Ada | `portfolio_access.invalidate_portfolio_caches` menghapus risk, optimasi, dan kurva ekuitas. Hasil risk kosong sengaja tidak di-cache, karena posisi pertama yang ditambahkan baru terlihat setelah TTL satu jam |
| Portfolio kosong dijawab jujur | Ada | `risk_service` mengembalikan `positionsCount: 0` dengan metrik nol, `EquityCurveResponse.source` punya nilai `"empty"`, dan snapshot bernilai nol. Baseline Rp 13,1 miliar sudah dihapus |

## Yang Belum Ada

Tidak ada satu pun item di bawah ini yang ada di kode. Setiapnya tercatat supaya tidak ada yang mengira sudah selesai.

| Area | Status | Kenapa belum |
| --- | --- | --- |
| Tabel `system_settings` | Belum | Ditunda ke Fase 2. Harga dan rekening tujuan tidak ada sumbernya |
| Tabel `notification_logs` | Belum | Ditunda ke Fase 2. Belum ada kanal notifikasi |
| Checkout dan pembayaran | Belum | Tidak ada UI dan tidak ada endpoint. Midtrans, QRIS, dan upload bukti nol baris kode |
| Integrasi email dan WhatsApp | Belum | Nol baris kode. Ini kanal notifikasi tunggal yang dirancang, dan belum ada |


## Keputusan yang Sudah Disepakati

Keputusan di bawah sudah final dan sudah diterapkan. Alasan lengkapnya ada di `docs/adr/`.

| Keputusan | Sumber |
| --- | --- |
| Tetap raw SQL tanpa ORM. Setiap tabel baru masuk `backend/db/schema.sql` **dan** `backend/db/migrations/` | [ADR-0001](adr/0001-tetap-raw-sql-tanpa-orm.md) |
| `owner_sub` diganti `user_id` secara bertahap, tidak dibuang dalam satu tahap | [ADR-0002](adr/0002-ganti-owner-sub-dengan-user-id-uuid.md) |
| Session opaque di Postgres, hash saat disimpan, paywall fail-closed | [ADR-0004](adr/0004-session-opaque-postgres-hash-fail-closed.md) |
| Analytics membaca baris portfolio, bukan konstanta bersama. **Diterima, sudah diterapkan** | [ADR-0005](adr/0005-analytics-baca-baris-portfolio.md) |
| `users.role` hanya berisi `user` dan `admin`. Nilai `subscriber` dihapus sepenuhnya | [ADR-0002](adr/0002-ganti-owner-sub-dengan-user-id-uuid.md) |
| `subscriptions` tidak punya kolom status. Akses diturunkan dari tanggal berakhir | [ADR-0002](adr/0002-ganti-owner-sub-dengan-user-id-uuid.md) |
| Registrasi terbuka tanpa pembayaran | [ADR-0004](adr/0004-session-opaque-postgres-hash-fail-closed.md) |
| Penagihan uang sungguhan ditunda sampai Fase 2 dan Fase 5 selesai | Tertunda. ADR-nya belum ditulis |
| Gate 2: audit log persetujuan sisi server | Belum | Modal dan penyimpanan peramban sudah ada, tapi tidak ada tabel yang merekam siapa menyetujui apa dan kapan, jadi persetujuan tidak bisa dibuktikan kepada regulator |

## Utang yang Diketahui

Hal berikut disengaja untuk sekarang, dan akan menggigit kalau tidak dicatat.

| Utang | Kenapa ditinggalkan |
| --- | --- |
| `subscriptions` belum punya `plan_type` dan `price_paid` | Keduanya butuh pembayaran. Sekarang akan jadi kolom kosong |
| Sesi kedaluwarsa menumpuk | Ada CLI (`python -m db.purge_sessions`), tapi belum dijadwalkan. Tabel tumbuh sampai seseorang menjalankannya. Butuh satu DELETE pada `idx_sessions_expires_at` |
| Consent lama menumpuk | Sama: ada `db/purge_consent.py`, belum dijadwalkan |
| Blokir tidak menghapus sesi | Keputusan, bukan utang. Sesi tetap hidup dan ditolak selama `blocked_at` terisi. Terbuka blokir akan menghidupkan lagi ([ADR-0004](adr/0004-session-opaque-postgres-hash-fail-closed.md)) |
| Key `aidss-portfolio` masih ada di peramban sebagian orang | Tidak dibaca dan tidak ditulis siapa pun sejak posisi pindah ke server. Data lama orang tinggal di localStorage tanpa ada yang menghapusnya |

## Dokumen yang Perlu Dibaca dengan Hati-hati

| Dokumen | Kenapa |
| --- | --- |
| `docs/saas-subscription-platform.md` | Menulis "Implementation-Ready" dan "SQLAlchemy / asyncpg". Keduanya sudah dikoreksi sebagian, tapi rinciannya masih banyak yang belum ada |
| `docs/legal-and-consent.md` | Draft internal dan belum berlaku. Tidak mengikat siapa pun sampai penagihan ada dan tinjauan Qualified Legal Professional selesai. Gate 2 sudah ada separuh, dan Bagian 1 §4 sekarang hanya menyebut data yang benar-benar dikumpulkan |
| `docs/settings-module-spec.md` | Bagian checklist menandai file yang tidak ada. Status riil ada di bagian atas file itu |