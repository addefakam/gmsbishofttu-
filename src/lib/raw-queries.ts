/**
 * Raw SQL helpers for queries that hit enum-typed columns.
 *
 * WHY THIS EXISTS
 * The DB has a mix of column states (some TEXT, some enum) due to
 * init-db.ts's CREATE TABLE IF NOT EXISTS being a no-op on existing
 * tables. Prisma's native db.<model>.count() / findMany() generate
 * SQL like `WHERE status = $1::"ProviderStatus"`. If the column is
 * TEXT, this fails with:
 *   42883: operator does not exist: text = "ProviderStatus"
 *
 * These helpers use raw SQL with literal+cast (validated against
 * whitelist — no SQL injection). 2-way fallback:
 *   1. Try with cast (works for enum column)
 *   2. Fall back to no-cast (works for TEXT column)
 *
 * Usage:
 *   import { countProviders } from "@/lib/raw-queries";
 *   const totalProviders = await countProviders();
 *   const activeProviders = await countProviders("APPROVED");
 */
import { db } from "./db";

// ─── Whitelists (closed enum value sets — safe to inline as SQL literals) ──
const VALID_PROVIDER_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]);
const VALID_ROOM_STATUSES = new Set(["AVAILABLE", "OCCUPIED", "MAINTENANCE", "RESERVED"]);
const VALID_RESERVATION_STATUSES = new Set(["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED", "DELETED"]);
const VALID_PAYMENT_STATUSES = new Set(["PAID", "PARTIAL", "PENDING"]);
const VALID_USER_ROLES = new Set(["POLICE", "SUPERUSER", "OPERATOR", "STAFF"]);
const VALID_SUSPECT_SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

// ─── Generic count helper ──────────────────────────────────────────────────
// Builds a parameterized COUNT query with a cast on the enum-typed filter
// column. Tries with cast first, falls back to no-cast.
async function countWithEnumFilter(opts: {
  table: string;
  enumColumn?: string;          // e.g. "status"
  enumType: string;             // e.g. "ProviderStatus"
  filterValue?: string;         // e.g. "APPROVED"
  validValues: Set<string>;     // whitelist for SQL-injection safety
  extraConditions?: string;     // e.g. `"providerId" = $1`
  extraParams?: unknown[];      // e.g. [providerId]
}): Promise<number> {
  const safeFilter = opts.filterValue && opts.validValues.has(opts.filterValue)
    ? opts.filterValue
    : null;

  // Build WHERE clause — combine extra conditions with optional enum filter
  const conds: string[] = [];
  if (opts.extraConditions) conds.push(opts.extraConditions);
  if (safeFilter && opts.enumColumn) {
    // Will be set by tryQuery() with/without cast
  }
  const hasWhere = () => conds.length > 0 || (safeFilter && opts.enumColumn);

  const tryQuery = (cast: string) => {
    const allConds = [...conds];
    if (safeFilter && opts.enumColumn) {
      allConds.push(`"${opts.enumColumn}" = '${safeFilter}'${cast}`);
    }
    const whereClause = allConds.length > 0 ? ` WHERE ${allConds.join(" AND ")}` : "";
    const sql = `SELECT COUNT(*)::int AS count FROM "${opts.table}"${whereClause}`;
    return db.$queryRawUnsafe<Array<{ count: number }>>(sql, ...(opts.extraParams || []));
  };

  try {
    const r = await tryQuery(`::"${opts.enumType}"`);
    return Number(r[0]?.count ?? 0);
  } catch (castErr: unknown) {
    const castMsg = castErr instanceof Error ? castErr.message : String(castErr);
    const enumTypeMissing = castMsg.includes(`type "${opts.enumType}" does not exist`);
    const otherCastError = castMsg.includes("42804")
      || (castMsg.includes("is of type") && castMsg.includes("but expression is of type"))
      || castMsg.includes("42883")
      || castMsg.includes("operator does not exist");
    if (enumTypeMissing || otherCastError) {
      // Fallback: no cast (works for TEXT column)
      const r = await tryQuery("");
      return Number(r[0]?.count ?? 0);
    }
    throw castErr;
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────
export async function countProviders(statusFilter?: string): Promise<number> {
  return countWithEnumFilter({
    table: "Provider",
    enumColumn: "status",
    enumType: "ProviderStatus",
    filterValue: statusFilter,
    validValues: VALID_PROVIDER_STATUSES,
  });
}

export async function countProvidersByProviderId(providerId: string, statusFilter?: string): Promise<number> {
  return countWithEnumFilter({
    table: "Provider",
    enumColumn: "status",
    enumType: "ProviderStatus",
    filterValue: statusFilter,
    validValues: VALID_PROVIDER_STATUSES,
    extraConditions: `"id" = $1`,
    extraParams: [providerId],
  });
}

// ─── Room ───────────────────────────────────────────────────────────────────
export async function countRooms(statusFilter?: string, providerId?: string): Promise<number> {
  return countWithEnumFilter({
    table: "Room",
    enumColumn: statusFilter ? "status" : undefined,
    enumType: "RoomStatus",
    filterValue: statusFilter,
    validValues: VALID_ROOM_STATUSES,
    extraConditions: providerId ? `"providerId" = $1` : undefined,
    extraParams: providerId ? [providerId] : [],
  });
}

// ─── Reservation ────────────────────────────────────────────────────────────
export async function countReservations(statusFilter?: string, providerId?: string): Promise<number> {
  return countWithEnumFilter({
    table: "Reservation",
    enumColumn: statusFilter ? "status" : undefined,
    enumType: "ReservationStatus",
    filterValue: statusFilter,
    validValues: VALID_RESERVATION_STATUSES,
    extraConditions: providerId ? `"providerId" = $1` : undefined,
    extraParams: providerId ? [providerId] : [],
  });
}

// ─── User ───────────────────────────────────────────────────────────────────
export async function countUsers(roleFilter?: string): Promise<number> {
  return countWithEnumFilter({
    table: "User",
    enumColumn: roleFilter ? "role" : undefined,
    enumType: "UserRole",
    filterValue: roleFilter,
    validValues: VALID_USER_ROLES,
  });
}

// ─── Guest ──────────────────────────────────────────────────────────────────
export async function countGuests(providerId?: string): Promise<number> {
  return countWithEnumFilter({
    table: "Guest",
    // No enum-typed filter on Guest — just count by providerId
    extraConditions: providerId ? `"providerId" = $1` : undefined,
    extraParams: providerId ? [providerId] : [],
    // Dummy values for the helper signature
    enumType: "ProviderStatus",
    validValues: VALID_PROVIDER_STATUSES,
  });
}

// ─── SuspectedPerson ───────────────────────────────────────────────────────
export async function countSuspectedPersons(severityFilter?: string, activeOnly: boolean = false): Promise<number> {
  return countWithEnumFilter({
    table: "SuspectedPerson",
    enumColumn: severityFilter ? "severity" : undefined,
    enumType: "SuspectSeverity",
    filterValue: severityFilter,
    validValues: VALID_SUSPECT_SEVERITIES,
    extraConditions: activeOnly ? `"is_active" = true` : undefined,
  });
}
