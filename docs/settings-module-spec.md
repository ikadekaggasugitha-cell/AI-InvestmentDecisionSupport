# Spesifikasi Teknis & Desain: Perancangan Ulang Modul Settings (SaaS Multi-User)

> **Dokumen Arsitektur & Desain Antarmuka (UI/UX)**  
> **Status:** Siap Implementasi (*Implementation-Ready*)  
> **Versi:** 1.0.0  
> **Target Komponen:** `src/app/components/SettingsView.tsx` & Backend User/Billing Services  
> **Lokasi File:** `docs/settings-module-spec.md`

---

## 1. Latar Belakang & Tujuan Refaktor

Modul **Settings** saat ini dirancang untuk kebutuhan *single-operator personal decision tool* dengan layout satu halaman (*single scroll*) yang hanya memuat:
1. Tema (*Theme: Light/Dark*)
2. Bahasa (*Language: ID/EN*)
3. Mata Uang (*Currency: IDR/USD*)
4. Notifikasi (*In-App Alert Toggles*)
5. Informasi Aplikasi (*About*)

Dengan beralihnya sistem ke model bisnis **SaaS Multi-User dengan Langganan (Rp 15.000/bln dan Rp 150.000/thn)**, modul Settings perlu ditransformasikan menjadi pusat manajemen pengguna (*User Account Center*) yang modern, terstruktur, dan modular menggunakan navigasi berbasis **Tab (Tab-Based Layout)**.

---

## 2. Struktur Tata Letak Baru (*Tab-Based Architecture*)

Modul Settings dirombak menjadi **5 Tab Utama**:

```
Settings View (src/app/components/SettingsView.tsx)
│
├── 📂 Tab 1: Profil & Akun (Profile & Account)
│   ├── Avatar Pengguna, Nama Lengkap, dan Email
│   ├── Edit Nomor WhatsApp Aktif
│   ├── Form Ganti Kata Sandi (Password Security)
│   ├── Badge Role (Subscriber / Administrator)
│   │   └── *Khusus Admin:* Tombol Shortcut "Buka Portal Admin ↗" (/admin)
│   └── Tombol Logout / Keluar Akun (Dengan Dialog Konfirmasi)
│
├── 💳 Tab 2: Langganan & Tagihan (Subscription & Billing)
│   ├── Kartu Status Paket Aktif (Bulanan / Tahunan)
│   ├── Indikator Masa Aktif & Sisa Hari (Progress Bar)
│   ├── Tombol Aksi: "Perpanjang Paket" & "Upgrade ke Tahunan" (Modal Quick-Checkout)
│   └── Tabel Riwayat Pembayaran & Unduh Invoice PDF
│
├── 🎨 Tab 3: Preferensi Tampilan (Appearance & Display)
│   ├── Tema Antarmuka (Terang / Gelap)
│   ├── Bahasa Antarmuka (Bahasa Indonesia / English)
│   └── Mata Uang Nilai Portofolio (IDR / USD) + Kartu Kurs Real-Time
│
├── 🔔 Tab 4: Notifikasi In-App (Notifications)
│   ├── Toggle Notifikasi Sinyal AI Baru
│   ├── Toggle Notifikasi Peringatan Risiko Portofolio
│   └── Toggle Notifikasi Berita Korporasi
│
└── ℹ️ Tab 5: Tentang & Bantuan (About & Support)
    ├── Informasi Teknis Sistem (Versi, Model AI, Sumber Data, Zona Waktu)
    └── Bantuan Pelanggan (WhatsApp Support & Email Support)
```

---

## 3. Rincian Desain Antarmuka & Interaksi Tiap Tab

### 3.1 Tab 1: Profil & Akun (*Profile & Account*)

#### Komponen UI:
1. **Header Profil:**
   * Avatar lingkaran dengan inisial nama pengguna (misal: "JD" untuk James Davidson).
   * Nama lengkap pengguna dan status akun (*Verified Member*).
   * Alamat email (bersifat *read-only* dengan badge terverifikasi).
2. **Formulir Edit Data Pengguna:**
   * Field `Nomor WhatsApp`: Dapat diperbarui oleh pengguna untuk keperluan notifikasi sistem dan tanda terima transaksi.
   * Tombol "Simpan Perubahan Profil".
3. **Formulir Ganti Password:**
   * Field `Kata Sandi Saat Ini`
   * Field `Kata Sandi Baru` (Minimal 8 karakter)
   * Field `Konfirmasi Kata Sandi Baru`
   * Tombol "Perbarui Kata Sandi".
4. **Indikator Role & Akses Admin:**
   * Jika role pengguna adalah `subscriber`: Menampilkan badge hijau *"Active Subscriber"*.
   * Jika role pengguna adalah `admin`: Menampilkan badge ungu *"System Administrator"* disertai banner navigasi:
     > **Portal Khusus Admin Tersedia**  
     > Anda memiliki hak akses administrator untuk mengelola transaksi, pengguna, dan pengaturan sistem.  
     > `[ Buka Portal Admin ↗ ]` *(Membuka rute `/admin`)*
5. **Tombol Keluar (*Sign Out*):**
   * Tombol merah di bagian bawah dengan konfirmasi dialog untuk menghapus session/token JWT dari `localStorage` dan meredirect ke halaman login.

---

### 3.2 Tab 2: Langganan & Tagihan (*Subscription & Billing*)

Tab ini merupakan fungsionalitas inti untuk mendukung model bisnis SaaS berulang (*Recurring SaaS*).

```
┌────────────────────────────────────────────────────────────────────────┐
│ 💳 PAKET AKTIF                                                         │
│                                                                        │
│ Paket Bulanan (Rp 15.000 / bulan)               Status: [ AKTIF 🟢 ]   │
│ Masa aktif hingga 24 Oktober 2026 (Sisa 28 hari)                       │
│ [██████████████████████████████░░░░] 70% masa aktif tersisa            │
│                                                                        │
│ [ ⚡ Perpanjang Paket ]         [ 🔥 Upgrade ke Tahunan (Hemat 16,7%) ] │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 📑 RIWAYAT PEMBAYARAN                                                  │
├─────────────┬─────────────────┬────────────┬──────────┬────────┬───────┤
│ Tanggal     │ No. Invoice     │ Paket      │ Nominal  │ Status │ Aksi  │
├─────────────┼─────────────────┼────────────┼──────────┼────────┼───────┤
│ 24 Sep 2026 │ INV-20260924-01 │ Bulanan    │ Rp15.000 │ Lunas  │ [PDF] │
│ 24 Agu 2026 │ INV-20260824-88 │ Bulanan    │ Rp15.000 │ Lunas  │ [PDF] │
└─────────────┴─────────────────┴────────────┴──────────┴────────┴───────┘
```

#### Komponen & Interaksi:
1. **Kartu Status Paket:**
   * Menampilkan nama paket aktif saat ini: **Paket Bulanan** (`Rp 15.000/bln`) atau **Paket Tahunan** (`Rp 150.000/thn`).
   * Label status visual: `AKTIF` (Hijau), `MENUNGGU VERIFIKASI` (Kuning), atau `KEDALUWARSA` (Merah).
   * Tanggal kedaluwarsa lengkap dengan countdown hari tersisa dan progress bar horizontal.
2. **Tombol Aksi Pembayaran:**
   * **Tombol "Perpanjang Paket":** Membuka modal pop-up checkout ringkas untuk memilih metode pembayaran (Midtrans Snap QRIS/VA otomatis atau Transfer Bank Manual).
   * **Tombol "Upgrade ke Tahunan":** Khusus untuk pelanggan bulanan; menawarkan transisi ke paket Rp 150.000/tahun (setara 2 bulan gratis).
3. **Tabel Riwayat Pembayaran:**
   * Menampilkan riwayat transaksi milik pengguna secara kronologis.
   * Tombol **"Unduh Invoice (PDF)"**: Menghasilkan atau mengunduh invoice formal tanda terima pembayaran.

---

### 3.3 Tab 3: Preferensi Tampilan (*Appearance & Display*)

Mempertahankan dan merapikan komponen visual yang sudah ada di codebase:
1. **Tema Antarmuka (*Theme*):**
   * Pilihan tombol radio toggle: **Terang (*Light*)** vs **Gelap (*Dark*)**.
2. **Bahasa (*Language*):**
   * Pilihan tombol: **Bahasa Indonesia (ID)** vs **English (EN)**.
3. **Mata Uang (*Currency*):**
   * Pilihan nilai tampilan: **IDR (Rupiah)** vs **USD (Dollar)**.
4. **Live Kurs Valas Real-Time:**
   * Kartu kurs USD/IDR live dengan persentase perubahan dan penjelasan dampak daya beli pada portofolio berbasis IDR.

---

### 3.4 Tab 4: Notifikasi In-App (*In-App Notifications*)

Sesuai arahan spesifikasi, pengaturan notifikasi pada sisi pengguna difokuskan khusus pada **peringatan di dalam aplikasi (*In-App Alerts*)**, sementara pengiriman pesan Email dan WhatsApp dijalankan otomatis oleh sistem backend:

1. **Sinyal AI Baru (*New AI Signals*):**
   * Switch toggle on/off: Memberi tahu saat model kuantitatif LightGBM menghasilkan sinyal probabilitas saham baru.
2. **Peringatan Risiko (*Risk Alerts*):**
   * Switch toggle on/off: Memberi tahu saat eksposur risiko portofolio (VaR/CVaR) melampaui batas toleransi.
3. **Berita Korporasi (*Corporate News*):**
   * Switch toggle on/off: Memberi tahu berita keterbukaan informasi emiten yang ada di watchlist pengguna.

*Setiap perubahan toggle otomatis disimpan ke `localStorage` dengan umpan balik visual animasi centang (*Saved Indicator*).*

---

### 3.5 Tab 5: Tentang & Bantuan (*About & Support*)

1. **Metadata Sistem:**
   * Versi Aplikasi: `4.2.1`
   * Model AI: `AIDSS Quant v4.2`
   * Sumber Data Pasar: `BEI (IDX) / Yahoo Finance`
   * Zona Waktu: `WIB (UTC+7)`
   * Terakhir Dilatih: Tanggal model update terakhir.
2. **Kontak Bantuan & Layanan Pelanggan:**
   * Tombol tautan langsung: **WhatsApp Customer Support** (`https://wa.me/628...`).
   * Tombol tautan langsung: **Kirim Email Bantuan** (`mailto:support@aidss.id`).
   * Tautan Syarat & Ketentuan serta Kebijakan Privasi.

---

## 4. Spesifikasi Kontrak API Pendukung (*API Contracts*)

Modul Settings baru memerlukan endpoint REST API backend berikut untuk melayani data profil dan tagihan:

### 4.1 Endpoint Pengguna & Keamanan
* `GET /v1/user/profile`
  * **Header:** `Authorization: Bearer <JWT>`
  * **Response:**
    ```json
    {
      "id": "c1f7a218-4b71-4b11-a8bb-b892a0d63f01",
      "email": "user@example.com",
      "full_name": "James Davidson",
      "phone_number": "081234567890",
      "role": "subscriber",
      "created_at": "2026-08-24T10:00:00Z"
    }
    ```
* `PUT /v1/user/profile`
  * **Payload:** `{ "phone_number": "081234567899" }`
* `POST /v1/user/change-password`
  * **Payload:** `{ "old_password": "...", "new_password": "..." }`

### 4.2 Endpoint Langganan & Tagihan
* `GET /v1/user/subscription`
  * **Response:**
    ```json
    {
      "status": "active",
      "plan_type": "monthly",
      "price": 15000,
      "start_date": "2026-09-24T00:00:00Z",
      "end_date": "2026-10-24T23:59:59Z",
      "days_remaining": 28,
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

## 5. Rencana Arsitektur Komponen React (`src/app/components/`)

Agar kode bersih, terstruktur rapi, dan mudah dirawat, file monolitik `SettingsView.tsx` dipecah menjadi beberapa sub-komponen:

```
src/app/components/settings/
├── SettingsView.tsx          # Shell utama dengan Tab Bar horizontal (Radix UI Tabs)
├── TabProfile.tsx            # Form profil, ganti password, role badge, tombol logout
├── TabSubscription.tsx       # Kartu status langganan, tombol perpanjang/upgrade, riwayat tagihan
├── TabAppearance.tsx         # Kontrol Tema, Bahasa, dan Mata Uang + Kurs USD/IDR
├── TabNotifications.tsx      # Toggle notifikasi in-app
├── TabAbout.tsx              # Metadata versi, disclaimer OJK, dan tombol kontak support
└── RenewModal.tsx            # Modal dialog cepat untuk bayar perpanjangan paket
```

---

## 6. Desain Visual Navigasi Tab

Navigasi Tab diletakkan di bagian atas halaman Settings dengan gaya *segmented pill / underline tab* yang serasi dengan desain tema AIDSS:

```tsx
<Tabs.List className="flex border-b border-[var(--border)] gap-2 mb-6">
  <Tabs.Trigger value="profile" className="flex items-center gap-2 py-2 px-4 text-xs font-medium">
    <User size={14} /> Profil & Akun
  </Tabs.Trigger>
  <Tabs.Trigger value="billing" className="flex items-center gap-2 py-2 px-4 text-xs font-medium">
    <CreditCard size={14} /> Langganan & Tagihan
  </Tabs.Trigger>
  <Tabs.Trigger value="appearance" className="flex items-center gap-2 py-2 px-4 text-xs font-medium">
    <Sliders size={14} /> Tampilan
  </Tabs.Trigger>
  <Tabs.Trigger value="notifications" className="flex items-center gap-2 py-2 px-4 text-xs font-medium">
    <Bell size={14} /> Notifikasi
  </Tabs.Trigger>
  <Tabs.Trigger value="about" className="flex items-center gap-2 py-2 px-4 text-xs font-medium">
    <Info size={14} /> Tentang
  </Tabs.Trigger>
</Tabs.List>
```

---

## 7. Kesimpulan

Dengan penerapan spesifikasi ini:
1. Pengguna memiliki kendali penuh atas informasi akun dan masa aktif langganan mereka (Rp 15.000/bln atau Rp 150.000/thn).
2. Memudahkan perpanjangan paket (*renew*) langsung dari dashboard tanpa harus logout.
3. Administrator memiliki akses langsung (*shortcut*) ke Portal Admin `/admin` jika sedang login dengan akun bertipe admin.
4. Tampilan antarmuka Settings menjadi profesional, rapi, dan memenuhi standar produk SaaS finansial tingkat produksi.
