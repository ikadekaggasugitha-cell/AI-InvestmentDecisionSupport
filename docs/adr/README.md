# Architecture Decision Records

Catatan keputusan yang tidak bisa ditebak dari kode. Kalau pembaca lain melihat sesuatu dan berpikir "kenapa begini?", jawabannya ada di sini.

Kolom Status membedakan **diterima** dari **diterapkan**. Keduanya tidak sama, dan confond keduanya adalah cara tercepat membuat dokumen ini berbohong: keputusan yang diterima describe arah, keputusan yang diterapkan describe keadaan.

| # | Keputusan | Diterima | Diterapkan |
| --- | --- | --- | --- |
| *(reservasi)* | Penundaan penagihan dan beta gratis | Belum. Ditulis setelah Fase 2 dan Fase 5 terumuskan | Tidak berlaku |
| [0001](0001-tetap-raw-sql-tanpa-orm.md) | Tetap raw SQL, tanpa ORM | Ya | Ya |
| [0002](0002-ganti-owner-sub-dengan-user-id-uuid.md) | Ganti `owner_sub` dengan `user_id` UUID | Ya | Ya, lewat migrasi `0006_retire_owner_sub.sql` |
| [0004](0004-session-opaque-postgres-hash-fail-closed.md) | Session opaque di Postgres, hash saat disimpan, paywall fail-closed | Ya | Ya, kecuali bagian cache Redis yang dibatalkan |
| [0005](0005-analytics-baca-baris-portfolio.md) | Analytics membaca baris portfolio, bukan konstanta bersama | Ya | Ya, lewat migrasi `0007_clear_seeded_positions.sql`. Baris lama dikosongkan, jadi posisi yang diinput tangan ikut hilang |
| [0006](0006-cookie-samesite-dan-deployment.md) | Session cookie: Lax, Secure di produksi, tanpa Domain | Ya | Ya |
| [0007](0007-lantai-kontras-batas-kontrol.md) | Batas kontrol punya lantai kontras; pembatas tidak | Ya | Ya |

Nomor 0003 sengaja dilewati. Slot itu dipesan untuk keputusan penundaan penagihan, dan akan diisi ketika batas Fase 2 benar-benar digambar — menulisnya sekarang akan mencatat batasan yang belum ada. Angka pada label di tabel selalu sama dengan angka pada nama filenya, jadi membacanya tidak perlu menebak.

Cara menulis ADR baru: salicinan format dari salah satu file di sini. Yang layak jadi ADR hanya keputusan yang sulit dibalik, yang akan membingungkan pembaca di masa depan, dan yang lahir dari trade-off sungguhan. Keputusan lain cukup satu baris di `docs/status.md`.

Status pekerjaan yang sedang dikerjakan ada di [../status.md](../status.md). Istilah domain ada di [../../CONTEXT.md](../../CONTEXT.md).