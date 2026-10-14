# ADR-0009: Satu kode penolakan per penyebab, di HTTP maupun WebSocket

**Status:** Diterima. Diterapkan.

## Masalah

Backend menolak WebSocket pasar dengan close code `1008` untuk **tiga** penolakan
yang berbeda: tidak terautentikasi, akun diblokir, dan tidak ada langganan aktif.
Hanya `reason` yang membedakannya, dan `reason` adalah kalimat yang ditulis untuk
manusia.

Klien membaca `code`, bukan `reason`. `useLiveMarket` memperlakukan setiap `1008`
sebagai sesi yang tidak berlaku dan memanggil `signalAuthExpired()`.

Akibatnya sebuah akun dengan sesi yang **sah** tapi tanpa langganan keluar dari
akunnya sendiri. Paywall yang seharusnya menahan data justru mengeluarkan orang.
Dan begitu keluar, `useLiveMarket` juga berhenti sejenak, setiap request berikutnya
401, lalu hook melempar error dan RiskView menampilkan "Backend tidak terjangkau,
menampilkan data simulasi" — padahal backend-nya sehat. Satu penolakan menghasilkan
tiga penjelasan yang salah.

Bug ini bertahan karena kombinasi `AUTH_BYPASS=true` (default dev) membuatnya mustahil
dilihat: di lokal `get_current_user` mengembalikan dev principal, gerbang tidak pernah
menyala, dan setiap route berbayar membalas 200.

## Keputusan

**Satu kode penolakan per penyebab, dan thankfully dipisahkan oleh angka, bukan oleh teks.**

| Penolakan | HTTP | WebSocket |
| --- | --- | --- |
| Tidak terautentikasi | 401 | 1008 |
| Akun diblokir | 403 | 1008 |
| Bukan admin di route admin | 403 | — |
| Sesi valid, langganan tidak aktif | **402** | **4403** |

Baris HTTP adalah tambahan terhadap keputusan awal. Semula gerbang menjawab 403,
yang sama dengan akun diblokir dan dengan non-admin — sehingga membaca 403 sebagai
"butuh langganan" memberi tahu **orang yang diblokir** untuk mengecek tagihannya,
dan memberi tahu pengguna biasa bahwa tagihannya adalah sebab halaman admin tidak
terbuka. Bug yang sama dalam arah yang berlawanan. 402 saying from the protocol:
permintaan dipahami, identitasnya benar, dan jawabannya "bayar dulu".

4403 dipilih karena:

- **Tidak dipangkas.** Browser memangkas `CloseEvent.reason` ke 123 byte. Kode numerik
  tidak, jadi tidak pernah bisa terpotong.
- **Tidak bisa berubah karena copy.** Kalimat yang ditulis ulang tidak boleh mengubah
  apa yang dilakukan klien. Kalau pembeda adalah `reason`, maka menyunting
  redaksinya adalah perubahan perilaku tanpa satu pun test yang gagal.
- **Tidak menabrak kode protokol.** Rentang 4000–4999 dicadangkan aplikasi oleh
  spesifikasi WebSocket, jadi 4403 tidak akan pernah disalahartikan sebagai kegagalan
  transport.

`reason` tetap dibawa. Ia dibaca manusia di console, dan test memakainya untuk
memastikan nama langganan ikut disebut. Ia sengaja **bukan** pembeda.

Di sisi HTTP, 402 sekarang diproses di satu tempat — `apiFetch` — dengan pola yang
sudah ada untuk 401: satu event aplikasi, latch agar satu penolakan tidak
menghasilkan delapan toast, dan latch dilepas saat ada request yang sukses.

## Konsekuensi

- `PaywallNotice` muncul di shell, bukan di setiap view. Delapan panel yang menolak
  bersamaan adalah satu fakta tentang akun; mengatakannya delapan kali adalah noise
  yang menyembunyikan satu-satunya hal yang perlu dibaca.
- `AppContext` memegang satu fakta: `subscription`, turunan dari
  `GET /v1/subscription/current`. `locked` **turunkan** dari itu, bukan flag terpisah
  yang menyala saat 403 pertama. Flag dan status adalah dua catatan untuk satu fakta,
  dan keduanya akan berbeda begitu masa aktif berakhir di tab yang terbuka.
- Hook menyimpan `failure: { kind: "locked" | "unreachable" }`, bukan hanya
  `error: string`. Hook menyimpan `error` juga — ia masih dibaca, dan beberapa view
  masih menampilkannya apa adanya.
- Angka simulasi **tetap tampil** di bawah banner yang benar. Markets dan Risk punya
  jalur simulasi yang disengaja dan berlabel; menyembunyikannya adalah keputusan
  produk, bukan perbaikan kejujuran. Yang diperbaiki adalah labelnya.
- `AUTH_BYPASS=true` bersama `PAYWALL_ENABLED=true` sekarang memunculkan peringatan
  saat start. Peringatan, bukan penolakan boot: berhenti boot akan menghentikan kerja
  lokal dan menambah satu alasan lagi gerbang tidak pernah diuji.

## Yang sengaja tidak berubah

- `require_entitlement` tetap. Gerbangnya sudah benar dan sudah teruji.
- Socket **tetap** mencoba menyambung ulang setelah penolakan langganan, dengan jeda
  satu menit. Penolakan itu terminal untuk sambungan itu, tapi bukan untuk akunnya:
  orang bisa berlangganan di tab lain, dan tanpa percobaan ulang lencana akan tetap
  menulis TERKUNCI jauh setelah server mau meloloskannya. 4403 memakai kelambatan
  yang jauh lebih lambat dari ramp 1 detik milik kegagalan transport, karena tidak
  ada yang berubah pada ritme tersebut.
- `PAYWALL_ENABLED` default `true`, dan produksi tetap menolak boot dengan `false`.
- Tidak ada jalur pembelian, tidak ada tombol beli, tidak ada harga baru di layar.
  Harga sudah diputuskan (Rp 15.000/bulan dan Rp 150.000/tahun) dan endpoint publiknya
  sudah dispesifikasikan, keduanya di `docs/saas-subscription-platform.md`. Yang belum
  ada adalah tabel `system_settings` tempat harga itu dibaca — itu Fase 2, dan
  keputusannya bukan milik agen.
- `subscriptions` tetap tanpa kolom status. Masa aktif tetap ditulis sekali di
  `expires_at`, dan akses tetap diturunkan darinya (CONTEXT.md aturan 1).

## Yang paling mudah kembali

Yang paling cepat kembali adalah `reason` jadi pembeda lagi. Kalimat itu bisa berubah dari kalimat yang benar hari ini menjadi kalimat yang salah besok,
tanpa satu pun test yang gagal. Karena itu test memakai angka literal
(`4403`, `1008`) dan bukan konstanta yang diimpor: kalau hanya satu sisi yang diubah,
test harus merah, bukan diam-diam sama.