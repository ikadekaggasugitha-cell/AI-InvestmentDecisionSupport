# Dokumen Legal, Syarat Layanan & Persetujuan Pengguna (Legal & Consent Agreement)
### AIDSS — AI Investment Decision Support System

> **Versi Dokumen:** 0.2.0-draft  
> **Tanggal Berlaku:** belum berlaku  
> **Status:** **Draf internal. Tidak mengikat siapa pun.**  
> **Lokasi File:** `docs/legal-and-consent.md`  
> **Bahasa:** Bilingual (Bahasa Indonesia & English)

### Mengapa statusnya draft

Versi sebelumnya menandai dokumen ini sebagai sah dan mengikat sejak 24 September 2026. Itu tidak bisa dibenarkan, karena beberapa janji di dalamnya belum didukung apa pun:

- **Tidak ada penagihan.** Midtrans, QRIS, virtual account, upload bukti transfer, dan verifikasi admin belum ada satu baris kode pun.
- **Gate 2 sudah lengkap.** Modal berjalan di AI Advisor dan halaman detail saham, persetujuannya dicatat di server bersama versi teks dan waktunya, dan penanda peramban disimpan per akun.
- **Kebijakan privasi menurut data yang tidak dikumpulkan.** Bagian 1 §4 pernah menyebut alamat IP, *user-agent*, log audit, stempel waktu login, nomor invoice, dan bukti transfer. Tidak satu pun itu ada di database. Sekarang bagian itu menyebut yang tidak ada secara eksplisit.
- **Tidak ada kanal WhatsApp maupun email.** Nomor dan alamat yang dicantumkan di Bagian 2 §6 belum diterima siapa pun.
- **Tidak ada mekanisme penagihan**, jadi kebijakan tanpa pengembalian dana di Bagian 1 §3.3 belum bisa dijalankan.

Dua hal harus berubah sebelum dokumen ini boleh dipakai: peninjauan oleh Qualified Legal Professional Indonesia, dan Fase 2 plus Fase 5 yang benar-benar hijau.

Sampai itu terjadi, jangan arahkan pengguna ke dokumen ini sebagai syarat dan ketentuan yang berlaku.

---

# BAGIAN 1: BAHASA INDONESIA (VERSI UTAMA)

## 1. Pernyataan Penyangkalan Hukum & Kepatuhan OJK (*Legal & Regulatory Disclaimer*)

### 1.1 Bukan Nasihat Keuangan Resmi (*Non-Advisory Disclaimer*)
Platform **AIDSS (AI Investment Decision Support System)** adalah perangkat lunak analitik data dan sistem pendukung keputusan independen berbasis kecerdasan buatan (*Artificial Intelligence*). 

1. **Bukan Penasihat Investasi:** AIDSS, pemilik platform, pengembang, dan afiliasinya **BUKAN** merupakan Penasihat Investasi, Perantara Pedagang Efek (Broker-Dealer), maupun Manajer Investasi (MI) berizin sebagaimana diatur dalam Undang-Undang No. 8 Tahun 1995 tentang Pasar Modal dan peraturan Otoritas Jasa Keuangan (OJK).
2. **Sifat Skor Probabilitas:** Seluruh sinyal kuantitatif, probabilitas kenaikan (*probability score* 0–100), optimasi portofolio Black-Litterman, metrik risiko GARCH/CVaR, dan jawaban asisten AI (AI Advisor) disajikan semata-mata untuk **tujuan edukasi, penelitian, dan referensi analitis**. Tidak ada satu pun informasi dalam platform ini yang dapat ditafsirkan sebagai instruksi, rekomendasi, tawaran, atau ajakan mengikat untuk membeli, menjual, atau menahan instrumen efek saham tertentu di Bursa Efek Indonesia (BEI/IDX).
3. **Tanggung Jawab Keputusan:** Seluruh keputusan investasi, alokasi aset, dan pemilihan transaksi saham sepenuhnya merupakan keputusan dan tanggung jawab mandiri pengguna (*Do Your Own Research - DYOR*). AIDSS dibebaskan dari segala bentuk tuntutan atas kerugian modal langsung maupun tidak langsung yang timbul akibat keputusan transaksi pengguna di pasar saham.

---

## 2. Syarat & Ketentuan Layanan (*Terms of Service*)

### 2.1 Ketentuan Akun Pengguna
1. **Kelayakan:** Pengguna wajib berusia minimal 18 tahun atau telah cakap menurut hukum Indonesia untuk mengikatkan diri dalam perjanjian ini.
2. **Kebenaran Data:** Pengguna wajib memberikan data yang akurat saat pendaftaran, termasuk nama lengkap, alamat email aktif, dan nomor WhatsApp valid.
3. **Keamanan Akun:** Pengguna bertanggung jawab penuh menjaga kerahasiaan kata sandi dan seluruh aktivitas yang terjadi di bawah akun pengguna.

### 2.2 Lisensi Penggunaan Personal Tunggal (*Single-User License*)
1. Akun langganan AIDSS bersifat **pribadi dan tidak dapat dipindahtangankan** (*non-transferable single-user license*).
2. **Larangan Berbagi Akun (*Account Sharing*):** Dilarang keras membagikan kredensial login kepada pihak ketiga, menjual akses akun bersama (*shared account*), atau menggunakannya secara simultan pada banyak perangkat yang mencurigakan.
3. **Larangan Scraping & Reverse Engineering:** Dilarang keras melakukan penarikan data otomatis (*web scraping*, *bot automated requests*, *API extraction*), membongkar kode sumber, atau merekayasa balik (*reverse engineering*) algoritma dan model AI AIDSS.
4. **Larangan Menjual Sinyal (*Signal Reselling*):** Dilarang keras mendistribusikan ulang, menyiarkan, atau menjual kembali hasil sinyal AI, metrik risiko, atau analisis portofolio AIDSS ke dalam grup publik/berbayar (seperti Telegram, WhatsApp Signal Group, Discord) tanpa perjanjian lisensi kemitraan tertulis.
5. **Sanksi Pelanggaran:** Pelanggaran terhadap klausul ini mengakibatkan pemblokiran akun permanen secara seketika (*immediate account termination*) tanpa hak pengembalian dana, serta hak pengelola untuk mengajukan tuntutan hukum sesuai UU ITE (Informasi dan Transaksi Elektronik).

---

## 3. Kebijakan Langganan, Pembayaran & Pengembalian Dana (*Billing & Refund Policy*)

### 3.1 Paket & Ketentuan Biaya
1. **Paket Bulanan:** Rp 15.000 (Masa aktif 30 hari kalender).
2. **Paket Tahunan:** Rp 150.000 (Masa aktif 365 hari kalender).
3. Semua harga dalam denominasi Rupiah (IDR) dan dapat disesuaikan sewaktu-waktu dengan pemberitahuan wajar pada platform.

### 3.2 Metode Pembayaran (Hybrid)
1. **Otomatis (Midtrans):** Pembayaran instan melalui QRIS (GoPay, OVO, ShopeePay, DANA) dan Virtual Account Bank (BCA, Mandiri, BNI, BRI). Status akun aktif seketika setelah notifikasi pelunasan terverifikasi otomatis.
2. **Manual (Transfer Bank):** Pengguna mentransfer ke rekening resmi tertera dan mengunggah foto bukti transfer. Akun aktif setelah verifikasi admin maksimal $1 \times 24$ jam kerja.

### 3.3 Kebijakan Tidak Ada Pengembalian Dana (*Strict No-Refund Policy*)
Mengingat sifat produk AIDSS adalah **layanan informasi & analitik data digital yang langsung aktif dan dapat diakses seketika** setelah transaksi berhasil diverifikasi:
1. **Seluruh pembayaran langganan bersifat final dan tidak dapat dikembalikan (*strictly non-refundable*)** untuk alasan apa pun, termasuk namun tidak terbatas pada: perubahan preferensi pengguna, kurangnya penggunaan, atau ketidakpuasan subjektif atas pergerakan pasar saham riil.
2. **Pengecualian Penagihan Ganda (*Duplicate Billing*):** Pengembalian dana hanya dapat diproses apabila terbukti terjadi penagihan berulang secara ganda (*double-charge*) atas pesanan yang sama akibat kendala teknis gateway pembayaran. Pengajuan wajib disampaikan maksimal 3 hari kerja sejak transaksi ke `support@aidss.id` disertai bukti mutasi perbankan.

---

## 4. Kebijakan Privasi & Perlindungan Data Pribadi (UU PDP No. 27/2022)

AIDSS berkomitmen penuh melindungi hak privasi pengguna sesuai dengan ketentuan **Undang-Undang Republik Indonesia Nomor 27 Tahun 2022 tentang Perlindungan Data Pribadi (UU PDP)**:

### 4.1 Data Pribadi yang Dikumpulkan
1. **Data Identitas:** Nama lengkap, alamat email, dan nomor kontak WhatsApp. Ketiganya diisi sendiri oleh pengguna saat pendaftaran dan dapat diubah kapan saja lewat `/v1/auth/me`.
2. **Data Sesi:** Saat masuk, aplikasi membuat token acak, menyimpan **hash SHA-256**-nya beserta waktu dibuat dan waktu berakhirnya. Token aslinya hanya ada di cookie `HttpOnly` peramban, tidak pernah ditulis ke database.
3. **Riwayat Langganan:** Tanggal mulai dan tanggal berakhir tiap masa aktif langganan.

Yang **tidak** dikumpulkan pada versi ini:

- **Tidak ada data pembayaran apa pun.** Tidak ada nomor kartu, PIN, nomor invoice, metode pembayaran, atau bukti transfer, karena penagihan belum ada sama sekali.
- **Tidak ada alamat IP atau *user-agent* yang disimpan.** Pembatas laju permintaan memakai alamat IP untuk menghitung kuota di memori proses, dan nilai itu tidak ditulis ke mana pun.
- **Tidak ada log audit atau stempel waktu login.** Tabel `sessions` menyimpan waktu dibuat dan berakhir, bukan riwayat kapan seseorang masuk dari perangkat mana.
- **Persetujuan di Bagian 1 §5 disimpan hanya di peramban,** bukan di server. Tidak ada tabel yang mencatat siapa menyetujui apa dan kapan.

Bagian ini sengaja menyebut yang tidak ada. Menjanji pemrosesan data yang tidak pernah dikumpulkan membuat orang berhak atas sesuatu yang tidak bisa diberikan, dan membuat kita terlihat mengumpulkan lebih banyak daripada kenyataannya.

### 4.2 Tujuan Pemrosesan Data
1. Mengotentikasi akun dan mengelola masa aktif langganan yang sedang berjalan.
2. Menentukan apakah sebuah permintaan diizinkan, dengan membandingkan tanggal berakhir langganan dengan waktu sekarang.
3. Membatasi penyalahgunaan layanan dan biaya model AI melalui pembatas laju permintaan per alamat IP.

Yang **belum** ada: pengiriman invoice, email konfirmasi, pesan WhatsApp, dan pengingat perpanjangan. Semuanya bergantung pada penagihan dan kanal notifikasi yang belum dibangun.

### 4.3 Kerahasiaan & Keamanan Data
1. Data kata sandi disimpan dalam bentuk hash terenkripsi searah menggunakan standar kriptografi mutakhir (**Argon2id**, tanpa alternatif bcrypt).
2. AIDSS **TIDAK AKAN PERNAH** menjual, menyewakan, atau memperdagangkan data pribadi pengguna kepada pihak ketiga mana pun untuk tujuan periklanan atau pemasaran tanpa persetujuan eksplisit pengguna.
3. Pengguna memiliki hak meminta penghapusan akun (*Right to Erasure*) dengan mengajukan permohonan tertulis ke layanan pelanggan resmi.

---

## 5. Tata Cara & Gerbang Persetujuan Pengguna (*User Consent Gates*)

Persetujuan pengguna terhadap seluruh ketentuan di atas ditegakkan melalui **Dual-Gate Consent System**:

```
[ GERBANG 1: CHECKOUT PENDAFTARAN ]
☑ Saya menyatakan telah berusia minimal 18 tahun, MENYETUJUI Syarat & Ketentuan,
  Kebijakan Privasi, Kebijakan Tanpa Pengembalian Dana, serta MEMAHAMI bahwa seluruh output
  AIDSS adalah skor probabilitas analitis dan BUKAN merupakan nasihat investasi resmi OJK.
  (Wajib dicentang sebelum tombol bayar dapat diklik)

[ GERBANG 2: FIRST-ACCESS MODAL DI DALAM DASHBOARD ]
Modal interaktif "Penjelasan Kepatuhan OJK" yang muncul saat pertama kali sebuah akun
mengakses output model — sinyal AI, skor probabilitas pada halaman detail saham, atau
AI Advisor:
- Pengguna wajib menekan tombol: [ SAYA MENGERTI & SETUJU ]
- Setelah tombol ditekan, persetujuan dikirim ke server dan dicatat di tabel
  `consent_acceptances` bersama id akun, versi teks yang disetujui, dan waktunya.
- Penanda di penyimpanan lokal peramban memakai kunci yang memuat id akun, sehingga
  persetujuan satu orang tidak berlaku untuk akun lain di peramban yang sama.
- Teks pada modal menyebutkan bahwa ini bukan nasihat investasi resmi.

Penanda di peramban hanya menentukan apakah modal perlu muncul lagi. Yang
menjadi bukti adalah baris di server: `GET /v1/auth/consent` mengembalikan versi
teks yang terakhir disetujui, dan `has_current_acceptance()` hanya bernilai benar
bila versinya masih sama dengan yang sedang ditampilkan. Kalau teksnya berubah,
persetujuan versi lama tetap terbaca sebagai catatan, tetapi **bukan** persetujuan
atas teks yang sekarang.
```

Gerbang 1 belum ada, dan tidak akan ada sebelum ada layar pembayaran.

---
---

# PART 2: ENGLISH VERSION (OFFICIAL TRANSLATION)

## 1. Legal Disclaimer & Regulatory Compliance

### 1.1 Non-Advisory Disclaimer
The **AIDSS (AI Investment Decision Support System)** platform is an independent decision-support and data analytics software powered by Artificial Intelligence.

1. **Not a Financial Advisor:** AIDSS, its operators, creators, developers, and affiliates are **NOT** licensed Investment Advisors, Broker-Dealers, or Investment Managers under the laws of the Republic of Indonesia (Law No. 8 of 1995 on Capital Markets) or any foreign regulatory authority (including SEC, FCA, or ASIC).
2. **Probabilistic Outputs:** All quantitative signals, probability scores (0–100), Black-Litterman allocations, GARCH/CVaR risk parameters, and AI conversational responses are provided strictly for **educational, analytical, and research reference purposes**. Nothing contained within this platform constitutes a binding recommendation, solicitation, or offer to buy, sell, or hold any financial instrument or equity listed on the Indonesia Stock Exchange (IDX).
3. **Sole Responsibility:** Capital market trading involves substantial financial risk, including the loss of principal. All investment decisions, trade executions, and portfolio allocations are the sole, independent responsibility of the user (*Do Your Own Research - DYOR*). AIDSS assumes no liability for direct or indirect losses incurred from trading activities.

---

## 2. Terms of Service

### 2.1 Account Eligibility & Security
1. **Eligibility:** Users must be at least 18 years of age or legally competent to enter into binding contractual obligations.
2. **Accurate Data:** Users agree to provide truthful and verifiable registration details, including full legal name, active email address, and valid WhatsApp phone number.
3. **Credential Safeguard:** Users maintain sole responsibility for preserving account password confidentiality and all actions initiated under their account credentials.

### 2.2 Single-User Personal License Restrictions
1. Subscriptions grant a **personal, non-exclusive, revocable, and non-transferable single-user license**.
2. **Prohibition of Account Sharing:** Subleasing, sharing login credentials, pooling access among multiple parties, or concurrent unauthorized multi-device access is strictly prohibited.
3. **Anti-Scraping & Reverse Engineering:** Automated data extraction (crawling, scraping, API query abuse), code decompilation, reverse engineering of machine learning models, or unauthorized reproduction of UI design systems is strictly unlawful.
4. **Prohibition of Signal Reselling:** Redistributing, publishing, broadcast-sharing, or commercializing AIDSS probability outputs or risk alerts through public or paid subscription groups (e.g., Telegram, Discord, WhatsApp Signal channels) without prior written enterprise authorization is prohibited.
5. **Remedies for Breach:** Infringement will trigger immediate, non-refundable account termination, without prejudice to statutory damage claims under applicable electronic transaction laws.

---

## 3. Subscription, Billing & Refund Policy

### 3.1 Pricing Tiers
1. **Monthly Subscription:** IDR 15,000 (30 calendar days active duration).
2. **Annual Subscription:** IDR 150,000 (365 calendar days active duration).
3. Prices are quoted in Indonesian Rupiah (IDR) and remain subject to scheduled revision upon transparent platform notification.

### 3.2 Payment Processing
1. **Automated Gateway (Midtrans):** Real-time activation via Indonesian QRIS and major Bank Virtual Accounts (BCA, Mandiri, BNI, BRI).
2. **Direct Bank Transfer:** Manual wire transfer with receipt slip upload, requiring administrative verification within 24 working hours.

### 3.3 Strict No-Refund Policy
Given that AIDSS provides **instantaneous, irrevocable access to digital analytics and proprietary computational models** upon order fulfillment:
1. **All subscription fees are strictly non-refundable**. No partial refunds, prorated credits, or cancellations apply for reasons including market volatility, subjective dissatisfaction, or non-usage of the software.
2. **Duplicate Transaction Exception:** Refunds are exclusively entertained in substantiated instances of duplicate automated billing caused by technical gateway anomalies. Inquiries must be logged within 3 business days of the incident to `support@aidss.id` supported by formal banking transaction receipts.

---

## 4. Privacy Policy & Data Protection (Indonesian PDP Act No. 27/2022)

AIDSS respects and enforces the privacy rights of its subscribers in full compliance with **Law of the Republic of Indonesia Number 27 of 2022 on Personal Data Protection (PDP Act)**:

### 4.1 Categories of Data Collected
1. **Identity & Contact Records:** Full name, email address, and WhatsApp telephone number. All three are entered by the person signing up and can be changed at any time through `/v1/auth/me`.
2. **Session Records:** On sign-in the app generates a random token and stores only its SHA-256 hash, together with the time it was created and the time it expires. The token itself exists solely in an HttpOnly browser cookie and is never written to the database.
3. **Subscription Records:** The start and end date of each purchased period.

What is **not** collected in this version:

- **No payment data of any kind.** No card numbers, PINs, invoice numbers, payment methods or deposit slips, because there is no billing at all yet.
- **No stored IP addresses or user-agent strings.** The rate limiter reads the client IP to count a budget in the process's memory, and that value is written nowhere.
- **No audit logs and no login timestamps.** The `sessions` table stores creation and expiry times, not a record of who signed in from where.
- **The consent described in §5 is stored in the browser only,** not on the server. No table records who accepted what and when.

This section names what is absent on purpose. Promising to process data that is never collected leaves people entitled to something that cannot be delivered, and makes us look like we collect more than we do.

### 4.2 Purposes of Processing
1. Authenticating the account and tracking the subscription period that is currently running.
2. Deciding whether a request is permitted, by comparing a subscription's end date against the current time.
3. Limiting service abuse and AI model cost through per-IP request budgets.

Not yet present: invoices, confirmation email, WhatsApp messages, and renewal reminders. All of them depend on billing and on notification channels that have not been built.

### 4.3 Data Confidentiality & Subscriber Rights
1. Passwords undergo irreversible, salted cryptographic hashing via **Argon2id** (there is no bcrypt fallback) before persistence.
2. AIDSS **NEVER** sells, trades, or leases personal subscriber records to external brokers, advertising exchanges, or commercial third parties.
3. Subscribers retain the legal right to request inspection, modification, or permanent deletion of their account profile (*Right to be Forgotten*) through verified communication with our data protection team.

---

## 5. Formal User Consent Architecture

Consent is contractually acknowledged and audited via a **Dual-Gate Enforcement System**:

1. **Gate 1 (Checkout Registration Gate):** not implemented. It depends on a checkout screen that does not exist yet.
2. **Gate 2 (In-App Interactive Disclaimer Modal):** implemented.
   * A modal is shown the first time an account reaches any model output: AI Signals, the probability score on a stock's detail page, or the AI Advisor. The stock detail page used to show the same model's score and tier with no modal at all.
   * Acceptance requires pressing **"I Understand & Agree"**, and the modal states that none of the output is official investment advice.
   * After the button is pressed, the acceptance is sent to the server and recorded in `consent_acceptances` with the account id, the version of the text that was shown, and the time.
   * The browser's local marker is namespaced by account id, so one person's acceptance does not carry over to another account in the same browser.
   * The modal says in as many words that the acceptance is recorded on the server.

The browser marker only decides whether the modal appears again. The record is the row: `GET /v1/auth/consent` returns the version last accepted, and an acceptance counts as current only while that version is still the one on screen. When the text changes, an acceptance of the old wording stays readable as a record but is not consent to the new one.

---

## 6. Official Contact for Legal & Regulatory Inquiries
* **Corporate Operator:** AIDSS Financial Technology
* **Legal & Privacy Officer:** `legal@aidss.id`
* **Subscriber Support:** `support@aidss.id` / WhatsApp Official Service
* **Website:** `https://app.aidss.id`
