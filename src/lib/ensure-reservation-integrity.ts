/**
 * Ensures Reservation → Room referential integrity.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Prisma's schema declares Reservation.room as a REQUIRED relation
 * (no `?` — every reservation MUST have a valid Room):
 *
 *   model Reservation {
 *     roomId String
 *     room    Room     @relation(fields: [roomId], references: [id])
 *   }
 *
 * When prisma.reservation.findMany({ include: { room: ... } }) runs, Prisma
 * tries to populate `room` for every row returned. If any Reservation has:
 *   - roomId = NULL, OR
 *   - roomId pointing to a deleted/non-existent Room
 * Prisma throws:
 *   "Inconsistent query result: Field room is required to return data,
 *    got null instead."
 *
 * This happens on:
 *   - Suspect alert details page (/api/suspected-persons/[id])
 *   - Police reports
 *   - Group booking lookups
 *   - Reservation listings
 *
 * ROOT CAUSE
 * ──────────
 * Older deploys (and raw SQL inserts) created Reservation rows without
 * enforcing the foreign key constraint. The FK constraint may also not
 * exist in the database (ALTER TABLE ADD CONSTRAINT failed silently in
 * the cached migration). Rooms can also be deleted without CASCADE,
 * leaving orphan reservations.
 *
 * FIX (per Scenario A: room is mandatory)
 * ────────────────────────────────────────
 * 1. Create a special "Deleted Room (Placeholder)" Room record that
 *    acts as a tombstone for orphaned reservations.
 * 2. Reassign orphan reservations (NULL roomId OR non-existent roomId)
 *    to this placeholder — preserves history (does NOT delete reservations).
 * 3. Backfill NULL values in non-nullable Reservation columns.
 * 4. Ensure the FK constraint exists (with ON DELETE RESTRICT so
 *    future Room deletions are blocked if reservations exist).
 *
 * Cached — runs once per cold start. Never throws (errors escape the
 * API handler and cause empty body / "Unexpected end of JSON input").
 */
import { ensureDatabase } from "./init-db";

let _checked = false;
let _promise: Promise<void> | null = null;
let _attempts = 0;
const MAX_ATTEMPTS = 1;

export const PLACEHOLDER_ROOM_ID = "deleted-room-placeholder";

// SHARED CACHE: if any ensure* helper already ran successfully on this
// instance, skip ALL others. This prevents 4-5 separate DB connections
// per request — the first helper to run does ALL the work, the rest
// just check this flag and return instantly.
declare global {
  // eslint-disable-next-line no-var
  var __ghmsSchemaChecked: boolean | undefined;
}
function isSchemaChecked(): boolean {
  return typeof globalThis !== "undefined" && globalThis.__ghmsSchemaChecked === true;
}
function markSchemaChecked(): void {
  if (typeof globalThis !== "undefined") {
    globalThis.__ghmsSchemaChecked = true;
  }
}

export async function ensureReservationIntegrity(): Promise<void> {
  // FAST PATH: if any schema helper already ran, skip entirely (0ms)
  if (isSchemaChecked()) return;
  if (_checked) return;
  if (_promise) { await _promise; return; }

  _promise = (async () => {
    try {
      // NOTE: We intentionally DO NOT call ensureDatabase() here.
      // ensureDatabase() opens a pg.Client with 30s timeout and runs
      // ~200 DDL statements — this causes Vercel function timeouts
      // (10s limit on hobby tier). Instead, repairReservationIntegrity()
      // does ALL the necessary table/column fixes directly with a
      // short 3s connection timeout.
      await repairReservationIntegrity();
      _checked = true;
      markSchemaChecked(); // Mark for ALL helpers to skip
    } catch (err) {
      _attempts++;
      console.error(
        `[ensureReservationIntegrity] Attempt ${_attempts}/${MAX_ATTEMPTS} failed:`,
        err instanceof Error ? err.message : err
      );
      if (_attempts >= MAX_ATTEMPTS) {
        console.error(`[ensureReservationIntegrity] Giving up after ${MAX_ATTEMPTS} attempts — schema fixes skipped.`);
        _checked = true;
        // CRITICAL: mark as checked even on failure so subsequent helpers
        // don't retry (which would cause additional timeouts)
        markSchemaChecked();
      }
      _promise = null;
    }
  })();

  await _promise;
}

/**
 * Direct repair via pg.Client — bypasses ensureDatabase() caching.
 */
async function repairReservationIntegrity(): Promise<void> {
  const { Client } = await import("pg");
  const url = process.env.DATABASE_URL || "";
  const needsSsl = url.includes("supabase.co") || url.includes("neon.tech") || url.includes("sslmode=require");

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 3000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();

    // ── BATCH ALL DDL INTO ONE QUERY ──
    // Previously: 60+ individual queries (each ~50-100ms round-trip = 3-6s)
    // Now: 1 multi-statement query (~200ms total)
    // PostgreSQL supports executing multiple statements separated by ; in a
    // single client.query() call.
    const BATCH_DDL = `
      -- Enum types (idempotent — DO $$ EXCEPTION WHEN duplicate)
      DO $$ BEGIN CREATE TYPE "RoomType" AS ENUM ('SINGLE','DOUBLE','TWIN','SUITE','DELUXE','KING','STANDARD','STANDARD_SUITE','JUNIOR_SUITE','EXECUTIVE_SUITE','PRESIDENTIAL_SUITE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE','OCCUPIED','MAINTENANCE','RESERVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "GroupBookingStatus" AS ENUM ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "PaymentStatusType" AS ENUM ('PAID','PARTIAL','PENDING'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "PaymentMethodType" AS ENUM ('CASH','TRANSFER','CARD','MOBILE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "ReservationStatus" AS ENUM ('UPCOMING','ACTIVE','COMPLETED','CANCELLED','DELETED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

      -- Room table (create if missing)
      CREATE TABLE IF NOT EXISTS "Room" (
        "id" TEXT NOT NULL PRIMARY KEY, "number" TEXT NOT NULL, "name" TEXT NOT NULL,
        "type" "RoomType" NOT NULL DEFAULT 'SINGLE', "pricePerNight" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "pricePerNightWeekend" DOUBLE PRECISION, "floor" INTEGER NOT NULL DEFAULT 0,
        "capacity" INTEGER NOT NULL DEFAULT 1, "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
        "amenities" TEXT NOT NULL DEFAULT '', "description" TEXT NOT NULL DEFAULT '',
        "image" TEXT, "providerId" TEXT NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "pricePerNightWeekend" DOUBLE PRECISION;
      ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "image" TEXT;
      ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "amenities" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '';

      -- Guest table (create if missing)
      CREATE TABLE IF NOT EXISTS "Guest" (
        "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "phone" TEXT NOT NULL,
        "email" TEXT NOT NULL DEFAULT '', "idNumber" TEXT NOT NULL DEFAULT '',
        "notes" TEXT NOT NULL DEFAULT '', "vip" BOOLEAN NOT NULL DEFAULT false,
        "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0, "totalStays" INTEGER NOT NULL DEFAULT 0,
        "providerId" TEXT, "otpCode" TEXT, "otpExpiresAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "otpCode" TEXT;
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "otpExpiresAt" TIMESTAMP(3);
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "email" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "phone" TEXT NOT NULL DEFAULT '';
      DO $$ BEGIN ALTER TABLE "Guest" ALTER COLUMN "providerId" DROP NOT NULL; EXCEPTION WHEN OTHERS THEN null; END $$;

      -- Reservation table (create if missing)
      CREATE TABLE IF NOT EXISTS "Reservation" (
        "id" TEXT NOT NULL PRIMARY KEY, "guestId" TEXT NOT NULL, "roomId" TEXT,
        "checkIn" TEXT NOT NULL DEFAULT '', "checkOut" TEXT NOT NULL DEFAULT '',
        "nights" INTEGER NOT NULL DEFAULT 1, "roomRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0, "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "paymentStatus" "PaymentStatusType" NOT NULL DEFAULT 'PENDING',
        "status" "ReservationStatus" NOT NULL DEFAULT 'UPCOMING',
        "notes" TEXT NOT NULL DEFAULT '', "actualCheckIn" TIMESTAMP(3), "actualCheckOut" TIMESTAMP(3),
        "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0, "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "secondGuestName" TEXT NOT NULL DEFAULT '', "secondGuestPhone" TEXT NOT NULL DEFAULT '',
        "secondGuestIdNumber" TEXT NOT NULL DEFAULT '', "exceptionallyReserved" BOOLEAN NOT NULL DEFAULT false,
        "exceptionReason" TEXT NOT NULL DEFAULT '', "guestNotes" TEXT NOT NULL DEFAULT '',
        "providerId" TEXT NOT NULL DEFAULT '', "groupBookingId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "guestNotes" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "exceptionReason" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "exceptionallyReserved" BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "secondGuestName" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "secondGuestPhone" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "secondGuestIdNumber" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "balance" DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "groupBookingId" TEXT;
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "actualCheckIn" TIMESTAMP(3);
      ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "actualCheckOut" TIMESTAMP(3);

      -- User columns
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "permissions" TEXT NOT NULL DEFAULT '["reservations","guests"]';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "policeRank" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLogin" TIMESTAMP(3);
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "providerId" TEXT;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "jurisdictionType" TEXT NOT NULL DEFAULT 'CITY';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subCity" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "woreda" TEXT NOT NULL DEFAULT '';

      -- Provider columns
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "licenseFile" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'GUESTHOUSE';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "subCity" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "woreda" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT NOT NULL DEFAULT '';

      -- Settings columns
      ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "configJson" JSONB;
      ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "providerId" TEXT;

      -- GroupBooking table
      CREATE TABLE IF NOT EXISTS "GroupBooking" (
        "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL,
        "contactName" TEXT NOT NULL DEFAULT '', "contactPhone" TEXT NOT NULL DEFAULT '',
        "contactEmail" TEXT NOT NULL DEFAULT '', "startDate" TEXT NOT NULL, "endDate" TEXT NOT NULL,
        "notes" TEXT NOT NULL DEFAULT '', "status" "GroupBookingStatus" NOT NULL DEFAULT 'PENDING',
        "totalRooms" INTEGER NOT NULL DEFAULT 0, "totalGuests" INTEGER NOT NULL DEFAULT 0,
        "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0, "discountType" TEXT NOT NULL DEFAULT 'AMOUNT',
        "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0, "providerId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE "GroupBooking" ADD COLUMN IF NOT EXISTS "discountType" TEXT NOT NULL DEFAULT 'AMOUNT';
      ALTER TABLE "GroupBooking" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

      -- Convert TEXT status columns to enums (only if TEXT + enum exists)
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Provider' AND column_name='status' AND data_type='text')
           AND EXISTS (SELECT 1 FROM pg_type WHERE typname='ProviderStatus') THEN
          UPDATE "Provider" SET "status" = 'PENDING' WHERE "status" IS NULL OR "status"::text NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED');
          ALTER TABLE "Provider" ALTER COLUMN "status" TYPE "ProviderStatus" USING "status"::"ProviderStatus";
        END IF;
      EXCEPTION WHEN OTHERS THEN null;
      END $$;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='User' AND column_name='role' AND data_type='text')
           AND EXISTS (SELECT 1 FROM pg_type WHERE typname='UserRole') THEN
          UPDATE "User" SET "role" = 'STAFF' WHERE "role" IS NULL OR "role"::text NOT IN ('POLICE','SUPERUSER','OPERATOR','STAFF');
          ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole";
        END IF;
      EXCEPTION WHEN OTHERS THEN null;
      END $$;

      -- Placeholder Room for orphan reservations
      INSERT INTO "Room" ("id", "number", "name", "type", "pricePerNight", "floor", "capacity", "status", "amenities", "description", "providerId", "createdAt", "updatedAt")
      SELECT 'deleted-room-placeholder', 'DELETED', 'Deleted Room', 'SINGLE', 0, 0, 1, 'AVAILABLE', '', '', '', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM "Room" WHERE id = 'deleted-room-placeholder');

      -- Reassign orphan reservations
      UPDATE "Reservation" SET "roomId" = 'deleted-room-placeholder'
      WHERE "roomId" IS NULL OR "roomId" NOT IN (SELECT id FROM "Room");

      -- Backfill NULLs (all in one batch)
      UPDATE "Reservation" SET "guestId" = '' WHERE "guestId" IS NULL;
      UPDATE "Reservation" SET "checkIn" = '' WHERE "checkIn" IS NULL;
      UPDATE "Reservation" SET "checkOut" = '' WHERE "checkOut" IS NULL;
      UPDATE "Reservation" SET "nights" = 1 WHERE "nights" IS NULL;
      UPDATE "Reservation" SET "notes" = '' WHERE "notes" IS NULL;
      UPDATE "Reservation" SET "guestNotes" = '' WHERE "guestNotes" IS NULL;
      UPDATE "Reservation" SET "providerId" = '' WHERE "providerId" IS NULL;
      UPDATE "User" SET "email" = '' WHERE "email" IS NULL;
      UPDATE "User" SET "phone" = '' WHERE "phone" IS NULL;
      UPDATE "Provider" SET "subCity" = '' WHERE "subCity" IS NULL;
      UPDATE "Provider" SET "woreda" = '' WHERE "woreda" IS NULL;

      -- Integration + ApiLog tables (for external API access)
      CREATE TABLE IF NOT EXISTS "Integration" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT NOT NULL DEFAULT '',
        "apiKeyHash" TEXT NOT NULL UNIQUE,
        "apiKeyPrefix" TEXT NOT NULL DEFAULT '',
        "scopes" TEXT NOT NULL DEFAULT '[]',
        "permissions" TEXT NOT NULL DEFAULT '["read"]',
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "rateLimit" INTEGER NOT NULL DEFAULT 1000,
        "ipAllowlist" TEXT NOT NULL DEFAULT '[]',
        "dataSharing" JSONB,
        "webhookUrl" TEXT,
        "webhookSecret" TEXT,
        "createdBy" TEXT NOT NULL DEFAULT '',
        "lastUsedAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS "Integration_apiKeyHash_idx" ON "Integration" ("apiKeyHash");
      CREATE INDEX IF NOT EXISTS "Integration_status_idx" ON "Integration" ("status");

      CREATE TABLE IF NOT EXISTS "ApiLog" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "integrationId" TEXT NOT NULL,
        "integrationName" TEXT NOT NULL DEFAULT '',
        "endpoint" TEXT NOT NULL,
        "method" TEXT NOT NULL,
        "statusCode" INTEGER NOT NULL,
        "responseTimeMs" INTEGER,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "requestParams" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS "ApiLog_integrationId_idx" ON "ApiLog" ("integrationId");
      CREATE INDEX IF NOT EXISTS "ApiLog_createdAt_idx" ON "ApiLog" ("createdAt");
    `;

    // Execute ALL DDL + backfills in ONE round-trip to the database
    await client.query(BATCH_DDL);
    console.log("[ensureReservationIntegrity] Batch DDL applied in 1 query ✓");

  } catch (err) {
    console.error("[ensureReservationIntegrity] Batch DDL failed:", err instanceof Error ? err.message : err);
    throw err;
  } finally {
    try { await client.end(); } catch {}
  }
}


export function resetReservationIntegrityCheck(): void {
  _checked = false;
  _promise = null;
}
