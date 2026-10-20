import { PrismaClient } from "@prisma/client";

let _db: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("[db] DATABASE_URL is not set.");
    }
    // Append connection params for Neon compatibility:
    // - connection_limit=1: serverless functions should use 1 connection
    // - pool_timeout=30: wait up to 30s for a connection (Neon wake-up)
    // - connect_timeout=30: wait up to 30s for TCP connection (Neon wake-up)
    // - pgbouncer=true: use PgBouncer connection pooling (Neon requires this)
    let url = process.env.DATABASE_URL;
    if (!url.includes("connection_limit=") && !url.includes("pgbouncer=")) {
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}connection_limit=1&pool_timeout=30&connect_timeout=30&pgbouncer=true`;
    }
    _db = new PrismaClient({
      log: ["warn", "error"],
      datasources: { db: { url } },
    });
  }
  return _db;
}

export const db = getClient();
