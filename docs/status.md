# Status Implementasi AIDSS

Satu-satunya sumber kebenaran tentang apa yang sudah ada dan apa yang belum. Kalau ada klaim tentang AIDSS di dokumen lain yang bertentangan dengan file ini, file ini yang benar.

Diverifikasi terhadap kode pada **2026-10-07**, setelah migrasi `0008` diterapkan. Cara verifikasi: setiap path file dan setiap nama endpoint yang disebut di bawah harus benar-benar ada, dan itu diperiksa oleh `backend/tests/test_docs_status.py`.

---

## Yang Sudah Ada

| Area | Status | Bukti |
| --- | --- | --- |
| Skema data pasar | Ada | 12 tabel dan 1 continuous aggregate di `backend/db/schema.sql` |
| Tabel `users` | Ada | `backend/db/migrations/0005_auth_and_sessions.sql`. Email unik per `lower(email)`, role hanya `user` dan `admin`, `blocked_at` nullable |
| Tabel `sessions` | Ada | `backend/db/migrations/0005_auth_and_sessions.sql`. Menyimpan `SHA-256` token, bukan token mentah |
| Tabel `subscriptions` | Ada | `backend/db/migrations/0005_auth_and_sessions.sql`. Hanya `user_id` dan `expires_at`, tanpa kolom status. Dipakai untuk menilai akses |
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
| Tab 2 Settings | Ada, sebagian | Status, tanggal berakhir, dan sisa hari dari server. Tidak ada tombol perpanjang atau invoice — endpoint pembayaran belum ada, dan kontrol yang tampak hidup tapi tidak berfungsi lebih buruk daripada tidak ada (R-26) |
| Portal admin | Ada | `/admin` di frontend: daftar akun plus blokir/buka blokir. Backend `backend/api/routers/admin.py`. URL tersendiri, tanpa entry sidebar — alat operasional, bukan navigasi. Non-admin mendapat 403 dan halamannya mengatakannya sendiri |
| Retensi consent | Ada | 24 bulan, sisakan yang terbaru (`CONSENT_RETENTION_MONTHS`). `backend/db/purge_consent.py`. Angka adalah kebijakan, configurable tanpa menyentuh kode ([ADR-0004](adr/0004-session-opaque-postgres-hash-fail-closed.md)) |
| Rate limit | Ada, teruji | `backend/api/core/rate_limit.py` (sliding window, in-process) plus `backend/api/core/rate_limit_middleware.py`. 8 tes di `backend/tests/test_rate_limit.py` proving 429 muncul. Suite berjalan dengan limiter menyala — `RATE_LIMIT_TEST_BUDGET` menaikkan ceiling, bukan mematikan fiturnya. Pergantian dari slowapi dicatat di ADR-0004 |
| Batas endpoint mahal | Ada | `/v1/advisor/chat` 10/menit, `/v1/technicals/ohlcv`, `/v1/portfolio/equity`, `/v1/symbols` 30/menit. **Angka ini belum diukur terhadap beban nyata** — titik awal, bukan hasil pengukuran |
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
| Tabel `transactions` | Belum | Ditunda ke Fase 2. Tidak ada jalur pembayaran, jadi tidak ada yang bisa mengisinya |
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