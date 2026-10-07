# Session opaque di Postgres, hash disimpan, paywall fail-closed

Autentikasi berpindah dari JWT ke session opaque: cookie `HttpOnly` berisi 64 karakter acak, tabel `sessions` di Postgres adalah sumber kebenaran dan satu-satunya tempat lookup session membaca dari. Alasannya bukan modernisasi token. JWT yang diperluas dengan klaim `role` dan `sub_status` akan membawa masalah yang sudah diketahui, dan yang paling sulit diurus adalah revocation: mencabut akses berarti mengubah satu fakta di server, dan itu tidak bisa dilakukan pada token yang sudah terbit.

## Tiga keputusan yang menyatu

**Opaque, bukan PASETO.** Token yang tidak bisa dibaca server tidak menambah keamanan di sini, karena server yang memutuskan. Sebaliknya, opaque memberi revocation gratis: menghapus baris session adalah logout instan, tanpa daftar hitam dan tanpa kumpulan token yang harus dicatat. Kunci yang dipakai bukan rahasia, melainkan identitas — rotasi kunci tidak berlaku karena tidak ada kunci yang perlu diputar.

**Hash saat disimpan.** `sessions.id` menyimpan `SHA-256` dari nilai yang ada di cookie, bukan nilai itu sendiri. Siapa pun yang punya akses baca ke database atau ke satu backup bisa menyalin 64 karakter itu dan menyamar sebagai setiap user aktif — tanpa menebak password dan tanpa melewati rate limit. Hash mengatasinya di sisi server saja, tanpa mengubah format cookie maupun sisi klien. Kewajibannya: nilai cookie tidak boleh pernah masuk log.

**Tidak ada cache di jalur otorisasi.** Ini membatalkan klausul "Redis sebagai read-through cache" dari perencanaan awal, dan alasannya ditemukan oleh test: `authenticate()` sempat membaca Redis lebih dulu, sehingga session yang sudah di-`DELETE` masih diterima sampai entri cache kedaluwarsa. Jendela lima menit itu mengubah `DELETE FROM sessions` dari "keluar" menjadi "keluar nanti" — persis satu properti yang session opaque dipilih untuk itu. Karena itu lookup session sekarang satu query `JOIN` dengan `users`, tanpa cache sama sekali, yang sekaligus membuat ini satu-satunya query yang dilakukan satu request. Revocation dan pemblokiran berlaku pada request berikutnya, bukan pada request berikutnya setelah cache habis.

**Memblokir tidak menghapus session.** Ini yang paling mudah disalahbaca sebagai
kelalaian, jadi ditulis eksplisit. `blocked_at` dibaca di setiap request, jadi blokir
berlaku seketika — itulah yang CONTEXT.md aturan 8 minta. Yang tidak terjadi adalah
penghapusan baris `sessions`: sesi yang sudah terbit tetap ada, dan hanya ditolak
selama `blocked_at` terisi.

Alasannya satu mekanisme untuk satu fakta. Kehadiran baris session menjawab
"apakah token ini masih dikenal"; `blocked_at` menjawab "apakah akun ini boleh masuk". Dua hal
berbeda, dan menggabungkannya berarti ada dua tempat yang bisa salah lalu berbeda
pendapat. `revoke_all_sessions()` sudah ada dan dipakai saat ganti sandi — kasusnya
berbeda, karena di sana token lama benar-benar harus mati. Untuk blokir, accounts
sudah ditolak tanpa perlu memaksa token-nya dihapus.

Konsekuensi yang perlu diketahui: membuka blokir mengembalikan seluruh sesi lama
ke keadaan aktif tanpa perlu login ulang. Untuk akun yang diblokir karena
penyalahgunaan, itu mungkin tidak diinginkan — dan kalau ternyata dibutuhkan,
perubahannya satu baris di `accounts.set_blocked()`. Yang jelas: saat ini begitu,
dan itu keputusan, bukan kelalaian.

**Rate limit ditentukan dari path, bukan mencari route handler.** Semula slowapi 0.1.9
yang melakukannya. Ia mencari handler dengan menelusuri `app.routes` mencari objek route
datar yang punya `.endpoint`. FastAPI 0.141 tidak lagi meratakan router:
`include_router()` membungkus tiap router dalam `_IncludedRouter`, sehingga tidak ada
yang cocok, handler bernilai `None`, dan `_should_exempt(None)` mengembalikan `True`.
**Setiap route tanpa kecuali dianggap dikecualikan.**

Buktinya: limiter menyala, terpasang, memegang anggaran 5/menit, dan dua belas request
ke `/v1/news` semuanya mengembalikan 200 tanpa satu pun header batas. Tidak ada yang
menangkapnya karena `conftest.py` mematikan rate limit untuk seluruh suite dengan
catatan "ada tes khusus" — tes itu tidak pernah ada.

Naik ke slowapi 0.1.10 tidak menolong: `_find_route_handler` identik byte per byte.
Menurunkannya FastAPI akan menghilangkan gejalanya, tapi dengan versi yang lebih lama.
Menambal `app.routes` berarti mengikat ke `_IncludedRouter`, simbol privat yang akan
berubah lagi. Daripada ketiganya, sekitar 80 baris limiter sendiri di
`api/core/rate_limit.py`, yang tidak perlu mencari route sama sekali.

Dua keputusan di dalamnya berlawanan dengan sistem lain, dan itu disengaja:

  * **Gagal terbuka.** Kalau penghitungnya sendiri melempar, request dilayani. Limiter
    yang membuat API mati saat ia rusak adalah beban, bukan pengaman. Ini berlawanan
    dengan paywall, yang gagal tertutup dengan sengaja: data berbayar tidak boleh
    dilayani kepada orang yang tidak bisa diperiksa, sedangkan rate limit yang mati
    hanya berarti anggaran tidak ditegakkan.
  * **Penyimpanan in-process.** Benar untuk satu proses, yang memang kondisi hari ini.
    Beberapa instance akan menegakkan anggaran secara terpisah, dan itu keputusan
    tersendiri.

Angka batasnya belum pernah diukur terhadap beban nyata. `docs/status.md` mencatat
begitu, dan akan tetap begitu sampai ada yang mengukurnya.

**Retensi consent: 24 bulan, sisakan yang terakhir.** `consent_acceptances` tidak
pernah dihapus utuh. Setiap akun menyimpan satu baris terbaru — itu jawaban untuk
"apakah orang ini pernah menyetujui?", dan menghapusnya berarti menghapus satu-satunya
hal yang perlu diketahui tabel tersebut. Sisanya, yang hanya berisi versi teks lama,
dihapus setelah `CONSENT_RETENTION_MONTHS` bulan.

"Simpan selamanya" bisa dijelaskan, tapi harus dijelaskan, dan tidak ada alasan
teknis untuk tidak membatasi. Angka 24 bulan dipilih karena cukup panjang untuk
menghadapi sengketa yang masuk akal, cukup pendek untuk tidak menyimpan data pribadi
lebih lama dari perlu, dan cukup bulat untuk dijelaskan. Angka ini disengaja tidak
dijadikan konstanta: ia kebijakan, bukan detail implementasi, dan yang bertanggung
jawab atasnya harus bisa mengubahnya tanpa code review.

Tidak ada audit log yang dihapus otomatis, jadi yang tersisa hanya baris terbaru per
akun. Kalau bukti historis ternyata dibutuhkan, ini keputusan untuk diambil ulang,
bukan sesuatu yang bisa dipulihkan.

**Paywall fail-closed.** Pemeriksaan akses harus menolak request ketika database tidak tersedia, bukan meloloskannya. Redis di repo ini sengaja degrade-open (`api/core/redis_client.py:25-34` benar untuk cache market) dan pola itu akan otomatis berlaku juga di jalur ini kalau tidak ada test yang bilang sebaliknya. Karena itu test database mati bukan opsional: tanpa Subscription → 403, dengan Subscription → 200, query entitlement mati → **403**, seluruh database mati → **503**. Dua status itu berbeda dan sengaja: yang pertama berarti "kamu tahu, dan jawabannya tidak", yang kedua berarti "kamu tidak bisa diverifikasi" — yang terakhir harus bisa di-retry dan tidak boleh dilaporkan sebagai masalah tagihan.

## Konsekuensi

- **Satu query per request, bukan dua.** `authenticate()` menggabungkan lookup session, cek kedaluwarsa, dan cek `blocked_at` dalam satu `JOIN`. Tidak ada cache kedua, jadi tidak ada yang perlu diinvalidasi saat mencabut.
- **WebSocket tidak selalu membawa cookie.** Browser tidak bisa mengirim header saat handshake, dan query param bocor ke access log. Kalau same-site, cookie ridesalong sendiri; kalau cross-site, `SameSite=Lax` menahannya, jadi klien menukar cookie dengan tiket sekali pakai berumur 30 detik lewat HTTP yang sudah diautentikasi.
- **Ganti kata sandi menghapus semua sesi** user tersebut (`DELETE FROM sessions WHERE user_id = $1`). Dipilih menghapus baris, bukan menambah kolom `revoked_at`, karena baris itu sendiri adalah fakta dan tidak perlu state kedua.
- **Client harus mengirim `credentials: "include"`.** Tanpa itu, browser membuang cookie pada permintaan lintas origin dan jawabannya 401 — yang terlihat seperti backend rusak, bukan opsi fetch yang hilang.
- **Tidak ada yang bisa dipromosikan menjadi admin.** Registrasi terbuka membuat setiap akun berperan `user`. Promosi dilakukan skrip pemeliharaan yang membaca `ADMIN_EMAIL`; tidak ada akun admin yang di-seed, karena `schema.sql` dijalankan pada setiap deploy dan kredensial di sana tidak akan pernah bisa dirotasi.
- **Status 403 dan 503 sengaja dibedakan.** Query entitlement yang gagal berarti "tidak berhak" (403). Database yang sepenuhnya mati berarti "tidak bisa diverifikasi" (503), karena yang kedua harus bisa di-retry dan tidak boleh dilaporkan sebagai masalah tagihan.
