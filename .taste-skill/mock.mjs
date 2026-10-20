/**
 * Mock API untuk menangkap layar sebelum/sesudah (design-taste-frontend run).
 * Hanya alat perekaman: tidak pernah dipakai oleh sumber aplikasi (R-33),
 * tidak pernah jadi bagian build. Menjawab persis cakupan yang dibutuhkan
 * tiga layar: /auth/me, /subscriptions/pricing, /admin/accounts.
 */
const ADMIN = process.env.MOCK_ADMIN === "1";
const USER = !ADMIN && process.env.MOCK_USER === "1";
// Mode akun yang baru mendaftar: masuk tanpa langganan, untuk menangkap tab
// Langganan & Tagihan saat bentuk deklarasi dan gateway terpasang
// (preselect intent harga dari lembar harga publik).
const NEWUSER = !ADMIN && !USER && process.env.MOCK_NEW_USER === "1";

const ACCOUNT = (role) => ({
  id: "3f2a6c11-0d5e-4a1b-9c77-1f0b2d3e4a55",
  email: role === "admin" ? "operator@aidss.id" : "pengguna@aidss.id",
  full_name: role === "admin" ? "Operator AIDSS" : "Pengguna Contoh",
  phone_number: "081234567890",
  role,
  blocked: false,
  blockedReason: null,
});

const ACCOUNTS = [
  { id: "a1", email: "siti@aidss.id", full_name: "Siti Rahayu", phone_number: "0812", role: "user", blocked: false, blocked_at: null },
  { id: "a2", email: "budi@aidss.id", full_name: "Budi Santoso", phone_number: "0813", role: "admin", blocked: true, blocked_at: "2026-10-01T00:00:00+00:00" },
];

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin ?? "http://localhost:5173",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Cache-Control": "no-store",
});

import { createServer } from "node:http";

const http = createServer((req, res) => {
  const origin = req.headers.origin;
  Object.entries(cors(origin)).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/v1/auth/me") {
    if (ADMIN) return json(200, ACCOUNT("admin"));
    if (USER) return json(200, ACCOUNT("user"));
    if (NEWUSER) return json(200, ACCOUNT("user"));
    return json(401, { detail: "Not authenticated" });
  }
  if (url.pathname === "/v1/subscriptions/pricing") {
    return json(200, { weekly: 15000, monthly: 44000, annual: 252000, updatedAt: "2026-10-10T00:00:00+00:00" });
  }
  if (url.pathname.startsWith("/v1/admin/accounts")) {
    return ADMIN
      ? json(200, { accounts: ACCOUNTS, hasMore: false })
      : json(403, { detail: "Administrator access required." });
  }
  if (url.pathname === "/v1/subscription/current") {
    if (ADMIN) return json(200, { active: true, expiresAt: "2027-01-01T00:00:00Z", daysRemaining: 72 });
    // The subscriber profile owns the in-session run: the shell must read an
    // active subscription or it draws the paywall banner on every screen.
    if (USER) return json(200, { active: true, expiresAt: "2026-11-30T00:00:00Z", daysRemaining: 41 });
    if (NEWUSER) return json(200, { active: false, expiresAt: null, daysRemaining: null, startDate: null });
    return json(403, { detail: "No active subscription." });
  }
  // Login flow for the aux recorder (:5174, VITE_USE_LIVE_API=true). The real
  // backend issues an HttpOnly session cookie; a fake one with the same name
  // and flags keeps /auth/me consistent afterwards.
  if (url.pathname === "/v1/auth/login" && req.method === "POST") {
    res.setHeader("Set-Cookie", "aidss_session=mock-recording; HttpOnly; SameSite=Lax; Path=/");
    return json(200, { account: ACCOUNT(USER ? "user" : ADMIN ? "admin" : "user") });
  }
  // IDX keterbukaan informasi for the news list recording. Filing-style titles
  // against the app's own ticker universe: no publication names, no real-world
  // events — the same class of simulated data every other endpoint here serves.
  if (url.pathname === "/v1/news") {
    const daysBack = Number(url.searchParams.get("daysBack") ?? 7);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const now = Date.now();
    const min = 60_000;
    const RAW_FILINGS = [
      { symbol: "BBCA", jenis: "Keterbukaan Informasi", title: "Perubahan Komposisi Pengurus dan Dewan Pengawas", mins: 24 },
      { symbol: "",     jenis: "Perdagangan",          title: "Ringkasan Saham Aktif dalam Perdagangan Reguler", mins: 42 },
      { symbol: "TLKM", jenis: "Keterbukaan Informasi", title: "Rencana Penggunaan Dana Hasil Penawaran Umum Berkelanjutan", mins: 88 },
      { symbol: "BBRI", jenis: "Keterbukaan Informasi", title: "Distribusi Deviden Akhir Tahun Buku 2025", mins: 150 },
      { symbol: "",     jenis: "Obligasi",             title: "Pembayaran Bunga Obligasi Berkelanjutan Tahap VII", mins: 260 },
      { symbol: "ASII", jenis: "Keterbukaan Informasi", title: "Persetujuan RUPS atas Perubahan Anggaran Dasar", mins: 410 },
      { symbol: "",     jenis: "Perdagangan",          title: "Pencatatan Perdagangan Saham dalam Kondisi Suspen", mins: 640 },
      { symbol: "ICBP", jenis: "Keterbukaan Informasi", title: "Program Buyback yang Berasal dari Dana Cadangan", mins: 1_180 },
      { symbol: "BMRI", jenis: "Keterbukaan Informasi", title: "Kepemilikan Saham oleh Direksi dan Komisaris", mins: 1_700 },
      { symbol: "",     jenis: "Sukuk",                title: "Penawaran Umum Sukuk Berkelanjutan Fase IV", mins: 2_400 },
      { symbol: "ADRO", jenis: "Keterbukaan Informasi", title: "Keterlambatan Penyampaian Laporan Keuangan Periode Q2", mins: 3_900 },
      { symbol: "UNVR", jenis: "Keterbukaan Informasi", title: "Rencana Pemecahan Saham (Stock Split)", mins: 5_500 },
    ];
    const FILINGS = RAW_FILINGS.slice(0, Math.max(1, limit));
    return json(200, {
      source: "idx",
      items: FILINGS.filter(() => daysBack > 0).map((f, i) => ({
        id: `mock-${i}-${f.mins}`,
        title: f.title,
        category: f.jenis,
        symbol: f.symbol,
        publishedAt: new Date(now - f.mins * min).toISOString(),
        url: "",
        source: "IDX",
      })),
    });
  }
  return json(200, []);});

http.listen(8010, () => {
  console.log(`mock api on :8010 (ADMIN=${ADMIN})`);
});
