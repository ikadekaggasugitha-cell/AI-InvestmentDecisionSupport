**Status: Diterima, sudah diterapkan (migrasi `0007_clear_seeded_positions.sql`).**

Yang benar sekarang: `risk_service`, `portfolio_service`, `market_service`, dan `risk_worker` membaca `lots_json` milik portfolio itu sendiri lewat satu fungsi, `api/services/portfolio_access.load_lots`. Tidak ada lagi modul yang melayani request yang mengimpor `PORTFOLIO_LOTS`.

Empat hal lain ikut berubah, karena semuanya akan menampilkan angka milik orang lain:

- `portfolio_access` tidak lagi mengisi baris baru dengan seed, jadi akun pertama yang mendaftar tidak lagi menerima 10 posisi milik operator.
- `market:snapshot` tidak lagi membawa `portfolioValue`, dan `ingestor/tick_aggregator.py` kehilangan salinan konstanta ketiganya. Proses yang hanya melihat tick harga tidak tahu posisi siapa yang harus dihargai.
- `generate_snapshot` menerima lot dan portfolio id, dan seri intraday dipisah per portfolio. Daftar module-level akan menempelkan nilai rupiah satu akun ke grafik akun berikutnya.
- Migrasi `0007` mengosongkan baris yang sudah ada, karena berhenti mengisi baris baru tidak mengubah baris lama. Konsekuensinya tidak bisa dibatalkan: kolom `lots_json` tidak bisa membedakan seed dari input asli, keduanya ditulis oleh statement yang sama. Di install yang sudah dipakai, jalankan `SELECT lots_json FROM portfolios` lebih dulu.

Portfolio kosong berhenti sebelum komputasi, bukan di sampler: `EmptyPortfolio` di
`risk_service`, `source: "empty"` di `EquityCurveResponse`, dan nilai snapshot yang benar-benar
nol. Sebelum ini, nol dijawab dengan baseline Rp 13,1 miliar.

Bagian di bawah menjelaskan kondisi **sebelum** keputusan ini diterapkan, dan
alasannya. Angka baris di dalamnya sudah bergeser karena kodenya berubah.

Empat modul analitik mengimpor satu konstanta, `PORTFOLIO_LOTS` dari `api/core/holdings.py`, dan menghitung metrik dari konstanta itu: `risk_service.py:161`, `portfolio_service.py:259-268`, `market_service.py:602`, `risk_worker.py:70`. Baris `portfolios.lots_json` yang menyimpan posisi asli user praktis tidak dibaca. Efeknya: ada tepat satu portfolio di seluruh sistem, di-hardcode ke 10 posisi IDX, dan setiap orang yang memakai aplikasi melihat portfolio yang sama.

Konsentrasinya itu disengaja dan tunggal alasannya (`holdings.py:1-24`): isi portfolio pernah hidup di empat modul dan sudah berbeda-beda — optimizer memakai GOTO, risk worker memakai jumlah lot yang lain — sehingga semuanya disatukan ke satu konstanta supaya angka yang tampil tidak lagi bertentangan dengan angka yang dihitung. Memecahkannya tanpa alasan yang jelas akan mengembalikan bug itu.

Jadi konstanta tidak dihapus, tapi diturunkan perannya: ia jadi **seed pengembangan**, bukan sumber kebenaran produksi. Setelah diterapkan, analytics membaca `portfolios.lots_json` dan Account baru hasil auto-provision menerima posisi kosong. Ini yang membuat portofolio benar-benar milik satu Owner, sesuai definisi di `CONTEXT.md`.

## Konsekuensi

- **Empat modul berubah, plus satu worker.** `risk_service`, `portfolio_service`, `market_service`, dan `risk_worker`. Tidak ada jalan pintas: selama satu modul masih membaca konstanta, satu layar dan satu perhitungan akan tetap berbeda.
- **Portfolio kosong harus ditangani, bukan hanya ditampilkan.** Optimizer Black-Litterman dan GARCH/CVaR butuh titik harga yang valid. Kalau lot kosong, jalur itu harus berhenti sebelum komputasi dan mengembalikan state kosong yang jujur — bukan grafik dengan sumbu salah atau error runtime. Ini bukan perubahan UI.
- **Cache per-portfolio sudah dirancang untuk ini**, jadi tidak ada pekerjaan infrastructure baru: kunci Redis `risk:portfolio:{uid}` sudah ada di `api/core/redis_client.py`. Kunci kurva ekuitas ikut diperbaiki — sebelumnya `portfolio:equity:{days}` tanpa portfolio id, yang jadi benar hanya selama semua akun berbagi satu seed.
- **Baris lama yang sudah ada ikut kosong**, kalau backfill tidak membersihkan isi seed-nya. Kalau tidak, Account pertama yang mendaftar akan melihat 10 posisi fabricated milik orang lain.

## Kenapa tidak ada jalan mudah

Menjual yang sama ke semua orang — seed konstanta untuk seluruh sistem — terlihat seperti pilihan paling murah, dan memang satu-satunya yang bisa dikerjakan dalam satu sore. Tapi itu membatalkan dua hal sekaligus: `Owner` di `CONTEXT.md` jadi dekoratif, dan pekerjaan kejujuran data yang sudah dilakukan (menghapus berita fiktif, menghapus identitas karangan, menurunkan Indicator freshness dari indeks array ke waktu nyata) ikut dibatalkan, dengan angka yang terlihat sangat nyata dan sangat salah.