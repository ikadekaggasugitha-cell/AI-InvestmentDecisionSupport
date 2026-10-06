# Ganti owner_sub dengan user_id UUID, bertahap

`portfolios` di-key ke `owner_sub TEXT`, yaitu string subjek JWT — pada praktiknya nama login single-operator (`backend/db/migrations/0004_portfolios.sql`, dan dipakai sebagai dasar setiap pemeriksaan kepemilikan di `backend/api/services/portfolio_access.py`). Begitu identitas menjadi Account sungguhan, string itu tidak bisa dicek referensialnya, tidak bisa di-FK, dan tidak lagi punya penulis setelah autentikasi berpindah ke session opaque. Jadi `user_id UUID REFERENCES users(id)` ditambahkan, dan `owner_sub` **tidak** dibuang di tahap yang sama.

Migrasi 0004 sudah merancang urutan ini dan menuliskan alasannya (`0004_portfolios.sql:18-36`): tambah kolom, backfill, retire kolom teks di migrasi yang lebih akhir. Kolomnya additive, bukan replacement, dan transisinya spanning setidaknya satu migrasi tambahan. Dua hal yang tidak boleh dilanggar dari tulisan itu: `owner_sub` harus bertahan sampai **setiap** principal yang pernah ada punya baris Account, dan principal bypass pengembangan (`"dev-user"`) memang tidak punya akun — itulah sebabnya kolom itu belum bisa dibuang.

## Konsekuensi

- **`owner_sub` harus jadi nullable pada tahap yang sama.** Session opaque membawa `user_id`, bukan subjek token, jadi tidak ada lagi nilai yang bisa ditulis ke kolom itu. `NOT NULL` tidak bisa dipenuhi, dan auto-provisioning (`portfolio_access.py:129-136`) akan gagal.
- **Kedua index belum pindah di tahap ini, dan itu disengaja.** `uq_portfolios_one_default` pada `(owner_sub) WHERE is_default` dan `idx_portfolios_owner` masih melayani jalur baca/tulis yang berjalan hari ini. Memindahkannya sebelum `portfolio_access.py` membaca `user_id` akan kehilangan jaminan satu-portfolio-default-per-owner tepat di celah antara perubahan skema dan perubahan kode. Keduanya pindah pada migrasi yang mencabut `owner_sub`, bersama kode yang berhenti menulisnya.
- **Baris yang tidak punya pemilik tetap ada.** Principal bypass pengembangan (`"dev-user"`) tidak punya akun, jadi `user_id`-nya sengaja dibiarkan NULL. Menugaskan portofolio itu ke pendaftar berikutnya berarti menyerahkan data satu orang ke orang asing.
- **Tidak ada fallback berbasis nama.** Setelah auth berhenti menaruh identitas di token, tidak ada jalur yang mengotorisasi kepemilikan lewat string login. Request tanpa Account yang valid adalah 401/403, tidak pernah "coba `dev-user`". Ini menutup mode kelolosan yang sebelumnya ada.
- **Semua jalur yang menyentuh portfolio ikut berubah**: `portfolio`, `risk`, `advisor`, `reports`, dan `alerts` semuanya lewat `resolve_portfolio_id`. Mengubah resolver tanpa mengubah kelima pemanggilnya akan muncul sebagai 404, bukan 500 — dan 404 di sini memang disengaja (anti-oracle), jadi sukar dideteksi.
- **Unik email memakai indeks ekspresi `lower(email)`.** Konsekuensinya, `INSERT ... ON CONFLICT (email)` gagal keras: target berupa nama kolom tidak cocok dengan indeks ekspresi. Deteksi duplikat harus menangkap pelanggaran unique, bukan mengandalkan `ON CONFLICT`.

## Yang sudah diterapkan

`backend/db/migrations/0005_auth_and_sessions.sql` dan `backend/db/schema.sql`: tiga tabel baru, `portfolios.user_id`, `owner_sub` jadi nullable, backfill berdasarkan email. Yang tersisa adalah bagian pencabutan `owner_sub`, dan itu tidak bisa ditulis sebelum kodenya berubah.

## Rujukan

- `0004_portfolios.sql:18-36` — rencana lengkap untuk tahap lanjutan, termasuk calibrasi ulang baris lama
- ADR-0005 — kenapa isi portfolio juga harus per-Account, bukan satu konstanta bersama
- `docs/status.md` — status riil tiap tahap