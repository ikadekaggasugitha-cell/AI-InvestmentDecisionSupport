# Transaction mengunci id transaksi gateway; Subscription tetap tidak pernah berubah

`subscriptions` sudah ada sejak migrasi 0005 dan tidak pernah bisa diisi. Di seluruh
backend tidak ada satu pun `INSERT`, `UPDATE`, atau `DELETE` terhadap tabel itu: yang
ada hanya `SELECT` di `entitlements.py` dan `routers/subscription.py`. Jadi setiap akun
selalu menjawab "tidak punya subscription", dan akan terus begitu sampai ada jalur yang
menulisnya.

Jalur itu tidak bisa ditulis di atas `subscriptions` langsung. CONTEXT.md aturan 7
menetapkan bahwa masa aktif ditulis sekali saat dibuat dan tidak pernah berubah,
sehingga perpanjangan membuat baris baru, bukan menggeser tanggal yang lama. Kalau
pembayaran menulis langsung ke sana, satu webhook yang terkirim dua kali akan
menghasilkan dua masa aktif penuh untuk satu pembayaran. Kuncinya harus ada di sisi uang,
yaitu Transaction, bukan di sisi akses.

`uq_transactions_midtrans_transaction_id` adalah kunci itu. Midtrans memutar ulang
sebuah order ketika tidak melihat respons kita, jadi satu pembayaran bisa sampai dua
kali. Tanpa batasan, tangkapan kedua membuat baris Transaction kedua, dan dari sana satu
masa aktif penuh lagi. Dengan batasan, tangkapan kedua menjadi pelanggaran constraint,
bukan duplikasi.

Constraint-nya diberi nama dan ditulis sebagai constraint level tabel, bukan inline di
kolom, supaya rollback dan inspeksi manual bisa menyebutnya.

## Kenapa bukan di `subscriptions`

Akses dibaca dari `MAX(expires_at) WHERE expires_at > NOW()`. Dua masa aktif yang
tumpang tindih itu sah, bukan kerusakan: perpanjangan lebih awal memang akan menambah,
bukan menimpa. Artinya tidak ada slot "sedang aktif" yang bisa dibedakan satu sama lain,
sehingga `subscriptions` tidak punya apa pun untuk ditegakkan. Batasan unique parsial
pun tidak mungkin, karena predicate harus IMMUTABLE sedangkan `NOW()` hanya STABLE.
Ini sudah tercatat di `schema.sql` sejak migrasi 0005.

## Kenapa `ON DELETE SET NULL`, bukan `RESTRICT`

`subscription_id` terlihat seperti kandidat untuk `RESTRICT`, karena `SET NULL` membuang
ikatan antara uang yang dibayar dan masa aktif yang dibeli. `RESTRICT` ditolak setelah
dicek: `users` cascade ke dua anak sekaligus (`subscriptions` dan `transactions`), dan
PostgreSQL tidak melakukan topological sort atas cascading delete
([bug #18064](https://www.postgresql.org/message-id/18064-41dae27eda0024e1%40postgresql.org)).
Dengan `RESTRICT` di jalur ini, `DELETE FROM users` akan gagal dari arah cascade yang
satu, karena PostgreSQL menghapus baris `subscriptions` sebelum baris `transactions`
yang masih mereferensikannya.

## Consequences

- **NULL tetap berulang demi transfer manual.** Pembayaran transfer bank tidak punya
  id gateway, dan PostgreSQL mengabaikan NULL pada UNIQUE, jadi beberapa transfer manual
  bisa coexist tanpa bentrok. Kalau id gateway diwajibkan, transfer manual tidak akan
  punya tempat.
- **Constraint mencegah baris duplikat, belum mencegah logika duplikat.** Webhook yang
  datang setelah Transaction-nya sudah ada tetap harus dikenali dan dijawab, dan handler
  itu belum ada. Option (b), masih terbuka. Kalau handler naif nanti menulis
  Subscription tanpa memeriksa constraint lebih dulu, satu webhook dobel tetap akan
  memberi dua masa aktif.
- **Verifikasi butuh Postgres sungguhan dan masih belum dilakukan.** Test yang ada
  mem-parse DDL dan membuktikan constraint itu dideklarasikan. Tidak ada PostgreSQL nyata
  di suite, jadi constraint menolak insert duplikat belum pernah diuji. Ini prasyarat
  terbuka sebelum produksi.
- **`updated_at` tidak pernah berubah sendiri.** Tidak ada trigger di `schema.sql`,
  konsisten dengan `instruments` dan `broker_summary`, jadi kolom ini akan sama dengan
  `created_at` sampai seseorang menulis trigger-nya.
- **`status` memakai kosakata Midtrans** karena baris ini ditulis oleh callback Midtrans.
  Payment Status di CONTEXT.md adalah konsepnya; kelima nilai ini adalah nama gateway.
  `settlement` berarti uangnya sampai, bukan berarti akses diberikan.
- **Tabel ini kosong di install baru dan itu memang benar.** Tidak ada endpoint
  pembayaran, jadi tidak ada yang mengisinya. Keberadaan tabel bukan klaim bahwa
  penagihan berjalan.

## Rujukan

- `backend/db/migrations/0010_transactions.sql` untuk constraint dan index
- `backend/db/schema.sql` untuk bentuk yang sama di database baru
- `backend/api/services/entitlements.py:9-12` untuk kenapa `subscriptions` tidak bisa
  punya batasan unik
- `backend/tests/test_identity_schema.py` untuk assertion yang mem-parse DDL