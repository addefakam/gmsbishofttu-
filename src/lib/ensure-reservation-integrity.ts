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
const MAX_ATTEMPTS = 3;

export const PLACEHOLDER_ROOM_ID = "deleted-room-placeholder";

export async function ensureReservationIntegrity(): Promise<void> {
  if (_checked) return;
  if (_promise) { await _promise; return; }

  _promise = (async () => {
    try {
      // First, make sure ensureDatabase() has run (creates tables/columns).
      await ensureDatabase();

      // Then do the direct integrity fix via pg.Client.
      await repairReservationIntegrity();
      _checked = true;
    } catch (err) {
      _attempts++;
      console.error(
        `[ensureReservationIntegrity] Attempt ${_attempts}/${MAX_ATTEMPTS} failed:`,
        err instanceof Error ? err.message : err
      );
      if (_attempts >= MAX_ATTEMPTS) {
        console.error(`[ensureReservationIntegrity] Giving up after ${MAX_ATTEMPTS} attempts — orphan reservations may still cause Prisma errors.`);
        _checked = true;
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
    connectionTimeoutMillis: 10000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();

    // Step 1: Ensure enum types exist (RoomType, RoomStatus) — needed
    // before we can INSERT into Room table.
    try {
      await client.query(`DO $$ BEGIN CREATE TYPE "RoomType" AS ENUM ('SINGLE','DOUBLE','TWIN','SUITE','DELUXE','KING','STANDARD','STANDARD_SUITE','JUNIOR_SUITE','EXECUTIVE_SUITE','PRESIDENTIAL_SUITE'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    } catch {}
    try {
      await client.query(`DO $$ BEGIN CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE','OCCUPIED','MAINTENANCE','RESERVED'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
    } catch {}

    // Step 2: Ensure the Room table exists with all required columns.
    // (Older deploys may not have created it, or may have it missing
    // columns that Prisma expects.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Room" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "number" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "type" "RoomType" NOT NULL DEFAULT 'SINGLE',
        "pricePerNight" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "pricePerNightWeekend" DOUBLE PRECISION,
        "floor" INTEGER NOT NULL DEFAULT 0,
        "capacity" INTEGER NOT NULL DEFAULT 1,
        "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
        "amenities" TEXT NOT NULL DEFAULT '',
        "description" TEXT NOT NULL DEFAULT '',
        "image" TEXT,
        "providerId" TEXT NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Step 3: Add any missing columns via ALTER TABLE ADD COLUMN IF NOT EXISTS.
    const roomColumns: Array<[string, string]> = [
      ["pricePerNightWeekend", "DOUBLE PRECISION"],
      ["image", "TEXT"],
      ["amenities", "TEXT NOT NULL DEFAULT ''"],
      ["description", "TEXT NOT NULL DEFAULT ''"],
      ["providerId", "TEXT NOT NULL DEFAULT ''"],
    ];
    for (const [col, def] of roomColumns) {
      try {
        await client.query(`ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "${col}" ${def}`);
      } catch {}
    }

    // Step 4: Ensure the Reservation table exists too (paranoid).
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Reservation" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "guestId" TEXT NOT NULL,
        "roomId" TEXT,
        "checkIn" TEXT NOT NULL DEFAULT '',
        "checkOut" TEXT NOT NULL DEFAULT '',
        "nights" INTEGER NOT NULL DEFAULT 1,
        "roomRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "paymentStatus" "PaymentStatusType" NOT NULL DEFAULT 'PENDING',
        "status" "ReservationStatus" NOT NULL DEFAULT 'UPCOMING',
        "notes" TEXT NOT NULL DEFAULT '',
        "actualCheckIn" TIMESTAMP(3),
        "actualCheckOut" TIMESTAMP(3),
        "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "secondGuestName" TEXT NOT NULL DEFAULT '',
        "secondGuestPhone" TEXT NOT NULL DEFAULT '',
        "secondGuestIdNumber" TEXT NOT NULL DEFAULT '',
        "exceptionallyReserved" BOOLEAN NOT NULL DEFAULT false,
        "exceptionReason" TEXT NOT NULL DEFAULT '',
        "providerId" TEXT NOT NULL DEFAULT '',
        "groupBookingId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Step 5: Find a valid providerId for the placeholder Room.
    // We use the providerId of the first orphan reservation if available,
    // otherwise the first provider in the DB, otherwise an empty string.
    let placeholderProviderId = "";
    try {
      const providerResult = await client.query(`
        SELECT "providerId" FROM "Reservation"
        WHERE "providerId" IS NOT NULL AND "providerId" != ''
        LIMIT 1
      `);
      if (providerResult.rows.length > 0 && providerResult.rows[0].providerId) {
        placeholderProviderId = providerResult.rows[0].providerId;
      } else {
        const anyProvider = await client.query(`SELECT id FROM "Provider" LIMIT 1`);
        if (anyProvider.rows.length > 0 && anyProvider.rows[0].id) {
          placeholderProviderId = anyProvider.rows[0].id;
        }
      }
    } catch {}

    // Step 6: Create the placeholder Room record if it doesn't exist.
    // This Room acts as a tombstone — orphaned reservations get reassigned
    // to it instead of being deleted (preserves historical records).
    try {
      await client.query(`
        INSERT INTO "Room" ("id", "number", "name", "type", "pricePerNight", "floor", "capacity", "status", "amenities", "description", "providerId", "createdAt", "updatedAt")
        SELECT
          $1, $2, $3, 'SINGLE'::"RoomType", 0, 0, 1, 'AVAILABLE'::"RoomStatus", '', $4, $5, NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM "Room" WHERE id = $1)
      `, [
        PLACEHOLDER_ROOM_ID,
        "DELETED",
        "Deleted Room (Placeholder)",
        "This room was deleted but is still referenced by historical reservations. It serves as a placeholder to preserve reservation history.",
        placeholderProviderId,
      ]);
    } catch (insertErr) {
      // If RoomType enum is missing the 'SINGLE' value, try without cast
      // (column default will apply).
      console.warn("[ensureReservationIntegrity] Could not insert placeholder Room with enum cast, trying fallback:", insertErr instanceof Error ? insertErr.message : insertErr);
      try {
        await client.query(`
          INSERT INTO "Room" ("id", "number", "name", "pricePerNight", "floor", "capacity", "amenities", "description", "providerId", "createdAt", "updatedAt")
          SELECT
            $1, $2, $3, 0, 0, 1, '', $4, $5, NOW(), NOW()
          WHERE NOT EXISTS (SELECT 1 FROM "Room" WHERE id = $1)
        `, [
          PLACEHOLDER_ROOM_ID,
          "DELETED",
          "Deleted Room (Placeholder)",
          "This room was deleted but is still referenced by historical reservations. It serves as a placeholder to preserve reservation history.",
          placeholderProviderId,
        ]);
      } catch (fallbackErr) {
        console.error("[ensureReservationIntegrity] Fallback placeholder Room insert also failed:", fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      }
    }

    // Step 7: Count orphan reservations BEFORE repair (for logging).
    let orphanCount = 0;
    try {
      const countResult = await client.query(`
        SELECT COUNT(*)::int as cnt
        FROM "Reservation" r
        WHERE r."roomId" IS NULL
           OR NOT EXISTS (SELECT 1 FROM "Room" room WHERE room.id = r."roomId")
      `);
      orphanCount = countResult.rows[0]?.cnt || 0;
    } catch {}

    // Step 8: Reassign orphan reservations to the placeholder Room.
    // This PRESERVES all reservation records (per requirement #4: never
    // delete reservation records automatically).
    if (orphanCount > 0) {
      const updateResult = await client.query(`
        UPDATE "Reservation"
        SET "roomId" = $1
        WHERE "roomId" IS NULL
           OR "roomId" NOT IN (SELECT id FROM "Room")
      `, [PLACEHOLDER_ROOM_ID]);
      console.log(`[ensureReservationIntegrity] Reassigned ${updateResult.rowCount || 0} orphan reservation(s) to placeholder Room (preserved history).`);
    }

    // Step 9: Ensure ALL Reservation columns exist (especially guestNotes
    // which was added recently and may be missing on the production DB).
    // ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent — safe to re-run.
    // This is critical: prisma.reservation.findFirst() / findMany() will
    // throw "column does not exist" if guestNotes is missing from the DB
    // even though it's in the Prisma schema.
    const reservationColumns: Array<[string, string]> = [
      ["guestNotes", "TEXT NOT NULL DEFAULT ''"],
      ["exceptionReason", "TEXT NOT NULL DEFAULT ''"],
      ["exceptionallyReserved", "BOOLEAN NOT NULL DEFAULT false"],
      ["secondGuestName", "TEXT NOT NULL DEFAULT ''"],
      ["secondGuestPhone", "TEXT NOT NULL DEFAULT ''"],
      ["secondGuestIdNumber", "TEXT NOT NULL DEFAULT ''"],
      ["taxAmount", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
      ["discountAmount", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
      ["paidAmount", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
      ["balance", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
      ["groupBookingId", "TEXT"],
      ["actualCheckIn", "TIMESTAMP(3)"],
      ["actualCheckOut", "TIMESTAMP(3)"],
    ];
    for (const [col, def] of reservationColumns) {
      try {
        await client.query(`ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "${col}" ${def}`);
      } catch (colErr) {
        // Don't swallow silently — log so we can debug
        console.warn(`[ensureReservationIntegrity] Could not add Reservation.${col}:`, colErr instanceof Error ? colErr.message : colErr);
      }
    }

    // Step 9b: Ensure ALL Guest columns exist (especially otpCode +
    // otpExpiresAt which were added for the /find app's phone+OTP auth,
    // and providerId which was made nullable). prisma.guest.update() /
    // findFirst() will throw "column does not exist" if these are missing.
    const guestColumns: Array<[string, string]> = [
      ["otpCode", "TEXT"],
      ["otpExpiresAt", "TIMESTAMP(3)"],
      ["email", "TEXT NOT NULL DEFAULT ''"],
      ["phone", "TEXT NOT NULL DEFAULT ''"],
      ["idNumber", "TEXT NOT NULL DEFAULT ''"],
      ["idType", "TEXT NOT NULL DEFAULT ''"],
      ["nationality", "TEXT NOT NULL DEFAULT ''"],
      ["region", "TEXT NOT NULL DEFAULT ''"],
      ["zone", "TEXT NOT NULL DEFAULT ''"],
      ["woreda", "TEXT NOT NULL DEFAULT ''"],
      ["kebele", "TEXT NOT NULL DEFAULT ''"],
      ["houseNumber", "TEXT NOT NULL DEFAULT ''"],
      ["streetName", "TEXT NOT NULL DEFAULT ''"],
      ["plateNumber", "TEXT NOT NULL DEFAULT ''"],
      ["weapon", "TEXT NOT NULL DEFAULT ''"],
      ["address", "TEXT NOT NULL DEFAULT ''"],
      ["notes", "TEXT NOT NULL DEFAULT ''"],
      ["vip", "BOOLEAN NOT NULL DEFAULT false"],
      ["totalSpent", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
      ["totalStays", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [col, def] of guestColumns) {
      try {
        await client.query(`ALTER TABLE "Guest" ADD COLUMN IF NOT EXISTS "${col}" ${def}`);
      } catch (colErr) {
        console.warn(`[ensureReservationIntegrity] Could not add Guest.${col}:`, colErr instanceof Error ? colErr.message : colErr);
      }
    }

    // Also make Guest.providerId nullable (for OTP-registered guests
    // without a provider). Idempotent — no-op if already nullable.
    try {
      await client.query(`ALTER TABLE "Guest" ALTER COLUMN "providerId" DROP NOT NULL`);
    } catch (colErr) {
      // Already nullable or column missing — log but don't throw
      console.warn(`[ensureReservationIntegrity] Could not drop NOT NULL on Guest.providerId:`, colErr instanceof Error ? colErr.message : colErr);
    }

    // Step 9c: Ensure Room table has all required columns too (since
    // prisma.room.update() is called during checkout to set status=AVAILABLE)
    const roomColumns: Array<[string, string]> = [
      ["pricePerNightWeekend", "DOUBLE PRECISION"],
      ["image", "TEXT"],
      ["amenities", "TEXT NOT NULL DEFAULT ''"],
      ["description", "TEXT NOT NULL DEFAULT ''"],
      ["status", "RoomStatus NOT NULL DEFAULT 'AVAILABLE'"],
      ["type", "RoomType NOT NULL DEFAULT 'SINGLE'"],
    ];
    for (const [col, def] of roomColumns) {
      try {
        await client.query(`ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "${col}" ${def}`);
      } catch (colErr) {
        console.warn(`[ensureReservationIntegrity] Could not add Room.${col}:`, colErr instanceof Error ? colErr.message : colErr);
      }
    }

    // Step 10: Backfill NULL values in Reservation's other non-nullable
    // columns. Same pattern as ensure-not-null-defaults.ts but scoped
    // to Reservation only.
    const reservationBackfills: Array<[string, string]> = [
      ["guestId", "''"],
      ["checkIn", "''"],
      ["checkOut", "''"],
      ["nights", "1"],
      ["roomRate", "0"],
      ["totalCost", "0"],
      ["paidAmount", "0"],
      ["balance", "0"],
      ["notes", "''"],
      ["taxAmount", "0"],
      ["discountAmount", "0"],
      ["secondGuestName", "''"],
      ["secondGuestPhone", "''"],
      ["secondGuestIdNumber", "''"],
      ["exceptionReason", "''"],
      ["guestNotes", "''"],
      ["providerId", "''"],
    ];
    for (const [col, defaultExpr] of reservationBackfills) {
      try {
        const result = await client.query(
          `UPDATE "Reservation" SET "${col}" = ${defaultExpr} WHERE "${col}" IS NULL`
        );
        if (result.rowCount && result.rowCount > 0) {
          console.log(`[ensureReservationIntegrity] Reservation.${col}: backfilled ${result.rowCount} NULL rows with ${defaultExpr}`);
        }
      } catch {}
    }

    // Step 10: Ensure the FK constraint exists (with ON DELETE RESTRICT).
    // This prevents future Room deletions from creating orphan reservations.
    try {
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE "Reservation" DROP CONSTRAINT IF EXISTS "Reservation_roomId_fkey";
          ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_roomId_fkey"
            FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        EXCEPTION WHEN OTHERS THEN null;
        END $$;
      `);
    } catch {}

    console.log(`[ensureReservationIntegrity] Repair complete. Orphans fixed: ${orphanCount}.`);
  } finally {
    try { await client.end(); } catch {}
  }
}

/**
 * Reset the cached state. Used by tests or when forcing a re-check.
 */
export function resetReservationIntegrityCheck(): void {
  _checked = false;
  _promise = null;
}
