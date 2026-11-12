import { PrismaClient } from "@prisma/client";

let _db: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("[db] DATABASE_URL is not set.");
    }
    // Use DATABASE_URL as-is. Do NOT override with datasources — the
    // previous override (pgbouncer=true&prepared_statements=false) was
    // causing connection failures on Vercel when combined with Neon's
    // own pooler. The "cached plan must not change result type" (0A000)
    // error is now handled by the shared cache in ensure* helpers — they
    // only run ALTER TABLE on the FIRST request, so prepared statements
    // are safe on all subsequent requests.
    _db = new PrismaClient({ log: ["warn", "error"] });
  }
  return _db;
}

export const db = getClient();
