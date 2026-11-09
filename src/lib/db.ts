import { PrismaClient } from "@prisma/client";

let _db: PrismaClient | null = null;

/**
 * Returns a DATABASE_URL with params that prevent the
 * "cached plan must not change result type" (0A000) error.
 *
 * WHY: Our ensure* helpers (ensureReservationIntegrity, ensureProviderStatusEnum,
 * ensureSettingsColumns, etc.) run ALTER TABLE ADD COLUMN at runtime to fix
 * schema drift. When Prisma uses prepared statements, PostgreSQL caches the
 * query plan BEFORE the ALTER. After the ALTER, the cached plan returns a
 * different result type (new column) → PostgreSQL throws 0A000.
 *
 * FIX: Disable prepared statements so PostgreSQL re-plans every query.
 * This has a small performance cost but eliminates the error entirely.
 *
 * Also sets pgbouncer=true so the connection goes through PgBouncer
 * (required by Neon's pooler endpoint, which most cloud DBs use).
 */
function getSafeDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || "";
  if (!url) return url;

  // Already has the params — don't add them again
  if (url.includes("prepared_statements=false")) {
    return url;
  }

  // Append the params
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}pgbouncer=true&prepared_statements=false&connection_limit=10`;
}

function getClient(): PrismaClient {
  if (!_db) {
    const safeUrl = getSafeDatabaseUrl();
    if (!safeUrl) {
      throw new Error("[db] DATABASE_URL is not set.");
    }

    // Override the datasource URL with the safe version that has
    // prepared_statements=false. This prevents PostgreSQL from caching
    // query plans that would become stale after our runtime ALTER TABLE
    // migrations (ensure* helpers).
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
