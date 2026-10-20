import { PrismaClient } from "@prisma/client";

let _db: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("[db] DATABASE_URL is not set.");
    }
    let url = process.env.DATABASE_URL;

    // Strip ALL existing query params and replace with our own.
    // This ensures consistent behavior regardless of what's in the env var.
    // We do NOT use pgbouncer=true — it breaks Prisma's prepared statements
    // and is not needed if the DATABASE_URL already uses Neon's pooler
    // endpoint (-pooler in hostname). If using the direct endpoint,
    // pgbouncer=true would cause "prepared statement does not exist" errors.
    try {
      const parsed = new URL(url);
      parsed.search = "connection_limit=1&pool_timeout=30&connect_timeout=30";
      url = parsed.toString();
    } catch {
      // URL parsing failed — append params directly
      url = `${url.split("?")[0]}?connection_limit=1&pool_timeout=30&connect_timeout=30`;
    }

    _db = new PrismaClient({
      log: ["warn", "error"],
      datasources: { db: { url } },
    });
  }
  return _db;
}

export const db = getClient();
