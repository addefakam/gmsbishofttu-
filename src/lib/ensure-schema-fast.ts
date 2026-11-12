/**
 * FAST consolidated schema integrity check.
 *
 * Replaces 4-5 separate ensure* helpers (each opening its own DB
 * connection) with a SINGLE helper that uses ONE connection.
 *
 * Performance:
 *   - Cold start (first request): ~1-2s (one SSL handshake + ~60 queries)
 *   - Warm requests (subsequent): ~0ms (cache flag check, no DB work)
 *
 * vs. previous approach:
 *   - Cold start: ~4-8s (4-5 SSL handshakes + ~100+ queries)
 *   - Warm requests: ~0ms but still checked 4-5 separate cache flags
 *
 * Usage in API routes:
 *   import { ensureSchemaFast } from "@/lib/ensure-schema-fast";
 *   // At top of handler:
 *   try { await ensureSchemaFast(); } catch {}
 *
 * This replaces:
 *   await ensureReservationIntegrity();
 *   await ensureProviderStatusEnum();
 *   await ensureNotNullableDefaults();
 *   await ensureSettingsColumns();
 */
import { ensureDatabase } from "./init-db";

let _checked = false;
let _promise: Promise<void> | null = null;
let _attempts = 0;
const MAX_ATTEMPTS = 3;

export async function ensureSchemaFast(): Promise<void> {
  // FAST PATH: already checked — return instantly (0 DB work)
  if (_checked) return;
  if (_promise) { await _promise; return; }

  _promise = (async () => {
    try {
      // First, run ensureDatabase() — creates tables, enums, FKs, indexes.
      // This is cached internally (runs once per instance).
      await ensureDatabase();

      // Then run the column fixes + backfills in ONE connection.
      await runAllFixesInOneConnection();
      _checked = true;
    } catch (err) {
      _attempts++;
      console.error(`[ensureSchemaFast] Attempt ${_attempts}/${MAX_ATTEMPTS} failed:`, err instanceof Error ? err.message : err);
      if (_attempts >= MAX_ATTEMPTS) {
        // Give up — don't keep retrying on every request (causes slowness)
        _checked = true;
      }
      _promise = null;
    }
  })();

  await _promise;
}

/**
 * Runs ALL column additions + backfills using a SINGLE pg.Client
 * connection (instead of 4-5 separate connections like before).
 */
async function runAllFixesInOneConnection(): Promise<void> {
  const { Client } = await import("pg");
  const url = process.env.DATABASE_URL || "";
  const needsSsl = url.includes("supabase.co") || url.includes("neon.tech") || url.includes("sslmode=require");

  const client = new Client({
    connectionString: url,
    // Short timeout — if we can't connect in 5s, skip (the app still
    // works, queries will fail with a proper error message)
    connectionTimeoutMillis: 5000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();

    // ── Batch ALL DDL into a single multi-statement query ──
    // This is much faster than 60+ separate round-trips.
    // Each statement uses IF NOT EXISTS / EXCEPTION WHEN — idempotent.
    const BATCH_DDL = `
      -- Enum types
      DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('POLICE','SUPERUSER','OPERATOR','STAFF'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "ProviderStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "RoomType" AS ENUM ('SINGLE','DOUBLE','TWIN','SUITE','DELUXE','KING','STANDARD','STANDARD_SUITE','JUNIOR_SUITE','EXECUTIVE_SUITE','PRESIDENTIAL_SUITE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE','OCCUPIED','MAINTENANCE','RESERVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "PaymentStatusType" AS ENUM ('PAID','PARTIAL','PENDING'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "PaymentMethodType" AS ENUM ('CASH','TRANSFER','CARD','MOBILE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "ReservationStatus" AS ENUM ('UPCOMING','ACTIVE','COMPLETED','CANCELLED','DELETED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
      DO $$ BEGIN CREATE TYPE "GroupBookingStatus" AS ENUM ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;

      -- Reservation columns
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

      -- Guest columns
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "otpCode" TEXT;
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "otpExpiresAt" TIMESTAMP(3);
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "email" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "phone" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "idNumber" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';
      DO $$ BEGIN ALTER TABLE "Guest" ALTER COLUMN "providerId" DROP NOT NULL; EXCEPTION WHEN OTHERS THEN null; END $$;

      -- Room columns
      ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "pricePerNightWeekend" DOUBLE PRECISION;
      ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "image" TEXT;
      ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "amenities" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '';

      -- User columns
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "permissions" TEXT NOT NULL DEFAULT '["reservations","guests"]';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "policeRank" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLogin" TIMESTAMP(3);
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "providerId" TEXT;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "jurisdictionType" TEXT NOT NULL DEFAULT 'CITY';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subCity" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "woreda" TEXT NOT NULL DEFAULT '';

      -- Provider columns
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "licenseFile" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'GUESTHOUSE';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "subCity" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "woreda" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "bedCount" INTEGER;
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
      ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "suspendedBy" TEXT NOT NULL DEFAULT '';

      -- Settings columns
      ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "configJson" JSONB;
      ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "providerId" TEXT;

      -- GroupBooking table (create if missing)
      CREATE TABLE IF NOT EXISTS "GroupBooking" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "contactName" TEXT NOT NULL DEFAULT '',
        "contactPhone" TEXT NOT NULL DEFAULT '',
        "contactEmail" TEXT NOT NULL DEFAULT '',
        "startDate" TEXT NOT NULL,
        "endDate" TEXT NOT NULL,
        "notes" TEXT NOT NULL DEFAULT '',
        "status" "GroupBookingStatus" NOT NULL DEFAULT 'PENDING',
        "totalRooms" INTEGER NOT NULL DEFAULT 0,
        "totalGuests" INTEGER NOT NULL DEFAULT 0,
        "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "discountType" TEXT NOT NULL DEFAULT 'AMOUNT',
        "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "providerId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      -- GroupBooking columns
      ALTER TABLE "GroupBooking" ADD COLUMN IF NOT EXISTS "discountType" TEXT NOT NULL DEFAULT 'AMOUNT';
      ALTER TABLE "GroupBooking" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE "GroupBooking" ADD COLUMN IF NOT EXISTS "contactName" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "GroupBooking" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT NOT NULL DEFAULT '';
      ALTER TABLE "GroupBooking" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT NOT NULL DEFAULT '';

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
    `;

    // Run all DDL in one batch (single round-trip to the DB)
    await client.query(BATCH_DDL);

    // ── Backfill NULLs (batch UPDATEs in one query) ──
    const BATCH_BACKFILL = `
      UPDATE "Reservation" SET "guestId" = '' WHERE "guestId" IS NULL;
      UPDATE "Reservation" SET "checkIn" = '' WHERE "checkIn" IS NULL;
      UPDATE "Reservation" SET "checkOut" = '' WHERE "checkOut" IS NULL;
      UPDATE "Reservation" SET "nights" = 1 WHERE "nights" IS NULL;
      UPDATE "Reservation" SET "roomRate" = 0 WHERE "roomRate" IS NULL;
      UPDATE "Reservation" SET "totalCost" = 0 WHERE "totalCost" IS NULL;
      UPDATE "Reservation" SET "notes" = '' WHERE "notes" IS NULL;
      UPDATE "Reservation" SET "guestNotes" = '' WHERE "guestNotes" IS NULL;
      UPDATE "Reservation" SET "providerId" = '' WHERE "providerId" IS NULL;
      UPDATE "User" SET "email" = '' WHERE "email" IS NULL;
      UPDATE "User" SET "phone" = '' WHERE "phone" IS NULL;
      UPDATE "User" SET "subCity" = '' WHERE "subCity" IS NULL;
      UPDATE "User" SET "woreda" = '' WHERE "woreda" IS NULL;
      UPDATE "User" SET "jurisdictionType" = 'CITY' WHERE "jurisdictionType" IS NULL;
      UPDATE "Provider" SET "subCity" = '' WHERE "subCity" IS NULL;
      UPDATE "Provider" SET "woreda" = '' WHERE "woreda" IS NULL;
      UPDATE "Provider" SET "type" = 'GUESTHOUSE' WHERE "type" IS NULL;
      UPDATE "Provider" SET "licenseFile" = '' WHERE "licenseFile" IS NULL;
      UPDATE "Provider" SET "rejectionReason" = '' WHERE "rejectionReason" IS NULL;
      UPDATE "Room" SET "amenities" = '' WHERE "amenities" IS NULL;
      UPDATE "Room" SET "description" = '' WHERE "description" IS NULL;
    `;
    await client.query(BATCH_BACKFILL);

    // ── Placeholder room for orphan reservations ──
    try {
      await client.query(`
        INSERT INTO "Room" ("id", "number", "name", "type", "pricePerNight", "floor", "capacity", "status", "amenities", "description", "providerId", "createdAt", "updatedAt")
        SELECT 'deleted-room-placeholder', 'DELETED', 'Deleted Room (Placeholder)', 'SINGLE', 0, 0, 1, 'AVAILABLE', '', 'Placeholder', '', NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM "Room" WHERE id = 'deleted-room-placeholder')
      `);
      await client.query(`UPDATE "Reservation" SET "roomId" = 'deleted-room-placeholder' WHERE "roomId" IS NULL OR "roomId" NOT IN (SELECT id FROM "Room")`);
    } catch {}

    console.log("[ensureSchemaFast] All schema fixes applied in ONE connection ✓");
  } finally {
    try { await client.end(); } catch {}
  }
}

export function resetSchemaFastCheck(): void {
  _checked = false;
  _promise = null;
}
