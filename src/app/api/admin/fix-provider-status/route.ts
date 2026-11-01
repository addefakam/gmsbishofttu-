import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";

/**
 * GET /api/admin/fix-provider-status
 * ----------------------------------------------------------------------------
 * Returns the current state of Provider.status and User.role columns.
 * Useful for diagnosing the recurring 42883 'operator does not exist:
 * text = "ProviderStatus"' error.
 *
 * POST /api/admin/fix-provider-status
 * ----------------------------------------------------------------------------
 * Runs the ALTER TABLE conversion directly via Prisma's $executeRawUnsafe,
 * WITHOUT the silent `EXCEPTION WHEN OTHERS THEN null` swallowing that
 * forceMigrate() uses. Returns the result + new column state.
 *
 * Both endpoints require SUPERUSER auth.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function requireSuperuser(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "Superuser access required." },
          { status: 403 }
        ),
      };
    }
    return { ok: true as const };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: error.message },
          { status: error.statusCode }
        ),
      };
    }
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      ),
    };
  }
}

type ColInfo = { table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string };

async function getColumnState(): Promise<{ columns: ColInfo[]; tables: string[] }> {
  const columns = await db.$queryRawUnsafe<ColInfo[]>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'Provider' AND column_name = 'status')
        OR (table_name = 'User' AND column_name = 'role')
        OR (table_name = 'Room' AND column_name = 'type')
        OR (table_name = 'Room' AND column_name = 'status')
        OR (table_name = 'Reservation' AND column_name = 'status')
      )
    ORDER BY table_name, column_name
  `);

  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name IN ('Provider', 'User', 'Room', 'Reservation')
    ORDER BY table_name
  `);

  return { columns, tables: tables.map((t) => t.table_name) };
}

// ─── GET: diagnostic ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const guard = await requireSuperuser(req);
  if (!guard.ok) return guard.response;

  try {
    const { columns, tables } = await getColumnState();

    const summary = columns.map((c) => ({
      table: c.table_name,
      column: c.column_name,
      type: c.data_type,
      udt: c.udt_name,
      nullable: c.is_nullable,
      is_enum: c.data_type === "USER-DEFINED",
      needs_fix:
        (c.data_type === "text" || c.data_type === "character varying") &&
        ["status", "role", "type", "paymentStatus", "paymentMethod"].includes(c.column_name),
    }));

    return NextResponse.json({
      tables_present: tables,
      columns: summary,
      has_text_enum_mismatch: summary.some((s) => s.needs_fix),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message, stack: error instanceof Error ? error.stack : undefined },
      { status: 500 }
    );
  }
}

// ─── POST: actually run the conversion ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const guard = await requireSuperuser(req);
  if (!guard.ok) return guard.response;

  const steps: Array<{ step: string; status: "ok" | "skipped" | "failed"; message: string }> = [];

  try {
    // Step 1: Create enum types (idempotent).
    try {
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "ProviderStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('POLICE','SUPERUSER','OPERATOR','STAFF'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "RoomType" AS ENUM ('SINGLE','DOUBLE','TWIN','SUITE','DELUXE','KING','STANDARD','STANDARD_SUITE','JUNIOR_SUITE','EXECUTIVE_SUITE','PRESIDENTIAL_SUITE'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE','OCCUPIED','MAINTENANCE','RESERVED'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "ReservationStatus" AS ENUM ('UPCOMING','ACTIVE','COMPLETED','CANCELLED','DELETED'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "PaymentStatusType" AS ENUM ('PAID','PARTIAL','PENDING'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "PaymentMethodType" AS ENUM ('CASH','TRANSFER','CARD','MOBILE'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "NotificationType" AS ENUM ('INFO','WARNING','SUCCESS','ERROR'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "HousekeepingTaskType" AS ENUM ('CLEANING','MAINTENANCE','INSPECTION'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "HousekeepingTaskStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "SuspectSeverity" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      await db.$executeRawUnsafe(`DO $$ BEGIN CREATE TYPE "GroupBookingStatus" AS ENUM ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$`);
      steps.push({ step: "Create enum types", status: "ok", message: "All 12 enum types created (or already existed)." });
    } catch (err) {
      steps.push({ step: "Create enum types", status: "failed", message: err instanceof Error ? err.message : String(err) });
      // Continue — maybe some exist already.
    }

    // Step 2: Provider.status
    try {
      const col = await db.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(`
        SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Provider' AND column_name='status' LIMIT 1
      `);
      if (col.length === 0) {
        steps.push({ step: "Provider.status", status: "skipped", message: "Column doesn't exist." });
      } else if (col[0].data_type === "USER-DEFINED" && col[0].udt_name === "ProviderStatus") {
        steps.push({ step: "Provider.status", status: "skipped", message: "Already enum-typed." });
      } else if (col[0].data_type === "text" || col[0].data_type === "character varying") {
        await db.$executeRawUnsafe(`UPDATE "Provider" SET "status" = 'PENDING' WHERE "status" IS NULL OR "status"::text NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED')`);
        await db.$executeRawUnsafe(`ALTER TABLE "Provider" ALTER COLUMN "status" TYPE "ProviderStatus" USING "status"::"ProviderStatus"`);
        await db.$executeRawUnsafe(`ALTER TABLE "Provider" ALTER COLUMN "status" SET DEFAULT 'PENDING'`);
        steps.push({ step: "Provider.status", status: "ok", message: `Converted from ${col[0].data_type} to ProviderStatus enum.` });
      } else {
        steps.push({ step: "Provider.status", status: "skipped", message: `Unexpected type ${col[0].data_type}/${col[0].udt_name}.` });
      }
    } catch (err) {
      steps.push({ step: "Provider.status", status: "failed", message: err instanceof Error ? err.message : String(err) });
    }

    // Step 3: User.role
    try {
      const col = await db.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(`
        SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='User' AND column_name='role' LIMIT 1
      `);
      if (col.length === 0) {
        steps.push({ step: "User.role", status: "skipped", message: "Column doesn't exist." });
      } else if (col[0].data_type === "USER-DEFINED" && col[0].udt_name === "UserRole") {
        steps.push({ step: "User.role", status: "skipped", message: "Already enum-typed." });
      } else if (col[0].data_type === "text" || col[0].data_type === "character varying") {
        await db.$executeRawUnsafe(`UPDATE "User" SET "role" = 'STAFF' WHERE "role" IS NULL OR "role"::text NOT IN ('POLICE','SUPERUSER','OPERATOR','STAFF')`);
        await db.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole"`);
        steps.push({ step: "User.role", status: "ok", message: `Converted from ${col[0].data_type} to UserRole enum.` });
      } else {
        steps.push({ step: "User.role", status: "skipped", message: `Unexpected type ${col[0].data_type}/${col[0].udt_name}.` });
      }
    } catch (err) {
      steps.push({ step: "User.role", status: "failed", message: err instanceof Error ? err.message : String(err) });
    }

    // Step 4: Room.type
    try {
      const col = await db.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(`
        SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Room' AND column_name='type' LIMIT 1
      `);
      if (col.length === 0) {
        steps.push({ step: "Room.type", status: "skipped", message: "Column doesn't exist." });
      } else if (col[0].data_type === "USER-DEFINED" && col[0].udt_name === "RoomType") {
        steps.push({ step: "Room.type", status: "skipped", message: "Already enum-typed." });
      } else if (col[0].data_type === "text" || col[0].data_type === "character varying") {
        await db.$executeRawUnsafe(`UPDATE "Room" SET "type" = 'STANDARD' WHERE "type" IS NULL OR "type"::text NOT IN ('SINGLE','DOUBLE','TWIN','SUITE','DELUXE','KING','STANDARD','STANDARD_SUITE','JUNIOR_SUITE','EXECUTIVE_SUITE','PRESIDENTIAL_SUITE')`);
        await db.$executeRawUnsafe(`ALTER TABLE "Room" ALTER COLUMN "type" TYPE "RoomType" USING "type"::"RoomType"`);
        steps.push({ step: "Room.type", status: "ok", message: `Converted from ${col[0].data_type} to RoomType enum.` });
      } else {
        steps.push({ step: "Room.type", status: "skipped", message: `Unexpected type ${col[0].data_type}/${col[0].udt_name}.` });
      }
    } catch (err) {
      steps.push({ step: "Room.type", status: "failed", message: err instanceof Error ? err.message : String(err) });
    }

    // Step 5: Room.status
    try {
      const col = await db.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(`
        SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Room' AND column_name='status' LIMIT 1
      `);
      if (col.length === 0) {
        steps.push({ step: "Room.status", status: "skipped", message: "Column doesn't exist." });
      } else if (col[0].data_type === "USER-DEFINED" && col[0].udt_name === "RoomStatus") {
        steps.push({ step: "Room.status", status: "skipped", message: "Already enum-typed." });
      } else if (col[0].data_type === "text" || col[0].data_type === "character varying") {
        await db.$executeRawUnsafe(`UPDATE "Room" SET "status" = 'AVAILABLE' WHERE "status" IS NULL OR "status"::text NOT IN ('AVAILABLE','OCCUPIED','MAINTENANCE','RESERVED')`);
        await db.$executeRawUnsafe(`ALTER TABLE "Room" ALTER COLUMN "status" TYPE "RoomStatus" USING "status"::"RoomStatus"`);
        steps.push({ step: "Room.status", status: "ok", message: `Converted from ${col[0].data_type} to RoomStatus enum.` });
      } else {
        steps.push({ step: "Room.status", status: "skipped", message: `Unexpected type ${col[0].data_type}/${col[0].udt_name}.` });
      }
    } catch (err) {
      steps.push({ step: "Room.status", status: "failed", message: err instanceof Error ? err.message : String(err) });
    }

    // Step 6: Reservation.status
    try {
      const col = await db.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(`
        SELECT data_type, udt_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Reservation' AND column_name='status' LIMIT 1
      `);
      if (col.length === 0) {
        steps.push({ step: "Reservation.status", status: "skipped", message: "Column doesn't exist." });
      } else if (col[0].data_type === "USER-DEFINED" && col[0].udt_name === "ReservationStatus") {
        steps.push({ step: "Reservation.status", status: "skipped", message: "Already enum-typed." });
      } else if (col[0].data_type === "text" || col[0].data_type === "character varying") {
        await db.$executeRawUnsafe(`UPDATE "Reservation" SET "status" = 'UPCOMING' WHERE "status" IS NULL OR "status"::text NOT IN ('UPCOMING','ACTIVE','COMPLETED','CANCELLED','DELETED')`);
        await db.$executeRawUnsafe(`ALTER TABLE "Reservation" ALTER COLUMN "status" TYPE "ReservationStatus" USING "status"::"ReservationStatus"`);
        steps.push({ step: "Reservation.status", status: "ok", message: `Converted from ${col[0].data_type} to ReservationStatus enum.` });
      } else {
        steps.push({ step: "Reservation.status", status: "skipped", message: `Unexpected type ${col[0].data_type}/${col[0].udt_name}.` });
      }
    } catch (err) {
      steps.push({ step: "Reservation.status", status: "failed", message: err instanceof Error ? err.message : String(err) });
    }

    // ── Generic helper to convert any TEXT column to its enum type ──
    // Used for the remaining enum-typed fields. Each call:
    //   1. Normalizes any bad values to a safe default
    //   2. ALTER COLUMN TYPE EnumType USING column::EnumType
    // Idempotent — no-op if already enum-typed.
    const convertTextToEnum = async (
      table: string, column: string, enumType: string,
      validValues: string[], fallbackValue: string,
      stepLabel: string,
      // Some columns are nullable (no NOT NULL constraint) — pass true to allow NULL
      // values to coexist (they'll stay NULL after conversion).
      nullable: boolean = false,
    ) => {
      try {
        const col = await db.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(
          `SELECT data_type, udt_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name='${table}' AND column_name='${column}' LIMIT 1`
        );
        if (col.length === 0) {
          steps.push({ step: stepLabel, status: "skipped", message: "Column doesn't exist." });
          return;
        }
        if (col[0].data_type === "USER-DEFINED" && col[0].udt_name === enumType) {
          steps.push({ step: stepLabel, status: "skipped", message: "Already enum-typed." });
          return;
        }
        if (col[0].data_type !== "text" && col[0].data_type !== "character varying") {
          steps.push({ step: stepLabel, status: "skipped", message: `Unexpected type ${col[0].data_type}/${col[0].udt_name}.` });
          return;
        }
        // Normalize bad values
        const validList = validValues.map(v => `'${v}'`).join(",");
        if (nullable) {
          await db.$executeRawUnsafe(
            `UPDATE "${table}" SET "${column}" = NULL WHERE "${column}" IS NOT NULL AND "${column}"::text NOT IN (${validList})`
          );
        } else {
          await db.$executeRawUnsafe(
            `UPDATE "${table}" SET "${column}" = '${fallbackValue}' WHERE "${column}" IS NULL OR "${column}"::text NOT IN (${validList})`
          );
        }
        await db.$executeRawUnsafe(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "${enumType}" USING "${column}"::"${enumType}"`
        );
        steps.push({ step: stepLabel, status: "ok", message: `Converted from ${col[0].data_type} to ${enumType}.` });
      } catch (err) {
        steps.push({ step: stepLabel, status: "failed", message: err instanceof Error ? err.message : String(err) });
      }
    };

    // Step 7-onwards: all the remaining enum-typed fields
    await convertTextToEnum("Reservation", "paymentStatus", "PaymentStatusType",
      ["PAID", "PARTIAL", "PENDING"], "PENDING", "Reservation.paymentStatus");
    await convertTextToEnum("Reservation", "paymentMethod", "PaymentMethodType",
      ["CASH", "TRANSFER", "CARD", "MOBILE"], "CASH", "Reservation.paymentMethod", /* nullable */ true);
    await convertTextToEnum("DaytimeBooking", "paymentStatus", "PaymentStatusType",
      ["PAID", "PARTIAL", "PENDING"], "PENDING", "DaytimeBooking.paymentStatus");
    await convertTextToEnum("DaytimeBooking", "paymentMethod", "PaymentMethodType",
      ["CASH", "TRANSFER", "CARD", "MOBILE"], "CASH", "DaytimeBooking.paymentMethod", true);
    await convertTextToEnum("DaytimeRoomBooking", "paymentStatus", "PaymentStatusType",
      ["PAID", "PARTIAL", "PENDING"], "PENDING", "DaytimeRoomBooking.paymentStatus");
    await convertTextToEnum("DaytimeRoomBooking", "paymentMethod", "PaymentMethodType",
      ["CASH", "TRANSFER", "CARD", "MOBILE"], "CASH", "DaytimeRoomBooking.paymentMethod", true);
    await convertTextToEnum("DaytimeRoomBooking", "status", "ReservationStatus",
      ["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED", "DELETED"], "UPCOMING", "DaytimeRoomBooking.status");
    await convertTextToEnum("Expense", "paymentMethod", "PaymentMethodType",
      ["CASH", "TRANSFER", "CARD", "MOBILE"], "CASH", "Expense.paymentMethod");
    await convertTextToEnum("Payment", "method", "PaymentMethodType",
      ["CASH", "TRANSFER", "CARD", "MOBILE"], "CASH", "Payment.method");
    await convertTextToEnum("Notification", "type", "NotificationType",
      ["INFO", "WARNING", "SUCCESS", "ERROR"], "INFO", "Notification.type");
    await convertTextToEnum("HousekeepingTask", "type", "HousekeepingTaskType",
      ["CLEANING", "MAINTENANCE", "INSPECTION"], "CLEANING", "HousekeepingTask.type");
    await convertTextToEnum("HousekeepingTask", "status", "HousekeepingTaskStatus",
      ["PENDING", "IN_PROGRESS", "COMPLETED"], "PENDING", "HousekeepingTask.status");
    await convertTextToEnum("SuspectedPerson", "severity", "SuspectSeverity",
      ["LOW", "MEDIUM", "HIGH", "CRITICAL"], "MEDIUM", "SuspectedPerson.severity");
    await convertTextToEnum("GroupBooking", "status", "GroupBookingStatus",
      ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"], "PENDING", "GroupBooking.status");

    // Final state
    const finalState = await getColumnState();

    const anyFailed = steps.some((s) => s.status === "failed");

    return NextResponse.json(
      {
        success: !anyFailed,
        steps,
        final_state: finalState.columns.map((c) => ({
          table: c.table_name,
          column: c.column_name,
          type: c.data_type,
          udt: c.udt_name,
          is_enum: c.data_type === "USER-DEFINED",
        })),
        all_converted: finalState.columns.every(
          (c) => c.data_type === "USER-DEFINED"
        ),
      },
      anyFailed ? { status: 500 } : { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
        steps_so_far: steps,
      },
      { status: 500 }
    );
  }
}
