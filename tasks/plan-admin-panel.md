# Implementation Plan: Konsol operator lengkap (2 November 2026)

Permintaan pemilik: "buat Admin Panel lengkap", mengacu ke blueprint
§5.1 (`docs/saas-subscription-platform.md`). Cakupan yang disepakati lewat
tanya-jawab: **semua modul blueprint**, tetap **satu URL `/admin` dengan tab**
(bukan sidebar + route), **API key tinggal di `.env`** dengan panel status
hanya-baca, **ekspor CSV ikut**, **reset sandi tidak**.

## Yang ditemukan sebelum memutuskan

Dibaca dari kode, bukan diasumsikan dari blueprint:

- **Lubang sebenarnya bukan fitur kurang — layar kurang.** `GET
  /v1/admin/transactions`, `POST .../approve`, `POST .../deny` sudah selesai di
  `backend/api/routers/admin/transactions.py`, sudah diuji
  `backend/tests/test_admin_transactions.py`, dan **tidak punya pemanggil sama
  sekali**. Uang masuk dan tidak ada tempat untuk memutuskannya. Karena itu
  antrean dikerjakan lebih dulu, tanpa mengubah backend.
- `POST /v1/admin/accounts/{id}/subscription` juga sudah ada dan juga tidak punya
  layar.
- **`blocked_reason` sudah dikirim server dan dibuang layar.**
  `AdminAccountResponse` mengirimnya; interface `AdminAccount` di
  `AdminView.tsx` tidak memuatnya, jadi konsol mencetak "Diblokir" tanpa
  membedakan `'admin'` (hanya dibuka endpoint ini) dari `'subscription_expired'`
  (dibuka pembayaran) — persis pembeda yang jadi alasan ADR-0012 ada.
- **Tiga butir blueprint tidak bisa dibangun seperti tertulis**: pratinjau bukti
  transfer (`proof_image_url` sengaja tidak pernah diisi, ADR-0011), notifikasi
  saat approve (tidak ada transport email/WA di seluruh kode), dan pengaturan
  kunci API (SMTP dan WhatsApp tidak punya field di `Settings` sama sekali).
- Fake pool di `backend/tests/conftest.py` mencocokkan **teks** query dan menjawab
  dalam Python. Ia tidak bisa menangkap SQL yang bukan Postgres sah. Sebelum ini,
  tidak ada satu pun tes yang menjalankan `list_accounts` atau query ringkasan di
  driver sungguhan.

## Keputusan yang diambil sambil membangun, dan kenapa

### 1. Daftar akun dipisah ke `AdminAccountsView.tsx`; bacanya tetap di shell

Rencana awal mengekstrak panel akun dari `AdminView.tsx`. Draf pertama menolak
itu, dengan alasan: gerbang 403 dan tag `OPERATOR ACCESS` keduanya **ditentukan
oleh respons daftar akun itu sendiri**. Mengekstrak daftar berarti salah dari dua
hal buruk — probe ganda ke endpoint yang sama di setiap buka konsol, atau
menaikkan state ke shell lewat callback.

Alasan itu benar, kesimpulannya salah. Yang tidak boleh ganda adalah **bacanya**,
bukan filenya. Bentuk akhirnya: `useAdminAccounts()` dipegang shell, dan
`<AdminAccountsView accounts={accounts} />` menerima objek yang sama itu. Satu
GET per buka konsol, tetap; state yang jadi dasar gerbang ya state yang sama
yang dipakai tabel. Shell jadi hanya tab + `GateSection` + footer (574 baris jadi
287), dan kolom, aksi baris, serta pagination pindah bersama tabelnya.

Yang membuat keberatan awal tadi terdengar benar adalah cara ekstraksi biasanya
dilakukan: komponen minta datanya sendiri. Di sini komponen menerimanya. `AdminView.test.tsx`
direvisi mengikuti itu — assertion tentang tabel dan dialog pindah ke
`AdminAccountsView.test.tsx` (diuji lewat harness yang memasang hook dan view
berpasangan, sama seperti konsol memasang keduanya), dan yang tinggal di shell
hanya yang memang milik shell: gerbang, tag operator, dan tab.

### 2. Denominator MRR dibangun dari `PLAN_DAYS`, tidak diketik ulang

Draf pertama menulis `CASE plan WHEN 'weekly' THEN 7.0 …` sebagai literal, dengan
komentar yang mengklaim angka itu "dirujuk dari satu tempat". Klaimnya salah dan
kodenya juga: itu salinan kedua. Diperbaiki jadi `CASE` yang disusun dari
`PLAN_DAYS`, supaya kalau masa aktif paket berubah, lajur bulanan ikut — bukan
salah diam-diam.

### 3. Query baru diuji di Postgres sungguhan, dalam transaksi yang di-rollback

`backend/tests/test_admin_live_sql.py` menjalankan `LEFT JOIN LATERAL`,
`FILTER (WHERE …)`, dan `AT TIME ZONE` lewat driver nyata. Semua tulisan di dalam
`conn.transaction()` yang di-rollback lewat sentinel; diverifikasi database
pengembang tetap bersih (0 user sisa, 0 transaksi sisa). Satu tes menangkap
kesalahan yang tidak mungkin terlihat di fake: SQL membulatkan (64286) sementara
ekspektasi Python memotong (64285).

### 4. Ekspor CSV menyatakan sendiri kalau terpotong

Batasnya 5.000 baris dan berkas yang dipotong diakhiri baris komentar berisi
batas, jumlah baris, dan offset berikutnya. Kolomnya persis yang tampil di layar —
`approved_at` sengaja tidak ikut, karena antrean juga tidak membacanya; menambah
kolom ke berkas yang tidak ada di layar menciptakan salinan ledger kedua yang bisa
berbeda dari yang pertama.

### 5. Integrasi hanya Midtrans, dan hanya-baca

`gateway_configured()` / `gateway_environment()` dipisah dari
`midtrans_service.py` supaya panel dan jalur checkout memakai **satu predikat**.
Tidak ada kolom input: `get_settings()` di-`lru_cache` saat import, jadi formulir
apa pun akan tampak menyimpan tanpa mengubah apa pun. SMTP dan WhatsApp tidak
diperlihatkan sebagai "off" — itu menyiratkan aplikasi punya tempat untuknya.

## Berkas

**Backend baru**: `api/services/admin_analytics_service.py`,
`api/routers/admin/analytics.py`, `api/routers/admin/integrations.py`,
`tests/test_admin_analytics.py`, `tests/test_admin_integrations.py`,
`tests/test_admin_live_sql.py`.

**Backend diubah**: `api/services/account_service.py` (`_LIST_ACCOUNTS_SQL`,
`Account.expires_at`, `_to_account`), `api/services/midtrans_service.py`
(predikat), `api/services/payment_service/core.py` (`_MAX_QUEUE_FETCH`),
`api/services/payment_service/manual.py` (`offset`, `hasMore`),
`api/routers/admin/accounts.py` (`subscriptionExpiresAt`),
`api/routers/admin/transactions.py` (`AdminTransactionListResponse`,
`GET .../export`), `api/routers/admin/__init__.py`, `tests/conftest.py`
(cabang overview, `expires_at` di daftar, limit/offset dihormati, `get_pool`
modul analytics di-patch).

**Frontend baru**: `AdminTransactionsView.tsx` (+ tes), `usePaymentQueue.ts`,
`AdminModal.tsx`, `GrantPeriodDialog.tsx`, `AdminDashboardView.tsx`,
`AdminIntegrationsView.tsx` (+ tes), `AdminAccountsView.tsx` (+ tes).

**Frontend diubah**: `AdminView.tsx` — tinggal shell: tujuh tab, Ringkasan jadi
tab awal, tab "Rekening", gerbang 403, tag `OPERATOR ACCESS`; kolom Status tiga
keadaan, kolom Berakhir, dan tombol Perpanjang hidup di `AdminAccountsView.tsx`
yang dipisah dari file ini. `AdminView.test.tsx` dikecilkan ke assertion milik
shell; assertion tabel dan dialog pindah ke `AdminAccountsView.test.tsx`.
`config/api.ts`.

## Perubahan bentuk yang disengaja

`GET /v1/admin/transactions` kini menjawab `{transactions, hasMore}`, bukan
array polos. Ini memecah kontrak, dan dipilih justru karena bentuk lamanya
menyembunyikan pemotongan pada 200 baris. Semua pemakai ikut diubah di commit
yang sama; tidak ada kompatibilitas ganda yang ditinggalkan.

## Irisan kedua: paritas §5.1 yang tersisa

Setelah konsolnya hidup, pembacaan ulang §5.1 terhadap kode meninggalkan dua butir
bernama yang memang belum ada, keduanya di layar akun:

- **Kolom No WA.** `AdminAccountResponse` sudah mengirim `phone_number` dan
  `_LIST_ACCOUNTS_SQL` sudah membacanya; tabelnya tidak mencetaknya. Pola yang
  persis sama dengan `blocked_reason` di irisan pertama: faktanya ada di respons,
  layarnya membuangnya. Nol perubahan backend.
- **Pencarian dan filter status.** §6.3 sudah mengakuinya sendiri ("**Sudah ada**;
  pencarian dan filter status belum"). `GET /v1/admin/accounts` hanya menerima
  `limit`/`offset`. Pada 477 baris di database pengembang, sebagian besar
  `consent-*@test.invalid`, daftar tanpa pencarian tidak bisa dipakai menemukan
  satu akun.

### Keputusan bentuknya

`q` dan `state` masuk ke `GET /v1/admin/accounts` yang sama, sebagai predikat di
dalam statement — bukan endpoint kedua, dan bukan saringan atas satu halaman di
browser. Memotong 25 baris yang sudah datang menjawab "tidak ada yang cocok"
tentang jendela yang kebetulan sedang tampil, sementara akun di halaman berikutnya
tetap ada; itu menyembunyikan akun, bukan menemukannya.

`state` adalah kata layar untuk `blocked_at IS (NOT) NULL`. Ia sengaja tidak
menyentuh `blocked_reason`: jenis penutupan sudah punya kolom dan subbarisnya
sendiri (ADR-0012), dan menjadikannya dropdown filter akan memindahkan keputusan
arti kata itu ke tempat kedua.

Nomor parameter dihitung, tidak ditulis tangan. `LIMIT` berpindah dari `$1` ke
`$3` begitu ada term pencarian di depannya, dan itu satu-satunya tempat bug ini
lahir kalau keduanya ditulis terpisah.

### Yang terbukti oleh tes, dan mana yang tidak bisa dibuktikan fake

Fake pool di `backend/tests/conftest.py` ikut diubah supaya benar-benar
menerapkan `q`, `state`, `LIMIT`, dan `OFFSET` — dan ia menolak query yang
dikenalnya punya predikat `blocked_at` tapi tidak dikenal bentuknya. Tanpa itu,
WHERE clause yang tidak pernah cocok akan lulus di seluruh suite. Ini diverifikasi
dengan mutasi: membuat builder mengabaikan term pencarian menggagalkan 5 tes;
mengembalikan escaping `%`/`_` membuat tes di Postgres sungguhan gagal. Keduanya
kembali hijau setelah mutasi dilepas.

Tiga tes di `backend/tests/test_admin_live_sql.py` menjalankan statement yang sama
di driver nyata dalam transaksi yang di-rollback: predikat state, escaping
wildcard (dengan pembanding yang sengaja tidak di-escape, supaya tesnya membuktikan
perbedaan dan bukan sekadar query yang tidak mengembalikan apa pun), dan urutan
`LIMIT`/`OFFSET` setelah predikat baru.

### Dua cacat yang ditemukan verifikasi browser, bukan tes

Keduanya ada di "Prasyarat" irisan ini dan layak dicatat karena tidak ada tes yang
menangkapnya:

- **Slab abu-abu di `Ringkasan`.** Grid enam kartu memakai `repeat(auto-fit,
  minmax(200px, 1fr))` dengan `gap: 1` dan `background: var(--border)` sebagai
  cara menggambar garis rambut. Jumlah track yang auto-fit pilih pada 1440px tidak
  membagi enam, jadi baris kedua memperlihatkan background kontainer selebar
  empat kolom — tampak seperti panel yang kehilangan datanya. Diperbaiki dengan
  jumlah kolom tetap (3/2/1 per lebar) plus sel terakhir menutup sisa barisnya.
- **Angka telanjang di tes ekspor CSV.** `rows[1][9]` mengikat tes ke urutan
  kolom, bukan ke isinya. Ketika kolom ekspor disesuaikan agar persis sesuai
  daftar §5.1 (`approved_at` menggantikan `updated_at`), tes itu gagal karena
  pergeseran posisi, bukan karena isi. Semua assertion kolom sekarang mencari
  indeksnya lewat `header.index("nama_kolom")`; hal yang sama diterapkan di
  `AdminAccountsView.test.tsx` lewat `columnIndex('Berakhir')`.

## Irisan ketiga: jalur email, dengan antrean di depannya

Pemilik memilih **email dulu** dan bentuk **outbox**. Yang membuat butir §5.1 ini
bisa dibangun tanpa membalik keputusan yang sudah tercatat adalah satu
perbedaan: antrean tidak lagi berkata "tidak ada notifikasi", ia berkata
"pesannya diantrekan, dan yang tahu sudah keluar atau belum hanyalah worker".

### Bentuknya, dan kenapa bukan alternatifnya

**Baris pesan ditulis di dalam transaksi approve.** Ini seluruh alasan tabelnya
ada. Mengirim dari dalam transaksi berarti menahan lock database melewati
round trip jaringan ke pihak ketiga — provider yang lambat berubah jadi pool
habis. Mengirim sesudah commit berarti proses yang mati di antaranya
menghilangkan pesan **tanpa jejak**: operator melihat tabel kosong dan
menyimpulkan tidak ada yang perlu dikirim, padahal ada. Satu baris membuat
kewajiban itu bertahan dari crash.

**Teks yang dirender disimpan, bukan disusun ulang saat kirim.** Barisnya adalah
rekaman apa yang sebenarnya dikatakan ke alamat itu. Merender dari template
terbaru ketika worker sempatinya akan membuat satu baris berarti berbeda di waktu
berbeda — bentuk sumber kedua yang schema ini hindari di tempat lain.

**At-least-once, bukan exactly-once.** Proses yang mati antara kirim sukses dan
mark `sent` membuat pesan dikirim ulang. Untuk konfirmasi pembayaran itu arah
yang benar: duplikat itu tidak nyaman, pesan yang hilang membuat pembayar tidak
tahu ia sudah punya akses dan tidak ada yang bisa menunjukkan sesuatu pernah
diwajibkan. Exactly-once butuh pengiriman yang transactional dengan barisnya, dan
server SMTP tidak ikut transaksi Postgres.

**Satu predikat, tiga pemakai.** `email_configured()` dibaca jalur approve, worker,
dan panel Integrasi — bentuk yang sama yang sudah dipakai
`gateway_configured()` untuk Midtrans. Kalau panel menebak sendiri, ia bisa
mengiklankan jalur yang sedang menolak mengirim.

**Default mati.** `NOTIFICATIONS_ENABLED=false`. Email ke pelanggan tidak bisa
ditarik, dan developer yang menyalin `.env` staging ke laptopnya tidak boleh
menemukan dirinya mengirim invoice sungguhan ke orang sungguhan. Flag ini sengaja
terpisah dari `SMTP_HOST` karena keduanya fakta berbeda: sebuah instalasi bisa
punya host dan tetap memilih tidak mengirim.

### Yang ditemukan sebelum sempat rusak di produksi

- **`str(timedelta)` bukan interval.** `_CLAIM_SQL` dan `_MARK_FAILED_SQL`
  mengirim `str(_CLAIM_WINDOW)` ke parameter `$n::interval`. asyncpg meminta
  objek `timedelta` dan menjawab `DataError: 'str' object has no attribute
  'days'`. Fake pool menerima string dengan senang, jadi worker akan gagal di
  setiap beat di produksi sementara suite tetap hijau. Inilah tepatnya yang
  `backend/tests/test_admin_live_sql.py` ada untuk menangkapnya, dan ia menangkap.
- **`mark_failed` menulis `status='failed'` pada kegagalan pertama.** Itu
  membuat `_MAX_ATTEMPTS` dan backoff eksponensial di bawahnya jadi kode mati, dan
  mengubah satu gangguan provider sepuluh menit jadi pesan yang tidak pernah
  terkirim lagi. Diperbaiki jadi `CASE WHEN attempts >= $3 THEN 'failed' ELSE
  'pending' END` — satu statement, karena transisi dan backoff harus bergerak
  bersama.
- **`.replace(",", ".")` pada literal yang bersebelahan.** Di `_approved_body`,
  `.replace` yang ditempel di satu baris f-string menempel ke **seluruh rangkaian
  literal** yang bersisian, termasuk baris nomor faktur. Angka rupiah memang benar
  (`Rp 44.000`), tapi kode faktur yang mengandung koma akan ikut berubah diam-diam.
  Diganti `_rupiah()` sebagai helper, dengan tes yang mengirim kode
  `INV,WITH,COMMAS` dan menegaskan komanya masih ada.
- **Penjaga `.env.example` bekerja.** `tests/test_env_template.py` menuntut setiap
  field `Settings` terdokumentasi; tujuh field email baru membuat tes itu gagal
  dan tujuh tes lain jadi `skip`. Skip itu bukan hijau — itu field yang belum
  ditulis. Sekarang ketiganya ada di template dan 93 tes template lolos tanpa skip.

### Yang sengaja belum dibangun

Template HTML invoice §7.2 (logo, multipart alternative, keputusan tampilan) —
 yang terkirim sekarang teks biasa berisi nomor faktur, nominal, paket, dan
tanggal berakhir, dan itu pesan yang lengkap. Pengingat perpanjangan H-3.
WhatsApp, termasuk normalisasi `users.phone_number` ke E.164 yang dibutuhkannya.

**Diverifikasi di browser untuk jalur email**, dengan akun sementara pola yang sama
(`zz-mail-*`, dihapus lagi setelahnya) dan instance backend kedua di port 8022
yang dimatikan sesudahnya — supaya proses pemilik di 8020 tidak dipakai untuk
menguji konfigurasi email. Yang terbukti, dua-duanya:

- **Install tanpa email (8020, `NOTIFICATIONS_ENABLED=false`).** Approve satu
  transfer menjawab `settlement` dan mencetak langganan, dan `notification_outbox`
  tetap **0 baris**. Panel Integrasi mencetak "Email / Belum terpasang / Yang
  belum diisi: NOTIFICATIONS_ENABLED, SMTP_HOST, SMTP_MAIL_FROM" dengan **nol
  kolom input** di seluruh tab. Antrean tidak lagi mengklaim apa pun tentang
  notifikasi yang terkirim.
- **Install dengan email (8022, host menunjuk port 2525 yang tidak ada
  servernya).** `/v1/admin/settings/integrations` menjawab
  `emailConfigured: true, emailMissing: []`; approve satu transfer menulis tepat
  **satu** baris `payment_approved` dengan alamat pembayar dan subjek yang
  menyebut paketnya. Lalu `drain_once()` diarahkan ke server yang menolak
  koneksi: `{claimed: 1, sent: 0, failed: 1}` — barisnya **tetap `pending`**,
  `attempts` naik, `next_attempt_at` bergeser ke depan, dan `last_error` berisi
  "could not reach 127.0.0.1: [Errno 61] Connection refused". Tidak ada jalur di
  mana kegagalan kirim menyamar jadi `sent`.
- **Jendela klaim bekerja di arah yang benar.** Drain kedua sebelum jendela
  backoff habis menjawab `{claimed: 0}` — baris yang sedang dipegang tidak diambil
  dua kali.
- **Cascade pada data nyata.** Menghapus 2 akun verifikasi membawa baris outboxnya
  bersama: `notification_outbox` kembali ke 0 tanpa satu DELETE pun ke tabel itu.

## Temuan agen browser, dan yang diperbaiki

Verifikasi `/admin` dijalankan lewat subagent browser di dua lebar (1440 dan 390),
seluruh tujuh tab, dengan akun operator sementara. Empat temuan diverifikasi di
kode lebih dulu sebelum dipercaya — dan keempatnya nyata:

1. **`Ringkasan` mengklaim "Sembilan angka" sementara yang tampil 6 kartu.**
   Endpoint memang menjawab sembilan field, tapi enam jadi kartu, dua masuk ke
   strip antrean, dan satu bersembunyi di dalam rumus MRR. Kalimat itu mengundang
   pembaca menghitung enam dan menyimpulkan panelnya kehilangan tiga. Diganti jadi
   "Satu pertanyaan ke server untuk angka-angka di bawah" — tanpa klaim jumlah.
2. **Tolak tidak memberi konfirmasi apa pun; Setujui memberi banner.** Asimetri
   nyata: `usePaymentQueue.deny()` memanggil `setResult(null)` dan tidak pernah
   mengisi hasil, jadi satu-satunya tanda sebuah penolakan terjadi adalah baris
   yang menghilang — yang tampak persis seperti halaman yang memuat ulang.
   `result` sekarang `QueueOutcome` (approved | denied), banner penolakan menyebut
   nomor faktur dan bahwa alasannya tercatat, dan **tidak** mengklaim pembayar
   sudah diberitahu — itu jawaban worker, bukan layar ini. Dua tes baru menjaganya.
3. **Wrapper tabel yang menggulir tidak bisa diakses keyboard.** Di 390px lima
   kolom dari tujuh ada di luar layar, dan `overflowX: 'auto'` tanpa `tabIndex`
   berarti region itu tidak bisa difokuskan — jadi tidak bisa digulir tanpa mouse
   atau jempol. Kedua wrapper (akun dan antrean) sekarang `role="region"` +
   `aria-label` + `tabIndex={0}`.
4. **Tab strip menyembunyikan `Kontak` dan `Integrasi` di 390px.** Tujuh tab lebih
   lebar dari ponsel dan stripnya menggulir di dalam dirinya sendiri tanpa isyarat.
   Ditambah `flexWrap: 'wrap'` — ketujuh tab sekarang terlihat, bukan digulir.

Yang dicatat tapi **tidak** diubah: Rekening tujuan kosong di database pengembang
(`Belum ada rekening tujuan`) sementara baris settlement lama menyebut
`BCA 777000111` — itu keadaan data, bukan cacat layar, dan mengisi rekening adalah
keputusan pemilik. `402` pada `/v1/portfolio/positions` yang ikut terpicu selama
`/admin` terbuka juga keadaan lama: shell aplikasi mengambil posisi di setiap route.

## Uji

505 tes frontend (39 berkas) dan 1004 backend hijau; `tsc`, `eslint`, `ruff`,
`prettier`, `vite build` bersih; `test_docs_status.py` 20 lolos. Coverage backend
70,46%. `test_env_template.py` 93 lolos tanpa skip.

**Diverifikasi di browser** pada `http://localhost:5173/admin`, sebagai operator
sungguhan, di 1440 dan 390. Caranya: akun sementara dibuat lewat `POST
/v1/auth/signup` lalu dipromosikan dengan `python -m db.promote_admin`, dan
setelah verifikasi selesai barisnya dihapus lagi (sessions → subscriptions →
transactions → users, scoped `email LIKE 'zz-queue-%@local.invalid'`; database
kembali ke 477 user dan 1 transaksi). Yang terbukti: approve satu putaran penuh
("Disetujui. Masa aktif berlaku sampai 3 Des 2026, 01.28.") dengan barisnya
keluar dari filter Menunggu; Tolak dengan tombol terkunci selama alasan kosong,
lalu status `deny` dan alasan tercatat di `admin_notes`; baris `settlement`
menyebut id langganan yang dicetaknya; ringkasan berubah angka setelah approve;
390px tanpa overflow horizontal dan grid satu kolom.

**Verifikasi ulang setelah irisan ini**, dengan akun sementara pola yang sama
(`zz-parity-*`, dihapus lagi setelahnya: 6 sessions, 1 subscription, 2
transactions, 2 users): kolom No WA terisi dari server (`081200000009`),
pencarian `parity` mengirim `?limit=25&offset=0&q=parity` dan menyisakan dua
baris dengan readout `1–1 · Diblokir · pencarian "parity"` setelah saringan
ditekan, baris kosongnya berkata "tidak ada akun yang cocok" dan bukan "tidak
ada akun", blokir/unblock satu putaran penuh lewat UI, `approvedAt` tercetak di
baris settlement (`disetujui 3 Nov 2026, 02.51`), dan ketujuh tab di 390px tidak
melebar keluar halaman sementara kedua tabelnya menggulir di wadahnya sendiri.

Dua hal yang **tidak** bisa dibuktikan browser ini, dan disebut apa adanya:
`MIDTRANS_SERVER_KEY` pada instalasi dev kosong, jadi panel Integrasi hanya bisa
menunjukkan "Belum dikonfigurasi" tanpa kolom input — penjaga asli "tidak ada
materi kunci" adalah `backend/tests/test_admin_integrations.py`, yang mengonfigurasikan
kunci palsu lalu menegaskan nilai itu, prefiks 8 karakternya, dan panjang nilai
tidak pernah muncul di body. Dan baris `consent-*@test.invalid` bertambah setiap
`pytest` jalan (477 → 487 selama sesi ini); itu ditulis suite-nya sendiri, dan
menghapusnya bukan bagian tugas ini.

**Efek samping pada proses pemilik:** backend dev di port 8020 dijalankan ulang
dengan command line identik (`python -m uvicorn api.main:app --host 127.0.0.1
--port 8020`). Tanpa itu verifikasi browser mustahil: proses yang sedang berjalan
dimulai sebelum editan ini dan tidak memakai `--reload`, jadi ia melayani kode
lama — header CSV-nya masih `updated_at` dan `?q=` tidak dikenal. Instance paralel
di port lain sudah dicoba dan ditinggalkan: reconnect WS yang ditolak membuat Vite
kedua itu macet sebelum POST login sempat diteruskan.

## Pertanyaan yang tersisa

- **Indeks `pg_trgm` untuk pencarian — sudah diukur, jawabannya jangan.**
  `EXPLAIN (ANALYZE, BUFFERS)` atas statement daftar akun yang sebenarnya
  (`_list_accounts_query` dikirim lewat asyncpg ke database pengembang, 492 baris
  `users`): seq scan, **0,63 ms** dengan `q=nama`, **0,08 ms** dengan `q` +
  `state`, **0,98 ms** tanpa filter. Sebuah indeks trigram menambah migrasi dan
  satu hal yang harus dijaga benar, untuk angka yang sudah di bawah satu
  milidetik. Yang mengubah jawaban ini adalah pertumbuhan, bukan perasaan: kalau
  `users` sudah puluhan ribu baris dan plan masih seq scan, migrasinya satu file.
- **Sampah tes di database pengembangan — sudah dibereskan, dan penyebabnya
  ditutup di sumbernya.** Diukur lebih dulu: dari 492 user, **487** adalah
  `consent-*@test.invalid` (99%), dan yang menunjuk ke mereka hanya
  `consent_acceptances` (**640** baris, `ON DELETE CASCADE`); `sessions`,
  `subscriptions`, `portfolios`, `transactions` semuanya **0**.
  Yang tumbuh itu bukan sampah yang tak terhindarkan: fixture `account_id` di
  `backend/tests/test_consent_service.py` menulis user sungguhan dan tidak pernah
  menghapusnya — lima baris baru setiap kali suite jalan. Diperbaiki di sana
  (fixture jadi `yield` lalu `DELETE FROM users`; cascade menangani baris
  consentnya), diverifikasi dengan menjalankan modul itu dan menghitung ulang:
  **487 sebelum, 487 sesudah**, sebelumnya akan jadi 492. Baru kemudian 487
  baris lama dihapus lewat skrip scoped dengan dry-run dan pemeriksaan ulang
  blast radius pada saat penghapusan, bukan mengandalkan pengukuran tadi.
  Hasil: `users` 492 → 5, `consent_acceptances` 686 → 46, **970 tes tetap lolos**.
  Yang tersisa lima akun yang memang dipakai layar ini (`operator@local.invalid`,
  `payer-e2e@aidss.id` dengan satu baris settlement, `admin-e2e@aidss.id`, dan dua
  akun inspeksi UI). Dua akun inspeksi itu juga artefak tes, tapi tidak cocok
  polanya dengan yang diukur dan disetujui, jadi tidak ikut dihapus — scope
  pembersihan tidak boleh melebar diam-diam setelah melihat angka.
- **Satu `@local.invalid` tersisa dan itu benar**: `operator@local.invalid`
  (admin, dibuat 2026-10-04). Nol baris `zz-*` milik verifikasi ini yang
  bertahan — pembersihannya sudah diverifikasi, bukan diasumsikan.
- **`/fitur` berakhir tanpa CTA** — pertanyaan terbuka dari sesi footer publik,
  masih belum dijawab.

---

## Increment 2026-11-09 — pembayaran: rekening, kanal, SMTP, dan layar `/bayar`

Empat permintaan pemilik, dan tiga di antaranya menyentuh kode yang sudah ada tapi
berbentuk salah. Rencananya dieksekusi per irisan; yang tercatat di sini adalah
keputusan dan konsekuensi yang pemilik terima, bukan ringkasan diff.

- **Rekening jadi pilihan dari daftar bank, bukan teks bebas, dan tiap baris punya
  "tampilkan ke user".** Sebelumnya setiap baris yang disimpan langsung publik.
  Sekarang endpoint publik mengirim yang ditampilkan saja — baris yang disembunyikan
  tidak dikirim dengan flag untuk diabaikan browser. Bentuk baris bertambah
  (`code`, `enabled`) dan **baris lama tanpa keduanya tetap terbaca** dengan default
  `code="other"`, `enabled=true`: kalau tidak, memasang fitur ini akan mematikan
  halaman pembayaran instalasi yang sedang bekerja. Daftarnya disajikan server
  (`GET /v1/admin/settings/bank-options`) supaya form tidak menyimpan salinan kedua.
  Kodenya kunci internal, **bukan** kode clearing — tidak ada satu pun angka bank
  yang ditulis dari ingatan.
- **Kanal bayar online kini dipilih operator, dan halaman gateway dibatasi.**
  Yang dulu ada dua daftar yang bisa berbeda (di `core.py` dan di `constants.ts`)
  dan satu salinan ketiga di bundle frontend; tinggal satu registry
  (`backend/api/services/channel_registry.py`) dan salinan frontend **dihapus**.
  `enabled_payments` dikirim ke Snap hanya bila operator pernah memilih —
  "belum pernah ditulis" dibaca `None`, bukan kosong, karena kalau tidak, deploy
  ini akan diam-diam menghapus metode bayar yang sedang jalan.
- **Satu koreksi hasil verifikasi, bukan asumsi.** Draft rencana menuliskan kode
  Mandiri sebagai `mandiri_va`. Dokumentasi Snap Midtrans menunjukkan `bank_transfer`
  adalah alias yang mengembang ke `permata_va, bca_va, bni_va, bri_va, echannel` —
  Mandiri adalah **`echannel`**. Kalau tebakan itu ikut dikirim, Virtual Account
  Mandiri hilang dari halaman bayar **tanpa satu pun error**. Dipatok di
  `backend/tests/test_payment_channels.py` karena kegagalan jenis ini tidak bersuara.
- **Kolom `transactions.destination`** (migrasi `0016`) — hasil dari pertanyaan yang
  belum pernah diajukan ke user: transfer ke rekening *yang mana*. Disimpan sebagai
  snapshot yang server susun, bukan referensi, supaya rekening yang nanti diubah
  atau dipensiunkan tidak menulis ulang klaim payer. **Tidak ikut diekspor CSV**:
  sebelas kolom keluaran itu milik blueprint, dan menambah kolom adalah perubahan
  dokumen, bukan perubahan respons.
- **SMTP bisa disunting dan benar-benar dibaca.** Pemilik memilih "semua field
  SMTP bisa disunting", dan itu **membalikkan keputusan yang tercatat sebelumnya**.
  Konsekuensi yang diterima dan tidak bisa dimitigasi: **password SMTP plaintext di
  jsonb** — ada di setiap backup basis data dan terbaca oleh akun mana pun dengan
  hak baca Postgres. Mitigasi yang dipasang: tidak ada endpoint yang mengembalikan
  nilainya (hanya `hasPassword`), tidak masuk log, `repr` dataclass dibuang, dan
  PUT tanpa password mempertahankan yang tersimpan. Ditulis di
  [ADR-0014](../docs/adr/0014-smtp-di-database.md).
  **Tanpa perubahan pada transport, fitur ini akan lebih buruk daripada tidak ada**:
  `get_settings()` di-cache saat import, jadi formulir yang menulis ke DB sementara
  mailer membaca `Settings` akan tampak menyimpan dan tidak mengubah apa pun.
  `mail_config()` sekarang satu-satunya pembaca, dan ia membaca barisnya saat
  mengirim — ada tes yang membuktikannya berubah **tanpa restart**
  (`backend/tests/test_smtp_settings.py`).
- **Editor email adalah pintu terpisah dari panel Integrasi**, dan alasannya
  tercatat di docstring `backend/api/routers/admin/smtp.py`: panel itu dijaga tes
  yang menolak teks apa pun selain nama site. Memakai pintu yang sama akan
  menghancurkan penjaga yang baru saja diperkuat untuk password SMTP.
- **`/bayar` adalah layar bayar, dan gate-nya sesi — bukan entitlement.** Ini
  jebakan termahal di increment ini: `require_entitlement` menolak akun tanpa
  langganan aktif, sementara akun yang **baru habis langganannya** justru yang
  paling perlu membayar. Layar bayar yang ter-gate entitlement akan mengunci tepat
  orang yang ingin dibukanya. `subscription_expired` membuka `/bayar`; ban `'admin'`
  tidak ([ADR-0012](../docs/adr/0012-alasan-pada-blokir.md)).
- **Dua form di Tab 2 Settings pindah, tidak disalin.** Dua form yang menulis fakta
  yang sama adalah dua tempat yang bisa berbeda jawaban. Tesnya ikut pindah
  (`src/app/features/payment/PayView.test.tsx`), bukan dihapus;
  `src/app/features/settings/SettingsViewGateway.test.tsx` sekarang menegakkan sisi
  negatifnya: Tab 2 tidak punya form bayar sendiri dan tidak POST ke
  `/v1/payments/manual`.
- **User tidak membaca nama gateway di layar kita, dan itu dijaga tes**
  (`src/app/test/noGatewayBrand.test.ts`). **Yang tidak bisa dijanjikan**: halaman
  yang terbuka setelah memilih bayar online adalah halaman milik gateway, dan kata
  itu ada di sana. Batasan itu tertulis di `docs/status.md`, bukan ditutup-tutupi.
- **Satu butir rencana yang saya ikut dengan tulisan yang lebih spesifik di rencana
  yang sama, dan itu perlu dibaca sebagai keputusan, bukan kelalaian.** Bagian
  service menulis "list kanal yang diizinkan, **minimal satu**"; bagian endpoint
  menulis "An empty list is accepted here and means no online payment at all — a
  deliberate act". Yang saya bangun mengikuti yang kedua: `write_payment_channels([])`
  sah, dan checkout menjawab 503 berkalimat alih-alih membuka halaman tanpa batas.
  Alasannya bukan selera: daftar rekening tujuan memang harus ditolak kalau kosong
  (mengosongkannya berarti tidak ada alamat transfer sama sekali), tetapi daftar
  kanal yang kosong berarti "instalasi ini hanya menerima transfer" — keadaan yang
  koheren dan memang diinginkan operator. Menolak keduanya dengan aturan yang sama
  akan memakai satu alasan untuk dua fakta yang berbeda. Ditutup dari dua sisi:
  `test_an_empty_list_is_a_choice_and_reads_as_one`,
  `test_everything_switched_off_refuses_instead_of_opening_the_world`, dan
  `test_switching_everything_off_is_written_and_reads_back`.
- **Daftar kanal yang diizinkan menguasai kedua pintu, bukan satu.** Yang pertama
  saya bangun hanya membatasi `POST /v1/payments/checkout`; deklarasi manual masih
  menerima metode apa pun yang ada di registry. Itu belum jawaban yang diminta:
  mematikan VA BCA menyisakan jalan kedua untuk membayar lewat VA BCA, dan antrean
  akan terisi baris yang mengklaim metode yang instalasi itu tolak. Sekarang
  `backend/api/services/payment_service/manual.py` juga memeriksa daftar itu —
  dengan dua pengecualian yang justru intinya: `bank_transfer` tidak ikut aturan
  (ia tidak punya kode gateway dan tidak ada di daftar itu untuk dimatikan), dan
  baris yang belum pernah ditulis tidak membatasi apa pun di kedua pintu.
  Mutation-tested: menghapus pemeriksaan itu membuat
  `test_a_channel_the_operator_switched_off_cannot_be_declared_as_used` gagal.
- **Satu keputusan teknis yang muncul di tengah jalan dan perlu dibaca:** kolom
  `destination` butuh migrasi, dan `db/schema.sql` serta
  `docs/saas-subscription-platform.md` harus ikut — `test_docs_status.py`
  membandingkan DDL blueprint dengan schema apa adanya, dan migrasi yang tidak
  muncul di schema.sql tidak akan pernah sampai ke stack yang dibangun ulang
  (ADR-0001).
