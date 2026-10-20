/**
 * Centralized table-creation helper.
 *
 * ensureNewTables() calls ensureDatabase() (heavy — ~200 DDL statements,
 * cached via setupDone so it only runs once per cold start).
 *
 * ensureOwnerTables() is a lightweight function that creates the 3 new
 * owner feature tables (EndOfDayReport, ShiftHandover, ProviderMessage)
 * on EVERY call — NOT cached. This is necessary because the Prisma Provider
 * model now has relations to these tables, and any Prisma query that
 * touches Provider will crash if they don't exist. On Vercel warm instances
 * where setupDone is already true from a previous deploy, the heavy
 * ensureDatabase() migration is skipped — so these tables never get
 * created. Running 3 CREATE TABLE IF NOT EXISTS on every request is safe
 * (PostgreSQL optimizes it to a catalog lookup, < 1ms per table).
 */
import { ensureDatabase } from "./init-db";
import { db } from "./db";

let setupDone = false;
let setupPromise: Promise<void> | null = null;

/**
 * Creates the 3 owner feature tables if they don't exist.
 * Runs on EVERY call (no caching) — safe because CREATE TABLE IF NOT
 * EXISTS is a no-op when the table already exists (< 1ms in PostgreSQL).
 *
 * This is called by ensureNewTables() automatically. Routes that don't
 * call ensureNewTables (e.g. auth) should call this directly.
 */
export async function ensureOwnerTables(): Promise<void> {
  try {
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "EndOfDayReport" ("id" TEXT NOT NULL PRIMARY KEY, "reportDate" TEXT NOT NULL, "providerId" TEXT NOT NULL, "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "cashPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "cashRefunds" DOUBLE PRECISION NOT NULL DEFAULT 0, "pettyCashExpenses" DOUBLE PRECISION NOT NULL DEFAULT 0, "expectedCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "countedCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "discrepancy" DOUBLE PRECISION NOT NULL DEFAULT 0, "telebirrPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "cbePayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "cardPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "totalPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "checkins" INTEGER NOT NULL DEFAULT 0, "checkouts" INTEGER NOT NULL DEFAULT 0, "newReservations" INTEGER NOT NULL DEFAULT 0, "cancellations" INTEGER NOT NULL DEFAULT 0, "noShows" INTEGER NOT NULL DEFAULT 0, "signedOffById" TEXT, "signedOffAt" TIMESTAMP(3), "closingShiftId" TEXT, "notes" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "EndOfDayReport_reportDate_providerId_key" UNIQUE ("reportDate", "providerId"))`);
  } catch {}
  try {
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ShiftHandover" ("id" TEXT NOT NULL PRIMARY KEY, "providerId" TEXT NOT NULL, "shiftDate" TEXT NOT NULL, "shiftType" TEXT NOT NULL DEFAULT 'DAY', "staffStartId" TEXT NOT NULL, "staffEndId" TEXT, "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "closingCash" DOUBLE PRECISION, "discrepancy" DOUBLE PRECISION NOT NULL DEFAULT 0, "handoverNotes" TEXT NOT NULL DEFAULT '', "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3), "signedOffAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  } catch {}
  try {
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProviderMessage" ("id" TEXT NOT NULL PRIMARY KEY, "fromProviderId" TEXT NOT NULL, "toProviderId" TEXT NOT NULL, "message" TEXT NOT NULL, "isRead" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  } catch {}
}

export async function ensureNewTables(): Promise<void> {
  // Always ensure the 3 owner feature tables exist — this runs on EVERY
  // call, even if setupDone is true. The CREATE TABLE IF NOT EXISTS is
  // < 1ms per table when they already exist (PostgreSQL catalog lookup).
  // This is critical because the Prisma Provider model has relations to
  // these tables, and any query touching Provider crashes if they're
  // missing.
  await ensureOwnerTables();

  if (setupDone) return;
  if (setupPromise) { await setupPromise; return; }

  setupPromise = (async () => {
    try {
      await ensureDatabase();
    } catch (err) {
      console.error("[ensureNewTables] Error:", err);
    } finally {
      setupDone = true;
    }
  })();

  await setupPromise;
}
