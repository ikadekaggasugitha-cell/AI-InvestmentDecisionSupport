# Task List: Paywall yang Jujur

Rencana lengkap: [plan-paywall-jujur.md](plan-paywall-jujur.md). Baca file itu dulu
untuk keputusan arsitektur, bukti, dan batasan scope.

Perintah verifikasi yang dipakai di bawah ini:

```bash
# Backend
cd backend && .venv/bin/python -m pytest -q
cd backend && .venv/bin/python -m ruff check .

# Frontend
npx tsc --noEmit
npx vitest run
npx eslint src
```

---

## Fase 1: Dua penolakan, dua jawaban

Rantai yang sedang rusak: `403 paywall → WS 1008 → signalAuthExpired() → logout →
401 → "backend tidak terjangkau, menampilkan data simulasi"`. Fase ini memotong
rantai itu di mata pertama: 1008 berarti auth lagi, dan 403 berarti auth lagi.

## Task 1: Kode close WebSocket terpisah untuk paywall

**Deskripsi:** `market_ws.py` memakai close code 1008 untuk tiga penolakan yang
berbeda (tidak terautentikasi, diblokir, tanpa langganan). Yang membedakan hanya
`reason`, yaitu string manusia yang dipangkas browser ke 123 byte.

**Putusan owner: penolakan langganan memakai 4403** (rentang aplikasi 4000–4999 —
valid, tidak dipangkas browser, dan tidak bisa berubah karena copy ditulis ulang).
`reason` tetap dibawa sebagai teks untuk dibaca manusia dan oleh test, tapi tidak
lagi jadi pembeda. Auth dan blokir tetap 1008 — jangan diubah, itu yang sudah
dipahami klien dan oleh test yang ada.

**Acceptance criteria:**
- [ ] Penolakan langganan memakai kode 4403; `reason` tetap menyebut langganan
- [ ] Penolakan "Not authenticated" dan "This account is blocked." tetap 1008
- [ ] Kode dan `reason` didefinisikan sebagai konstanta di satu tempat, bukan
      di-inline di tiga cabang
- [ ] `test_paywall.py` diperbarui: yang tadinya `assert code == 1008` untuk
      kasus paywall kini `assert code == 4403`, kasus auth tetap `1008`
- [ ] Tidak ada perubahan pada `require_entitlement` maupun kapan gerbang menolak

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_paywall.py -q` hijau
- [ ] Manual check: `git diff` tidak menyentuh `api/core/auth.py` atau
      `api/services/entitlements.py`
- [ ] Manual check: `grep -rn "1008" backend/api/` hanya menyisakan dua
      penolakan auth, tidak ada lagi di cabang paywall

**Dependencies:** None

**Files likely touched:**
- `backend/api/routers/market_ws.py`
- `backend/tests/test_paywall.py`

**Estimated scope:** S

---

## Task 2: `useLiveMarket` berhenti logout saat paywall

**Deskripsi:** `useLiveMarket.ts:374-377` memperlakukan setiap 1008 sebagai sesi
habis. Akibatnya penolakan paywall membuka `AUTH_EXPIRED_EVENT`, dan orang yang
sesinya masih valid dikeluarkan dari akunnya. Kode paywall sekarang dibaca
terpisah: ia harus menghentikan loop reconnect dan menandai state terkunci,
tanpa menyentuh state autentikasi. Penting: Task 2 bergantung pada Task 1. Kalau Task 2 jalan lebih dulu, ia
mendapat kode asing yang diperlakukan sebagai offline biasa — reconnect loop
senyap yang lebih sulit dideteksi daripada bug yang sekarang.

**Acceptance criteria:**
- [ ] 1008 → `signalAuthExpired()` seperti sekarang; kode lain → `scheduleReconnect()`
- [ ] Kode paywall dari Task 1 tidak memicu `AUTH_EXPIRED_EVENT`
- [ ] State paywall terekspos dari hook supaya view bisa menampilkan banner
- [ ] Test memakai kode close **literal**, bukan konstanta yang diimpor, supaya
      test ini gagal kalau Task 1 belum dikerjakan

**Verification:**
- [ ] `npx vitest run src/app/hooks/useLiveMarket.test.ts` hijau
- [ ] Test baru: menutup socket dengan paywall code tidak memancarkan
      `AUTH_EXPIRED_EVENT`, dan hook berhenti reconnect
- [ ] `npx tsc --noEmit` bersih

**Dependencies:** Task 1

**Files likely touched:**
- `src/app/hooks/useLiveMarket.ts`
- `src/app/hooks/useLiveMarket.test.ts`

**Estimated scope:** S

### Checkpoint: Fase 1

- [ ] WS auth tetap 1008
- [ ] WS paywall 4403, `reason` menyebut langganan
- [ ] `AUTH_EXPIRED_EVENT` tidak lagi terpancarkan oleh penolakan paywall
- [ ] `cd backend && .venv/bin/python -m pytest -q` hijau
- [ ] `npx vitest run` hijau

---

## Fase 2: 403 jadi sinyal

Pola ini sudah ada dan sudah terbukti untuk 401 di `src/app/config/api.ts:152-215`:
satu titik interception, latch, reset saat sukses, response dikembalikan tanpa
diubah supaya jalur error tiap hook tetap berjalan seperti sebelumnya. Fase ini
mengulang pola itu untuk 403 — menambah satu titik, bukan delapan.

## Task 3: `PAYWALL_EVENT` di `apiFetch`

**Deskripsi:** 403 sekarang jatuh ke `throw new Error("HTTP 403")` di delapan hook,
dan paywall sampai ke layar dengan bentuk yang sama dengan bug server. Tambahkan
penanganan 403 di `apiFetch`, meniru `AUTH_EXPIRED_EVENT` persis: latch agar satu
penolakan tidak dispatch belasan event, reset saat ada request sukses supaya
penolakan berikutnya bisa teriak lagi, dan response tetap dikembalikan
tanpa diubah.

**Acceptance criteria:**
- [ ] 403 memancarkan satu `PAYWALL_EVENT`
- [ ] Latch mencegah event kedua sampai ada request yang sukses
- [ ] Response tidak dimodifikasi — hook yang ada tetap melihat 403 seperti sekarang
- [ ] 401 dan 403 tidak saling menginterupsi: 401 tetap menyetel latch auth,
      403 menyetel latch paywall; keduanya punya latch sendiri

**Verification:**
- [ ] `npx vitest run src/app/config/api.test.ts` hijau
- [ ] Test baru: lima request 403 bersamaan → satu event
- [ ] Test baru: 403 → request sukses → 403 lagi → dua event
- [ ] `npx tsc --noEmit` bersih

**Dependencies:** None

**Files likely touched:**
- `src/app/config/api.ts`
- `src/app/config/api.test.ts`

**Estimated scope:** S

---

## Task 4: State paywall di AppContext

**Deskripsi:** Shell aplikasi perlu tahu satu fakta: apakah akun ini melihat
data yang terkunci, dan kalau ya, kenapa. Hook membaca
`GET /v1/subscription/current` — endpoint yang sudah ada, sudah benar, dan
sengaja tidak ada di balik gerbang. Satu state di AppContext, dibaca semua view,
supaya tidak ada view yang memutuskan sendiri apa arti 403.

**Acceptance criteria:**
- [ ] State paywall adalah satu fakta di AppContext, bukan di setiap view
- [ ] Sumbernya `GET /v1/subscription/current`, bukan tebakan dari status HTTP
- [ ] Tiga keadaan tetap terpisah: aktif, tidak ada, dan gagal ditanyakan
- [ ] `PAYWALL_EVENT` menyalakan state terkunci; langganan aktifrianaikannya

**Verification:**
- [ ] `npx vitest run src/app/context/` hijau
- [ ] Test: `GET` gagal → state "tidak diketahui", bukan "tidak berlangganan"
- [ ] `npx tsc --noEmit` bersih

**Dependencies:** Task 3

**Files likely touched:**
- `src/app/context/AppContext.tsx`
- `src/app/hooks/usePaywall.ts`

**Estimated scope:** S

---

## Task 5: Banner aplikasi yang mengarahkan ke Settings

**Deskripsi:** Satu banner di shell `App.tsx`, berdampingan dengan toast
auth-expired yang sudah ada di `App.tsx:91-97`, tapi dengan id dan penyebab yang
berbeda. Isinya menyebutkan langganan dan mengarah ke Tab 2 Settings, yang sudah
bisa menjelaskan keadaan dengan jujur. **Tidak ada tombol Beli** — R-26 di
`SettingsView.tsx:497-498` sudah.record alasannya, dan tidak ada jalur pembayaran
untukkemarlo.

**Acceptance criteria:**
- [ ] Satu elemen di shell, bukan modal per view
- [ ] Banner menyebut langganan dan mengarahkan ke Settings → Langganan
- [ ] Tidak ada tombol atau kontrol yang terlihat hidup tanpa fungsi
- [ ] Banner hilang saat langganan aktif
- [ ] Toast auth-expired dan banner paywall tidak pernah tampil bersamaan

**Verification:**
- [ ] `npx vitest run` hijau
- [ ] Test: paywall menyala → banner ada; menutup WS dengan 1008 → banner tidak ada
- [ ] Manual check: `src/styles` dan token `--control-border` yang dipakai,
      bukan warna baru (ADR-0007)

**Dependencies:** Tasks 3, 4

**Files likely touched:**
- `src/app/App.tsx`
- `src/app/components/PaywallNotice.tsx`
- `src/app/i18n/translations.ts`

**Estimated scope:** M

### Checkpoint: Fase 2

- [ ] Satu 403 → satu event, bukan satu per request
- [ ] Request sukses berikutnya melepas latch
- [ ] Banner menyebut langganan, punya tujuan, dan tidak punya tombol mati
- [ ] `npx vitest run` dan `npx tsc --noEmit` hijau

---

## Fase 3: Setiap view menjawab dengan jujur

Ini bagian yang paling damaging: hari ini 403 paywall ditampilkan sebagai
"backend tidak terjangkau" (`RiskView.tsx:228-243`), yang menuduh koneksi
pengguna ketika backend-nya sehat. Fase ini dilakukan bertahap, dua hook yang
paling terlihat dampaknya dulu.

## Task 6: Hook menyimpan penyebab, bukan cuma `error: string`

**Deskripsi:** Hook sekarang hanya menyimpan `error: string`, jadi "tidak ada
langganan" dan "backend mati" tiba di view sebagai nilai yang sama dan tidak bisa
dibedakan. Bentuknya discriminated union yang memipin pola yang sudah dipakai
`AdminView.tsx:38-41`. **Hanya dua hook** — `useRiskMetrics` dan `usePortfolio` —
supaya bagian ini tetap S-M; hook sisanya masuk Task 8.

**Acceptance criteria:**
- [ ] `error` pada dua hook itu menyimpan `kind`, bukan cuma teks
- [ ] `kind` membedakan: terkunci / gagal Celeborn / tidak ada data
- [ ] Bentuknya sama dengan yang sudah dipakai `AdminView`, bukan bentuk baru
- [ ] Tidak ada consumer lama yang ikut rusak (dicek `npx tsc --noEmit`)

**Verification:**
- [ ] `npx vitest run src/app/hooks/useRiskMetrics src/app/hooks/usePortfolio` hijau
- [ ] Test: 403 → `kind: "locked"`; 500 → `kind: "unreachable"`
- [ ] `npx tsc --noEmit` bersih

**Dependencies:** Task 3

**Files likely touched:**
- `src/app/hooks/useRiskMetrics.ts`
- `src/app/hooks/usePortfolio.ts`
- `src/app/hooks/useRiskMetrics.ts` test baru bila belum ada

**Estimated scope:** M

---

## Task 7: `RiskView` berhenti melaporkan paywall sebagai backend mati

**Deskripsi:** Ini kesalahan yang paling merusak di plan ini. Banner "Mode
simulasi: Backend tidak terjangkau" muncul untuk **apa pun** yang membuat hook
error — termasuk 403. Backend-nya sehat; yang terjadi adalah keputusan izin.
Label yang salah membuat orang menyalahkan koneksi mereka.

**Putusan owner: angka seed tetap tampil**, dengan banner "terkunci" di atasnya.
Markets dan Risk sengaja punya jalur simulasi yang berlabel, jadi Task 7 hanya
mengganti penyebab yang salah — bukan menghapus angkanya.

**Acceptance criteria:**
- [ ] Banner "backend tidak terjangkau" hanya muncul untuk kegagalan jaringan/5xx
- [ ] 403 menampilkan banner berbeda yang menyebut langganan, dengan alasan berbeda
- [ ] Angka seed di bawahnya tetap tampil dan tetap berlabel, tidak menyamar sebagai live
- [ ] Tidak ada warna atau token kontrol baru; batas kontras ADR-0007 tetap berlaku

**Verification:**
- [ ] `npx vitest run` hijau
- [ ] Test: hook `kind: "locked"` → teks "langganan" muncul, "backend tidak
      terjangkau" tidak
- [ ] Test: hook `kind: "unreachable"` → teks lama masih muncul
- [ ] Manual check: `npm run dev` dengan `AUTH_BYPASS=false`,
      `PAYWALL_ENABLED=true` → RiskView menampilkan banner langganan

**Dependencies:** Tasks 4, 6

**Files likely touched:**
- `src/app/components/RiskView.tsx`
- `src/app/components/RiskView.test.tsx` (baru)
- `src/app/i18n/translations.ts`

**Estimated scope:** M

---

## Task 8: `PortfolioView`, `AIAdvisorView`, `ViewError` berhenti menampilkan "HTTP 403"

**Deskripsi:** Men-naikan masalah yang sama ke sisa view. `PortfolioView.tsx:448`
sudah jujur tentang "bukan berarti portofolio Anda kosong" tapi tidak menyebut
langganan. `AIAdvisorView.tsx:789` → `ViewError.tsx:26-33` →
"Periksa koneksi dan coba lagi", yang untuk 403 adalah saran yang salah. Di sini
juga masuk job Task 6 yang tertunda: enam hook yang masih melempar
`HTTP ${res.status}` mentah harus sekarang bisa membedakan.

**Acceptance criteria:**
- [ ] Tidak ada hook paid yang melempar `HTTP 403` mentah ke view
- [ ] `ViewError` bisa menampilkan penyebab terkunci, dan-butuh-retry punya alasan
- [ ] `PortfolioView` menyebut langganan saat terkunci, dan tetap jujur saat gagal
- [ ] Delapan hook yang disebut di bagian Bukti plan sudah punya `kind`, atau penjelasan yang setara

**Verification:**
- [ ] `grep -rn "HTTP \${res.status}" src/app/hooks/` tidak menyisakan hook paid
- [ ] `npx vitest run` hijau
- [ ] Test: 403 → tidak ada teks "periksa koneksi" di mana pun

**Dependencies:** Tasks 6, 7

**Files likely touched:**
- `src/app/components/PortfolioView.tsx`
- `src/app/components/AIAdvisorView.tsx`
- `src/app/components/ViewError.tsx`
- hook yang tersisa (≤4 berkas dalam satu task)

**Estimated scope:** M

### Checkpoint: Fase 3

- [ ] 403 → "terkunci karena belum berlangganan"
- [ ] Gagal jaringan → "backend tidak terjangkau" (masih muncul)
- [ ] Tidak ada hook paid yang jatuh diam-diam ke seed tanpa label yang benar
- [ ] `npx vitest run`, `npx tsc --noEmit`, `npx eslint src` bersih

---

## Fase 4: Bukti dan dokumen

## Task 9: Peringatan kombinasi dev yang menyembunyikan semua ini

**Deskripsi:** Bug di plan ini tidak mungkin terlihat diancer development normal:
`AUTH_BYPASS=true` membuat `get_current_user` mengembalikan dev principal, jadi
gerbang tidak pernah menggigit. `test_paywall.py` sengaja menyalakan keduanya, tapi
itu hanya terlihat kalau sudah tahu. Beri tahu yang sedang membangun bahwa
kombinasi ini berarti app yang mereka lihat bukan yang akan mereka deploy.

**Acceptance criteria:**
- [ ] Saat start, kombinasi `AUTH_BYPASS=true` + `PAYWALL_ENABLED=true` memunculkan
      peringatan yang menyebut gerbang tidak diuji di proses ini
- [ ] Peringatan tidak muncul di produksi (`APP_ENV=production`)
- [ ] Peringatan tidak mengubah perilaku apa pun — hanya logger

**Verification:**
- [ ] Test: kombinasi itu memunculkan peringatan
- [ ] Test: `APP_ENV=production` tidak memunculkannya
- [ ] `cd backend && .venv/bin/python -m pytest -q` hijau

**Dependencies:** None

**Files likely touched:**
- `backend/api/core/config.py` atau `backend/api/main.py`
- `backend/tests/test_paywall.py`

**Estimated scope:** XS

---

## Task 10: Test frontend untuk kombinasi bypass + paywall

**Deskripsi:** Padanan frontend untuk `test_paywall.py`. Suite sekarang tidak
pernah menjalankan frontend terhadap gerbang yang menyala, jadi tidak ada tes yang
bisakDAEAK menangkap "paywall logout orang" atau "403 tampil sebagai backend
mati". Dua kasus itu harus punya tes yang gagal kalau regression-nya kembali.

**Acceptance criteria:**
- [ ] Ada tes yang membuktikan 403 tidak memicu `AUTH_EXPIRED_EVENT`
- [ ] Ada tes yang membuktikan RiskView tidak menampilkan "backend tidak terjangkau"
      saat hook melaporkan terkunci
- [ ] Ada tes yang membuktikan banner paywall muncul setelah 403 dan hilang
      setelah langganan aktif
- [ ] Ketiganya gagal jika dikomentari balik ke perilaku lama

**Verification:**
- [ ] `npx vitest run` hijau
- [ ] Manual check:omentari satu assertion, suite jadi merah, assertion dikembalikan

**Dependencies:** Tasks 2, 5, 7, 8

**Files likely touched:**
- `src/app/hooks/useLiveMarket.test.ts`
- `src/app/components/RiskView.test.tsx`
- `src/app/components/PaywallNotice.test.tsx` (baru)

**Estimated scope:** S

---

## Task 11: Sinkronisasi `docs/status.md`, `settings-module-spec.md`, ADR

**Deskripsi:** `docs/status.md` adalah SSOT dan `backend/tests/test_docs_status.py`
memaksa setiap path dan nama endpoint yang diklaim di sana benar-benar ada.
Status paywall harus menyebut apa yang sudah dijawab dan apa yang masih
tertunda — khususnya bahwa jalur pembayaran **tetap** belum ada setelah plan ini,
supaya tidak ada yang mengira plan ini menyelesaikannya.

Termasuk satu hal yang mudah disalahpahami: harga langganan **sudah diputuskan**
(Rp 15.000/bulan dan Rp 150.000/tahun, `docs/saas-subscription-platform.md:16-19`)
dan endpoint harga publik **sudah dispesifikasikan** sebagai
`GET /v1/subscriptions/pricing` (`:371`). Yang belum ada
adalah tabel `system_settings` tempat harga itu dibaca, jadi halaman
harga untuk pengunjung tanpa sesi masuk Fase 2 — bukan "harga belum diputuskan".

**Acceptance criteria:**
- [ ] `docs/status.md` mencatat bahwa penolakan paywall kini berbeda antara auth
      dan langganan, dan bahwa klien membacanya secara berbeda
- [ ] `docs/status.md` tetap menyatakan checkout/pembayaran belum ada
- [ ] `settings-module-spec.md` Tab 2 mencatat batasnya: status terbaca, belum bisa dibeli
- [ ] `docs/status.md` mencatat bahwa harga **sudah diputuskan** dan endpoint
      publiknya **sudah dispesifikasikan**, dan yang belum ada hanya
      `system_settings`-nya — supaya pertanyaan ini tidak dibuka lagi
- [ ] Jika pilihan kode close WS adalah keputusan yang mengikat, dicatat di ADR

**Verification:**
- [ ] `cd backend && .venv/bin/python -m pytest tests/test_docs_status.py -q` hijau
- [ ] `git ls-files` mengonfirmasi setiap path yang diklaim ada

**Dependencies:** Tasks 1–10

**Files likely touched:**
- `docs/status.md`
- `docs/settings-module-spec.md`
- `docs/adr/0009-*.md` (bila kode WS dicatat sebagai keputusan)

**Estimated scope:** S

### Checkpoint: Lengkap

- [ ] Semua acceptance criteria di atas terpenuhi
- [ ] `cd backend && .venv/bin/python -m pytest -q` hijau
- [ ] `cd backend && .venv/bin/python -m ruff check .` bersih
- [ ] `npx tsc --noEmit`, `npx eslint src`, `npx vitest run` hijau
- [ ] `git diff` tidak menyentuh `require_entitlement`, `entitlements.py`,
      `config.py:paywall_enabled`, dan tidak menambah kolom ke `subscriptions`
- [ ] Tinjau dengan manusia