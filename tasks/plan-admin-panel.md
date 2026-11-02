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

## Uji

504 tes frontend (39 berkas) dan 970 backend hijau; `tsc`, `eslint`, `ruff`,
`prettier`, `vite build` bersih; `test_docs_status.py` 20 lolos. Coverage backend
70,5%.

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

- **Sampah tes di database pengembangan**: 470+ user `*@test.invalid`. Bukan
  dibuat oleh pekerjaan ini — suite menulisnya setiap `pytest` jalan, yang
  sendiri layak jadi keputusan tersendiri. Tidak disentuh oleh pembersihan
  verifikasi ini karena menghapus jejak tes yang sah bukan bagian tugasnya.
- **Indeks `pg_trgm` untuk pencarian.** `ILIKE '%…%'` seq-scan; pada ratusan baris
  ini milidetik. Ukur dulu, baru migrasi, dan itu keputusan tersendiri.
- **`/fitur` berakhir tanpa CTA** — pertanyaan terbuka dari sesi footer publik,
  masih belum dijawab.

