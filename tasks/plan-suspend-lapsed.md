# Implementation Plan: Suspend Akun yang Langganannya Habis

## Gambaran

Hari ini langganan yang habis menghasilkan satu hal saja: route berbayar membalas
**402**, dan aplikasi menampilkan banner "langganan belum aktif". Orang itu masih
bisa masuk, masih bisa melihat shell dan data referensi, dan sudah tidak bisa
melihat satu pun analisis yang dia bayar.

Permintaan pemilik: kalau masa aktif habis, akunnya **tersuspend seluruhnya**, dan
terbuka lagi begitu membayar. Ini perlu lebih keras daripada yang ada sekarang, dan
plan ini mengerjakannya tanpa membuka lubang yang lebih besar dari masalah yang
diselesaikan.

## Keputusan yang Sudah Diambil

**Blokir dipakai, dengan alasannya.** `users` mendapat kolom `blocked_reason`.
Tanpa itu, pembayaran akan membuka blokir admin — lihat *Bahaya yang Dihindari*.

**Hanya akun yang pernah punya langganan lalu kehilangan.** Akun yang mendaftar
dan belum pernah membayar **tidak** pernah disuspend. Kalau aturan ini dilewati,
setiap pendaftaran gratis langsung berubah jadi ban, dan tabel `subscriptions`
yang kosong di instalasi baru akan memblokir siapa pun yang daftar.

**Ban admin tetap total.** Akun dengan `blocked_reason = 'admin'` tidak bisa masuk
sama sekali, tidak bisa melihat apa pun, dan tidak bisa membayar.

**Satu jam adalah batas pembayaran** (keputusan pemilik), sudah tercatat di
`tasks/plan-pembayaran.md`. Plan ini tidak mengubahnya.

## Bahaya yang Dihindari

Implementasi paling langsung — "kedaluwarsa mengisi `blocked_at`, pembayaran
mengosongkannya" — membuka jalur privilege escalation:

```
Admin memblokir penyalahgunakan   → blocked_at terisi
Orang yang diblokir itu membayar Rp 15.000 → pembayaran mengosongkan blocked_at
Orang yang diban masuk lagi
```

Satu-satunya penulis `blocked_at` saat ini adalah `set_blocked()` yang dipanggil
dari endpoint admin. Membiarkan pembayaran memanggilnya dengan alasan yang sama
berarti satu endpoint publik bisa membatalkan keputusan admin. Karena itu
`blocked_reason` bukan detail — itu yang membuat permintaan ini bisa dikerjakan
dengan aman, dan sekaligus yang membuat aplikasi bisa mengatakan alasan yang
benar.

## Konsekuensi yang Dipaksakan Logika

**"Seluruh aplikasi tertutup" dan "bisa dibuka dengan membayar" tidak bisa keduanya
benar kecuali ada jalur pembayaran yang tetap terjangkau dari keadaan terkunci.**

Akun yang tersuspend tidak bisa masuk. Kalau dia tidak bisa masuk, dia tidak bisa
membuat `transactions`, jadi tidak bisa membayar, jadi tidak akan pernah terbuka.
Yang terjadi adalah akun yang terkunci permanen — persis kebalikan dari yang
diminta.

Maka aturan yang dipakai:

| Keadaan | Masuk? | Lihat data? | Bisa bayar? |
|---|---|---|---|
| Normal | ya | ya | — |
| Suspend karena langganan habis | **ya** | **tidak ada** | **ya** |
| Diblokir admin | **tidak** | tidak | tidak |

Artinya "seluruh aplikasi tidak bisa dibuka" diimplementasikan sebagai: seluruh
**isi** aplikasi tidak bisa dibuka. Yang tersisa hanya layar "langganan berakhir,
bayar untuk membuka" — dan itu harus ada, atau tidak ada yang bisa membayar.

## Yang Tidak Berubah

- `subscriptions` tetap tanpa kolom status. Masa aktif tetap ditulis sekali, dan
  penyuspensi tidak menulis apa pun ke sana.
- Payment Status tetap tidak memblokir akses (aturan 3). Yang memblokir adalah
  masa aktif yang habis — bukan status transaksi. Transaksi yang gagal tidak
  menyuspend siapa pun.
- Perpanjangan tetap baris baru (aturan 7).
- Role dan Entitlement tetap terpisah (aturan 6).
- Ban admin tidak bisa dicabut pembayaran, dan `POST /v1/admin/accounts/{id}/unblock`
  tetap satu-satunya jalan membatalkannya.

## Keputusan Arsitektur

**Satu kolom alasan, bukan kolom status kedua.** `blocked_at` + `blocked_reason`
adalah satu fakta — "akun ini ditutup, dan sebabnya ini" — di satu tempat
(aturan 5). Bukan `subscription_expired` di `users` **dan** turunan di
`subscriptions`, yang akan berbeda begitu ada data yang tidak sinkron.

**Menangguhkan hanya dari satu tempat.** Task beat membaca
`MAX(expires_at) WHERE expires_at < NOW()` dan mengisi `blocked_at` untuk akun
yang punya subscription dan tidak sedang diblokir. Ia tidak pernah menyentuh
baris dengan `blocked_reason = 'admin'`.

**Membuka hanya dari satu tempat, dan hanya untuk alasan yang tepat.**
`grant_subscription()` atau penyelesaian pembayaran memanggil satu fungsi yang
mengosongkan `blocked_at` **hanya** kalau `blocked_reason =
'subscription_expired'`. Ban admin tidak punya jalan keluar itu.

**Tidak ada race antara beat dan pembayaran.** Kalau pembayaran masuk pada menit
yang sama dengan tick beat, salah satu akan menulis lebih dulu. Keduanya berakhir
pada keadaan yang sama — aktif dan tidak tersuspend — jadi tidak ada kasus yang
membiarkan akun tersuspend padahal sudah dibayar. Yang penting adalah keduanya
tidak boleh saling menimpa dengan alasan yang berbeda.

## Task List

### Fase 1: Alasan pada blokir

- [x] Task 1: Migrasi 0013 — `users.blocked_reason` (0012 sudah dipakai
      `0012_transactions_plan.sql` dari plan-pembayaran)
- [x] Task 2: `set_blocked()` membawa alasan + `reopen_after_payment()`, dan satu-satunya jalan memblokir

### Checkpoint: Fase 1
- [x] Baris `blocked_at` yang sudah ada ter-backfill ke `'admin'`
- [x] Ban admin tidak bisa dibuka oleh kode mana pun selain endpoint admin
      (guard di `WHERE` `reopen_after_payment`;
      `test_settlement_reopens.py::TestSettlementNeverOpensAnAdminBan`)

### Fase 2: Menangguhkan yang jatuh tempo

- [x] Task 3: Beat menangguhkan akun yang langganannya habis (beat hourly di
      :05; SQL guard-nya ada di `services.accounts` agar penulis `users`
      tetap satu modul)
- [x] Task 4: Gerbang membedakan dua alasan (WS 4404 untuk suspensi, 1008
      admin; suspensi menolak data bahkan saat paywall mati)

### Checkpoint: Fase 2
- [x] Akun yang belum pernah berlangganan tidak pernah tersuspend
- [x] Ban admin tidak pernah disentuh beat
- [x] Akun tersuspend bisa masuk tapi tidak melihat data apa pun

### Fase 3: Membuka dengan membayar

- [x] Task 5: Penyelesaian pembayaran membuka hanya yang tertangguh
- [x] Task 6: Layar "langganan berakhir" di sisi pengguna

### Checkpoint: Fase 3
- [x] Membayar membuka akun tertangguh
- [x] Membayar **tidak** membuka ban admin
- [x] Penyebab yang salah tidak dibaca sebagai langganan habis

### Fase 4: Bukti dan dokumen

- [x] Task 7: CONTEXT.md, `docs/status.md`, ADR-0012 (todo aslinya menulis
      ADR-0011; 0011 sudah dipakai plan-pembayaran, jadi penangguhan menjadi
      `docs/adr/0012-alasan-pada-blokir.md`)

### Checkpoint: Lengkap
- [x] Semua acceptance criteria terpenuhi
- [x] `cd backend && pytest` hijau, `ruff` bersih
- [x] `npx tsc --noEmit && npx eslint src && npx vitest run` hijau
- [ ] Tinjau dengan manusia

## Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Pembayaran membuka ban admin | **Kritis** | Pembukaan hanya menyentuh `blocked_reason = 'subscription_expired'`. Ban admin hanya punya satu jalan keluar: endpoint admin |
| Beat menyuspend akun yang baru saja membayar | Tinggi | Beat membaca `expires_at` langsung dari database, bukan dari cache. Kalau pembayaran sudah menambah baris dengan `expires_at` ke depan, akun itu tidak lagi muncul di kueri itu |
| Setiap pendaftaran gratis berubah jadi ban | Tinggi | Hanya akun dengan **setidaknya satu** subscription yang pernah ada ikut disuspend. `subscriptions` kosong di instalasi baru, jadi tidak ada yang kena |
| Akun terkunci permanen tanpa jalan membayar | Tinggi | Keadaan `subscription_expired` tetap boleh masuk — itulah satu-satunya jalan agar "buka dengan bayar" benar-benar bekerja |
| Penyebab salah tampil di layar | Sedang | `/v1/auth/me` melaporkan alasannya, dan setiap alasan punya kalimatnya sendiri |
| Beat lama tidak jalan, semua akun habis menganggur | Sedang | Suspend bisa dijalankan manual lewat CLI, dengan `--dry-run`, seperti `db/purge_positions.py` yang sudah ada |

## Pertanyaan Terbuka

- **Kapan beat dijalankan?** ~~Setiap menit, atau setiap jam?~~ **Terjawab dari
  pengerjaan:** tiap jam di menit :05 (beat `suspend-lapsed-subscriptions`,
  `workers/celery_app.py`). Satu jam cukup karena pintu pembayaran tetap
  terbuka bagi tertangguh, dan :05 menghindari gemetar menit-0 job jam pasar.
- **Apakah langganan yang kedaluwarsa bisa dipulihkan tanpa pembayaran baru?**
  Admin sudah bisa membuka blokir manual, jadi secara teknis bisa — tapi itu
  memberi jalan keluar yang tidak tercatat sebagai transaksi. **Keputusan yang
  tertimbun saat pengerjaan:** unblock admin tetap satu-satunya jalan keluar
  tanpa uang; uang yang masuk membuka lewat `grant()` dan tidak butuh unblock.
  Perilaku tidak berubah dari rencana.