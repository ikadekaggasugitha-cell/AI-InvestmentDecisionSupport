# CONTEXT.md — AIDSS

Glossary untuk AIDSS (AI Investment Decision Support System). Dokumen ini **hanya** kamus istilah: tidak ada keputusan implementasi, arsitektur, nama tabel, atau nama endpoint. Keputusan implementasi ada di `docs/adr/`, status kerja ada di `docs/status.md`.

## Language

**Account**:
Orang yang masuk ke sistem. Menyimpan identitas (nama, email, nomor WhatsApp) dan role. Satu Account ada tanpa keterangan apakah ia membayar atau tidak — status pembayaran bukan bagian dari identitas.
_Avoid_: User, Subscriber, Customer, Akun

**Role**:
Otorisasi fungsional: `user` (bawaan) atau `admin`. Menjawab "bolehkah orang ini memakai fitur sistem ini", bukan "apakah ia membayar".
_Avoid_: Subscriber sebagai nilai role, Plan, Tier, Permission

**Entitlement**:
Hasil evaluasi komersial yang menentukan boleh atau tidaknya Account mengakses data berbayar. Dihitung dari Subscription, tidak pernah disimpan sebagai kolom.
_Avoid_: Role, Subscription (itu entitas, bukan jawabannya), Access

**Plan**:
Konfigurasi komersial yang jemand bisa beli: harga dan masa aktifnya. Plan bukan entitas domain dan tidak punya identitas sendiri; ia berubah tanpa jejak, sehingga tidak boleh menjadi pemilik fakta historis.
_Avoid_: Paket sebagai entitas, Tier

**Subscription**:
Hak akses berbayar yang **dimiliki** oleh satu Account: satu rentang masa aktif, yang tidak pernah berubah setelah dibuat. Ia tidak menyimpan status pembayaran.
_Avoid_: Plan, Billing, Membership, Account

**Subscriber**:
Account yang **pada saat ini** memiliki Subscription yang belum berakhir. Istilah turunan, bukan kolom.
_Avoid_: field `is_subscriber`, nilai role `subscriber`

**Transaction**:
Satu percobaan pembayaran. Mencatat alur uang saja: sudah dibayar, menunggu verifikasi, ditolak, atau kedaluwarsa. Tidak menyatakan apa pun tentang hak akses.
_Avoid_: Invoice, Order, Subscription (yang terakhir sudah dipakai untuk entitas lain)

**Payment Status**:
Alur uang. Berada pada Transaction.
_Avoid_: status Subscription, Access Status

**Access Status**:
Alur akses. **Selalu diturunkan, tidak pernah disimpan.** Subscription aktif berarti tanggal berakhirnya belum lewat.
_Avoid_: kolom status, Payment Status

**Owner**:
Account yang memiliki sebuah resource milik dia sendiri, misalnya portfolio. Satu Account punya banyak resource; satu resource punya tepat satu Owner.
_Avoid_: user_id (itu pengenal, bukan hubungan)

**Operator Tunggal**:
Account yang memakai sistem tanpa Subscription, untuk penggunaan pribadi. Ia tetap sah dan punya akses penuh atas resource-nya sendiri; ia tidak punya Subscription, dan tidak perlu punya.
_Avoid_: akun sementara, akun dummy, admin

## Aturan Yang Mengikat Istilah

1. **Subscription tidak menyimpan status pembayaran.** Pembayaran adalah urusan Transaction. Memindahkan `pending` ke Subscription mencampur dua lifecycle yang berbeda, dan membuat notifikasi serta pembatalan tidak bisa dibedakan.
2. **Subscriber bukan field.** Kalau ia disimpan sebagai kolom, ada dua sumber kebenaran untuk satu fakta — role dan status Subscription — dan keduanya bisa menyimpang.
3. **Payment Status tidak pernah memblokir akses.** Yang menentukan boleh atau tidaknya masuk adalah Access Status. Transaction yang gagal tidak pernah menutup akses.
4. **Account tanpa Subscription tetap sah.** Ia bukan error, bukan kondisi yang perlu diperbaiki. Ia hanya punya lebih sedikit hak akses.
5. **Satu fakta, satu tempat.** Masa aktif Subscription ditentukan oleh tanggal berakhirnya. Status turunan yang disimpan terpisah perlahan akan menyimpang dari tanggal aslinya, dan setiap penyimpangan akan muncul sebagai bug di hari pertama penagihan.
6. **Role dan Entitlement dihitung terpisah.** Keduanya boleh dijawab berbeda untuk satu Account yang sama, dan tidak ada yang boleh mengorbankan yang satu demi yang lain.
7. **Subscription tidak pernah berubah.** Masa aktifnya ditulis sekali saat dibuat. Perpanjangan membuat Subscription baru, bukan menggeser tanggal yang lama. Karena itu Subscription tidak butuh status pembatalan: masa aktif yang sudah ditulis tidak bisa dicabut.
8. **Menonaktifkan akses adalah urusan Account, bukan Subscription.** Akun yang diblokir kehilangan akses seketika. Menyimpan status pembatalan pada Subscription akan menggandakan satu fakta yang sudah dimiliki Account.