/**
 * Mock API untuk menangkap layar sebelum/sesudah (design-taste-frontend run).
 * Hanya alat perekaman: tidak pernah dipakai oleh sumber aplikasi (R-33),
 * tidak pernah jadi bagian build. Menjawab persis cakupan yang dibutuhkan
 * tiga layar: /auth/me, /subscriptions/pricing, /admin/accounts.
 */
const ADMIN = process.env.MOCK_ADMIN === "1";
const USER = !ADMIN && process.env.MOCK_USER === "1";

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
    return ADMIN
      ? json(200, { active: true, expiresAt: "2027-01-01T00:00:00Z", daysRemaining: 72 })
      : json(403, { detail: "No active subscription." });
  }
  return json(200, []);
});

http.listen(8010, () => {
  console.log(`mock api on :8010 (ADMIN=${ADMIN})`);
});
