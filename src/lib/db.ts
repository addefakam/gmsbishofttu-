import { PrismaClient } from "@prisma/client";

let _db: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("[db] DATABASE_URL is not set.");
    }

    // Append prepared_statements=false to prevent the
    // "cached plan must not change result type" (0A000) error.
    // This is needed because ensure* helpers run ALTER TABLE at runtime,
    // which invalidates PostgreSQL's cached prepared statement plans.
    //
    // We do NOT add pgbouncer=true — it was causing connection failures
    // with Neon's pooler. Neon handles pooling server-side.
    //
    // We only append if not already present (idempotent).
    const safeUrl = url.includes("prepared_statements=false")
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}prepared_statements=false`;

    _db = new PrismaClient({
      log: ["warn", "error"],
      datasources: {
        db: { url: safeUrl },
      },
    });
  }
  return _db;
}

export const db = getClient();
