# ADR-0011: Satu penulis `subscriptions`, idempotensi di baris Transaction

**Status:** Diterima. Diterapkan.

## Masalah

Sampai jalur pembayaran ada, `subscriptions` punya **nol penulis** di request
path — `docs/status.md` mencatatnya sebagai batasan, bukan fitur. Fase 1–3
membuka dua pintu yang sama-sama menulis akses:

1. **Endpoint admin** (`POST /v1/admin/accounts/{id}/subscription`) — operator
   menulis masa aktif dengan tangan.
2. **Approve pembayaran** (`POST /v1/admin/transactions/{id}/approve`) — uang
   yang dinyatakan lewat transfer manual dikonfirmasi menjadi masa aktif.

Kalau setiap pintu punya INSERT-nya sendiri, tiga kegagalan jadi mungkin, dan
ketiganya tentang uang:

- **Crash di tengah persetujuan.** Status transaksi bisa berubah `settlement`
  tanpa Subscription — uang dicatat diterima tanpa aksesnya; atau sebaliknya,
  Subscription tanpa bukti settlement. Kedua keadaan itu adalah opini kedua
  tentang "sudah dibayar".
- **Approve ditekan dua kali.** Satu transfer mencetak dua masa aktif, dan
  `transactions.subscription_id` — kolom yang dimaksud membuktikan apa yang
  uang setiap transaksi beli — jadi tidak bisa dipercaya.
- **Webhook Midtrans** (belum ada; kredensialnya belum ada) akan jadi pintu
  ketiga. Kalau ia menulis SQL sendiri, ketiga risiko di atas tergandakan.

## Keputusan

**1. Satu penulis: `grant()`.** `backend/api/services/subscriptions.py` memegang
satu-satunya `INSERT INTO subscriptions` di request path. Kedua pintu di atas
memanggilnya, dan pintu ketiga (webhook, nanti) wajib memanggilnya juga. Tidak
ada penulis kedua yang menyelipkan cara kedua.

**2. Settlement + Subscription = satu transaksi database.** `grant()` menerima
koneksi (`conn`) daripada mengambil pool sendiri. Approve menjalankan UPDATE
status dan INSERT masa aktif pada satu koneksi, dalam satu `transaction()`:
crash di tengah mengembalikan keduanya. Keadaan "`settlement` tanpa
Subscription" tidak bisa dihasilkan penulisan normal — hanya bisa dihasilkan
seseorang yang menulis SQL kedua di luar pintu ini.

**3. Idempoten di baris Transaction.** Approve atas baris yang sudah
`settlement` menjawab ulang Subscription yang sama (re-read baris), bukan
mencetak yang kedua. `transactions.subscription_id` mencatat apa yang uang
setiap transaksi beli. Ini penerapan ADR-0008 untuk jalur manual: ADR-0008
mendefinisikan kuncinya (`uq_transactions_midtrans_transaction_id`, disiapkan
untuk webhook); jalur manual tidak butuh kunci unik karena idempotensinya ada
di guard status, bukan di kunci.

**4. Durasi dibawa oleh baris, bukan diturunkan dari harga.** Migrasi
`0012_transactions_plan.sql` menambah `transactions.plan` — diputuskan saat
deklarasi, `monthly` → 30 hari, `annual` → 365 hari. `amount` tidak boleh
menurunkan durasi: harga bisa berubah setelah baris dideklarasikan, dan angka
lama akan menafsir durasi yang salah. Kolom `plan` di `subscriptions` dengan
sengaja tidak ditambahkan — tabel itu tetap hanya `user_id` dan `expires_at`
(ADR-0002), karena akses dinilai dari tanggal berakhir saja.

**5. Deny tidak menyentuh `subscriptions`; `expire` bukan vonis.** Menolak bukti
tidak boleh mencabut akses yang sudah sah — mencabut akses adalah operasi lain
dengan prosesnya sendiri. Deny hanya menulis `admin_notes`. Kedaluwarsa adalah
kebersihan antrian (beat tiap 10 menit, TTL `manual_transaction_ttl_seconds`):
baris `expire` tetap bisa di-approve, karena uangnya masih mungkin nyata dan
berada di dunia di luar tabel ini.

## Konsekuensi

- Dua pintu, satu opini. Pembacaan akses tetap satu sumber
  (`subscriptions.expires_at`, CONTEXT.md aturan 1); `transactions` tidak ikut
  menilai akses, hanya mencatat uang (aturan 3).
- Setiap jalur pembayaran baru — webhook nanti — memakai `grant()`. Kalau
  seseorang menyalin SQL-nya ke tempat lain, garansi crash-safety hilang
  bersama salinannya. Suite test menahan ini: fake database menolak statement
  yang tidak dikenalnya, jadi SQL kedua adalah test merah, bukan jalur diam.
- Baris yang sudah `deny` final untuk baris itu; approve ulang dijawab 409,
  bukan opini kedua.
- `price_paid` tidak ditambahkan ke `subscriptions`: harga bisa berubah setelah
  pembayaran, dan nominal saat itu sudah tercatat di `transactions.amount`.
- Yang menahan keputusan ini: `backend/tests/test_admin_transactions.py`
  (approve → settlement + Subscription dalam satu jalan; approve ulang tidak
  mencetak; crash mengembalikan status `pending`; deny tidak mengubah
  langganan), `backend/tests/test_transaction_expiry.py`, dan
  `backend/tests/test_manual_payment.py`.
