/**
 * Centralized table-creation helper.
 *
 * ensureNewTables() calls ensureDatabase() (heavy — ~200 DDL statements).
 * The setupDone flag caches this so it only runs once per cold start.
 *
 * ensureOwnerTables() creates the 3 new owner feature tables. Also cached.
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

export async function ensureNewTables(): Promise<void> {
  // Always ensure the 3 owner feature tables exist
  await ensureOwnerTables();

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
    } catch (err) {
      console.error("[ensureNewTables] Error:", err);
      // Don't set setupDone=true if the migration failed — let it retry
      // on the next request.
      return;
    } finally {
      setupDone = true;
    }
  })();

  await setupPromise;
}
