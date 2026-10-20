import { PrismaClient } from "@prisma/client";

let _db: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("[db] DATABASE_URL is not set.");
    }
    // Use DATABASE_URL as-is. Do NOT override with datasources — this was
    // causing issues because the override was replacing the URL that
    // Prisma's schema already reads from env("DATABASE_URL").
    // Neon's pooler endpoint handles connection pooling server-side.
    // The DATABASE_URL in Vercel already has the right params (set by Neon).
    _db = new PrismaClient({ log: ["warn", "error"] });
  }
  return _db;
}

export const db = getClient();
