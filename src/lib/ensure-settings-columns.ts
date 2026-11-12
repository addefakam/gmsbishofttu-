/**
 * Ensures the Settings table exists with ALL columns that Prisma expects.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Older deploys created the Settings table without the `configJson` column.
 * `CREATE TABLE IF NOT EXISTS` is a no-op on existing tables, so the column
 * was never added. When Prisma runs `db.settings.findFirst()` it tries to
 * SELECT `configJson` — and PostgreSQL throws:
 *   The column `Settings.configJson` does not exist in the current database.
 *
 * This helper is cached — it only runs once per cold start. Subsequent
 * calls return immediately.
 *
 * USAGE
 * ─────
 * Call `await ensureSettingsColumns()` at the top of every API route
 * that calls `db.settings.*`. Combined with `ensureProviderStatusEnum()`
 * for Provider queries, this covers all the schema drift issues we've
 * seen on the Neon database.
 */
import { ensureDatabase } from "./init-db";

let _settingsChecked = false;
let _settingsPromise: Promise<void> | null = null;
let _settingsAttempts = 0;
const MAX_SETTINGS_ATTEMPTS = 3;

const SETTINGS_COLUMNS: Array<[string, string]> = [
  ["guestHouseName", "TEXT NOT NULL DEFAULT 'Guest House'"],
  ["ownerName", "TEXT NOT NULL DEFAULT ''"],
  ["address", "TEXT NOT NULL DEFAULT ''"],
  ["phone", "TEXT NOT NULL DEFAULT ''"],
  ["email", "TEXT NOT NULL DEFAULT ''"],
  ["currency", "TEXT NOT NULL DEFAULT 'ETB'"],
  ["taxRate", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["language", "TEXT NOT NULL DEFAULT 'en'"],
  ["logo", "TEXT"],
  ["checkInTime", "TEXT NOT NULL DEFAULT '14:00'"],
  ["checkOutTime", "TEXT NOT NULL DEFAULT '12:00'"],
  ["configJson", "JSONB"],
  ["providerId", "TEXT"],
  ["createdAt", "TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP"],
  ["updatedAt", "TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP"],
];


// SHARED CACHE: if ensureReservationIntegrity (or any other helper) already
// ran successfully on this instance, skip entirely. This prevents 4-5
// separate DB connections per request.
declare global {
  // eslint-disable-next-line no-var
  var __ghmsSchemaChecked: boolean | undefined;
}
function isSchemaChecked(): boolean {
  return typeof globalThis !== "undefined" && globalThis.__ghmsSchemaChecked === true;
}

export async function ensureSettingsColumns(): Promise<void> {
  if (_settingsChecked) return;
  if (_settingsPromise) { await _settingsPromise; return; }

  _settingsPromise = (async () => {
    try {
      // First, make sure ensureDatabase() has run. This creates the
      // Settings table if it doesn't exist + adds configJson via ALTER.
      await ensureDatabase();

      // Belt-and-suspenders: also do a direct ALTER via pg.Client.
      // This catches the case where ensureDatabase()'s cached flag was
      // set to true on a previous cold start when the migration failed.
      await addSettingsColumnsDirectly();
      _settingsChecked = true;
    } catch (err) {
      // CRITICAL: Do NOT re-throw. See ensure-provider-enum.ts for the
      // full rationale — short version: throwing escapes the API
      // handler (this guard is outside the try block), Vercel returns
      // an empty body, frontend fails with "Unexpected end of JSON input".
      _settingsAttempts++;
      console.error(
        `[ensureSettingsColumns] Attempt ${_settingsAttempts}/${MAX_SETTINGS_ATTEMPTS} failed:`,
        err instanceof Error ? err.message : err
      );
      if (_settingsAttempts >= MAX_SETTINGS_ATTEMPTS) {
        console.error(`[ensureSettingsColumns] Giving up after ${MAX_SETTINGS_ATTEMPTS} attempts — Settings.configJson may still be missing. Subsequent Prisma queries will fail with their own error.`);
        _settingsChecked = true;
      }
      _settingsPromise = null;
    }
  })();

  await _settingsPromise;
}

/**
 * Direct ALTER TABLE ADD COLUMN IF NOT EXISTS for all Settings columns,
 * bypassing any caching in ensureDatabase().
 */
async function addSettingsColumnsDirectly(): Promise<void> {
  const { Client } = await import("pg");
  const url = process.env.DATABASE_URL || "";
  const needsSsl = url.includes("supabase.co") || url.includes("neon.tech") || url.includes("sslmode=require");

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();

    // Step 1: Create the Settings table if it doesn't exist at all.
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Settings" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "guestHouseName" TEXT NOT NULL DEFAULT 'Guest House',
        "ownerName" TEXT NOT NULL DEFAULT '',
        "address" TEXT NOT NULL DEFAULT '',
        "phone" TEXT NOT NULL DEFAULT '',
        "email" TEXT NOT NULL DEFAULT '',
        "currency" TEXT NOT NULL DEFAULT 'ETB',
        "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "language" TEXT NOT NULL DEFAULT 'en',
        "logo" TEXT,
        "checkInTime" TEXT NOT NULL DEFAULT '14:00',
        "checkOutTime" TEXT NOT NULL DEFAULT '12:00',
        "configJson" JSONB,
        "providerId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Step 2: Add any missing columns. ALTER TABLE ADD COLUMN IF NOT EXISTS
    // is idempotent — safe to run on every cold start.
    for (const [col, def] of SETTINGS_COLUMNS) {
      try {
        await client.query(`ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "${col}" ${def}`);
      } catch (colErr) {
        // Don't swallow silently — log so we can debug if a column type
        // conflicts (e.g. trying to add NOT NULL without default on a
        // non-empty table).
        console.warn(`[ensureSettingsColumns] Could not add Settings.${col}:`, colErr instanceof Error ? colErr.message : colErr);
      }
    }

    // Step 3: Create the providerId index if missing.
    try {
      await client.query(`CREATE INDEX IF NOT EXISTS "Settings_providerId_idx" ON "Settings" ("providerId")`);
    } catch {}

    console.log("[ensureSettingsColumns] Settings table + columns verified.");
  } finally {
    try { await client.end(); } catch {}
  }
}

/**
 * Reset the cached state. Used by tests or when forcing a re-check.
 */
export function resetSettingsCheck(): void {
  _settingsChecked = false;
  _settingsPromise = null;
}
