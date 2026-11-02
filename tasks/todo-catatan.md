# Task List: Halaman Catatan Publik (`/catatan`)

Rencana: [plan-catatan.md](plan-catatan.md). Keputusan:
[ADR-0013](../docs/adr/0013-catatan-statis-tanpa-draft-legal.md).

Semua task di bawah sudah dikerjakan pada sesi 2026-11-02 dan ditandai selesai
bersama kodenya. Task 5 dan 6 **tidak boleh dipisah** dari Task 1-4: mengubah
`href` sebelum layarnya ada meninggalkan tautan mati di dua layar publik.

Perintah verifikasi:

```bash
npx vitest run src/app/features/public src/app/test
npx tsc --noEmit
npx eslint .
npx prettier --check "src/**/*.{ts,tsx}"
npm run build
```

---

## Fase 1: Isi disepakati

- [x] **Task 1.** Sembilan bagian disetujui, dengan satu baris "dibuktikan oleh"
      untuk masing-masing (lihat tabel di plan). Yang ditolak masuk: angka harga,
      kanal kontak, nama algoritma.
- [x] **Task 2.** `docs/legal-and-consent.md` diputuskan **tidak** dijadikan isi,
      dan alasannya ditulis sebagai ADR-0013, bukan sebagai komentar kode.

## Fase 2: Layarnya

- [x] **Task 3.** `src/app/features/public/PublicNotes.tsx`: topbar bersama
      (logo, dua gerbang masuk, `PublicNavMenu`), hero, sembilan `<article>`
      ber-`id`, `PublicFooter` bersama. Salinan inline `isId ? … : …`; bagian
      disimpan di array `SECTIONS`.
- [x] **Task 4.** Blok `pubnotes-*` di `src/styles/auth.css`: hanya kolom baca
      760px di dalam `.pub-container` (tepi kirinya sejajar hero), hairline
      antar-bagian, `scroll-margin-top` supaya tautan hash tidak tertutup bar.
      Tidak ada hex, tidak ada token baru.

## Fase 3: Titik masuk, sebagai satu perubahan

- [x] **Task 5.** Routing: cabang `location.pathname === '/catatan'` di blok
      signed-out `src/app/App.tsx`, mengikuti preseden `/fitur`. Tidak ada entri
      `<Route>` baru. `onViewNotes` pada layar fitur diubah dari `/#catatan` ke
      `/catatan`, dan `PublicPricing` menerima `onViewNotes` baru.
- [x] **Task 6.** Empat titik masuk dipindah ke layar baru: burger lembar harga,
      burger layar fitur, dan item "Catatan risiko" di kedua footer.
      `<p id="catatan">` di footer **tidak** disentuh.

## Fase 4: Tes

- [x] **Task 7.** Assertion yang mempin perilaku anchor lama diubah dengan
      sengaja, bukan dibuat hijau: `PublicPricing.test.tsx` (burger `Catatan`
      kini `/catatan` dan memanggil handler; "Catatan risiko" `/catatan`),
      `PublicFeatures.test.tsx` (`/#catatan` menjadi `/catatan`).
- [x] **Task 8.** `src/app/features/public/PublicNotes.test.tsx`, 12 tes:
      hero dan sembilan heading dengan anchor masing-masing, menu menawarkan
      Harga + Fitur dan tidak menawarkan dirinya, Escape menutup dan mengembalikan
      fokus, dua gerbang memanggil handler, footer bersama tetap membawa
      penyangkalan dan "Hubungi kami" tetap `held`, locale Inggris, dan tanggal
      revisi tercetak.
- [x] **Task 9.** Empat penjaga khusus halaman: tanpa nama algoritma, tanpa angka
      `Rp`, tanpa nomor/kanal kontak, tanpa glif piktograf.
- [x] **Task 10.** Suite lama tetap hijau: `vitest` 423 tes, `tsc` bersih,
      `eslint` 0 error, `prettier` bersih, `build` sukses tanpa peringatan
      bundle di atas 500 kB.

## Fase 5: Dokumen

- [x] **Task 11.** [ADR-0013](../docs/adr/0013-catatan-statis-tanpa-draft-legal.md)
      dan barisnya di `docs/adr/README.md`.
- [x] **Task 12.** Entri layar publik di `docs/DESIGN.md` dan baris
      "Layar Catatan publik" di `docs/status.md`.

---

## Yang masih terbuka

- [ ] **Utang label.** Bagian "Angka contoh dan angka Anda" menyatakan panel
      berisi contoh membawa label "Data contoh". Audit 2026-11-02 menemukan dua
      pelanggaran dalam harness offline: `Alokasi sektor` di
      `DashboardView.tsx` (memakai `SECTOR_ALLOCATION` tanpa badge, padahal
      panel yang sama di `PortfolioView.tsx` membawa badge) dan seluruh panel
      `RiskView.tsx` (`RISK_DATA`, `STRESS_TESTS`, `SECTOR_EXPOSURE` tanpa
      label). Kalimat di halaman ini sudah ditulis supaya temuan begitu disebut
      cacat, tetapi ia baru benar sepenuhnya setelah labelnya dipasang.
- [ ] **Kanal kontak.** Begitu pemilik menamai satu kanal, tiga tempat berubah
      bersama: `held: true` pada "Hubungi kami" di `PublicPricing.tsx` dan
      `PublicFeatures.tsx`, dan kalimat "Kanal kontak belum dibuka" di bagian
      `status` pada `PublicNotes.tsx`.
- [ ] **Tanggal revisi.** `REVISED` di `PublicNotes.tsx` adalah teks statis dan
      dijaga tes. Setiap perubahan salinan wajib mengubahnya; tes akan gagal kalau
      tanggalnya dibiarkan lama.
