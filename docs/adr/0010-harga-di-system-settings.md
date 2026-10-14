# ADR-0010: Harga tinggal di `system_settings`, bukan di dokumen

**Status:** Diterima. Diterapkan.

## Masalah

Harga langganan ada di satu tempat saja: prosa
`docs/saas-subscription-platform.md` §1.2. Dua konsekuensi, keduanya sudah
tercatat di `docs/status.md` sebelum tabel ini ada:

1. **Tidak bisa dibaca program.** Tidak ada endpoint, tidak ada konfigurasi, tidak
   ada apa pun yang mengembalikan harga itu. Setiap konsumen harus menyalin
   angkanya, dan setiap salinan adalah satu fakta kedua.
2. **Tidak bisa diubah tanpa mengedit dokumen.** Satu-satunya cara mengubah harga
   adalah membuka prosa dan mengetik angka baru, dan tidak ada yang memeriksa.
   `docs/status.md` mencatatnya sebagai *"Harga dan rekening tujuan tidak ada
   sumbernya"* — dan itu bukan fitur yang hilang, itu sumber yang tidak ada.

Blueprint sudah menyelesaikan masalahnya: §5 menentukan `system_settings` dan §6.1
menentukan `GET /v1/subscriptions/pricing` sebagai endpoint publik. Yang belum ada
adalah implementasinya.

## Keputusan

**Harga disimpan di `system_settings`, dan tabel itu satu-satunya tempat harga
ditulis.** `docs/adr/0001` sudah menetapkan raw SQL tanpa ORM, jadi migrasi
`0011_system_settings_pricing.sql` dan `db/schema.sql` keduanya ditulis tangan.

**Endpoint publik tidak butuh sesi.** `GET /v1/subscriptions/pricing` adalah satu
-satunya endpoint data tanpa autentikasi di aplikasi ini, dan itu disengaja:
harga yang hanya bisa dibaca setelah mendaftar bukan harga. Seseorang yang
memutuskan untuk berlangganan belum berlangganan.

Ini bentuknya sama dengan `GET /v1/subscription/current`, yang juga berada di luar
gerbang. Alasannya sama: akun yang ditolak gerbang justru akun yang perlu
diketahui berapa biayanya.

**Penulisan memakai `require_admin`, bukan `require_entitlement`.** Dua pertanyaan
berbeda: "bolehkah orang ini menjalankan produk" versus "bolehkah orang ini
memakai analisis berbayar". CONTEXT.md aturan 6 melarang yang satu menggantikan
yang lain. Admin tanpa langganan tetap boleh mengubah harga, dan penolakan untuk
non-admin adalah **403**, bukan 402 — 402 berarti "bayar dulu", dan orang yang
ditolak karena perannya tidak punya masalah tagihan.

**Angka di dokumen berhenti mengikat.** §1.2 dan §5 blueprint masih menyebut
`{"monthly": 15000, "annual": 150000}`, tapi angka itu kini adalah **nilai awal**,
dan hanya sampai operator mengubahnya. Setiap pembaca dokumen perlu tahu itu, atau
dokumennya berbohong dalam enam bulan.

**Tidak ada kolom `active` di samping harga.** Apakah harga yang berlaku adalah
faktanya ada di baris itu. Boolean di sebelahnya akan menjadi tempat kedua untuk
satu fakta disagreed dengan dirinya sendiri — CONTEXT.md aturan 5, pola yang
sudah pernah memakan repo ini dua kali: `owner_sub` punya dua sumber, dan `blocked_at`
punya kolom dan pembaca tapi tidak ada penulisnya.

## Konsekuensi

- `docs/status.md` bisa mengubah "tidak ada sumbernya" menjadi "ada". Itu satu
  baris yang selama ini menahan pekerjaan billing.
- Migration `0011` memakai `ON CONFLICT (key) DO NOTHING`. Menjalankan ulang
  migrasi tidak boleh mengembalikan harga ke angka seed dan membatalkan apa yang
  sudah ditetapkan administrator.
- Bentuk `{monthly, annual}` berarti menambah paket butuh migrasi. Rencana dan
  harga adalah konfigurasi, bukan entitas (CONTEXT.md), jadi dua slot adalah
  pilihan yang bisa dibalik — tapi itu keputusan pemilik, bukan pilihan agen.
- Belum ada jalur pembelian. Endpoint publik ada supaya harganya bisa dibaca;
  halaman harga untuk pengunjung tanpa sesi belum dibangun, dan panel admin
  sengaja tidak punya pemilih paket atau sakelar aktif — tidak ada yang bisa
  derrière di belakang sana (R-26).
- **Tidak ada deteksi konflik, dan itu disengaja.** Instalasi ini punya satu
  administrator. Tidak ada pihak kedua yang bisa menimpa harga yang baru
  disimpan, jadi `updatedAt` ditampilkan tanpa dipakai sebagai benturan.
  Menambahkan optimistic locking akan membangun mekanisme untuk kasus yang
  tidak bisa terjadi.

  Perhatikan bahwa kode **tidak** mengasumsikan hanya satu admin: `users.role`
  menerima admin sebanyak apa pun, dan `db/promote_admin.py` bisa menaikkannya
  kapan saja. Batas ini operasional, bukan ditegakkan.

  Kalau suatu saat ada admin kedua, form itu akan diam-diam menimpa — dan tidak
  ada yang memperingatkan.
- `bank_accounts` dan `contact_support` masih tertunda. Keduanya milik jalur
  pembayaran yang belum ada.

## Yang paling mudah kembali

Menyalin angka harga ke konfigurasi aplikasi "supaya cepat". Itu membuat dua
sumber, dan yang kedua tidak punya penulis, tidak punya validasi, dan tidak
melewati panel admin. Setiap nilai yang masuk ke UI harus datang dari
`system_settings` atau dari endpoint yang membacanya.