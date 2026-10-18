# Implementation Plan: Paywall yang Jujur

## Gambaran

`PAYWALL_ENABLED` default `true` (`backend/api/core/config.py:74`) dan tabel
`subscriptions` tidak pernah diisi — nol baris `INSERT`/`UPDATE` di seluruh
backend (`docs/status.md:16`). Jadi di setiap instalasi nyata dengan
`AUTH_BYPASS=false`, **setiap** router `paid` membalas 403 untuk siapa pun,
termasuk admin. Aplikasi secara praktis tidak bisa dipakai.

Yang rusak bukan penolakannya. `backend/tests/test_paywall.py` sudah menguji gerbang
itu dengan benar: 403 untuk yang tidak membayar, 401 untuk anonim, 503 untuk
database mati, dan fail-closed saat query entitlement gagal. Gerbangnya benar.

Yang rusak adalah **apa yang terjadi setelah penolakan itu sampai ke layar**. Hari
ini penolakan yang benar sampai ke tempat yang salah, dan di dua tempat
dipresentasikan sebagai kebohongan. Plan ini memperbaiki jalur itu saja.

Tidak ada harga, tidak ada checkout, tidak ada perubahan atas kapan gerbang
menolak. Semuanya Phase 2, dan sengaja di luar scope — lihat *Batasan*.

## Yang Rusak, dengan Bukti

### 1. Paywall me-logout orang yang sah

Backend menolak WebSocket dengan close code **1008** untuk **dua hal yang berbeda**:

```python
# backend/api/routers/market_ws.py:161-167 — auth
raise WebSocketException(code=1008, reason="Not authenticated")
raise WebSocketException(code=1008, reason="This account is blocked.")

# backend/api/routers/market_ws.py:168-172 — paywall
raise WebSocketException(code=1008,
                         reason="An active subscription is required for this feed.")
```

`reason` berbeda, `code` sama. Klien membaca `code`:

```ts
// src/app/hooks/useLiveMarket.ts:374-377
if (event.code === 1008) {
  signalAuthExpired();   // ← entri ke AUTH_EXPIRED_EVENT, App.tsx:91
  return;
}
```

Akibatnya: akun dengan sesi yang **valid** tapi tanpa langganan → WS ditutup 1008 →
`AUTH_EXPIRED_EVENT` → toast "sesi berakhir" dan seluruh request berikutnya 401.
Paywall yang seharusnya menahan data, justru mengeluarkan orang dari akunnya.

Yang membuat ini lolos: `AUTH_BYPASS=true` adalah default dev, jadi di lokal
`get_current_user` mengembalikan dev principal dan gerbangnya tidak pernah menggigit.
`test_paywall.py` menguji sisi backend kombinasi itu; tidak ada padanannya di
frontend. Bug ini tidak bisa muncul di pengembangan normal.

### 2. 403 tidak pernah dibaca sebagai 403

`apiFetch` sudah lama punya jalur pusat untuk 401 — `AUTH_EXPIRED_EVENT`, dengan
latch dan reset agar satu session berakhir tidak dispatch dua belas event
(`src/app/config/api.ts:152-215`). Untuk 403 **tidak ada apa pun**. Delapan hook
melempar string mentah:

```
src/app/hooks/useAISignals.ts:262        throw new Error(`HTTP ${res.status}`)
src/app/hooks/useRiskMetrics.ts:95       throw new Error(`HTTP ${res.status}`)
src/app/hooks/usePortfolio.ts:178,226    throw new Error(`HTTP ${res.status}`)
src/app/hooks/useEquityCurve.ts:121      throw new Error(`HTTP ${res.status}`)
src/app/hooks/usePortfolioOptimisation.ts:73
src/app/hooks/useTechnicals / useAccumulationMap / useAlerts / useUniverse
```

Jadi penolakan langganan dan bug server tiba di tempat yang sama, dengan bentuk
yang sama.

### 3. Yang paling buruk: 403 ditampilkan sebagai "backend mati"

```tsx
// src/app/components/RiskView.tsx:228-243
{error && !isLive && (
  "Mode simulasi: Backend tidak terjangkau, menampilkan data simulasi."
      "Sistem mencoba menyambung kembali otomatis."
)}
```

Setiap `error` dari hook — termasuk 403 penolakan langganan — memunculkan banner
"backend tidak terjangkau" di atas angka seed. Ini melanggar prinsip yang sudah
ditulis sendiri di `docs/status.md`: *"Setiap data service default ke jalur real dan
degrade ke seed/empty hanya ketika sumbernya benar-benar absen — dan selalu
berlabel."*

Yang terjadi di sini bukan sumber yang absen, melainkan **keputusan izin**. Label
menyebutkan penyebab yang salah, jadi orang akan menyalahkan koneksi mereka.
`PortfolioView.tsx:448` lebih jujur ("Posisi tidak dapat dimuat. Bukan berarti
portofolio Anda kosong") tapi tetap tidak menyebut langganan.

Dan `AIAdvisorView.tsx:789` → `ViewError.tsx:26-33` →
**"Gagal memuat data / Periksa koneksi dan coba lagi."**

### Rantai lengkapnya

```
403 paywall
  → WS 1008 → signalAuthExpired() → logout
  → 401 di semua request
  → hook error → "backend tidak terjangkau, menampilkan data simulasi"
```

Orang yang tidak berlangganan melihat angka simulasi, diberi tahu backend-nya
mati, lalu dikeluarkan dari akunnya. Tiga kesalahan dalam satu.

## Batasan Plan Ini

**Di luar scope, disengaja:**

- **Checkout, pembayaran, webhook, harga.** Phase 2, belum ada keputusannya
  (`tasks/plan.md:19-29`). Plan ini tidak mengarang provider atau nominal.
- **Perubahan kapan gerbang menolak.** `require_entitlement` sudah benar dan sudah
  teruji. Yang dirapikan adalah apa yang terjadi sesudahnya.
- **Menambah kolom status ke `subscriptions`.** Dilarang CONTEXT.md aturan 1.
- **`PAYWALL_ENABLED=false` di produksi.** Sudah ditolak saat start
  (`config.py:442-445`), tidak perlu disentuh.

Kalau nanti payment tiba, Task 3–5 di sini tidak perlu diubah — mereka membaca
`GET /v1/subscription/current`, yang sudah ada dan sudah benar.

## Keputusan Arsitektur

**Satu kode penolakan per penyebab — sudah diputuskan.** Auth 1008, penolakan
langganan 4403 (rentang aplikasi 4000–4999). Alasannya bukan estetika: `reason`
string manusia adalah satu-satunya pembeda saat ini, dan `CloseEvent.reason`
dipangkas browser ke 123 byte. Kode numerik tidak dipangkas dan tidak berubah
saat copy ditulis ulang. 1008 berarti "sesi habis, keluar"; 4403 berarti "kamu
masuk, datanya yang tidak". `reason` tetap dipertahankan — untuk manusia dan untuk
test yang sudah memakainya.

**403 diproses di `apiFetch`, bukan di delapan hook.** Pola ini sudah ada dan sudah
terbukti untuk 401. Diulang persis — latch, reset saat sukses, response dikembalikan
tanpa diubah supaya jalur error tiap hook tetap jalan seperti sebelumnya. Ini
menambah satu titik interception, bukan delapan.

**Kebenaran dinilai dari apa yang diketahui, bukan dari HTTP status.** Hook
sekarang hanya menyimpan `error: string`. Supaya Task 6 bisa membedakan
"backend mati" dari "terkunci", hook harus membawa jawabannya. Bentuknya
`{ kind, ... }` — dipinjam dari `AdminView.tsx:38-41`, yang sudah memakai
discriminated union untuk `loading | ready | error` persis karena
`"tidak ada data"` dan `"gagal memuat"` harus berbeda.

**Banner, bukan modal, dan bukan tombol Beli.** Prinsip R-26 sudah tercatat di
kode (`SettingsView.tsx:497-498`): kontrol yang tampak hidup tapi tidak berfungsi
lebih buruk daripada tidak ada. Tidak ada jalur beli, jadi tidak ada tombol beli.
Tujuan banner adalah mengarahkan ke Tab 2 Settings, yang sudah bisa menjelaskan
keadaannya dengan jujur.

**Angka simulasi tetap tampil di bawah banner "terkunci" — sudah diputuskan.**
Markets dan Risk sengaja punya jalur seed yang berlabel, jadi menyembunyikannya
adalah keputusan produk, bukan perbaikan kejujuran. Yang diperbaiki adalah
labelnya: penyebab yang salah harus diganti dengan yang benar, sementara
seed-nya tetap dan tetap berlabel. Kalau nanti owner memutuskan angka seed
seharusnya hilang saat terkunci, itu perubahan satu cabang di Task 7, bukan
mengulang Fase 3.

**Task 1 adalah yang paling berisiko dan paling awal.** Kalau kode close WS
diubah tanpa frontend yang menyusul, `useLiveMarket` akan menerima kode asing dan
memperlakukannya seperti offline biasa — reconnect loop senyap yang lebih sulit
dideteksi daripada bug yang sekarang. Karena itu Task 2 bergantung pada Task 1,
dan Checkpoint 1 membuktikannya dengan test.

## Task List

### Fase 1: Dua penolakan, dua jawaban

- [x] Task 1: Kode close WebSocket terpisah untuk paywall
- [x] Task 2: `useLiveMarket` berhenti logout saat paywall

### Checkpoint: Fase 1
- [x] WS auth tetap 1008
- [x] WS paywall 4403, dengan `reason` yang menyebut langganan
- [x] `AUTH_EXPIRED_EVENT` tidak lagi terpancarkan oleh paywall
- [x] Suite backend + frontend hijau

### Fase 2: 403 jadi sinyal

- [x] Task 3: `PAYWALL_EVENT` di `apiFetch`
- [x] Task 4: State paywall di AppContext
- [x] Task 5: Banner aplikasi yang mengarahkan ke Settings

### Checkpoint: Fase 2
- [x] Satu 403 → satu event, bukan satu per request
- [x] Request sukses berikutnya melepas latch
- [x] Banner menyebut langganan dan punya tujuan, bukan tombol mati

### Fase 3: Setiap view menjawab dengan jujur

- [x] Task 6: Hook menyimpan penyebab, bukan cuma `error: string`
- [x] Task 7: `RiskView` berhenti melaporkan paywall sebagai backend mati
- [x] Task 8: `PortfolioView`, `AIAdvisorView`, `ViewError` berhenti menampilkan "HTTP 403"

### Checkpoint: Fase 3
- [x] 403 → "terkunci karena belum berlangganan"
- [x] Gagal jaringan → "backend tidak terjangkau" (masih)
- [x] Tidak ada hook paid yang jatuh diam-diam ke seed tanpa label

### Fase 4: Bukti dan dokumen

- [x] Task 9: Peringatan kombinasi dev yang menyembunyikan semua ini
- [x] Task 10: Test frontend untuk kombinasi bypass + paywall
- [x] Task 11: Sinkronisasi `docs/status.md`, `settings-module-spec.md`, ADR

### Checkpoint: Lengkap
- [x] Semua acceptance criteria terpenuhi
- [x] `npm run typecheck && npm run lint && npm run test` hijau
- [x] `cd backend && pytest` hijau
- [x] Tinjau dengan manusia

## Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Kode close WS berubah tapi frontend belum menyusul → reconnect loop senyap | Tinggi | Task 2 bergantung pada Task 1. Test frontend memakai kode literal, bukan konstanta yang ikut berubah |
| Banner paywall muncul bersamaan dengan toast auth-expired | Sedang | Keduanya id yang berbeda; test membuktikan hanya satu yang muncul untuk 1008 |
| Task 6 menyentuh 8 hook sekaligus, jadi XL | Sedang | Dipecah: bentuk `kind` dulu di 2 hook yang paling terlihat dampaknya (Risk, Portfolio), sisanya menyusul |
| Banner menjadi modal yang muncul tiap pindah view | Sedang | Satu elemen di shell `App.tsx`, state-latch, hilang saat subscription aktif |
| Pembaca mengira ini berarti "paywall dimatikan" | Tinggi | Tidak ada task yang mengubah `PAYWALL_ENABLED` atau `require_entitlement`. Dinyatakan eksplisit di Batasan dan dicek di review |

## Keputusan yang Sudah Diambil

| Keputusan | Dampak ke plan |
|-----------|-----------------|
| Kode close WS untuk penolakan langganan = **4403**, bukan 1008 + branch pada `reason` | Task 1–2 definitif. `reason` tetap dibawa sebagai teks untuk manusia dan test, bukan sebagai pembeda |
| `RiskView` **tetap menampilkan angka seed**, dengan banner "terkunci" di atasnya | Task 7 hanya mengganti label penyebab, bukan menghapus angkanya. Menyembunyikan seed nanti adalah perubahan satu cabang, bukan mengulang Fase 3 |
| **Harga dan halaman harga publik tidak dikerjakan di plan ini.** Sudah diputuskan: masuk Fase 2 | Tidak ada Task baru. Task 11 hanya mencatat bahwa jawabannya sudah ada, supaya tidak dibuka lagi sebagai pertanyaan |

## Harga Publik: Sudah Ada Jawabannya, Belum Ada Kodenya

Pertanyaan "apakah pengunjung tanpa sesi perlu melihat status langganan" pernah
tertulis sebagai pertanyaan terbuka di plan ini. **Salah.** Jawabannya sudah
ditentukan jauh sebelumnya, di `docs/saas-subscription-platform.md`:

- Harga sudah diputuskan: **Rp 15.000/bulan** dan **Rp 150.000/tahun**
  (`saas-subscription-platform.md:16-19`).
- Endpoint-nya sudah dispesifikasikan sebagai **publik**:
  `GET /v1/subscriptions/pricing` — "Ambil harga aktif & daftar rekening tujuan"
  (`saas-subscription-platform.md:371`).

Jadi untuk pengunjung tanpa sesi, yang perlu ditampilkan bukan "status
langganan" — dia memang tidak punya satu — melainkan harga dan apa yang dibukanya.
Plan ini tidak membangunnya. Alasannya bukan karena belum diputuskan, melainkan
karena **harga belum punya sumber yang bisa dibaca**:

- Blueprint mengusulkan menyimpannya di `system_settings` pada key `pricing`
  (`saas-subscription-platform.md:261`), dan `docs/status.md:53` mencatat tabel
  itu belum ada: *"Harga dan rekening tujuan tidak ada sumbernya."*
- Angka itu hanya ada di prosa dokumen. Dua tempat untuk satu fakta adalah persis
  yang dilarang CONTEXT.md aturan 5, dan persis yang sudah pernah menggigit repo
  ini pada `owner_sub`.

Kalau halaman harga dibangun sekarang, keputusan pertamanya bukan komponennya
melainkan **harga ini dibaca dari mana** — `system_settings` atau nilai
konfigurasi. Pertanyaan itu belum dijawab, dan itu jawaban pemilik, bukan
tebakan agen.

Kalau nanti dikerjakan, Task 3–5 di plan ini tidak perlu diubah: state paywall
yang sudah dibangun di situ adalah tempat penanda status, dan `PAYWALL_EVENT`
sudah membedakan "tidak punya akses" dari "sesi bermasalah" untuk semua dev
yang mengikutinya.
