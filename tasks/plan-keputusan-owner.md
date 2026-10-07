# Implementation Plan: Tiga Keputusan Owner yang Menghambat

## Gambaran

Plan sebelumnya (`plan.md`) selesai kecuali peninjauan Anda. Yang tersisa bukan
pekerjaan yang bisa langsung dikerjakan — tiga keputusan yang hanya bisa diambil
owner, dan ketiganya mengubah kode atau dokumen yang sudah jadi.

Plan ini **tidak** mengimplementasikan apa pun. Isinya: apa yang sebenarnya
terjadi sekarang di setiap titik, apa pilihan yang ada, dan apa yang rusak kalau
salah pilih. Setelah Anda memilih, barulah task yang bisa ditulis.

Alasan plan ini terpisah dan bukan tambahan di `plan.md`: `plan.md` berisi
pekerjaan yang sudah selesai dan di-commit. Menimpanya akan menghapus catatan
itu tanpa sebab.

## Keputusan 1: Apakah memblokir akun juga mengakhiri sesinya

### Keadaan sekarang

`blocked_at` dibaca di setiap request. `authenticate()` melakukan satu `JOIN` yang
mengambil session, cek kedaluwarsa, dan cek `blocked_at` sekaligus — jadi blokir
langsung berlaku pada request berikutnya, tanpa cache dan tanpa invalidate.

Sesi yang sudah terbit **tetap ada** di tabel `sessions`. `revoke_all_sessions()`
sudah ada dan sudah dipakai saat ganti sandi, tapi `set_blocked()` tidak memanggilnya.

### Pilihan

**A. Biarkan seperti sekarang.** Sesi tetap hidup, akses tetap ditolak.

- Yang benar: satu sumber kebenaran. `blocked_at` yang menentukan akses, bukan keberadaan
  baris session. Menghapus sesi adalah hal kedua yang melakukan hal yang sama, dan
  dua mekanisme untuk satu fakta adalah tempat mereka mulai berbeda.
- Yang hilang: begitu blokir dibuka lagi, semua sesi langsung hidup kembali. Untuk
  akun yang diblokir karena penyalahgunaan, ini mungkin tidak diinginkan.
- KontEXT.md aturan 8 hanya menyatakan blokir berlaku seketika. Ia tidak menyatakan
  apa yang terjadi pada sesi.

**B. `set_blocked()` juga menghapus sesi.** Revocation jadi "tidak ada baris",
konsisten dengan ADR-0004.

- Yang benar: membuka blokir benar-benar memaksa login ulang. Untuk akun yang
  diblokir karena alasan keamanan, ini yang biasanya diinginkan.
- Yang hilang: satu cara pemulihan yang cepat. Kalau blokir tidak sengaja, admin
  sekarang harus convincing orang untuk login ulang.
- Catatan: ini mengubah perilaku yang sudah didokumentasikan, jadi ADR-0004 perlu
  satu kalimat tambahan.

### Rekomendasi: A, dengan B tersedia sebagai opsi eksplisit

Alasannya aturan CONTEXT.md yang berlaku sekarang sudah memenuhi janji "seketika"
tanpa mekanisme kedua. Menambahkan penghapusan sesi sekarang berarti menulis
mekanisme kedua sebelum ada yang|Contohkan membutuhkannya. Kalau nanti ada insiden
yang butuh, B adalah perubahan kecil — `revoke_all_sessions()` sudah ada.

Kalau Anda pilih A, saya sarankan menambah satu kalimat di ADR-0004 yang
menyatakan keputusan ini eksplisit, supaya tidak terbaca sebagai kelalaian.

## Keputusan 2: Berapa lama consent log disimpan

### Keadaan sekarang

Tabel `consent_acceptances` tidak pernah dihapus. Ada 101 baris untuk 103 akun di
database lokal — hampir semua dari test, jadi belum berarti apa-apa soal volume
produksi, tapi mekanismenya memang tidak ada sama sekali.

UU PDP mengatur penghapusan data ketika tidak ada lagi gunanya, dan pada saat yang
sama data consent punya nilai pembuktian. Dua hal itu menarik ke arah berlawanan,
dan yang baruはいよ perlu memutuskan.

### Pilihan

**A. Simpan selamanya.** Perilaku sekarang, tidak ada kode tambahan.

- Yang benar: bukti consent tidak pernah hilang, dan tidak ada satu baris kode pun
  yang bisa menghapusnya secara tidak sengaja.
- Yang hilang: data pribadi menumpuk tanpa batas. Untuk UU PDP, "disimpan
  selamanya" adalah keputusan yang harus bisa dijelaskan, bukan hal yang lolos
  karena tidak ada yang menulis apa pun.

**B. Hapus setelah N bulan, sisakan yang terakhir.** Satu baris per akun disimpan,
  sisanya dihapus setelah retensi.

- Yang benar: newest-wins tetap terjawab, dan volume terkendali.
- Yang hilang: bukti historis. Kalau ada sengketa tentang apakah seseorang pernah
  menyetujui versi tertentu, riwayatnya sudah tidak ada.
- Butuh kolom atau query baru, dan satu operasi purge terjadwal.

**C. Hapus seluruhnya saat akun dihapus.** `ON DELETE CASCADE` sudah melakukan ini
  — jadi sebenarnya sudah lewat.

- Perhatikan: cascade **sudah ada** dan sudah diuji. Yang belum ada adalah retensi
  untuk akun yang masih hidup.

### Rekomendasi: B dengan N yang belum ditetapkan

Alasannya "selamanya" bukan default yang bisa dipertahankan tanpa penjelasan, dan
cascade saja tidak menjawab pertanyaan akun yang masih aktif. Tapi N adalah angka
komersial/legal yang bukan keputusan teknis — nilai yang tepat bergantung pada
apa yang sebenarnya dituntut, dan itu tidak ada di repo.

Kalau Anda memilih B, N perlu ditetapkan, dan sebaiknya dicatat di ADR atau di
`status.md`, bukan hanya di kode.

## Keputusan 3: Bentuk `/admin` di frontend

### Keadaan sekarang

Endpoint sudah ada dan teruji: `GET /v1/admin/accounts` (berpaginasi, dengan
`hasMore`), `POST` dan `DELETE .../block`.

Yang belum ada: view-nya. App ini tidak punya routing sungguhan — hanya satu state
`view` di `App.tsx`, dengan `/login` dan `/signup` yang cuma redirect. Jadi ini
bukan route baru, tapi view baru.

`Sidebar` punya `account` dan sudah menampilkan label role, tapi `navItems`-nya
statis — tidak ada item yang disembunyikan berdasarkan role. Jadi ada dua hal yang
harus diputuskan: apa yang ditampilkan, dan bagaimana orang sampai ke sana.

### Pilihan untuk apa yang ditampilkan

**A. Daftar akun saja.** Nama, email, role, status blokir. Read-only.

- Paling kecil. Tidak ada aksi yang bisa salah.
- Tapi memblokir tetap harus lewat `curl` atau `promote_admin.py`, yang PAYWALL.

**B. Daftar + blokir/buka blokir.** Yang endpoint-nya sudah mendukung.

- Resolve penuh kemampuan yang sudah ada. Baris tabel dengan dua aksi.
- Harus menangani: konfirmasi sebelum memblokir, refresh daftar setelah aksi, dan
  apa yang tampil kalau daftar gagal dimuat.

**C. Halaman tersendiri di luar sidebar.** `/admin` yang diketik langsung.

- Terpisah dari navigasi utama, jadi tidak menambah entry sidebar untuk semua orang.
- Tapi lalu tidak ada yang menemukannya, dan tidak ada yang mencegah non-admin
  mengetiknya (backend sudah menolak, jadi ini soal penemuan, bukan keamanan).

### Rekomendasi: B, dengan item sidebar yang hanya muncul untuk admin

Alasannya A meninggalkan kemampuan yang sudah ada dan sudah diuji tidak terpakai,
dan C tidak bisa ditemukan. Item sidebar yang role-gated adalah satu-satunya yang
membuat halaman bisa ditemukan dan tidak sekadar tersembunyi di balik URL.

Tapi ini keputusan yang jelas_css milik owner: apakah admin adalah fitur yang
penting untuk dilihat, atau sekadar alat operasional yang jarang dipakai? Jawaban
itu menentukan B atau A, bukan sebaliknya.

## Keputusan yang Telah Diambil (2026-10-07)

Owner memutuskan ketiganya. Rincian di bawah supaya alasannya tercatat, bukan
sekadar hasilnya.

| # | Keputusan | Alasan yang dipakai |
|---|-----------|---------------------|
| 1 | Blokir **tidak** mengakhiri sesi; dicatat eksplisit di ADR-0004 | Satu mekanisme sudah memenuhi janji "seketika" di CONTEXT.md aturan 8. Menambahkan penghapusan sesi berarti mekanisme kedua untuk satu fakta, sebelum ada yang membutuhkannya |
| 2 | Retensi consent: hapus setelah N bulan, sisakan yang terakhir | "Simpan selforever" bukan default yang bisa dipertahankan tanpa penjelasan. Cascade sudah ada untuk akun yang dihapus; yang kurang adalah akun yang masih hidup |
| 3 | `/admin`: URL tersendiri, daftar akun plus aksi blokir/buka blokir | Endpoint sudah lengkap, jadi kemampuannya tidak perlu disembunyikan di balik `curl`. URL sendiri karena ini alat operasional, bukan navigasi utama — dan tidak ada entry sidebar yang harus disembunyikan dari akun biasa |

### Catatan untuk keputusan 2

N tidak ditetapkan owner karena itu angka legal, bukan teknis. Nilai yang
dipakai: **24 bulan**, sebagai default yang bisa diubah tanpa menyentuh kode lewat
`CONSENT_RETENTION_MONTHS`. Alasannya: cukup panjang untuk menghadapi
sengketa yang masuk akal, cukup pendek untuk tidak menyimpan data pribadi lebih
lama dari perlu, dan cukup jelas untuk dijelaskan kalau ditanya.

Kalau angkanya ternyata salah, itu perubahan satu baris di `.env`.

## Yang Tidak Dicakup

- **Fase 2 penagihan.** `docs/status.md` mencatat "ADR-nya belum ditulis". Kalau
  Anda ingin ini masuk, ADR-nya yang harus ditulis lebih dulu, bukan task-nya.
- **Rumah tangga operasional.** 18 file belum commit, migrasi `0008`/`0009` hanya
  terpasang di database lokal, dua CLI purge belum dijadwalkan. Semua itu daftar
  kerja, bukan sesuatu yang perlu planning.

## Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Keputusan diambil tanpa data yang mendukung | Sedang | Dua dari tiga keputusan adalah kebijakan, bukan fakta — kalau ini terasa seperti menebak, jawaban yang benar adalah "belum tahu", dan itu sendiri dicatat sebagai jawaban |
| Retensi memakai N yang belum ditinjau pihak yang berkepentingan | Sedang | N dibuat configurable (`CONSENT_RETENTION_MONTHS`) supaya dapat diubah tanpa menyentuh kode, dan default 24 bulan dicatat di ADR-0004 beserta alasannya |
| `/admin` dibangun sebelum bentuknya jelas | Sedang | Endpoint sudah ada dan sudah teruji, jadi tidak ada yang hilang kalau halaman `/admin` ditunda |
| Plan lama tertimpa | Tinggi | Plan ini file terpisah. `plan.md` dan `todo.md` tidak disentuh |

## Pertanyaan yang Masih Terbuka Setelah Plan Ini

- **N untuk retensi consent.** Hanya muncul kalau keputusan 2 dijawab B.
- **Apakah `/admin` perlu entry di sidebar.** Hanya muncul kalau keputusan 3
  dijawab B atau C.
- **Siapa saja yang boleh masuk ke `/admin`.** Endpoint sudah menolak non-admin,
  jadi ini soal penemuan dan penempatan, bukan soal keamanan.
