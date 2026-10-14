# Implementation Plan: Harga yang Ditentukan Admin

## Gambaran

`system_settings` adalah tabel yang sudah dispesifikasikan di
`docs/saas-subscription-platform.md:251-268` tapi belum ada di kode, dan itulah
sebabnya `docs/status.md` mencatat *"Harga dan rekening tujuan tidak ada
sumbernya"*. Plan ini membuat sumber itu ada: satu kunci `pricing`, dibaca lewat
endpoint publik, ditulis lewat endpoint admin, dan bisa diubah dari panel admin.

Harga yang dihasilkan adalah **nominal**, bukan langganan. Tidak ada checkout,
tidak ada webhook, tidak ada yang membaca harga untuk membuat Subscription.
Yang berubah karena plan ini: harga punya satu sumber yang bisa dibaca, dan
seseorang bisa memperbarinya tanpa akses database.

## Keputusan yang Sudah Diambil

**Seed 15000 / 150000 saat migrasi, sesuai blueprint.** Harga sudah diputuskan
pemilik dan tertulis di dua tempat dokumen. Memulai dengan kosong akan membuat
aplikasi bilang "harga belum ada" padahal sudah ada — itu berdusta ke arah lain.
Setelah migrasi, tabel adalah satu-satunya sumber.

**Hanya kunci `pricing`.** `bank_accounts` dan `contact_support` ada di blueprint
yang sama, tapi keduanya milik jalur pembayaran yang belum ada. Menambahkannya
sekarang berarti membangun sesuatu yang belum bisa dipakai, dan `docs/status.md`
sudah menandainya tertunda Fase 2.

**Nilai di prosa dokumen bukan sumber.** `saas-subscription-platform.md:16-19`
tetap menyebut Rp 15.000 dan Rp 150.000, tapi angka itu berhenti menjadi harga
saat ini begitu admin bisa mengubahnya. Ini dicatat di ADR-0010, karena-readable-
as-current adalah cara tercepat membuat dokumen ini bohong.

## Yang Tidak Berubah

- `require_entitlement` tetap. Gerbang tidak tahu apa pun soal harga.
- `subscriptions` tetap tanpa kolom status (CONTEXT.md aturan 1).
- Tidak ada jalur pembelian, tidak ada tombol Beli, tidak ada halaman harga untuk
  pengunjung tanpa sesi. Endpoint publiknya ada supaya harganya bisa dibaca; halaman
  yang memakainya adalah potongan berikutnya, bukan potongan ini.
- Rekening tujuan dan kontak tetap tertunda.

## Keputusan Arsitektur

**Satu fungsi tulis, satu fungsi baca, keduanya di `api/services/settings.py`.**
Pola yang sama dengan `accounts.py` untuk `blocked_at`: kalau dua tempat bisa
menulis, pembaruan bisa saling menimpa tanpa jejaknya.

**Harga divalidasi di service, bukan di router.** Router menolak bentuk yang salah
(Pydantic); service menolak harga yang tidak masuk akal. Menaruh angka batas di
dua tempat berarti keduanya akan berbeda.

**Endpoint publik menjawab 503 kalau barisnya hilang, bukan nol.** Baris `pricing`
dijamin ada oleh migrasi. Kalau tidak, itu instalasi yang rusak, dan
`{"monthly": 0}` adalah harga yang tidak pernah ada — lebih baik gagal keras
daripada dijawab dengan angka yang tidak benar.

**Admin melihat jawaban server, bukan angka yang diketiknya.** Setelah simpan,
panel memuat ulang dari server. Kolom `updated_at` ada justru supaya "kapan harga
terakhir diubah" bisa dijawab tanpa tabel audit.

**UI admin memisahkan bentuk dari Server.** `AdminView` sudah 318 baris dan
bertanggung jawab atas akun. Menambah form harga ke sana akan mendorong satu file
menjadi dua tanggung jawab; komponennya dipisah dan `/admin` memakai tab.

## Task List

### Fase 1: Sumber tunggal

- [x] Task 1: Tabel `system_settings` + migrasi 0011 + `schema.sql`
- [x] Task 2: `api/services/settings.py` — baca & tulis harga dengan validasi

### Checkpoint: Fase 1
- [x] Tabel ada di migration **dan** `schema.sql`
- [x] Migrasi idempoten dan tidak menimpa harga yang sudah diubah admin
- [x] Harga negatif, nol, atau di luar batas ditolak

### Fase 2: Dua arah baca

- [x] Task 3: `GET /v1/subscriptions/pricing` — publik
- [x] Task 4: `PUT /v1/admin/settings/pricing` — admin

### Checkpoint: Fase 2
- [x] Publik: tanpa sesi tetap dijawab 200
- [x] Non-admin mendapat **403**, bukan 402 (bukan masalah langganan)
- [x] Admin mengubah harga → endpoint publik langsung melaporkan yang baru

### Fase 3: Panel dan konsumen

- [x] Task 5: `AdminPricingView` + tab di `/admin`
- [x] Task 6: Tab 2 Settings menampilkan harga dari server

### Checkpoint: Fase 3
- [x] Admin menyimpan harga dan melihat nilai server, bukan yang diketik
- [x] Kegagalan simpan tidak mengubah tampilan
- [x] Tab 2 menampilkan harga tanpa mengarang apa pun saat gagal

### Fase 4: Bukti dan dokumen

- [x] Task 7: `docs/status.md`, `saas-subscription-platform.md`, ADR-0010

### Checkpoint: Lengkap
- [x] `test_docs_status.py` hijau
- [x] `cd backend && pytest` hijau, `ruff` bersih
- [x] `npm run typecheck && npm run lint && npm run test` hijau
- [ ] Tinjau dengan manusia

## Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Harga jadi sumber kedua karena ada di dokumen **dan** di tabel | Tinggi | ADR-0010 menyatakan tabel menang. `saas-subscription-platform.md` diberi pointer ke tabel, bukan nilai |
| Admin mengetik nol dan membiarkan form kosong berarti nol | Sedang | Service menolak nol dan negatif. Form tidak pernah mengirim kosong; ia melaporkan nilai server saat gagal memuat |
| Endpoint publik dipakai untuk enumerasi | Rendah | Hanya satu nilai yang diekspos: harga. Tidak ada data akun |
| Form admin tumbuh jadi satu file besar | Sedang | Komponen dipisah dari `AdminView`; `/admin` memakai tab |
| Migrasi menimpa harga yang sudah diedit admin | Tinggi | `ON CONFLICT DO NOTHING`; migrasi hanya mengisi baris yang belum ada |

## Pertanyaan Terbuka

- **Apakah `pricing` boleh punya lebih dari dua paket?** Bentuknya
  `{"monthly": ..., "annual": ...}` berarti menambah paket butuh migrasi. Rencana
  dan harga adalah data konfigurasi, bukan entitas, jadi dua slot adalah pilihan
  yang bisa dibalik — tapi pemilik yang memutuskan apakah itu cukup.
- **Kapan halaman harga untuk pengunjung tanpa sesi dibangun?** Endpoint publiknya
  sudah ada setelah plan ini. Halamannya belum, dan itu potongan berikutnya.