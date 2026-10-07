# Spesifikasi Teknis & Desain: Perancangan Ulang Modul Settings (SaaS Multi-User)

> **Dokumen Arsitektur & Desain Antarmuka (UI/UX)**  
> **Status:** Siap Implementasi (*Implementation-Ready*)  
> **Versi:** 1.1.1 (terimplementasi)  
> **Target Komponen:** `src/app/components/SettingsView.tsx` & Backend User/Billing Services  
> **Lokasi File:** `docs/settings-module-spec.md`  
> **Arah Desain:** `docs/DESIGN.md`. Revisi 1.1.0 mengikuti `DESIGN.md` serta aturan R-04, R-09, dan R-14. Nilai yang belum diputuskan pemilik tetap `[OWNER TO NAME]`.

---

## 1. Latar Belakang & Tujuan Refaktor

Modul **Settings** saat ini dirancang untuk kebutuhan *single-operator personal decision tool* dengan layout satu halaman (*single scroll*) yang hanya memuat:
1. Tema (*Theme: Light/Dark*)
2. Bahasa (*Language: ID/EN*)
3. Mata Uang (*Currency: IDR/USD*)
4. Notifikasi (*In-App Alert Toggles*)
5. Informasi Aplikasi (*About*)

Dengan beralihnya sistem ke model bisnis **SaaS Multi-User dengan Langganan (Rp 15.000/bln dan Rp 150.000/thn)**, modul Settings perlu ditransformasikan menjadi pusat manajemen pengguna (*User Account Center*) yang modern, terstruktur, dan modular menggunakan navigasi berbasis **Tab (Tab-Based Layout)**.

## 2. Prinsip Desain yang Mengikat

Bagian ini mengikat seluruh spec. Setiap keputusan visual di bawah harus bisa dirujuk ke salah satu prinsip ini.

| # | Prinsip | Aturan | Alasan |
|---|---|---|---|
| P1 | **Arah visuals berasal dari `DESIGN.md`** | Warna, tipografi, radius, dan ikonografi memakai token yang sudah ada di `src/styles/theme.css` dan token yang sudah dipakai komponen lain. Tidak ada warna, typeface, radius, atau ikon baru. | R-20, R-30. Identitas produk, bukan templat. |
| P2 | **Satu warna aksen, dipakai konsisten** | Hanya `var(--primary)` (+ `var(--accent)` sebagai permukaan tinted-nya) yang berwarna. Transparan, `var(--muted)`, `var(--card)`, `var(--border)`, `var(--foreground)`, `var(--muted-foreground)` adalah netral. | R-29, R-13. Aksen berhenti jadi aksen kalau dipakai di mana-mana. |
| P3 | **Label status memakai teks, bukan warna** | Status (Aktif, Menunggu Verifikasi, Kedaluwarsa) ditulis sebagai teks. Tidak ada pill, tidak ada capsule, tidak ada titik dekoratif. | R-09. Capsule badge tanpa fungsi informatif adalah noise; teks selalu terbaca. |
| P4 | **Ikon hanya kalau relevan** | Ikon tidak dipakai sebagai hiasan. Emoji sebagai ikon dilarang total. | R-04. |
| P5 | **Angka tabular** | Semua angka (rupiah, tanggal, hari tersisa, jumlah hari) memakai `font-family: var(--font-mono)` agar kolom sejajar dan bisa dibandingkan sekilas. | `DESIGN.md` Typography. Angka adalah produk. |
| P6 | **Restrained dan minimal** | Border tipis, radius kecil, tanpa glow, tanpa gradient, tanpa glassmorphism, tanpa shadow besar. | `DESIGN.md` Personality (restrained and analytical). |

### 2.1 Peta Token yang Dipakai (dari `src/styles/theme.css`)

| Peran | Token | Light | Dark |
|---|---|---|---|
| Aksen (tombol utama, tab aktif, link) | `--primary` | `#0b7c5e` | `#00d4aa` |
| Permukaan aksen (latar tab/opsi aktif) | `--accent` | `#e0f7f2` | `#0f2a45` |
| Teks di atas permukaan aksen | `--accent-foreground` | `#0b7c5e` | `#4da6ff` |
| Permukaan netral (baris, kartu) | `--card` | `#ffffff` | `#0b1118` |
| Permukaan dalam (baris tabel, baris toggle) | `--muted` | `#f1f5f9` | `#0d1520` |
| Teks utama | `--foreground` | `#111827` | `#c8d6e5` |
| Teks sekunder / label | `--muted-foreground` | `#6b7280` | `#5a7a9a` |
| Garis pemisah | `--border` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.07)` |
| Radius | `--radius` | `0.375rem` | `0.375rem` |
| Font sans | `--font-sans` | (dari `fonts.css`) | (dari `fonts.css`) |
| Font angka | `--font-mono` | (dari `fonts.css`) | (dari `fonts.css`) |
| Font body | `--font-size` | `14px` | `14px` |

Nilai warna, typeface, dan ikonografi yang belum diputuskan pemilik tetap `[OWNER TO NAME]` di `DESIGN.md`. Implementasi memakai token di atas; tidak ada nilai yang di-hardcode di spec ini.

### 2.2 Aturan Ikonografi

Set ikon final **belum ditetapkan pemilik** dan tercatat sebagai `[OWNER TO NAME]` di `DESIGN.md`. Spec ini tidak memperkenalkan satu pun ikon baru. Yang berlaku:

1. **Tab bar tanpa ikon.** Kelima tab memakai label teks saja. Label satu-dua kata sudah menyatakan isinya; ikon di sini hanya mengulang label itu. R-04, R-31.
2. **Ikon di dalam konten tab hanya boleh memakai glyph yang sudah dipakai komponen lain.** Contoh yang sah: `User`, `Monitor`, `Info`, yang sudah dipakai di `Sidebar` dan `SettingsView` sekarang. Memakai glyph yang sudah ada bukan keputusan baru.
3. **Ikon baru tidak boleh dimasukkan sebagai efek samping fitur.** Kalau sebuah kontrol butuh tanda yang belum ada di set yang dipakai sekarang, kontrol itu berjalan tanpa ikon sampai set ikon ditetapkan.
4. **Ikon generik dilarang** di mana pun: Sparkle, Star, Zap, Rocket, dan sejenisnya. R-04.
5. **Ikon pada label status dilarang.** Status berupa teks. R-09.
6. **Ikon per baris tabel dilarang.** Kolom sudah punya header; ikon di tiap baris menambah noise tanpa informasi. R-14, R-31.
7. **Emoji dilarang total**, sebagai ikon maupun di dalam copy. R-04, R-02.

---

## 3. Struktur Tata Letak (Tab-Based)

### 3.1 Pohon Tab

```
Settings (satu file: `src/app/components/SettingsView.tsx`)
│
├── Tab 1: Profil & Akun (Profile & Account)
│   ├── Nama lengkap, email, nomor WhatsApp (form)
│   ├── Tombol ganti kata sandi
│   └── Tombol keluar akun
│
├── Tab 2: Langganan & Tagihan (Subscription & Billing)
│   ├── Status langganan (teks + progress bar)
│   ├── Tombol aksi: perpanjang / upgrade
│   └── Tabel riwayat pembayaran
│
├── Tab 3: Tampilan (Appearance & Display)
│   ├── Tema (terang/gelap)
│   ├── Bahasa (ID/EN)
│   ├── Mata uang (IDR/USD)
│   └── Kartu kurs real-time
│
├── Tab 4: Notifikasi (In-App Notifications)
│   ├── Toggle sinyal AI
│   ├── Toggle peringatan risiko
│   └── Toggle berita korporasi
│
└── Tab 5: Tentang & Bantuan (About & Support)
    ├── Metadata sistem
    └── Kontak bantuan
```

### 3.2 Alasan Hirarki (R-14)

Tabs tidak seragam karena isi tiap tab berbeda. Tab 2 (Langganan) adalah yang paling penting secara komersial, jadi dominasinya lewat **kartu status yang lebar di atas** dan tabel di bawahnya, bukan lewat ukuran card yang sama untuk semua tab. Tab 1 (Profil) dan Tab 3 (Tampilan) adalah form, jadi layout-nya **form label di kiri, kontrol di kanan**. Tab 4 (Notifikasi) adalah daftar toggle, jadi layoutnya **satu toggle per baris dengan divider**. Tab 5 (Tentang) adalah daftar definisi, jadi layoutnya **label-kolom-nilai tanpa card**.

---

## 4. Rincian Desain Antarmuka per Tab

### 4.1 Tab 1: Profil & Akun

#### Komponen:
1. **Header profil:** Nama lengkap dan alamat email sebagai teks. Tidak ada avatar lingkaran dengan inisial. R-23: avatar inisial adalah data yang dibuat-buat (huruf pertama nama), bukan foto profil asli. Jika pengguna belum mengunggah foto, inisial bukan representasi yang jujur.
2. **Nomor WhatsApp:** Field yang bisa diedit, untuk notifikasi dan tanda terima transaksi.
3. **Badge role:** Dihapus. Ganti dengan **label teks** di baris yang sama dengan nama: `Subscriber` atau `Administrator`. Tidak ada warna, tidak ada pill, tidak ada badge ungu/hijau.
4. **Tombol ganti kata sandi:** Membuka modal atau panel inline dengan tiga field: kata sandi saat ini, kata sandi baru, konfirmasi. Minimal 8 karakter.
5. **Shortcut admin (khusus role `admin`):** Link teks `Buka Portal Admin` menuju `/admin`. Tidak ada tombol besar, tidak ada banner berwarna. Restrained: role admin adalah kondisi luar biasa, bukan sorotan visual.

#### Gaya:
```
Profil & Akun
────────────────────────────────────────────────
Nama Lengkap Pengguna            Subscriber
james@example.com
────────────────────────────────────────────────
Nomor WhatsApp
081234567890                       [ Ubah ]

[ Ganti Kata Sandi ]

                              [ Keluar Akun ]
```

- Nama: `font-size: 14px`, `font-weight: 500`, `--foreground`.
- Email: `font-size: 12px`, `--muted-foreground`, `font-family: var(--font-mono)`.
- Label "Subscriber": `font-size: 12px`, `--muted-foreground`, tanpa warna khusus.
- Tombol "Keluar Akun": variant `destructive` (merah, `#dc2626` di light / `#ff4757` di dark) karena ini tindakan destruktif. Konfirmasi dengan dialog sebelum sign-out. R-26.

### 4.2 Tab 2: Langganan & Tagihan

Tab ini adalah **focal point** dari seluruh halaman Settings karena isinya yang paling menentukan secara komersial.

```
Langganan & Tagihan
────────────────────────────────────────────────
Paket Bulanan · Rp 15.000 / bulan         Aktif

Masa aktif hingga 24 Oktober 2026 · Sisa 21 hari
[████████████████████░░░░░░░░] 70%

[ Perpanjang Paket ]   [ Upgrade ke Tahunan ]

Riwayat Pembayaran
────────────────────────────────────────────────
Tanggal    Invoice              Paket     Nominal    Status
24 Sep 26  INV-20260924-01     Bulanan   Rp15.000   Lunas
24 Agu 26  INV-20260824-88     Bulanan   Rp15.000   Lunas
```

#### Komponen:
1. **Status langganan (teks, bukan badge):**
   - Nama paket: `font-size: 14px`, `--foreground`.
   - Label status: `font-size: 12px`, `--foreground`. Contoh: `Aktif`, `Menunggu verifikasi`, `Kedaluwarsa`. **Tidak ada warna**, teks sudah cukup jelas (P3).
   - Jika status `Kedaluwarsa`, baris status diberi `aria-live="polite"` supaya screen reader tahu ada perubahan, dan tombol `Perpanjang Paket` berubah dari `outline` menjadi `default` (aksen penuh).
2. **Progress bar:** `Progress` dari `ui/progress.tsx` yang sudah ada. `value = percentage_remaining`. Warna isi: `var(--primary)`. Label persen: `font-family: var(--font-mono)`.
   **Konsistensi angka:** `percentage_remaining` dihitung server dari `start_date` dan `end_date`, bukan dari `days_remaining`. Untuk paket bulanan, `days_remaining = 21` harus selalu berpasangan dengan `percentage_remaining = 70`. Spec v1.0.0 menampilkan 28 hari dan 70% bersamaan, yang tidak mungkin saling sesuai; implementasi tidak boleh mengulang kesalahan itu.
3. **Tombol aksi:**
   - `Perpanjang Paket` → variant `outline`. Membuka `RenewModal`.
   - `Upgrade ke Tahunan` → variant `outline`. Hanya untuk pelanggan bulanan. **Tanpa ikon, tanpa emoji, tanpa badge "Hemat 16,7%".** Badge Capsule sudah dihapus (R-09). Hemat 16,7% adalah fakta yang benar dan dapat diverifikasi dari harga di `system_settings`, bukan angka yang perlu dibungkus badge.
4. **Tabel riwayat pembayaran:** Header `--muted-foreground`, body `--card`. Angka (tanggal, nominal) `font-family: var(--font-mono)`. Kolom "Status" berisi teks (`Lunas`, `Gagal`, `Menunggu`), bukan badge berwarna. Baris dipisah `border-bottom: 1px solid var(--border)`.

#### Perhitungan nilai:
Persentase sisa masa aktif dan jumlah hari tersisa dihitung dari data API (`percentage_remaining`, `days_remaining`), bukan dari angka yang ditulis di spec ini.

### 4.3 Tab 3: Tampilan

Menjaga komponen yang sudah ada di `SettingsView.tsx`, dirapikan mengikuti token yang sama:

1. **Tema:** Toggle `Terang / Gelap`. Tidak ada ikon di dalam tombol. Label teks saja. State aktif: `background: var(--accent)`, `color: var(--accent-foreground)`, `border-color: var(--primary)`. State tidak aktif: `background: var(--muted)`, `color: var(--muted-foreground)`, `border-color: var(--border)`.
2. **Bahasa:** `Indonesia / English`. Tanpa ikon. Kontrol yang sama seperti tema.
3. **Mata uang:** `IDR / USD`. Tanpa ikon.
4. **Kurs real-time:** Kartu dengan `background: var(--muted)`, `border: 1px solid var(--border)`, `border-radius: var(--radius)`. Angka kurs `font-family: var(--font-mono)`. Perubahan harian: `--gain` jika Rupiah menguat, `--loss` jika melemah. Ini semantik warna, bukan aksen.

#### Layout:
```
Tampilan
────────────────────────────────────────────────
Tema                 [ Terang ]  [ Gelap ]

Bahasa              [ Indonesia ]  [ English ]

Mata Uang           [ IDR ]  [ USD ]

────────────────────────────────────────────────
Kurs USD/IDR                       real-time
────────────────────────────────────────────────
Kurs Saat Ini       Perubahan       Persentase
Rp 15.420           -85             -0,551%
```

### 4.4 Tab 4: Notifikasi

```
Notifikasi
────────────────────────────────────────────────
Sinyal AI Baru          [on/off]  Tersimpan
────────────────────────────────────────────────
Peringatan Risiko       [on/off]
────────────────────────────────────────────────
Berita Korporasi       [on/off]
────────────────────────────────────────────────
```

- Setiap baris: label `font-size: 13px`, `--foreground`; deskripsi `font-size: 12px`, `--muted-foreground`.
- Toggle: `Switch` dari `ui/switch.tsx` yang sudah ada. `data-[state=checked]:bg-primary`. Thumb: `bg-card` / `data-[state=checked]:bg-primary-foreground`.
- **Indikator "tersimpan":** Setelah toggle diubah, tampilkan teks `Tersimpan` dalam `--muted-foreground`, `font-size: 11px`, selama 2 detik lalu hilang. **Bukan** ikon centang hijau, bukan badge hijau. R-09: "Tersimpan" adalah teks yang informatif, centang hijau adalah dekorasi. (Perubahan dari `SettingsView.tsx` saat ini yang memakai `<Check size={9} />` dengan warna `--gain`.)

### 4.5 Tab 5: Tentang & Bantuan

```
Tentang
────────────────────────────────────────────────
Sumber Data        IDX / Yahoo Finance
Bursa              BEI (IDX)
Zona Waktu         WIB (UTC+7)
Status Feed        Tertunda (delayed)
────────────────────────────────────────────────
WhatsApp           [OWNER TO NAME]
Email              support@aidss.id
────────────────────────────────────────────────
Syarat & Ketentuan
Kebijakan Privasi
```

- **Metadata sistem:** Label `font-size: 11px`, `--muted-foreground`, `text-transform: uppercase`, `letter-spacing: 0.04em` (mengikuti pola yang sudah ada di `SettingsView.tsx`). Nilai `font-size: 12px`, `font-family: var(--font-mono)`, `--foreground`.
- **Tidak ada "Versi Aplikasi", "Model AI", atau "Terakhir Dilatih"** sebagai angka hardcode. Angka-angka ini sudah dihapus dari `SettingsView.tsx` yang sekarang dengan alasan yang benar: model dan feed bisa berubah, dan angka yang tidak dibaca dari backend akan cepat bohong. R-17.
- **Disclaimer OJK:** Satu baris teks di bawah metadata, bukan badge, bukan banner berwarna. `font-size: 11px`, `--muted-foreground`. Teksnya merujuk pada checkpoint di `legal-and-consent.md` §5 (Gate 2). Gate 1 ada di halaman checkout, bukan di Settings.
- **Kontak bantuan:** Link teks yang nilainya dibaca dari `system_settings.contact_support` (kunci `whatsapp` dan `email`). Tidak ada tombol berwarna. Jika nilainya kosong, baris tidak dirender, karena `wa.me/628...` yang tidak lengkap adalah link mati (R-26).

---

## 5. Spesifikasi Kontrak API

### 5.1 Endpoint Pengguna & Keamanan

Path di spec v1.0.0 (`/v1/user/profile`) tidak pernah ada dan tetap tidak ada. Yang
dipakai adalah `auth.py`, dengan cookie sesi opaque dan tanpa header `Authorization`.

* `GET /v1/auth/me`
  * **Header:** tidak ada. Session ada di cookie `HttpOnly`, dikirim browser otomatis.
  * **Response:**
    ```json
    {
      "id": "c1f7a218-4b71-4b11-a8bb-b892a0d63f01",
      "email": "user@example.com",
      "full_name": "contoh nama pengguna",
      "phone_number": "081234567890",
      "role": "user",
      "blocked": false
    }
    ```
* `PUT /v1/auth/me`
  * **Payload:** `{ "full_name": "...", "phone_number": "081234567899" }`
  * Both fields are validated together. `email` is not updatable: it is the identity,
    so changing it needs its own verification flow and is not in this scope.
* `POST /v1/auth/change-password`
  * **Payload:** `{ "current_password": "...", "new_password": "..." }`
  * Satu-satunya request yang memakai header: `Authorization: Bearer <token>`, karena
    di sini session cookie saja tidak membuktikan bahwa orang yang sedang masuk
    adalah pemilik session itu.

`role` hanya berisi `user` dan `admin`. Nilai `subscriber` di spec v1.0.0 melanggar
aturan 2 di `CONTEXT.md`: menyimpan subscriber sebagai kolom membuat role dan
status Subscription jadi dua sumber kebenaran untuk satu fakta.

### 5.2 Endpoint Langganan & Tagihan
* `GET /v1/user/subscription`
  * **Response:**
    ```json
    {
      "status": "active",
      "plan_type": "monthly",
      "price": 15000,
      "start_date": "2026-09-24T00:00:00Z",
      "end_date": "2026-10-24T23:59:59Z",
      "days_remaining": 21,
      "percentage_remaining": 70
    }
    ```
* `GET /v1/user/transactions`
  * **Response:**
    ```json
    [
      {
        "id": "tx_01",
        "invoice_code": "INV-20260924-01",
        "amount": 15000,
        "plan_type": "monthly",
        "payment_gateway": "midtrans",
        "payment_method": "qris",
        "status": "settlement",
        "created_at": "2026-09-24T08:15:00Z",
        "invoice_pdf_url": "/v1/user/invoices/INV-20260924-01.pdf"
      }
    ]
    ```

---

## 6. Rencana Arsitektur Komponen React

Ini yangDirsusun di spec v1.0.0, dan tidak pernah menjadi kenyataan. Yang ada
adalah satu file:

```
src/app/components/SettingsView.tsx
```

Isinya: shell dengan tab bar, lalu `TabProfile` (`SettingsView.tsx:142`),
`TabSubscription` (`:378`), `TabAppearance` (`:399`), `TabNotifications` (`:524`),
dan `TabAbout` (`:596`).

Perluasan ke Radix UI Tabs tidak terjadi. Tab bar memakai `role="tablist"` dan
`role="tab"` langsung di JSX (`SettingsView.tsx:86,101`), yang memang memindahkan
pekerjaan navigasi keyboard dari Radix ke kode sendiri. `/@radix-ui/react-tabs` ada
di `package.json`, tapi tidak diimpor di mana pun.

Mengubah spec yang sudah ditulis ulang adalah pekerjaan tersendiri, bukan sesuatu
yang dilakukan diam-diam sambil memperbaiki baris lain di dokumen ini. Selama ini
§6 dan §7 hanya ditulis sebagai "rencana", dan sekarang ditandai sebagai
rencana yang tidak dijalankan.

---

## 7. Desain Navigasi Tab (Radix Tabs)

```tsx
const tabTrigger =
  "flex items-center gap-2 py-2 px-4 text-xs font-medium whitespace-nowrap " +
  "border-b-2 transition-colors duration-100 " +
  "border-transparent text-[var(--muted-foreground)] font-normal hover:text-[var(--foreground)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] " +
  "data-[state=active]:border-[var(--primary)] data-[state=active]:text-[var(--primary)] data-[state=active]:font-medium";

<Tabs.List className="flex gap-2 mb-6 border-b border-[var(--border)] overflow-x-auto">
  <Tabs.Trigger value="profile"     className={tabTrigger}>Profil &amp; Akun</Tabs.Trigger>
  <Tabs.Trigger value="billing"     className={tabTrigger}>Langganan &amp; Tagihan</Tabs.Trigger>
  <Tabs.Trigger value="appearance"  className={tabTrigger}>Tampilan</Tabs.Trigger>
  <Tabs.Trigger value="notifications" className={tabTrigger}>Notifikasi</Tabs.Trigger>
  <Tabs.Trigger value="about"       className={tabTrigger}>Tentang</Tabs.Trigger>
</Tabs.List>
```

**Catatan:** ikon dihapus dari tab trigger. Label teks sudah menyatakan isinya; ikon hanya mengulang label. (R-04)

State tab yang dirujuk oleh `data-[state=active]`:
- **Aktif:** `color: var(--primary)`, `border-bottom: 2px solid var(--primary)`, `font-weight: 500`.
- **Tidak aktif:** `color: var(--muted-foreground)`, `border-bottom: 2px solid transparent`, `font-weight: 400`.
- **Hover:** `color: var(--foreground)`. Tidak ada warna baru (P2).
- **Focus-visible:** `outline: 2px solid var(--ring)`, `outline-offset: 2px`.

---

## 8. R-27: Empty / Loading / Error States

Setiap tab yang memanggil API harus punya ketiga state ini.

### 8.1 Loading (Tab 1, 2)
- **Skeleton:** Baris abu-abu dengan lebar sesuai konten (`ProfileSkeleton`, `SubscriptionSkeleton`). Gunakan `Skeleton` dari `ui/skeleton.tsx`.
- **Tab 2 tabel riwayat:** Tiga baris skeleton dengan tinggi sama dengan tinggi baris tabel (32px). Tidak ada spinner penuh layar.
- **Tab 1:** 3 baris skeleton (nama, email, WhatsApp).

### 8.2 Error (Tab 1, 2)
- **Inline, bukan alert besar.** Pesan singkat di tempat data seharusnya: `Gagal memuat profil. [ Coba Lagi ]`. Tombol "Coba Lagi" adalah link teks `--primary` (bukan tombol filled) karena ini aksi sekunder.
- **Copy error:** Selalu menyebut penyebab dan tindakan. Contoh: `"Gagal terhubung ke server. Periksa koneksi lalu coba lagi."`, bukan `"Terjadi kesalahan."`.

### 8.3 Empty (Tab 2)
- **Riwayat pembayaran kosong:** `"Belum ada pembayaran. Langganan pertama Anda akan muncul di sini."` yang menjelaskan mengapa kosong dan kapan akan terisi.
- **Belum pernah berlangganan (Tab 2, status `null`):** `"Anda belum memiliki langganan aktif."` + tombol `Perpanjang Paket` sebagai focal point.

### 8.4 Empty (Tab 1)
- **Nomor WhatsApp kosong:** Field menampilkan `?` (tanda data belum tersedia), bukan string kosong. Input menampilkan placeholder `08xx`.

---

## 9. Aksesibilitas (R-32, R-25)

### 9.1 Keyboard
- Tab dapat dinavigasi dengan `Tab` / `Shift+Tab`.
- Arrow keys (`←` / `→`) berpindah tab dan fokus ikut berpindah, diimplementasikan
  di `SettingsView.tsx` (`onTabKeyDown`), bukan oleh Radix.
- `Home` dan `End` lompat ke tab pertama dan terakhir. Perpindahan membungkus: dari
  tab terakhir, `→` kembali ke tab pertama.
- Hanya tab aktif yang ada di tab order (`tabIndex`), jadi menjangkau tab terakhir
  tidak berarti melewati empat tab di tengah.
- `Enter` atau `Space` mengaktifkan tab.
- Tombol dan link dapat diaktifkan dengan `Enter`.
- Modal (`RenewModal`, dialog konfirmasi sign-out) dapat ditutup dengan `Escape`.

### 9.2 Focus visible
Setiap elemen interaktif memiliki indikator fokus yang jelas: `outline: 2px solid var(--ring)`, `outline-offset: 2px`. `outline: none` tanpa pengganti **dilarang**.

### 9.3 Kontras (R-25, diverifikasi)
Semua pasangan teks/latar di bawah diukur dengan WCAG 2.x formula:

Nilai di bawah adalah nilai **setelah perbaikan**, sudah diverifikasi ulang dengan `contrast-check.py` dari `antislop-human` terhadap setiap permukaan tempat token itu benar-benar dipaintar (bukan semua kombinasi yang mungkin).

| Token | Light | Dark | Permukaan yang diperiksa |
|---|---|---|---|
| `--foreground` | 15.84:1 | 9.88:1 | card, background, muted, accent |
| `--muted-foreground` | 4.56:1 | 4.53:1 | card, background, muted, secondary, accent, sidebar |
| `--primary` | 4.86:1 | 9.93:1 | card, background |
| `--accent-foreground` | 4.62:1 | 5.71:1 | accent |
| `--primary-foreground` | 5.17:1 | 10.39:1 | primary |
| `--gain` | 4.50:1 | 8.79:1 | card, background, muted, `gain-bg` di atas card |
| `--loss` | 4.53:1 | 4.55:1 | card, muted, `loss-bg` di atas card, accent |
| `--warning` | 4.57:1 | 7.91:1 | card, background, muted, `warning-bg` di atas card |
| `--destructive` | 4.55:1 | 4.55:1 | card, muted, accent |

Semua 18 pasangan FAIL. `theme.css` sudah diperbaiki pada 2026-10-03:

| Token | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `--muted-foreground` (light) | `#6b7280` | `#686e7c` | 4.41:1 pada `--muted`, di bawah 4.5:1 |
| `--gain` (light) | `#059669` | `#047f59` | 3.77:1 pada `--card`, di bawah 4.5:1 |
| `--loss` (light) | `#dc2626` | `#d42525` | 4.41:1 pada `--muted` |
| `--warning` (light) | `#d97706` | `#a85c05` | 2.85:1 pada `--accent`, terendah dari semua semantik |
| `--destructive` (light) | `#dc2626` | `#d52525` | 4.41:1 pada `--muted` |
| `--muted-foreground` (dark) | `#5a7a9a` | `#7892ad` | 3.26:1 pada `--accent`, di bawah 4.5:1 |
| `--loss` (dark) | `#ff4757` | `#ff4f5f` | 4.38:1 pada `--accent` |
| `--destructive` (dark) | `#ff4757` | `#ff4f5f` | 4.38:1 pada `--accent` |

Perubahan ini adalah koreksi aksesibilitas pada token yang sudah ada, **bukan** warna brand baru. Setiap nilai baru dipilih sebagai perubahan terkecil yang bisa-Menplicitykan 4.5:1 pada semua permukaan nyata, tanpa menggeser karakter warnanya.

Setiap pasangan teks/latar baru wajib diukur dengan `contrast-check.py` sebelum merge.

---

## 10. R-03: Mobile

- **Tab bar:** Pada lebar < 640px, tab bar menjadi horizontal scroll (`overflow-x-auto`, `scroll-snap-type: x mandatory`). Setiap tab `min-width: max-content` agar tidak terpotong. Tidak ada tab yang terpotong teks.
- **Form rows (Tab 1, 3):** Pada < 640px, layout berubah dari `label-kiri / kontrol-kanan` menjadi vertikal: label di atas, kontrol di bawah dengan `width: 100%`.
- **Tabel (Tab 2):** Pada < 640px, tabel riwayat pembayaran menjadi kartu satu per transaksi (tanggal + nominal sebagai headline, invoice + status sebagai metadata). Bukan horizontal scroll yang memaksa pinch-zoom.
- **Tap target:** Minimal 44px × 44px untuk semua tombol, toggle, dan tab.
- **Progress bar:** `width: 100%`, tidak fixed-width.
- Tidak ada horizontal overflow di viewport mana pun.

---

## 11. R-31: Alasan Setiap Keputusan Visual

| Keputusan | Alasan satu kalimat |
|---|---|
| Ikon emoji dihapus dari tab | Emoji adalah penanda "dihasilkan mesin"; label teks sudah cukup (R-04). |
| Avatar inisial dihapus | Inisial bukan data asli; foto profil adalah data yang harus diunggah user (R-23). |
| Badge role dihapus, jadi label teks | Capsule + warna ungu/hijau = badge tanpa fungsi; teks "Subscriber" sudah jelas (R-09). |
| Ikon centang "Tersimpan" diganti teks | Ikon centang hijau adalah dekorasi; teks "Tersimpan" memberi informasi yang sama tanpa noise (R-09). |
| Tombol "Upgrade ke Tahunan" tanpa badge "Hemat 16,7%" | Capsule badge adalah pola R-05/R-09; fakta hemat 16,7% sudah terkomunikasi sendiri sebagai teks. |
| Ikon per baris tabel dihapus | Kolom sudah punya header; ikon per baris tidak menambah informasi (R-14). |
| State aktif tab pakai `border-bottom: 2px solid var(--primary)` | Garis bawah adalah indikator posisi yang tenang; pil terisi pada semua tab akan jadi R-11. |
| Tombol "Keluar Akun" pakai `variant="destructive"` | Sign-out menghapus session dan tidak bisa di-undo; warna merah adalah sinyal yang benar (C-1). |
| State hover tidak memakai warna baru | `--primary` hanya muncul di state aktif dan focus-visible; tidak ada warna tambahan. |
| Versi/Model/Terakhir Dilatih dihapus dari Tab 5 | Angka hardcode yang tidak dibaca dari backend akan cepat bohong (R-17). |

---

## 12. Yang Dihapus dari Spec v1.0.0 dan Alasannya

| Dihapus | Alasan |
|---|---|
| Emoji sebagai ikon tab (folder, kartu, palet, lonceng, info) | R-04. |
| Emoji pada tombol aksi (petir, api) | R-04, R-02. |
| Avatar lingkaran dengan inisial | R-23, R-38. |
| Badge ungu "System Administrator" | R-09, R-29. |
| Badge hijau "Active Subscriber" | R-09, R-29. |
| Ikon centang hijau "Tersimpan" | R-09. |
| Badge "Hemat 16,7%" pada tombol Upgrade | R-09, R-05. |
| Ikon per baris pada tabel riwayat | R-14. |
| Ikon di dalam tombol tema/bahasa | R-04. |
| Angka "Versi 4.2.1", "Model AIDSS Quant v4.2", "Terakhir Dilatih" | R-17 (angka tanpa sumber). |

---

## 13. Yang Tetap `[OWNER TO NAME]`

Nilai berikut belum diputuskan dan tidak boleh di-hardcode:

1. **Nama produk**, dipakai di header halaman dan teks About.
2. **Warna inti 1, warna inti 2, warna aksen**, saat ini menggunakan token yang sudah ada (`--primary`, `--accent`), tetapi nilai finalnya belum disahkan.
3. **Typeface display dan sans**, saat ini menggunakan `--font-sans` dan `--font-mono` dari `fonts.css`. Nilai final belum disahkan.
4. **Typeface angka tabular**, saat ini `--font-mono`. Nilai final belum disahkan.
5. **Set ikon**, saat ini mengikuti `lucide-react` yang sudah dipakai. Keputusan untuk menetapkan set ikon final belum diambil.

---

## 14. Status Implementasi (terakhir diperbarui 2026-10-07)

Spec ini sudah diimplementasikan dan diverifikasi. Yang selesai dan yang belum.

### 14.1 Sudah Terimplementasi

| Bagian | Status | Bukti |
|---|---|---|
| Tab bar 5 tab, teks tanpa ikon | Selesai | 5 tab ter-render, `aria-selected` benar, `Enter` mengaktifkan |
| Tab Tampilan: tema, bahasa, mata uang | Selesai | Tersimpan ke `localStorage`, class `.dark` pada `<html>` berubah |
| Tab Tampilan: kartu kurs + state "belum ada feed" | Selesai | Copy berbeda saat `isLive` false |
| Tab Notifikasi: 3 switch + konfirmasi "Tersimpan" | Selesai | `aria-checked` berubah, teks muncul, tanpa ikon |
| Tab Tentang: metadata + disclaimer OJK | Selesai | Teks polos, tanpa banner berwarna |
| R-03 mobile: tab scroll, `setting-row` stack < 640px | Selesai | Overflow horizontal 0px pada 375px dan 600px |
| R-32 keyboard | Selesai | Tab dapat di-fokus dan diaktifkan |
| Tanpa emoji | Selesai | 0 emoji di seluruh teks yang dirender, kedua tema |
| Light sebagai default | Selesai | Ditemukan saat klik-through: sebelumnya default dark |
| Tab 1 Profil: nama, WhatsApp, ganti sandi, keluar akun | Selesai | `GET`/`PUT /v1/auth/me` dan `POST /v1/auth/change-password`. Cookie sesi opaque, bukan header JWT |
| Arrow keys pada tab bar | Selesai | `onTabKeyDown` di `SettingsView.tsx`, plus `Home`/`End` dan pembungkusan di kedua ujung. 5 tes di `SettingsView.test.tsx` |

### 14.2 Belum Bisa Diimplementasikan (blocking, bukan pilihan)

| Bagian | Alasan |
|---|---|
| Tab 2 Langganan: tanggal berakhir, sisa hari | **Sudah ada.** `GET /v1/subscription/current` menjawab status, `expiresAt`, dan `daysRemaining`. Hari tersisa dihitung di server, bukan dari jam peramban. |
| Tab 2: riwayat invoice dan tombol unduh | Bergantung pada tabel `transactions` dan endpoint pembayaran, semuanya ditunda ke Fase 2. |
| Tab 2: tanggal mulai periode | `subscriptions` hanya punya `expires_at`. Menampilkan tanggal mulai berarti merekonstruksi, jadi tidak ditampilkan. |
| Tombol "Perpanjang Paket", "Upgrade ke Tahunan" | Bergantung pada endpoint pembayaran yang belum ada. Menampilkannya sekarang berarti kontrol mati (R-26). |

Tab 2 menampilkan empty state yang menyebut penyebabnya. Tidak ada nama, avatar,
nomor invoice, atau angka langganan yang dikarik.

### 14.3 Sesi Kejujuran Data dan Token (2026-10-03)

Audit lanjutan menemukan kelas masalah yang lebih luas daripada spec ini, dan
seluruhnya sudah diperbaiki. Ringkasnya:

| Temuan | Perbaikan |
|---|---|
| 11 berita fiktif mengatasnamai Kontan, Bisnis.com, Reuters, CNBC, Bloomberg, dan digabung ke feed live | Seed dihapus. `useNews` kini mengembalikan `error` dan `retry`, `NewsView` punya Empty dan Error state |
| `isFresh` ditentukan dari indeks array (`i === 0`), bukan waktu | Diturunkan dari `publishedAt`, ambang 60 menit, batas yang sama dengan string "Baru saja" |
| 10 string "Beli: 12 \| Tahan: 3" pada seed | Semua menjadi tanda pisah, sama seperti yang dikirim backend |
| "Sumber: LightGBM + SHAP" diklaim tanpa sumber | Diturunkan dari `source`; kontrak API tidak menyebut algoritma sama sekali |
| "Last Updated" memakai jam lokal perangkat | Memakai `generatedAt` dari backend, tanda pisah pada jalur seed |
| 8 token gagal kontras WCAG AA | Diperbaiki; 18 pasangan terverifikasi |
| ~20 palet dark.hex dihardcode pada permukaan light | DimMigrasikan ke token |
| `--chart-1` vs `--chart-2` 1.00:1 satu sama lain | Goresan 1px `--card` di setiap sel donat |
| 6 sektor, 5 token grafik | Sectors terbesar pakai token; Material (7,2%) memakai `--muted` |
| Tier T1/T2/T3 memakai 3 hue untuk skala terurut | Satu hue, tiga intensitas lewat `color-mix` |
| `var(--info, #3b82f6)`, token tidak ada di mana pun | Dipakai `--neutral` |
| Identitas fiktif di Sidebar ("James Davidson") | Dihapus, dengan regression test |

### 14.4 Di luar Spec Ini, Ditemukan Saat Klik-Through

| Temuan | Perbaikan |
|---|---|
| Sidebar menampilkan identitas fiktif: "James Davidson", "Portfolio Manager", avatar inisial "JD" | Dihapus. Sidebar sekarang menulis "Operator Tunggal / Belum ada akun terhubung". Regression test di `Sidebar.test.tsx`. |
| Default tema dark, padahal `DESIGN.md` menetapkan light | `AppContext.readTheme()` sekarang mengembalikan light. |
| Judul "Settings" tampil dua kali (Header + view) | `<h2>` di SettingsView dihapus. |
| `<html lang="en">` sementara bahasa default `id` | `document.documentElement.lang` disinkronkan ke locale. |
| `/favicon.ico` 404 di console | `<link rel="icon" href="data:,">`. Logo tidak dibuat karena belum ditentukan pemilik (R-23). |

---

## 15. Checklist Implementasi

- [x] Tidak ada emoji di seluruh file `src/app/components/SettingsView.tsx`
- [x] Tidak ada avatar inisial di `SettingsView.tsx`
- [x] Tidak ada badge role di `SettingsView.tsx` (label teks saja)
- [x] Tidak ada ikon di `Tabs.Trigger`
- [x] Tidak ada ikon centang di feedback "Tersimpan"
- [x] Tidak ada badge "Hemat 16,7%" di `SettingsView.tsx`
- [x] Tidak ada ikon per baris di tabel riwayat
- [x] Tab bar: horizontal scroll pada layar sempit
- [x] `setting-row` stacking vertikal di bawah 640px
- [x] `focus-visible` di setiap elemen interaktif
- [x] `contrast-check.py` dijalankan untuk setiap pasangan teks/latar
- [ ] Empty/loading/error state di Tab 1 dan Tab 2 (blocked: endpoint belum ada, lihat §14.2)
- [x] Dark mode diverifikasi manual, bukan hanya light

Tabel riwayat pembayaran menjadi kartu pada mobile: belum dapat diverifikasi, karena tabelnya sendiri belum ada (lihat §14.2).
