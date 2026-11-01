/**
 * Centralized table-creation helper.
 *
 * ensureNewTables() calls ensureDatabase() (heavy — ~200 DDL statements).
 * The setupDone flag caches this so it only runs once per cold start.
 *
 * ensureOwnerTables() creates the 3 new owner feature tables. Also cached.
 *
 * ensureGroupBookingTable() and ensureCriticalTables() are STANDALONE
 * table-creation helpers that bypass ensureDatabase() entirely. They use
 * Prisma's $executeRawUnsafe directly. This is critical because
 * ensureDatabase() can silently fail (cached _initDone=true from a previous
 * failed cold start, SSL handshake issue on pg.Client, exception-swallowing
 * EXCEPTION WHEN OTHERS THEN null in TABLES_SQL, etc.). Routes that JOIN to
 * these tables (e.g. /api/reservations LEFT JOIN GroupBooking) MUST call
 * the standalone helpers at the top, OR they 500 with 42P01 'relation
 * "X" does not exist' if the table was never created.
 */
import { ensureDatabase, resetInitFlag } from "./init-db";
import { db } from "./db";

let setupDone = false;
let setupPromise: Promise<void> | null = null;

let _ownerTablesEnsured = false;
export async function ensureOwnerTables(): Promise<void> {
  if (_ownerTablesEnsured) return;
  _ownerTablesEnsured = true;
  try {
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "EndOfDayReport" ("id" TEXT NOT NULL PRIMARY KEY, "reportDate" TEXT NOT NULL, "providerId" TEXT NOT NULL, "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "cashPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "cashRefunds" DOUBLE PRECISION NOT NULL DEFAULT 0, "pettyCashExpenses" DOUBLE PRECISION NOT NULL DEFAULT 0, "expectedCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "countedCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "discrepancy" DOUBLE PRECISION NOT NULL DEFAULT 0, "telebirrPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "cbePayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "cardPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "totalPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "checkins" INTEGER NOT NULL DEFAULT 0, "checkouts" INTEGER NOT NULL DEFAULT 0, "newReservations" INTEGER NOT NULL DEFAULT 0, "cancellations" INTEGER NOT NULL DEFAULT 0, "noShows" INTEGER NOT NULL DEFAULT 0, "signedOffById" TEXT, "signedOffAt" TIMESTAMP(3), "closingShiftId" TEXT, "notes" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "EndOfDayReport_reportDate_providerId_key" UNIQUE ("reportDate", "providerId"))`);
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ShiftHandover" ("id" TEXT NOT NULL PRIMARY KEY, "providerId" TEXT NOT NULL, "shiftDate" TEXT NOT NULL, "shiftType" TEXT NOT NULL DEFAULT 'DAY', "staffStartId" TEXT NOT NULL, "staffEndId" TEXT, "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "closingCash" DOUBLE PRECISION, "discrepancy" DOUBLE PRECISION NOT NULL DEFAULT 0, "handoverNotes" TEXT NOT NULL DEFAULT '', "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3), "signedOffAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProviderMessage" ("id" TEXT NOT NULL PRIMARY KEY, "fromProviderId" TEXT NOT NULL, "toProviderId" TEXT NOT NULL, "message" TEXT NOT NULL, "isRead" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  } catch (err) {
    console.warn("[ensureOwnerTables] Failed (non-blocking):", err instanceof Error ? err.message : err);
  }
}

// ─── Standalone GroupBooking ensure ──────────────────────────────────────────
// WHY THIS EXISTS
// /api/reservations GET does `LEFT JOIN "GroupBooking" gb ON ...`. If the
// GroupBooking table doesn't exist (because ensureDatabase() silently failed
// on a previous cold start and the result was cached), Postgres throws
// 42P01 'relation "GroupBooking" does not exist'. This function creates
// the table directly via Prisma's own connection pool — no dependency on
// pg.Client, no dependency on ensureDatabase()'s _initDone cache flag.
// All columns are TEXT (no enum-type dependency) so the CREATE always
// succeeds regardless of DB state.

let _groupBookingEnsured = false;
export async function ensureGroupBookingTable(): Promise<void> {
  if (_groupBookingEnsured) return;
  _groupBookingEnsured = true;
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "GroupBooking" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "contactName" TEXT NOT NULL DEFAULT '',
        "contactPhone" TEXT NOT NULL DEFAULT '',
        "contactEmail" TEXT NOT NULL DEFAULT '',
        "startDate" TEXT NOT NULL,
        "endDate" TEXT NOT NULL,
        "notes" TEXT NOT NULL DEFAULT '',
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "totalRooms" INTEGER NOT NULL DEFAULT 0,
        "totalGuests" INTEGER NOT NULL DEFAULT 0,
        "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "discountType" TEXT NOT NULL DEFAULT 'AMOUNT',
        "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "providerId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Also ensure the groupBookingId column exists on Reservation (the FK
    // target). Older DBs may not have this column yet — without it, the
    // LEFT JOIN itself fails with 42703 'column r.groupBookingId does
    // not exist'.
    try {
      await db.$executeRawUnsafe(`DO $$ BEGIN ALTER TABLE "Reservation" ADD COLUMN "groupBookingId" TEXT; EXCEPTION WHEN duplicate_column THEN null; END $$`);
    } catch {}
    // Add FK if not exists (idempotent — swallow duplicate_object)
    try {
      await db.$executeRawUnsafe(`DO $$ BEGIN ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_groupBookingId_fkey" FOREIGN KEY ("groupBookingId") REFERENCES "GroupBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$`);
    } catch {}
  } catch (err) {
    // Non-blocking — log the real error so it's debuggable. Reset the flag
    // so the next call can retry.
    _groupBookingEnsured = false;
    console.error("[ensureGroupBookingTable] Failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Standalone ensure for other tables commonly JOINed in raw SQL ─────────
// Same pattern — bypass ensureDatabase() and use Prisma's connection pool.
// Add to this list as more 42P01 errors surface.

let _criticalTablesEnsured = false;
export async function ensureCriticalTables(): Promise<void> {
  if (_criticalTablesEnsured) return;
  _criticalTablesEnsured = true;
  try {
    // GroupBooking is the most common 42P01 culprit (LEFT JOIN'd in
    // /api/reservations GET raw SQL).
    await ensureGroupBookingTable();
  } catch (err) {
    _criticalTablesEnsured = false;
    console.error("[ensureCriticalTables] Failed:", err instanceof Error ? err.message : err);
  }
}

export async function ensureNewTables(): Promise<void> {
  // Always ensure the 3 owner feature tables exist
  await ensureOwnerTables();

  // Always ensure GroupBooking + other critical JOIN targets exist.
  // This bypasses ensureDatabase() entirely — no _initDone cache, no
  // pg.Client dependency. Runs every cold start via Prisma's own pool.
  await ensureCriticalTables();

  if (setupDone) return;
  if (setupPromise) { await setupPromise; return; }

  setupPromise = (async () => {
    try {
      // Reset the init flag so ensureDatabase() re-runs the FULL migration
      // (TABLES_SQL + FKS_SQL + MIGRATIONS_SQL + INDEXES_SQL). This is
      // critical because a previous cold start may have set _initDone=true
      // even though the migration failed (SSL issue, timeout, etc.).
      // Resetting forces a full re-run.
      resetInitFlag();
      await ensureDatabase();
      // ONLY mark setupDone=true if ensureDatabase() succeeded.
      // If it threw, we want the next request to retry the full migration.
      setupDone = true;
    } catch (err) {
      console.error("[ensureNewTables] Migration failed — will retry on next request:", err instanceof Error ? err.message : err);
      // Don't set setupDone=true — let it retry on the next request.
      // Reset setupPromise so the next call can re-attempt.
      setupPromise = null;
      // Re-throw so callers know it failed (they already handle errors)
      throw err;
    }
  })();

  await setupPromise;
}
