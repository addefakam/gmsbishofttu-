/**
 * Auto-fix enum/TEXT column mismatches at runtime.
 *
 * WHY THIS EXISTS
 * The DB has a mix of column types — some enum, some TEXT — because
 * init-db.ts uses CREATE TABLE IF NOT EXISTS (no-op on existing tables).
 * Different DBs end up in different states. The schema (after commit
 * 8b68e19) says all enum-typed fields are enums. If the DB column is
 * still TEXT, Prisma's native db.<model>.<method>() fails with:
 *   42883: operator does not exist: text = "ProviderStatus"
 *
 * This module runs the same conversion SQL as
 * /api/admin/fix-provider-status POST, but is callable from any route
 * when it detects the 42883 error. The route can then retry the query.
 *
 * USAGE
 *   try {
 *     await db.provider.count({ where: { status: "APPROVED" } });
 *   } catch (err) {
 *     if (isEnumOperatorMismatch(err)) {
 *       await autoFixEnumColumns();
 *       // retry the count
 *     } else {
 *       throw err;
 *     }
 *   }
 *
 * Caching: _fixDone flag ensures the fix runs at most once per cold
 * start. Subsequent calls are no-ops. If the fix fails, the flag is
 * reset so the next call can retry.
 */
import { db } from "./db";

let _fixDone = false;
let _fixPromise: Promise<void> | null = null;

/** Detect the 42883 'operator does not exist: text = "Enum"' error. */
export function isEnumOperatorMismatch(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("42883") ||
    msg.includes("operator does not exist") ||
    (msg.includes("does not exist") && msg.includes("text ="))
  );
}

/** Detect the 42804 'column X is of type EnumType but expression is of type text' error. */
export function isEnumCastMismatch(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("42804") ||
    (msg.includes("is of type") && msg.includes("but expression is of type text"))
  );
}

/** True if the error suggests a TEXT/enum column-type mismatch. */
export function isEnumColumnMismatch(err: unknown): boolean {
  return isEnumOperatorMismatch(err) || isEnumCastMismatch(err);
}

/**
 * Run the conversion SQL. Idempotent — safe to call multiple times.
 * Cached per-instance via _fixDone flag.
 *
 * Creates all 12 enum types and converts any TEXT/varchar columns
 * to their proper enum types. Same logic as
 * /api/admin/fix-provider-status POST.
 */
export async function autoFixEnumColumns(): Promise<void> {
  if (_fixDone) return;
  if (_fixPromise) { await _fixPromise; return; }

  _fixPromise = (async () => {
    try {
      // Step 1: Create all enum types (idempotent)
      const enumDefs: Array<[string, string[]]> = [
        ["ProviderStatus", ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]],
        ["UserRole", ["POLICE", "SUPERUSER", "OPERATOR", "STAFF"]],
        ["RoomType", ["SINGLE", "DOUBLE", "TWIN", "SUITE", "DELUXE", "KING", "STANDARD", "STANDARD_SUITE", "JUNIOR_SUITE", "EXECUTIVE_SUITE", "PRESIDENTIAL_SUITE"]],
        ["RoomStatus", ["AVAILABLE", "OCCUPIED", "MAINTENANCE", "RESERVED"]],
        ["ReservationStatus", ["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED", "DELETED"]],
        ["PaymentStatusType", ["PAID", "PARTIAL", "PENDING"]],
        ["PaymentMethodType", ["CASH", "TRANSFER", "CARD", "MOBILE"]],
        ["NotificationType", ["INFO", "WARNING", "SUCCESS", "ERROR"]],
        ["HousekeepingTaskType", ["CLEANING", "MAINTENANCE", "INSPECTION"]],
        ["HousekeepingTaskStatus", ["PENDING", "IN_PROGRESS", "COMPLETED"]],
        ["SuspectSeverity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]],
        ["GroupBookingStatus", ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]],
      ];
      for (const [enumName, values] of enumDefs) {
        const valuesList = values.map(v => `'${v}'`).join(",");
        try {
          await db.$executeRawUnsafe(
            `DO $$ BEGIN CREATE TYPE "${enumName}" AS ENUM (${valuesList}); EXCEPTION WHEN duplicate_object THEN null; END $$`
          );
        } catch { /* ignore — type may already exist */ }
      }

      // Step 2: Convert TEXT columns to their enum types.
      // Each conversion: (a) normalize bad values, (b) ALTER COLUMN TYPE.
      const conversions: Array<{
        table: string; column: string; enumType: string;
        values: string[]; fallback: string; nullable?: boolean;
      }> = [
        { table: "Provider", column: "status", enumType: "ProviderStatus", values: ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"], fallback: "PENDING" },
        { table: "User", column: "role", enumType: "UserRole", values: ["POLICE", "SUPERUSER", "OPERATOR", "STAFF"], fallback: "STAFF" },
        { table: "Room", column: "type", enumType: "RoomType", values: ["SINGLE", "DOUBLE", "TWIN", "SUITE", "DELUXE", "KING", "STANDARD", "STANDARD_SUITE", "JUNIOR_SUITE", "EXECUTIVE_SUITE", "PRESIDENTIAL_SUITE"], fallback: "STANDARD" },
        { table: "Room", column: "status", enumType: "RoomStatus", values: ["AVAILABLE", "OCCUPIED", "MAINTENANCE", "RESERVED"], fallback: "AVAILABLE" },
        { table: "Reservation", column: "status", enumType: "ReservationStatus", values: ["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED", "DELETED"], fallback: "UPCOMING" },
        { table: "Reservation", column: "paymentStatus", enumType: "PaymentStatusType", values: ["PAID", "PARTIAL", "PENDING"], fallback: "PENDING" },
        { table: "Reservation", column: "paymentMethod", enumType: "PaymentMethodType", values: ["CASH", "TRANSFER", "CARD", "MOBILE"], fallback: "CASH", nullable: true },
        { table: "DaytimeBooking", column: "paymentStatus", enumType: "PaymentStatusType", values: ["PAID", "PARTIAL", "PENDING"], fallback: "PENDING" },
        { table: "DaytimeBooking", column: "paymentMethod", enumType: "PaymentMethodType", values: ["CASH", "TRANSFER", "CARD", "MOBILE"], fallback: "CASH", nullable: true },
        { table: "DaytimeRoomBooking", column: "paymentStatus", enumType: "PaymentStatusType", values: ["PAID", "PARTIAL", "PENDING"], fallback: "PENDING" },
        { table: "DaytimeRoomBooking", column: "paymentMethod", enumType: "PaymentMethodType", values: ["CASH", "TRANSFER", "CARD", "MOBILE"], fallback: "CASH", nullable: true },
        { table: "DaytimeRoomBooking", column: "status", enumType: "ReservationStatus", values: ["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED", "DELETED"], fallback: "UPCOMING" },
        { table: "Expense", column: "paymentMethod", enumType: "PaymentMethodType", values: ["CASH", "TRANSFER", "CARD", "MOBILE"], fallback: "CASH" },
        { table: "Payment", column: "method", enumType: "PaymentMethodType", values: ["CASH", "TRANSFER", "CARD", "MOBILE"], fallback: "CASH" },
        { table: "Notification", column: "type", enumType: "NotificationType", values: ["INFO", "WARNING", "SUCCESS", "ERROR"], fallback: "INFO" },
        { table: "HousekeepingTask", column: "type", enumType: "HousekeepingTaskType", values: ["CLEANING", "MAINTENANCE", "INSPECTION"], fallback: "CLEANING" },
        { table: "HousekeepingTask", column: "status", enumType: "HousekeepingTaskStatus", values: ["PENDING", "IN_PROGRESS", "COMPLETED"], fallback: "PENDING" },
        { table: "SuspectedPerson", column: "severity", enumType: "SuspectSeverity", values: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], fallback: "MEDIUM" },
        { table: "GroupBooking", column: "status", enumType: "GroupBookingStatus", values: ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"], fallback: "PENDING" },
      ];

      for (const c of conversions) {
        try {
          // Check if column exists and its current type
          const col = await db.$queryRawUnsafe<Array<{ data_type: string; udt_name: string }>>(
            `SELECT data_type, udt_name FROM information_schema.columns
             WHERE table_schema='public' AND table_name='${c.table}' AND column_name='${c.column}' LIMIT 1`
          );
          if (col.length === 0) continue; // column doesn't exist yet
          if (col[0].data_type === "USER-DEFINED" && col[0].udt_name === c.enumType) continue; // already enum
          if (col[0].data_type !== "text" && col[0].data_type !== "character varying") continue;

          // Normalize bad values
          const validList = c.values.map(v => `'${v}'`).join(",");
          if (c.nullable) {
            await db.$executeRawUnsafe(
              `UPDATE "${c.table}" SET "${c.column}" = NULL WHERE "${c.column}" IS NOT NULL AND "${c.column}"::text NOT IN (${validList})`
            );
          } else {
            await db.$executeRawUnsafe(
              `UPDATE "${c.table}" SET "${c.column}" = '${c.fallback}' WHERE "${c.column}" IS NULL OR "${c.column}"::text NOT IN (${validList})`
            );
          }
          // Convert column type
          await db.$executeRawUnsafe(
            `ALTER TABLE "${c.table}" ALTER COLUMN "${c.column}" TYPE "${c.enumType}" USING "${c.column}"::"${c.enumType}"`
          );
        } catch (err) {
          console.warn(`[autoFixEnumColumns] Failed to convert ${c.table}.${c.column} → ${c.enumType}:`, err instanceof Error ? err.message : err);
          // Continue to next conversion — don't let one failure block others
        }
      }

      _fixDone = true;
      console.log("[autoFixEnumColumns] Completed — all enum types created, TEXT columns converted.");
    } catch (err) {
      console.error("[autoFixEnumColumns] Failed:", err instanceof Error ? err.message : err);
      // Reset so the next call can retry
      _fixPromise = null;
      // Don't re-throw — the calling route will see the original error
      // and surface it to the user. The fix will retry on the next call.
    }
  })();

  await _fixPromise;
}

/** Reset the cached state. Used by tests or when forcing a re-check. */
export function resetAutoFixEnum(): void {
  _fixDone = false;
  _fixPromise = null;
}
