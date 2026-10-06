# Tetap Raw SQL, Tanpa ORM

Proyek ini memakai SQL mentah + asyncpg, bukan SQLAlchemy/Alembic, dan itu disengaja. ORM pernah tercatat di `requirements.txt` lalu dicabut karena tidak ada satu pun modul yang mengimpornya; transformasi ke multi-user menambah lima tabel dengan foreign key dan check constraint sederhana, dan ORM baru tidak akan terbayar oleh itu.

## Konsekuensi yang harus diketahui pembaca berikutnya

- **`docs/saas-subscription-platform.md` §2.2 salah.** Ia menulis "SQLAlchemy / asyncpg". Bagian itu harus dikoreksi. Tanpa koreksi, pembaca berikutnya akan melihat spec lebih tinggi prioritasnya daripada kode dan "memperbaiki" arah ini ke ORM.
- **Skema harus masuk ke `backend/db/schema.sql`, bukan hanya ke `backend/db/migrations/`.** Alasannya konkret, bukan selera: `backend/docker-compose.yml` menjalankan service `db-init` yang hanya menerapkan `schema.sql`; file di `migrations/` **tidak pernah** dieksekusi oleh compose. Tabel yang hanya hidup di `migrations/0005_*.sql` tidak akan pernah ada di stack yang dibangun ulang, dan kegagalannya senyap.
- **Setiap tabel baru harus masuk ke dua tempat**: `schema.sql` untuk instalasi baru, dan `migrations/` untuk database yang sudah ada. Jalur kedua lewat `python -m db.migrate`, yang menyimpan ledger `schema_migrations` dengan sha256 per file (`backend/db/migrate.py`). Menyalin `schema.sql` mentah ke `migrations/` tidak boleh — ledger akan menandai file sebagai sudah terpasang.
- **Test yang menjaga ini sudah ada**: `backend/tests/test_live_paths.py` mem-parse `schema.sql` saat runtime dan memastikan setiap `FROM`/`JOIN` di modul worker dan service terpecahkan ke tabel atau view yang benar-benar dideklarasikan. Tabel baru otomatis tercakup hanya kalau ada di `schema.sql`.

## Opsi yang ditolak

- **SQLAlchemy async + Alembic** — mengganti `migrate.py` yang sudah bekerja dan tested, menambah dua dependency, untuk lima tabel yang seluruhnya bisa ditulis dalam ~80 baris SQL.
- **ORM hanya untuk tabel SaaS** — dua cara menulis skema yang sama dalam satu repo. Tidak lama kemudian tidak ada lagi yang bisa tahu tabel mana yang dikelola ORM dan mana yang harus lewat `migrate.py`.