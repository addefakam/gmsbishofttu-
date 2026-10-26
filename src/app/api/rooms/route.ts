import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  getAuthContext,
  getProviderFilter,
  checkWritePermission,
  AuthError,
} from "@/lib/tenant";
import { runReservationMaintenance } from "@/lib/reservation-maintenance";
import { logStaffActivity } from "@/lib/staff-log";
import { ensureDatabase } from "@/lib/init-db";
import { ensureCriticalTables } from "@/lib/ensure-tables";

// ── Raw-SQL Room INSERT helper ────────────────────────────────────────────
// Bypasses Prisma's runtime type validator entirely. After commits 6e0c0cf
// (schema enum→String) and 578ca75 (init-db.ts enum→TEXT), the Prisma
// runtime cache still rejects valid strings like 'SINGLE' with:
//   "Error converting field 'type' of expected non-nullable type 'String',
//    found incompatible value of 'SINGLE'"
// even though the schema says String. Using Prisma.sql tagged template
// sends parameterized SQL directly to Postgres — no model type metadata,
// no runtime validator, no enum cache.
async function createRoomRaw(opts: {
  number: string;
  name: string;
  type: string;
  pricePerNight: number;
  pricePerNightWeekend: number | null;
  floor: number;
  capacity: number;
  amenities: string;
  description: string;
  image: string | null;
  providerId: string;
}): Promise<Record<string, unknown>> {
  const id = `room_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  // Step 1: try INSERT with pricePerNightWeekend (column exists on most DBs
  // after ensureDatabase() runs the ALTER TABLE).
  try {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "Room"
        ("id", "number", "name", "type", "pricePerNight", "pricePerNightWeekend",
         "floor", "capacity", "status", "amenities", "description", "image",
         "providerId", "createdAt", "updatedAt")
      VALUES
        (${id}, ${opts.number}, ${opts.name}, ${opts.type}, ${opts.pricePerNight},
         ${opts.pricePerNightWeekend}, ${opts.floor}, ${opts.capacity},
         'AVAILABLE', ${opts.amenities}, ${opts.description}, ${opts.image},
         ${opts.providerId}, NOW(), NOW())
    `);
  } catch (insertErr: unknown) {
    const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
    // Fallback: pricePerNightWeekend column doesn't exist on this DB yet.
    // Retry without it (weekend price will be null).
    if (msg.includes("pricePerNightWeekend") && msg.includes("does not exist")) {
      console.warn("[rooms POST] pricePerNightWeekend column not found — retrying without it.");
      await db.$executeRaw(Prisma.sql`
        INSERT INTO "Room"
          ("id", "number", "name", "type", "pricePerNight",
           "floor", "capacity", "status", "amenities", "description", "image",
           "providerId", "createdAt", "updatedAt")
        VALUES
          (${id}, ${opts.number}, ${opts.name}, ${opts.type}, ${opts.pricePerNight},
           ${opts.floor}, ${opts.capacity},
           'AVAILABLE', ${opts.amenities}, ${opts.description}, ${opts.image},
           ${opts.providerId}, NOW(), NOW())
      `);
    } else {
      throw insertErr; // Re-throw unknown errors
    }
  }
  // Step 2: fetch the created record (also via raw SQL — consistent)
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "Room" WHERE "id" = $1`,
    id
  );
  return rows[0] ?? { id };
}

// ── Force dynamic rendering ──
// Without this, Vercel may cache the API response at the edge, causing
// stale data (old room statuses, old reservations) to be served even
// after the operator makes changes. force-dynamic ensures every request
// hits the server fresh.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // ── CRITICAL: ensure GroupBooking + other JOIN targets exist ──
    // /api/reservations GET (called in parallel from the Accommodation
    // page) does LEFT JOIN "GroupBooking". If that table doesn't exist,
    // Postgres throws 42P01. ensureCriticalTables() bypasses
    // ensureDatabase() and uses Prisma's $executeRawUnsafe directly
    // (no pg.Client, no _initDone cache flag). Cached per-instance.
    try {
      await ensureCriticalTables();
    } catch (ensureErr) {
      console.error("[rooms GET] ensureCriticalTables failed:", ensureErr instanceof Error ? ensureErr.message : ensureErr);
    }

    // ensureDatabase runs the ALTER TABLE statements in init-db.ts that
    // add new columns (like pricePerNightWeekend) to existing DBs. Without
    // this call, the SELECT below fails on databases that haven't yet
    // had the column added — causing "Failed to load guest data" on the
    // accommodation page (which fetches rooms in parallel with guests).
    await ensureDatabase();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);

    // Lazy maintenance (throttled) so room statuses reflect past-checkout
    // auto-releases even between cron runs. Never blocks the read.
    //
    // IMPORTANT: This is fire-and-forget — we DON'T await it. Previously we
    // awaited runReservationMaintenance(), which meant:
    //   1. fetchRooms() is called from the Add Guest to Group dialog
    //   2. runReservationMaintenance() runs synchronously
    //   3. It finds UPCOMING reservations with past checkout dates
    //   4. It CANCELS them (sets status to CANCELLED)
    //   5. The group bookings list refreshes and shows the guest as CANCELLED
    //
    // This was causing the operator to see "the previous guest was cancelled"
    // right after adding a new guest. By making it fire-and-forget (not awaited),
    // the room list returns immediately with current data, and the maintenance
    // runs in the background — the cancellation (if any) happens on the NEXT
    // page load, not during the Add Guest dialog flow.
    try {
      runReservationMaintenance(filter.isPolice ? {} : { providerId: filter.providerId });
    } catch {
      // Ignore — maintenance must not break room reads.
    }

    const where: Record<string, unknown> = filter.isPolice
      ? {}
      : { providerId: filter.providerId };

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");
    // NEW: date-aware availability filter.
    //   ?availableFrom=YYYY-MM-DD&availableTo=YYYY-MM-DD
    // When BOTH are provided, the response only includes rooms that have NO
    // overlapping reservation in [availableFrom, availableTo). This is the
    // half-open interval — a previous guest checking out on `availableFrom`
    // does NOT conflict with a new guest checking in on the same day.
    // Excludes MAINTENANCE rooms regardless (they're out of service).
    const availableFrom = searchParams.get("availableFrom");
    const availableTo = searchParams.get("availableTo");
    const useDateFilter = !!(availableFrom && availableTo && availableTo > availableFrom);

    if (q) {
      where.OR = [
        { number: { contains: q } },
        { name: { contains: q } },
      ];
    }

    // Use raw SQL with type::text cast to avoid Prisma's enum cache issue.
    // Build the query with parameterized values to prevent SQL injection.
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (q) {
      conditions.push(`("number" ILIKE $${paramIdx} OR "name" ILIKE $${paramIdx})`);
      params.push(`%${q}%`);
      paramIdx++;
    }
    if (where.providerId) {
      conditions.push(`"providerId" = $${paramIdx}`);
      params.push(where.providerId);
      paramIdx++;
    }
    // When date-filtering, also exclude MAINTENANCE rooms — they're out of
    // service and shouldn't be bookable even if they have no reservations.
    if (useDateFilter) {
      conditions.push(`"status" != 'MAINTENANCE'`);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

    // Use a try/catch around the SELECT — if the pricePerNightWeekend column
    // doesn't exist yet on this database (e.g. ensureDatabase didn't run on
    // this cold start), retry with a SELECT that omits the new column. The
    // rooms will load with pricePerNightWeekend = null (no weekend premium).
    let roomsRaw: Record<string, unknown>[];
    try {
      roomsRaw = await db.$queryRawUnsafe(
        `SELECT "id", "number", "name", "type"::text AS "type", "pricePerNight", "pricePerNightWeekend", "floor", "capacity", "status", "providerId", "createdAt", "updatedAt" FROM "Room"${whereClause} ORDER BY "floor" ASC, "number" ASC`,
        ...params
      ) as Record<string, unknown>[];
    } catch (selectErr: unknown) {
      const errMsg = selectErr instanceof Error ? selectErr.message : String(selectErr);
      if (errMsg.includes("pricePerNightWeekend") && errMsg.includes("does not exist")) {
        // Fallback: retry without the new column. The init-db ALTER TABLE
        // will run on the next ensureDatabase() call and add it for good.
        console.warn("[rooms GET] pricePerNightWeekend column not found — retrying without it. The ALTER TABLE in init-db.ts should add it on the next request.");
        roomsRaw = await db.$queryRawUnsafe(
          `SELECT "id", "number", "name", "type"::text AS "type", "pricePerNight", "floor", "capacity", "status", "providerId", "createdAt", "updatedAt" FROM "Room"${whereClause} ORDER BY "floor" ASC, "number" ASC`,
          ...params
        ) as Record<string, unknown>[];
      } else {
        // Different error — re-throw so the outer catch handles it
        throw selectErr;
      }
    }

    // Serialize ALL fields — $queryRawUnsafe returns BigInt for INT
    // columns and Date for TIMESTAMP columns. Both cause JSON.stringify
    // to throw, which makes NextResponse.json() return an empty response.
    let rooms = roomsRaw.map((r) => ({
      id: String(r.id),
      number: String(r.number),
      name: String(r.name || ""),
      type: String(r.type || ""),
      pricePerNight: Number(r.pricePerNight),
      // pricePerNightWeekend is undefined when the fallback SELECT (no
      // such column) ran — coerce to null so the client treats it as
      // "no weekend premium set".
      pricePerNightWeekend: r.pricePerNightWeekend == null ? null : Number(r.pricePerNightWeekend),
      floor: Number(r.floor),
      capacity: Number(r.capacity),
      status: String(r.status || "AVAILABLE"),
      providerId: r.providerId ? String(r.providerId) : null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ""),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt || ""),
    }));

    // ── Date-aware availability filter ──
    // When `availableFrom` + `availableTo` are provided, exclude any room
    // that has an UPCOMING or ACTIVE reservation overlapping the requested
    // window. Half-open interval: existing.checkOut === new.checkIn is OK.
    // CANCELLED or COMPLETED reservations don't block the room.
    if (useDateFilter && availableFrom && availableTo) {
      const conflicting = await db.reservation.findMany({
        where: {
          status: { in: ["UPCOMING", "ACTIVE"] },
          checkIn: { lt: availableTo },
          checkOut: { gt: availableFrom },
        },
        select: { roomId: true },
      });
      const conflictingRoomIds = new Set(conflicting.map((r) => r.roomId));
      rooms = rooms.filter((r) => !conflictingRoomIds.has(r.id));
    }

    return NextResponse.json({ rooms });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("List rooms error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { staffPermissionKey: "rooms" });

    if (!auth.providerId) {
      return NextResponse.json(
        { error: "No provider assigned to this user" },
        { status: 403 }
      );
    }

    const body = await req.json();

    // ── Bulk import ──────────────────────────────────────────────────────────
    if (Array.isArray(body.bulk)) {
      const results: { number: string; status: string; error?: string }[] = [];

      for (const row of body.bulk) {
        const { number, type, pricePerNight, pricePerNightWeekend, floor, capacity, amenities, description, name } = row;
        // pricePerNight is optional — defaults to 0 when omitted.
        if (!number || !type || floor == null || capacity == null) {
          results.push({ number: String(number ?? "?"), status: "skipped", error: "Missing required fields" });
          continue;
        }
        // ── Capacity cap for SINGLE rooms (same as the single-row path) ──
        // Bulk import skips the row with a clear error message instead of
        // silently capping — so the operator can see which rows failed.
        if (type === "SINGLE" && Number(capacity) > 2) {
          results.push({ number: String(number ?? "?"), status: "skipped", error: "Single rooms can hold max 2 guests" });
          continue;
        }
        try {
          const existing = await db.room.findFirst({ select: { id: true, number: true }, where: { number: String(number), providerId: auth.providerId } });
          if (existing) {
            results.push({ number: String(number), status: "skipped", error: "Room number already exists" });
            continue;
          }
          try {
            await createRoomRaw({
              number: String(number),
              name: name ? String(name) : `Room ${number}`,
              type: String(type).toUpperCase(),
              pricePerNight: pricePerNight == null || pricePerNight === "" ? 0 : Number(pricePerNight),
              pricePerNightWeekend: pricePerNightWeekend == null || pricePerNightWeekend === "" ? null : Number(pricePerNightWeekend),
              floor: Number(floor),
              capacity: Number(capacity),
              amenities: amenities ? JSON.stringify(String(amenities).split(",").map((s: string) => s.trim()).filter(Boolean)) : "[]",
              description: description ? String(description) : "",
              image: null,
              providerId: auth.providerId!,
            });
          } catch (createErr: unknown) {
            // createRoomRaw already handles the pricePerNightWeekend fallback
            // internally. Re-throw for the outer bulk-result handler.
            throw createErr;
          }
          results.push({ number: String(number), status: "created" });
        } catch {
          results.push({ number: String(number), status: "error", error: "Database error" });
        }
      }

      const created = results.filter((r) => r.status === "created").length;
      const skipped = results.filter((r) => r.status !== "created").length;
      return NextResponse.json({ imported: created, skipped, results }, { status: 200 });
    }

    // ── Single room create ───────────────────────────────────────────────────
    const {
      number,
      name,
      type,
      pricePerNight,
      pricePerNightWeekend,
      floor,
      capacity,
      amenities,
      description,
      image,
    } = body;

    // pricePerNight is OPTIONAL — defaults to 0 when omitted. Some operators
    // don't charge per-night (e.g. flat-rate guest houses, complimentary rooms,
    // or rooms where pricing is set later). The field is no longer required.
    if (!number || !type || floor == null || capacity == null) {
      return NextResponse.json(
        { error: "Missing required fields: number, type, floor, capacity" },
        { status: 400 }
      );
    }

    // ── Capacity cap by room type ──
    // SINGLE rooms can hold at most 2 guests (one primary + one optional
    // companion). DOUBLE/TWIN/SUITE/DELUXE/etc. have no hard cap here —
    // the operator decides based on the room's physical layout.
    // This matches the front-end validation on both the main system and
    // mobile app, so the API is the source of truth in case a request
    // bypasses the UI (e.g. direct API call, bulk import).
    const SINGLE_MAX_CAPACITY = 2;
    const capacityNum = Number(capacity);
    if (type === "SINGLE" && capacityNum > SINGLE_MAX_CAPACITY) {
      return NextResponse.json(
        {
          error: `Single rooms can hold a maximum of ${SINGLE_MAX_CAPACITY} guests. Use a DOUBLE or larger room type for higher capacity.`,
          code: "SINGLE_ROOM_CAPACITY_EXCEEDED",
          details: { type, requestedCapacity: capacityNum, maxCapacity: SINGLE_MAX_CAPACITY },
        },
        { status: 400 }
      );
    }

    // Check for duplicate room number within the same provider
    const existing = await db.room.findFirst({ select: { id: true, number: true },
      where: { number, providerId: auth.providerId },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Room number already exists for this provider" },
        { status: 409 }
      );
    }

    // pricePerNight is OPTIONAL — defaults to 0 when omitted/empty.
    const priceVal = pricePerNight == null || pricePerNight === "" ? 0 : Number(pricePerNight);
    // Weekend price is OPTIONAL — null/empty means "no weekend premium, use weekday rate for all nights".
    const weekendPriceVal = pricePerNightWeekend == null || pricePerNightWeekend === "" ? null : Number(pricePerNightWeekend);

    // Use createRoomRaw helper — bypasses Prisma's runtime type validator
    // (which still has cached enum metadata and rejects 'SINGLE' even though
    // the schema says String). The helper also handles the pricePerNightWeekend
    // column-doesn't-exist fallback internally.
    const room = await createRoomRaw({
      number,
      name: name || `Room ${number}`,
      type,
      pricePerNight: priceVal,
      pricePerNightWeekend: weekendPriceVal,
      floor: Number(floor),
      capacity: Number(capacity),
      amenities: amenities || "[]",
      description: description || "",
      image: image || null,
      providerId: auth.providerId!,
    });

    // Staff activity log
    logStaffActivity({
      req, userId: auth.userId, userName: auth.userName, action: "ROOM_CREATE", targetType: "ROOM", targetId: room.id,
      details: { roomNumber: room.number, roomType: room.type },
      providerId: auth.providerId!,
    });

    return NextResponse.json({ room }, { status: 201 });
  } catch (error: unknown) {
    console.error("Create room error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("permission") || message.includes("cannot")
      ? 403
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}