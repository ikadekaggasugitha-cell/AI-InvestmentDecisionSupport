# Implementation Plan: Menutup Sisa Gap yang Tidak Tertunda ke Fase 2

## Gambaran

`docs/status.md` mencantumkan item yang belum ada. Sebagian tertunda ke Fase 2
(penagihan, notifikasi, portal admin) dan tidak dicakup plan ini, karena
menundanya adalah keputusan yang sudah diambil. Sebaliknya, plan ini menangani gap
yang tidak butuh pembayaran dan bisa diselesaikan sekarang.

Semuanya bertumpu pada satu tema: ada kemampuan yang tidak pernah ditanyakan
kepada pengguna. Contoh paling mengganggu adalah `blocked_at` — kolomnya ada,
tapi tidak ada satu pun kode yang menulisnya, jadi memblokir akun secara harfiah
tidak dapat dilakukan.

Semua item sudah terverifikasi terhadap kode pada commit `29bb714`.

## Batasan Plan Ini

**Di luar scope:** tabel `transactions`, `system_settings`, `notification_logs`,
checkout/pembayaran, integrasi email/WhatsApp, portal admin.

Alasannya ada di `docs/status.md`: "Penagihan uang sungguhan ditunda sampai Fase 2 dan
Fase 5 selesai — Tertunda. ADR-nya belum ditulis". Merencanakan Fase 2 berarti
mengarang keputusan yang oleh owner sendiri dicatat belum diambil. Itu pekerjaan
tersendiri dan perlu ADR lebih dulu.

Konsekuensi yang harus diterima: sampai Fase 2 ada, **tidak ada cara mendapatkan
Subscription**. Jadi Tab 2 Settings dan "/admin" tetap kosong. Plan ini tidak
menyembunyikan itu — ia hanya memastikan sisanya benar.

## Keputusan Arsitektur

**Satu write path per fakta.** `blocked_at` ditulis lewat satu fungsi di
`accounts.py`, bukan langsung dari router. Kalau dua tempat bisa menulis, blokir bisa
dibatalkan tanpa jejaknya — pola yang sama yang membuat `owner_sub` dan
`PORTFOLIO_LOTS` bermasalah.

**Blokir berlaku seketika, bukan saat request berikutnya.** `authenticate()` sudah
membaca `blocked_at` dalam satu `JOIN`. Yang belum ada adalah penulisknya, jadi
tidak perlu mengubah apa pun di jalur otorisasi. Inilah alasan item ini berukuran S, bukan M.

**Validasi simbol dicek di DB, bukan di daftar frontend.** Universe ada di
tabel `instruments` (962 baris). `useUniverse` sudah ambil dari sana, tapi validasi
write harus ditanya ke server: peramban bisa mengirim apa saja, dan posisi yang
menunjuk saham fiktif membuat seluruh analitik di atasnya tidak bermakna.

**Consent log ditulis setelah persetujuan diterima, bukan saat modal dibuka.**
Satu `POST` dengan `account_id`, `version`, dan `accepted_at`. Kalau gagal, frontend
tetap menampilkan modal pada load berikutnya — lebih benar daripada menganggap
seseorang sudah menyetujui sesuatu yang tidak tercatat.

## Task List

### Fase 1: Dokumen yang Sudah Salah (fail cepat, murah)

- [x] Task 1: Perbaiki baris `docs/status.md` yang stale
- [x] Task 2: Alias `localStorage` — dibatalkan, premis plan salah. Lihat Task 2 di todo.md

### Checkpoint: Fase 1 — SELESAI
- [x] Setiap baris "Belum" di `docs/status.md` diverifikasi ulang terhadap kode
- [x] Semua 17 path yang diklaim `status.md` benar-benar ada
- [x] Test konsistensi dokumen hijau (578 backend)

### Fase 2: Menulis `blocked_at`

- [x] Task 3: Fungsi writer `blocked_at` di `accounts.py`
- [x] Task 4: Endpoint admin daftar akun, blokir, buka blokir
- [x] Task 5: Bukti blokir berlaku seketika di HTTP dan WebSocket

### Checkpoint: Fase 2 — SELESAI
- [x] 605 test backend hijau
- [x] Akun terblokir kehilangan akses pada request berikutnya, HTTP dan WebSocket
- [x] Non-admin mendapat 403 di ketiga endpoint admin
- [x] Dibuktikan dengan menghapus cek: 3 tes HTTP dan 1 tes WebSocket jadi merah
- [x] `docs/status.md` diperbarui

### Fase 3: Integritas posisi

- [x] Task 6: Validasi simbol posisi terhadap tabel `instruments`
- [x] Task 7: Hapus posisi yang menunjuk saham yang sudah tidak tercatat

### Checkpoint: Fase 3 — SELESAI
- [x] 617 test backend hijau
- [x] `PUT /v1/portfolio/positions` menolak simbol yang tidak ada
- [x] `db/purge_positions.py` idempoten dan punya `--dry-run`
- [x] `docs/status.md` diperbarui

### Fase 4: Audit log sisi server untuk Gate 2

- [x] Task 8: Tabel `consent_acceptances` + fungsi tulis
- [x] Task 9: Endpoint consent dan pengiriman dari frontend

### Checkpoint: Fase 4 — SELESAI
- [x] Persetujuan dapat dibaca balik dari database
- [x] Kegagalan POST tidak menahan modal tertutup
- [x] Akun dan versi teks berasal dari server, bukan dari body
- [x] `docs/legal-and-consent.md` §5 diperbarui

### Fase 5: Jalur baca Subscription

- [x] Task 10: `GET /v1/subscription/current`
- [x] Task 11: Tab 2 Settings menampilkan status dan sisa hari

### Checkpoint: Lengkap — SELESAI
- [x] 637 backend dan 200 frontend hijau
- [x] `npx tsc --noEmit` bersih, ruff bersih, 8 warning ESLint baseline
- [x] Semua 11 task selesai, 1 dibatalkan dengan alasan tercatat
- [x] `docs/status.md`, `legal-and-consent.md`, dan `settings-module-spec.md` disinkronkan
- [ ] Tinjau dengan manusia

## Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Migrasi `consent_acceptances` tidak bisa dibatalkan | Sedang | Tabel baru, tidak menyentuh tabel yang ada. Migration idempoten |
| Blokir(account) salah sasaran karena UUID vs email | Tinggi | Endpoint menerima UUID saja; email tidak pernah jadi parameter path |
| Validasi simbol menolak saham yang baru tercatat | Sedang | Kalau `instruments` kosong (fresh deploy), validasi dilewati dengan warning, bukan menolak semua posisi |
| `avgPrice` jadi null setelah migrasi | Rendah | Sudah terjadi di `0008` dan memang disengaja; `—` sudah ditampilkan |
| Task 11 memaksa Tab 2 menampilkan angka yang tidak ada | Tinggi | Task 11 memperlakukan `GET` yang belum ada sebagai empty state, bukan zeroes |

## Pertanyaan Terbuka

- **Portal admin UI.** Plan ini hanya memberi endpoint admin. `/admin` di frontend
  masih kosong, dan owner belum memutuskan bentuknya. Butuh keputusan terpisah.
- **Retensi consent log.** GDPR/UU PDP meminta masa simpan. Tidak ada yang memutuskan
  berapa lama. Untuk sekarang log tidak dihapus otomatis.
- **Apakah blokir harus mengakhiri sesi.** Saat ini memblokir hanya menolak request
  berikutnya; baris `sessions` milik akun itu masih ada. Menghapus sesi seketika
  lebih bersih, tapi mengubah perilaku yang sudah didokumentasikan di ADR-0004.