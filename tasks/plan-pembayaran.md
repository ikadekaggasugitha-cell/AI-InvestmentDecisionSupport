# Implementation Plan: Pembayaran Manual dan Gerbang

## Gambaran

Tabel `transactions` sudah ada sejak migrasi `0010`, lengkap dengan kunci
idempotensi webhook, `proof_image_url`, `approved_by`, dan `admin_notes`. Yang
belum ada bukan skema — jalannya.

Masalah yang lebih mendasar lebih dulu: **tidak ada satu pun kode yang menulis
tabel `subscriptions`.** Nol baris `INSERT` sejak hari pertama. Selama itu begitu,
tidak ada pembayaran apa pun yang bisa menghasilkan akses, dan tidak ada yang
bisa menguji apakah gerbang bekerja. Jadi yang pertama dibangun bukan checkout —
melainkan **satu-satunya penulis** `subscriptions`, supaya sisanya punya tempat
bertumpu.

Nomor harga sudah dibaca dari satu sumber sejak `0011`. Yang belum ada adalah
jalur yang mengubah nominal itu menjadi masa aktif.

## Keputusan yang Sudah Diambil

**Checkout adalah langkah sendiri, bukan bagian dari pendaftaran.** ADR-0004
membuat registrasi terbuka tanpa pembayaran, CONTEXT.md aturan 4 menyatakan
account tanpa Subscription tetap sah, dan `test_signup_path_is_canonical`
melarang `register-checkout`. Blueprint §4.1 masih menulis checkout menyatu di
formulir pendaftaran; itu sudah dilampaui oleh keputusan yang lebih baru.

**Tanpa unggah berkas bukti.** Pengguna menulis catatan; admin yang mencocokkan
nomornya. Volume satu operator tidak membenarkan adanya upload: verifikasi tipe
berkas, batas ukuran, dan nama berkas yang disajikan kembali ke peramban.

**Durasi mengikuti blueprint: 30 hari bulanan, 365 hari tahunan.** Satu baris
`subscriptions` per pembelian, `expires_at = NOW() + N days`, tidak pernah
digeser. Perpanjangan menulis baris baru, dan akses dibaca dari
`MAX(expires_at)` yang belum lewat — sudah berjalan di `entitlements.py`.

**Gerbang Midtrans masuk rencana, QRIS dinamis ikut.** `ServerKey` dan akun
aktif adalah prasyarat, bukan hal yang bisa dikerjakan di tengah.

## Yang Tidak Berubah

- `subscriptions` tetap tanpa kolom status (CONTEXT.md aturan 1). Masa aktif
  ditulis sekali.
- Payment Status tidak pernah memblokir akses (aturan 3). Transaksi `pending`
  yang menggantung tidak menutup apa pun.
- Transaksi yang gagal tidak pernah menutup akses. Menolak bukti transfer tidak
  menyentuh langganan yang sedang berjalan.
- Tidak ada unggah berkas, jadi `transactions.proof_image_url` **tidak akan
  punya penulis**. Kolomnya dibiarkan karena ada di blueprint; dicatat sebagai
  utang, bukan dipakai setengah.
- Role dan Entitlement tetap terpisah (aturan 6). Admin tidak otomatis punya
  akses berbayar.

## Keputusan Arsitektur

**Satu fungsi menulis `subscriptions`.** `grant()` di
`api/services/subscriptions.py`, dipanggil dari dua tempat: persetujuan admin
dan webhook gerbang. Kalau dua tempat menulis baris langganan, satu bisa menulis
tanpa mencatat transaksi mana yang membayarnya — dan `transactions.subscription_id`
menjadi kolom yang tidak bisa dipercaya.

**Idempotensi dipegang baris `transaction`, bukan `subscriptions`.** Dua masa
aktif yang tumpang tindih itu sah dan tidak bisa dibedakan satu sama lain, jadi
`subscriptions` tidak punya apa pun untuk ditegakkan. Webhook berulang berhenti
di baris yang sudah ada; Subscription baru hanya ditulis saat baris itu masuk
`settlement` untuk pertama kalinya. Webhook setelahnya tetap dijawab 200 supaya
penyedia tidak mengirim ulang.

**Nominal harus cocok saat webhook.** `amount` ditulis dari harga server saat
checkout, dan `gross_amount` dari webhook harus sama persis. Tidak cocok berarti
penolakan dan log — kalau dilewati, siapa pun bisa membuat transaksi
nominal kecil lalu mengirim webhook yang cocok dengan nominal kecil itu.

**Manual dan otomatis berbagi satu antrean admin.** Transaction `pending` dari
sumber mana pun muncul di tempat yang sama, karena tindakan berikutnya sama:
mencocokkan uang dan menekan approve.

**Antrean persetujuan adalah tempat bekerja, bukan halaman.** Admin yang menekan
Approve sedang mengaktifkan akses orang, jadi aksinya harus jelas dan
menghasilkan keadaan yang terlihat, bukan toast yang lewat.

## Task List

### Fase 1: Satu tangan yang menulis Subscription

- [ ] Task 1: `services/subscriptions.py` — `grant()` sebagai satu-satunya penulis
- [ ] Task 2: `POST /v1/admin/accounts/{id}/subscription` — beri langganan tanpa pembayaran

### Checkpoint: Fase 1
- [ ] `subscriptions` punya penulis untuk pertama kalinya
- [ ] Idempoten terhadap `transaction_id` yang sama
- [ ] Admin tanpa langganan tetap boleh memanggilnya (aturan 6)

### Fase 2: Rekening tujuan

- [ ] Task 3: `bank_accounts` di `system_settings` — baca, tulis, validasi
- [ ] Task 4: UI admin untuk rekening + tampilan publik

### Checkpoint: Fase 2
- [ ] Rekening bisa diisi dan diubah dari panel admin
- [ ] Pembaca tanpa sesi bisa membaca rekening tujuan
- [ ] Rekening kosong dijawab "belum ada", bukan daftar kosong yang terlihat seperti daftar

### Fase 3: Transfer manual

- [ ] Task 5: `POST /v1/payments/manual` — pengguna menyatakan transfer
- [ ] Task 6: Antrean admin + approve/deny
- [ ] Task 7: Halaman "sedang diverifikasi" + Tab 2 menampilkan transaksi pending
- [ ] Task 8: Kedaluwarsa transaksi manual yang menggantung

### Checkpoint: Fase 3
- [ ] Approve menulis Subscription dan mengubah status transaksi dalam satu jalan
- [ ] Deny tidak menyentuh Subscription yang sedang berjalan
- [ ] Transaksi expired tidak memblokir apa pun
- [ ] Alur lengkap bisa dicoba tanpa gerbang pihak ketiga

### Fase 4: Gerbang dan QRIS dinamis — **blocked oleh kredensial**

- [ ] Task 9: Konfigurasi Midtrans + `POST /v1/payments/checkout` → snap token
- [ ] Task 10: `POST /v1/payments/midtrans/webhook` — signature, nominal, idempotensi
- [ ] Task 11: Halaman checkout di frontend

### Checkpoint: Fase 4
- [ ] Webhook berulang untuk satu transaksi tidak menghasilkan Subscription kedua
- [ ] Signature salah ditolak
- [ ] Nominal tidak cocok ditolak

### Fase 5: Bukti dan dokumen

- [ ] Task 12: `docs/status.md`, ADR-0011

### Checkpoint: Lengkap
- [ ] `cd backend && pytest` hijau, `ruff` bersih
- [ ] `npm run typecheck && npm run lint && npm run test` hijau
- [ ] Tinjau dengan manusia

## Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Webhook palsu dengan nominal kecil mengaktifkan akses | **Kritis** | `gross_amount` harus sama dengan `amount` baris. Signature SHA-512 diverifikasi. Keduanya wajib, bukan salah satu |
| Webhook diproses dua kali → dua masa aktif | Tinggi | Idempotensi di baris `transaction`; Subscription hanya ditulis saat masuk `settlement` untuk pertama kalinya |
| `subscriptions` punya dua penulis | Tinggi | Satu fungsi `grant()`, dua pemanggil. `transactions.subscription_id` jadi bisa dipercaya |
| Transaksi `pending` menggantung selamanya | Sedang | Beat menjadwalkan kedaluwarsa. Tidak memblokir akses, jadi aman dijalankan agresif |
| Admin menekan approve untuk transaksi yang salah | Sedang | Antrean menampilkan nominal, catatan, dan waktu — bukan hanya daftar. Aksi mengubah keadaan yang terlihat |
| Pengguna membayar dua kali | Sedang | Dua masa aktif tumpang tindih itu sah dan hanya satu yang terpakai. Ruganya di pengguna, bukan di sistem; dicatat sebagai utang |
| `proof_image_url` jadi kolom mati | Rendah | Sengaja tidak diisi. Dicatat di `status.md` sebagai utang yang ditunda dengan sadar |

## Pertanyaan Terbuka

- **Apakah `ServerKey` Midtrans sudah ada?** Fase 4 blocked tanpa itu. Fase 1–3
  tidak butuh apa pun dari pihak ketiga dan bisa diselesaikan lebih dulu.
- **Berapa lama transaksi manual boleh menggantung sebelum expired?** Angka ini
  kebijakan, bukan teknis.
- **Apakah nominal bulanan dan tahunan perlu dibedakan di satu transaksi?** today
  `amount` ada per baris, jadi satu orang bisa mencampur; pertanyaannya apakah itu
  perlu dilarang.