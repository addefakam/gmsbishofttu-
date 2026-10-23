/**
 * Ensures the Provider table's enum-typed columns are actually enum-typed
 * (not TEXT) before any Prisma query runs.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Older deploys (and a buggy auth route) created the Provider table with
 * `status TEXT` instead of `status "ProviderStatus" NOT NULL DEFAULT 'PENDING'`.
 * When Prisma runs `db.provider.findMany({ where: { status: "APPROVED" } })`,
 * it sends the parameter bound as the `"ProviderStatus"` enum type:
 *   WHERE "Provider"."status" = $1::"ProviderStatus"
 * If the column is TEXT but the parameter is ProviderStatus, PostgreSQL throws:
 *   operator does not exist: text = "ProviderStatus" (42883)
 *
 * This function converts TEXT-typed status columns to the proper enum type
 * IN-PLACE using ALTER COLUMN TYPE. It's idempotent (no-op if already enum).
 *
 * USAGE
 * ─────
 * Call `await ensureProviderStatusEnum()` at the top of EVERY API route
 * that does `db.provider.*` queries. It's cached so it only runs once per
 * cold start — subsequent calls return immediately.
 *
 * CRITICAL: This is NOT just for `provider.create()` — it's also needed for
 * `provider.count()`, `provider.findMany()`, `provider.findFirst()`,
 * `provider.findUnique()`, `provider.update()`, `provider.delete()`. Any
 * Prisma query on Provider will fail with the same error if the column
 * type doesn't match the enum type Prisma expects.
 */
import { ensureDatabase } from "./init-db";

let _providerEnumChecked = false;
let _providerEnumPromise: Promise<void> | null = null;

export async function ensureProviderStatusEnum(): Promise<void> {
  if (_providerEnumChecked) return;
  if (_providerEnumPromise) { await _providerEnumPromise; return; }

  _providerEnumPromise = (async () => {
    try {
      // First, make sure ensureDatabase() has run. This creates all enum
      // types and runs FIX_ENUM_COLUMNS_SQL (which converts TEXT columns
      // to enum types). If this succeeds, the Provider.status column
      // is already converted.
      await ensureDatabase();

      // Belt-and-suspenders: also do a direct conversion via pg.Client.
      // This catches the case where ensureDatabase()'s cached flag was
      // set to true on a previous cold start (when the migration failed).
      await convertProviderStatusDirectly();
      _providerEnumChecked = true;
    } catch (err) {
      // Reset the promise so the next caller retries.
      _providerEnumPromise = null;
      console.error("[ensureProviderStatusEnum] Failed — will retry on next call:", err instanceof Error ? err.message : err);
      throw err;
    }
  })();

  await _providerEnumPromise;
}

/**
 * Direct conversion of Provider.status from TEXT to ProviderStatus enum,
 * bypassing any caching in ensureDatabase(). Logs loudly on failure so we
 * can debug if Prisma queries still fail.
 */
async function convertProviderStatusDirectly(): Promise<void> {
  const { Client } = await import("pg");
  const url = process.env.DATABASE_URL || "";
  const needsSsl = url.includes("supabase.co") || url.includes("neon.tech") || url.includes("sslmode=require");

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 30000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();

    // Step 1: Create the ProviderStatus enum type if it doesn't exist.
    // (DO $$ ... EXCEPTION WHEN duplicate_object ensures idempotency.)
    try {
      await client.query(`DO $$ BEGIN CREATE TYPE "ProviderStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    } catch (enumErr) {
      console.warn("[ensureProviderStatusEnum] Could not create ProviderStatus enum type:", enumErr instanceof Error ? enumErr.message : enumErr);
    }

    // Step 2: Check if the Provider table exists at all.
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'Provider'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) {
      // Provider table doesn't exist yet — nothing to convert. The auth
      // route or provider registration will create it.
      return;
    }

    // Step 3: Check the current data_type of the status column.
    const statusColCheck = await client.query(`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Provider' AND column_name = 'status'
      LIMIT 1
    `);
    if (statusColCheck.rows.length === 0) {
      // Status column doesn't exist — skip (CREATE TABLE will add it).
      return;
    }

    const statusRow = statusColCheck.rows[0];
    const dataType: string = statusRow.data_type;
    const udtName: string = statusRow.udt_name;

    // data_type='USER-DEFINED' and udt_name='ProviderStatus' means it's
    // already the proper enum type. Skip the conversion.
    if (dataType === 'USER-DEFINED' && udtName === 'ProviderStatus') {
      // Already enum-typed — nothing to do.
      return;
    }

    // If data_type is 'text' or 'character varying', convert it.
    if (dataType !== 'text' && dataType !== 'character varying') {
      console.warn(`[ensureProviderStatusEnum] Unexpected Provider.status data_type: ${dataType} (udt_name=${udtName}). Skipping conversion.`);
      return;
    }

    console.log(`[ensureProviderStatusEnum] Provider.status is ${dataType} — converting to ProviderStatus enum...`);

    // Step 4: Normalize any bad values to 'PENDING' before the type
    // conversion. This prevents ALTER COLUMN TYPE from failing on
    // invalid enum values (NULL, empty string, or unrecognized strings).
    const normalizeResult = await client.query(`
      UPDATE "Provider"
      SET "status" = 'PENDING'
      WHERE "status" IS NULL OR "status"::text NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED')
    `);
    if (normalizeResult.rowCount && normalizeResult.rowCount > 0) {
      console.log(`[ensureProviderStatusEnum] Normalized ${normalizeResult.rowCount} rows with invalid status values to 'PENDING'.`);
    }

    // Step 5: Convert the column type to the enum.
    await client.query(`ALTER TABLE "Provider" ALTER COLUMN "status" TYPE "ProviderStatus" USING "status"::"ProviderStatus"`);
    console.log("[ensureProviderStatusEnum] Provider.status converted to ProviderStatus enum.");

    // Step 6: Also fix the User.role column while we have a connection.
    // (Same issue — Prisma sends $1::"UserRole" but the column might be TEXT.)
    try {
      await client.query(`DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('POLICE','SUPERUSER','OPERATOR','STAFF'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    } catch {}

    const roleColCheck = await client.query(`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'role'
      LIMIT 1
    `);
    if (roleColCheck.rows.length > 0) {
      const roleRow = roleColCheck.rows[0];
      if ((roleRow.data_type === 'text' || roleRow.data_type === 'character varying')) {
        console.log(`[ensureProviderStatusEnum] User.role is ${roleRow.data_type} — converting to UserRole enum...`);
        try {
          await client.query(`UPDATE "User" SET "role" = 'STAFF' WHERE "role" IS NULL OR "role"::text NOT IN ('POLICE','SUPERUSER','OPERATOR','STAFF')`);
          await client.query(`ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole"`);
          console.log("[ensureProviderStatusEnum] User.role converted to UserRole enum.");
        } catch (roleConvErr) {
          console.error("[ensureProviderStatusEnum] Failed to convert User.role:", roleConvErr instanceof Error ? roleConvErr.message : roleConvErr);
        }
      }
    }
  } finally {
    try { await client.end(); } catch {}
  }
}

/**
 * Reset the cached state. Used by tests or when forcing a re-check.
 */
export function resetProviderEnumCheck(): void {
  _providerEnumChecked = false;
  _providerEnumPromise = null;
}
