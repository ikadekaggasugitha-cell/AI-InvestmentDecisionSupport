# Catatan run app-screen — restyle 3 layar (20-10-2026)

Style yang dihidangkan: **achromatic-ledger** (seed 1203113956, kind finance, light). Redraw tidak ada.
Alasan pilih: "tanpa warna di chrome, satu aksen di momen kunci" = pasangan paling dekat dengan
INENERGY 1 / RHYTHM 2 / MOTION 1 dan identitas "Institutional Finance x Modern Intelligence" di
docs/DESIGN.md. Redraw dengan alasan: tidak ada.

## Wajah (dipilih sebelum markup)
1. **Ground dari dunia produk**: Cool Ivory `#F5F7FA` (biru-abu satu tingkat dari putih). Kartu putih.
2. **All-figure mono**: IBM Plex Mono + tabular-nums untuk setiap angka (harga, tanggal, durasi) —
   keputusan gaya "every figure in mono"; alasan: DESIGN.md §Typography membuat angka jadi produk.
   Chrome teks tetap Inter; display Manrope. Alasan per R-06: mandat brand, bukan pilihan default.
3. **Satu hue di elemen data utama**: Emerald Teal `#0F9D78` hanya di (a) omzet tahunan / caption
   hemat yang dihitung dari harga praktis, (b) elemen aktif satu kontrol per layar. Target < 1%
   piksel berwarna. Chrome: ink; primary action = Midnight Navy `#14243A` (near-black fill dari brand).

## Inventaris subjek
- **Objek**: akun (email, nama, nomor WhatsApp, role, status blokir + waktu), harga paket (mingguan
  15.000 / bulanan 44.000 / tahunan 252.000, sumbernya satu endpoint publik, bisa diubah admin),
  buka-pakai (sinyal, peringatan otomatis, panel risiko, optimasi) -> 4, jalur bayar (Midtrans atau
  transfer manual dari dalam aplikasi).
- **Orang**: pengunjung tanpa sesi yang memutuskan apakah berlangganan (layar login + /harga, besar
  sekali lihat, campuran HP/desktop); operator admin (jarang, desktop, bekerja tabel).
- **Pekerjaan**: paling sering -> masuk; lalu buat akun; baca harga sebelum memutuskan. Operator:
  blokir/buka blokir akun, tetapkan 3 harga, periksa pembayaran.
- **Data nyata**: tiga harga dari server; daftar akun dari server; tiap angka mono/tabular. Tidak ada
  angka karangan. Caption "hemat" dihitung render-time dari harga yang dimuat (baseline bulanan:
  (annual - monthly*12) / (monthly*12)) dan hanya muncul saat ketiga harga bersedia tampil.
- **Elemen tanda tangan** (satu-satunya milik produk ini): tangga harga tiga baris yang dibaca dari
  server dengan langkah "per bulan-ekuivalen" + caption hemat yang dihitung; dan banding AIDSS
  (wordmark + nama panjang di mono kecil) pada panel Midnight Navy layar masuk.

## Pertanyaan utama per layar (satu kalimat, dasar hierarki)
1. **AuthScreen** — "Buat atau masuk kembali ke akun yang membuka harga." Fokus terbesar: form.
   Panel navy memberi nama produk; tanpa ada klaim pasar; info "harga" satu tautan (PricingLink).
   Jejak operator: tautan kecil ke /admin (bukan navigasi kedua, tetap satu ground).
2. **PublicPricing** — "Berapa biaya langganan, dan apa yang dibuka?" Fokus: tangga harga tiga angka
   (Plex Mono, nilai terbesar tahunan sebagai angka utama); setelah itu 4 buka-pakai, catatan jalur
   bayar, satu kontrol masuk/buat akun. Status muat + 503 sudah ada (tanpa Rp 0).
3. **AdminView gerbang** — untuk non-admin: "Siapa yang boleh masuk sini" -> layar menolak yang
   layih (judul + kalimat server + tombol kembali yang nyata). Untuk operator: label mono
   `OPERATOR ACCESS` hanya muncul setelah server membuktikan role (daftar akun 200).

## Batas yang dipegang
- Token theme.css/fonts.css tidak berubah nilai (warna, radius 0.375rem, font).
- Teal bukan putih-atas-teal; teks di atas isian tetap gelap (R-25 / DESIGN.md §Color).
- Tanpa homepage slop: tanpa gradien, tanpa kilau, tanpa bento, tanpa emoji, tanpa iklata kolom
  "tengah paling populer", tanpa pill di atas H1, tanpa panah dekoratif di tiap tombol.
- Em dash dihapus dari teks UI yang saya sentuh (R-02): auth_beta_note + kalimat 503 + catatan bayar.
- Akses: tab-urut tes AuthScreen harus tetap pas (email -> sandi -> kirim -> ganti mode; elemen baru
  WAJIB di akhir dokumen setelah tombol ganti mode); fokus terlihat; target sentuh >= 44px.
- MOTION 1: hanya hover/fokus/wajiyawa; tanpa loop tanpa akhir.

## Laporan keputusan owner
20-10-2026, pemilik mengizinkan melampaui DESIGN.md bila hasil lebih baik. Dipakai untuk: menamai
wai AIDSS di layar admin, tag `OPERATOR ACCESS`, dan keberanian komposisitiga layar. Palet/font/dail
tetap dipatuhi (keputusanertia lebih baik). Nomor WhatsApp [OWNER TO NAME] TIDAK diisi; baris sisWhatsApp tidak
 ditampilkan di tiga layar ini.

## Strictness tes (tetap hijau)
- AuthScreen.test.tsx: urutan tab, toggle "Buat akun", seluruh label, catatan beta, no-emoji, no-img,
  guard /AI-InvestmentDecisionSupport/ (kini tetap lewat, karena guard repo-name identifikasinya).
- PublicPricing.test.tsx: Rp 15.000/44.000/252.000 (format id-ID & en-GB), "Memuat harga", 503 ->
  "tidak dapat dimuat…", 4 butir buka-pakai, tanpa tombol Beli/Bayar, CTA "Masuk atau buat akun".
- AdminView.test.tsx: header persis [Nama, Email, Role, Status, Aksi], 403 -> /Hanya
  administrator/, kosonga tetap "Tidak ada akun", tombol Blokir/Oh buka-blokir per akun, tab nama
  tetap, alert gagal-aksi, pagination.
- App.test.tsx: /login & /signup redirect; /harga utk yang terkunci; /harga kembali ke shell.
