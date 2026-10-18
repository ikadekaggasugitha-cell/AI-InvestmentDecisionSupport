# ADR-0012: Blokir membawa alasannya — penangguhan langganan vs ban admin

**Status:** Diterima. Diterapkan.

## Masalah

Langganan yang habis bisa menutup seluruh Account tanpa kolom baru: beat
menulis `blocked_at`, dan gerbang membacanya seperti sekarang. Keputusan ini
menolak jalan itu, karena satu kolom `blocked_at` hanya membawa satu jawaban —
"ditutup" — dan untuk dua penyebabnya, jawaban itu tidak cukup:

1. **Siapa yang boleh membukanya kembali.** Ban administrator dibuka oleh
   administrator. Penangguhan karena langganan habis dibuka oleh pembayaran.
   Dengan satu kolom, kode pembuka harus memilih satu aturan untuk semua.
   Approve yang mengosongkan `blocked_at` akan membebaskan ban lewat jalur
   uang — privilege-escalation. Kalau tidak diizinkan, orang yang membayar
   terus terkunci di luar akses yang barusan ia bayar.
2. **Apa yang diperlihatkan kepada orangnya.** "Akun diblokir" dan "langganan
   berakhir" adalah dua pesan dengan dua jalannya. Status yang sama membuat
   akun tertangguh menerima 403 persis seperti orang yang diblokir —
   termasuk di login, tempat tertangguh harus tetap bisa masuk untuk mencari
   jalan kembali.

## Keputusan

**1. `users.blocked_reason`: kolom nullable berpasangan dengan `blocked_at`.**
Migrasi `0013_subscription_suspension.sql` menambahkan kolom dengan dua CHECK:
kosakata hanya `'admin'` dan `'subscription_expired'`, dan pasangan
`blocked_at` ⟺ `blocked_reason` tidak boleh setengah terisi. Bentuknya dijaga
database, bukan di kode. Baris yang sudah terblokir saat migrasi berjalan
di-backfill ke `'admin'` — mereka ditangguhkan oleh admin, dan tidak boleh
berubah menjadi sesuatu yang bisa dibuka pembayaran.

**2. Dua penulis sengaja, dua alasan, satu modul.** `set_blocked()` adalah
penulis ban admin (endpoint block/unblock, selalu `reason='admin'`). Beat
penangguhan menulis `'subscription_expired'` lewat
`suspend_lapsed_accounts()` — satu pernyataan UPDATE ber-guard:
`blocked_at IS NULL`, pernah punya Subscription, dan tidak punya periode
berjalan. Tiga kondisi itu sekaligus membuat beat idempoten dan membuat ban
`'admin'` tidak pernah tersentuh. Guard-nya hidup di dalam `WHERE` pernyataan
itu, bukan di Python: pemilihan korban dan penutupan terjadi pada satu
snapshot, jadi akun yang barusan dibayar dan dibuka di antara "baca" dan
"tulis" tidak tersentuh oleh keputusan yang memakai data lama.

**3. Pembayaran hanya membuka `'subscription_expired'`.**
`accounts.reopen_after_payment` dipanggil dari `grant()` — satu pintu sukses
semua grant: approve admin, grant manual operator, dan webhook nanti — pada
koneksi yang sama dengan INSERT periode. Crash mengembalikan keduanya, retry
menjalankan keduanya. Guard-nya juga di dalam `WHERE`: hanya baris beralasan
`'subscription_expired'` yang lolos. Ban admin tidak bisa dibuka pembayaran.

**4. Gerbang membagi dua alasan.**

- `'admin'` → **403** "This account is blocked." di mana pun — login,
  auth/me, route data, dan WebSocket **1008**.
- `'subscription_expired'` → tetap bisa login, membaca auth/me, harga, dan
  payments/me; justru dia yang harus tahu jalan kembali. Route data
  (`require_entitlement`) dijawab **403 dengan kalimatnya sendiri**, diperiksa
  **sebelum** switch paywall: instalasi dengan paywall mati tidak
  menghidupkan masa aktif yang sudah lewat — pembayaran yang melakukannya.
  WebSocket penangguhan ditutup **4404** (`WS_CLOSE_SUBSCRIPTION_ENDED`),
  bukan 1008: klien tidak boleh membaca penangguhan sebagai sesi mati dan
  menendang orangnya ke login page.

**5. Frontend menampilkan alasan ini.** `/v1/auth/me` melaporkan
`blockedReason`. `App` me-render `SuspensionScreen`: untuk tertangguh, panel
billing dirender langsung di layar — semua route yang dibacanya tetap
menjawab, jadi tidak ada kontrol mati; untuk admin, hanya pesan, tanpa jalan
pembayaran.

## Alternatif yang tidak dipilih

- **Beat menulis `blocked_at` saja, alasan disimpan samping** — tabel atau
  kolom catatan harus diparse setiap kali kode bertanya "apakah pembayaran
  boleh membuka ini", dan CHECK tidak bisa menjamin pairingnya.
- **`subscriptions.status`** — melanggar ADR-0002 dan CONTEXT.md aturan 1:
  penangguhan adalah keputusan *Account*, bukan properti periode.
- **Beat memanggil `set_blocked()`** — guard penangguhan (pernah berlangganan,
  tidak ada periode berjalan, belum terblokir) tidak sama bentuknya dengan
  menulis ban satu akun; melewatkannya lewat satu fungsi membuat dua keputusan
  yang berbeda terlihat seperti satu jenis aksi yang sama. Bedanya sengaja.
- **1008 untuk dua-duanya, penangguhan dijawab 402** — klien membaca 1008
  sebagai sesi habis dan menendang orang tertangguh ke login page; justru
  perbedaan kodenya yang berguna (ADR-0009). Dan 402 berarti "belum pernah
  berlangganan" — salah dua-duanya untuk tertangguh.

## Konsekuensi

- SQL yang menyentuh `users` tetap satu modul (`api/services/accounts.py`,
  ADR-0001). Dua penulis `blocked_at` dan keberadaan alasan pada masing-masing
  dikunci test yang menyapu sumber kode.
- Guard harus tetap di dalam `WHERE`. Memindahkannya ke Python berarti
  mengembalikan race yang guard-nya cegah.
- Setiap tes yang memblokir akun kini mencatat alasannya secara eksplisit.
  Baris terblokir tanpa alasan adalah bentuk yang ditolak CHECK, jadi tidak
  bisa dibuat oleh statement mana pun.
- Yang menahan keputusan ini: `backend/tests/test_blocked_reason_schema.py`
  (kosakata dan CHECK di database), `backend/tests/test_blocked_reason.py`
  (`set_blocked` dan `reopen_after_payment`),
  `backend/tests/test_suspend_lapsed.py` (siapa yang tertangkap, ban tidak
  pernah tersentuh, idempoten), `backend/tests/test_suspension_gate.py`
  (401/402/403 dan WS 1008/4403/4404 per penyebab), dan
  `backend/tests/test_settlement_reopens.py` (settlement membuka penangguhan,
  bukan ban; crash mengembalikan penangguhan bersama periodenya).
