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
import { db } from "./db";

let _providerEnumChecked = false;
let _providerEnumPromise: Promise<void> | null = null;
let _providerEnumAttempts = 0;
const MAX_ENUM_ATTEMPTS = 3;

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
      // CRITICAL: Do NOT re-throw. If this throws, the error escapes the
      // API handler (the guard is outside the handler's try block), and
      // Vercel returns an empty body — the frontend then fails with
      // "Unexpected end of JSON input".
      //
      // Instead, log the FULL error (stack + message) so the real cause
      // shows up in `next dev` console / Vercel logs, and mark as checked
      // so we don't retry on EVERY request. The actual Prisma query will
      // fail with a proper JSON error if the column is still TEXT — that
      // error is caught by the handler's try/catch.
      _providerEnumAttempts++;
      const errObj = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[ensureProviderStatusEnum] Attempt ${_providerEnumAttempts}/${MAX_ENUM_ATTEMPTS} failed:`,
        errObj.message,
        "\n[ensureProviderStatusEnum] Full error:\n",
        errObj.stack || errObj
      );
      if (_providerEnumAttempts >= MAX_ENUM_ATTEMPTS) {
        console.error(`[ensureProviderStatusEnum] Giving up after ${MAX_ENUM_ATTEMPTS} attempts — Provider.status column may still be TEXT. Subsequent Prisma queries will fail with: 'operator does not exist: text = "ProviderStatus"' (42883). To fix the DB directly, run scripts/fix-provider-status.sql via psql.`);
        _providerEnumChecked = true;
      }
      // Reset the promise so the next call can retry (up to MAX_ENUM_ATTEMPTS).
      _providerEnumPromise = null;
    }
  })();

  await _providerEnumPromise;
}

/**
 * Direct conversion of Provider.status from TEXT to ProviderStatus enum,
 * bypassing any caching in ensureDatabase(). Logs loudly on failure so we
 * can debug if Prisma queries still fail.
 *
 * STRATEGY (order flipped in this commit — Prisma first)
 * ──────────────────────────────────────────────────────
 * Path A (primary): run the ALTER via `db.$executeRawUnsafe` through
 *         Prisma's own connection pool. This is the MOST reliable path
 *         because if Prisma was able to send the `count()` query in the
 *         first place (which it was — that's why the user is seeing the
 *         42883 error), then Prisma's own connection is healthy and can
 *         run the ALTER just fine. Also has no extra TLS/connection
 *         overhead — uses Prisma's already-established pool.
 *
 * Path B (backup): if Path A fails for ANY reason, open a fresh
 *         `pg.Client` against DATABASE_URL and run the ALTER. Useful if
 *         Prisma's connection is somehow restricted (e.g. transaction
 *         mode) — but rarely needed in practice.
 *
 * Why the flip: the original order (pg.Client first) had a 30s connection
 * timeout that blocked the entire API request when pg.Client couldn't
 * connect (stale local .env, unfamiliar SSL host). The Prisma path is
 * effectively free (uses the existing pool) so it should always be first.
 */
async function convertProviderStatusDirectly(): Promise<void> {
  let prismaWorked = false;
  try {
    await convertWithPrisma();
    prismaWorked = true;
  } catch (err) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    console.error(
      `[ensureProviderStatusEnum] Prisma path failed: ${errObj.message}`,
      "\n[ensureProviderStatusEnum] Prisma full error:\n",
      errObj.stack || errObj
    );
  }

  if (!prismaWorked) {
    console.log("[ensureProviderStatusEnum] Falling back to pg.Client (fresh connection)...");
    try {
      await convertWithPgClient();
      console.log("[ensureProviderStatusEnum] pg.Client fallback completed.");
    } catch (err) {
      const errObj = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[ensureProviderStatusEnum] pg.Client fallback also failed: ${errObj.message}`,
        "\n[ensureProviderStatusEnum] pg.Client full error:\n",
        errObj.stack || errObj
      );
      // Re-throw so the outer catch in ensureProviderStatusEnum() sees it
      // and logs the retry attempt. (The outer function still swallows
      // it to preserve the "never throws" contract from commit 7c97bf5.)
      throw errObj;
    }
  }
}

/**
 * Path A — open a fresh pg.Client against DATABASE_URL and run the ALTER.
 */
async function convertWithPgClient(): Promise<void> {
  const { Client } = await import("pg");
  const url = process.env.DATABASE_URL || "";
  const needsSsl = detectSslRequired(url);

  const client = new Client({
    connectionString: url,
    // Short timeout — pg.Client is only the backup path now (Prisma runs
    // first). If pg.Client can't connect in 5s, give up and let the
    // outer catch log it.
    connectionTimeoutMillis: 5000,
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
 * Path B — run the same conversion SQL via Prisma's own connection pool.
 * Used as a fallback when pg.Client can't connect (e.g. stale local
 * DATABASE_URL on a deployed Vercel function, or unfamiliar SSL host).
 */
async function convertWithPrisma(): Promise<void> {
  // Create the ProviderStatus enum type (idempotent).
  await db.$executeRawUnsafe(
    `DO $$ BEGIN CREATE TYPE "ProviderStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$`
  );

  // Check if Provider table exists.
  const tableCheck = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Provider') as exists`
  );
  if (!tableCheck[0]?.exists) return; // nothing to convert

  // Check Provider.status column type.
  const statusCol = await db.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(
    `SELECT data_type, udt_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'Provider' AND column_name = 'status'
     LIMIT 1`
  );
  if (statusCol.length === 0) return; // column doesn't exist yet

  if (statusCol[0].data_type === 'USER-DEFINED' && statusCol[0].udt_name === 'ProviderStatus') {
    // Already converted — no-op.
    return;
  }

  if (statusCol[0].data_type !== 'text' && statusCol[0].data_type !== 'character varying') {
    console.warn(`[ensureProviderStatusEnum] Prisma fallback: unexpected Provider.status data_type: ${statusCol[0].data_type} (udt_name=${statusCol[0].udt_name}). Skipping.`);
    return;
  }

  console.log(`[ensureProviderStatusEnum] Prisma fallback: Provider.status is ${statusCol[0].data_type} — converting to ProviderStatus enum...`);

  // Normalize bad values, then ALTER.
  await db.$executeRawUnsafe(
    `UPDATE "Provider" SET "status" = 'PENDING' WHERE "status" IS NULL OR "status"::text NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED')`
  );
  await db.$executeRawUnsafe(
    `ALTER TABLE "Provider" ALTER COLUMN "status" TYPE "ProviderStatus" USING "status"::"ProviderStatus"`
  );
  console.log("[ensureProviderStatusEnum] Prisma fallback: Provider.status converted to ProviderStatus enum.");

  // Same for User.role.
  await db.$executeRawUnsafe(
    `DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('POLICE','SUPERUSER','OPERATOR','STAFF'); EXCEPTION WHEN duplicate_object THEN null; END $$`
  );

  const roleCol = await db.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(
    `SELECT data_type, udt_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'role'
     LIMIT 1`
  );
  if (roleCol.length > 0 && (roleCol[0].data_type === 'text' || roleCol[0].data_type === 'character varying')) {
    console.log(`[ensureProviderStatusEnum] Prisma fallback: User.role is ${roleCol[0].data_type} — converting to UserRole enum...`);
    try {
      await db.$executeRawUnsafe(
        `UPDATE "User" SET "role" = 'STAFF' WHERE "role" IS NULL OR "role"::text NOT IN ('POLICE','SUPERUSER','OPERATOR','STAFF')`
      );
      await db.$executeRawUnsafe(
        `ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole"`
      );
      console.log("[ensureProviderStatusEnum] Prisma fallback: User.role converted to UserRole enum.");
    } catch (roleConvErr) {
      console.error("[ensureProviderStatusEnum] Prisma fallback: failed to convert User.role:", roleConvErr instanceof Error ? roleConvErr.message : roleConvErr);
    }
  }
}

/**
 * Detect whether the DATABASE_URL points at a host that requires SSL.
 * Handles:
 *  - Known cloud-Postgres hosts: supabase.co, neon.tech, neon.dbs.host,
 *    aivencloud.com, render.com, *.rds.amazonaws.com, planetscale (although
 *    PS uses MySQL), cleardb, elephantsql.com
 *  - Explicit `sslmode=` URL param: sslmode=require/verify-ca/verify-full
 *    → SSL required. sslmode=disable → SSL disabled.
 *  - Default: no SSL (local Postgres / Docker).
 */
function detectSslRequired(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();

  // Explicit sslmode URL param takes precedence.
  const sslmodeMatch = lower.match(/[?&]sslmode=([^&]+)/);
  if (sslmodeMatch) {
    const mode = sslmodeMatch[1];
    if (mode === 'disable') return false;
    if (mode === 'require' || mode === 'verify-ca' || mode === 'verify-full' || mode === 'prefer') return true;
  }

  // Known cloud-Postgres hostnames.
  const sslHosts = [
    'supabase.co',
    'neon.tech',
    'neon.dbs.host',
    'aivencloud.com',
    'render.com',
    '.rds.amazonaws.com',
    'elephantsql.com',
    'cleardb.com',
    'digitaloceancloud.com',
    'db.heydata.dev',
  ];
  return sslHosts.some(h => lower.includes(h));
}

/**
 * Reset the cached state. Used by tests or when forcing a re-check.
 */
export function resetProviderEnumCheck(): void {
  _providerEnumChecked = false;
  _providerEnumPromise = null;
}
