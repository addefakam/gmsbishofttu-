import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { checkSuspectMatch } from "@/lib/suspect-check";
import { composeAddress } from "@/lib/ethiopian-admin-divisions";
import { isValidPhone, isValidEmail } from "@/lib/utils";
import { isValidNationalId, isNationalIdType, normalizeIdType } from "@/lib/national-id";
import { normalizeNationality } from "@/lib/nationalities";
import { logStaffActivity } from "@/lib/staff-log";
import { ensureNewTables } from "@/lib/ensure-tables";

// ── Force dynamic rendering ──
// Prevents Vercel from caching stale guest data at the edge.
export const dynamic = "force-dynamic";

// Force-create the new owner feature tables so Prisma's Provider model
// relations don't fail. Uses a module-level flag to only run ONCE per
// cold start — subsequent requests skip the DDL statements entirely.
let _ownerTablesEnsured = false;
async function ensureOwnerTables(): Promise<void> {
  if (_ownerTablesEnsured) return;
  try {
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "EndOfDayReport" ("id" TEXT NOT NULL PRIMARY KEY, "reportDate" TEXT NOT NULL, "providerId" TEXT NOT NULL, "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "cashPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "cashRefunds" DOUBLE PRECISION NOT NULL DEFAULT 0, "pettyCashExpenses" DOUBLE PRECISION NOT NULL DEFAULT 0, "expectedCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "countedCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "discrepancy" DOUBLE PRECISION NOT NULL DEFAULT 0, "telebirrPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "cbePayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "cardPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "totalPayments" DOUBLE PRECISION NOT NULL DEFAULT 0, "checkins" INTEGER NOT NULL DEFAULT 0, "checkouts" INTEGER NOT NULL DEFAULT 0, "newReservations" INTEGER NOT NULL DEFAULT 0, "cancellations" INTEGER NOT NULL DEFAULT 0, "noShows" INTEGER NOT NULL DEFAULT 0, "signedOffById" TEXT, "signedOffAt" TIMESTAMP(3), "closingShiftId" TEXT, "notes" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "EndOfDayReport_reportDate_providerId_key" UNIQUE ("reportDate", "providerId"))`);
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ShiftHandover" ("id" TEXT NOT NULL PRIMARY KEY, "providerId" TEXT NOT NULL, "shiftDate" TEXT NOT NULL, "shiftType" TEXT NOT NULL DEFAULT 'DAY', "staffStartId" TEXT NOT NULL, "staffEndId" TEXT, "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0, "closingCash" DOUBLE PRECISION, "discrepancy" DOUBLE PRECISION NOT NULL DEFAULT 0, "handoverNotes" TEXT NOT NULL DEFAULT '', "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3), "signedOffAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProviderMessage" ("id" TEXT NOT NULL PRIMARY KEY, "fromProviderId" TEXT NOT NULL, "toProviderId" TEXT NOT NULL, "message" TEXT NOT NULL, "isRead" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    _ownerTablesEnsured = true;
  } catch (err) {
    console.warn("[guests] ensureOwnerTables failed (non-blocking):", err instanceof Error ? err.message : err);
    _ownerTablesEnsured = true; // Don't retry on failure — let the API continue
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureOwnerTables();
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const { isPolice, providerId } = getProviderFilter(auth);

    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    // ── Cap raised from 100 → 999 ──
    // The frontend helper apiGetGuests() requests limit=999 to fetch ALL
    // guests for client-side search/filter. The previous cap of 100
    // silently truncated the list — operators with 200+ guests would
    // see only the first 100, and the count wouldn't match the police
    // dashboard's totalGuests KPI (which counts ALL guests with no cap).
    // 999 is the same ceiling used by /api/reservations and is more
    // than enough for any single guesthouse's guest list.
    const limit = Math.min(999, Math.max(1, parseInt(searchParams.get("limit") || "999")));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (!isPolice) {
      where.providerId = providerId;
    }

    if (q) {
      where.OR = [
        { name: { contains: q } },
        { phone: { contains: q } },
        { idNumber: { contains: q } },
      ];
    }

    // Use raw SQL to avoid any Prisma schema mismatch issues
    const conditions: string[] = [];
    const params: unknown[] = [];
    let pi = 1;

    if (!isPolice && providerId) {
      conditions.push(`"providerId" = $${pi++}`);
      params.push(providerId);
    }
    if (q) {
      conditions.push(`("name" ILIKE $${pi} OR "phone" ILIKE $${pi} OR "idNumber" ILIKE $${pi})`);
      params.push(`%${q}%`);
      pi++;
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

    const [guestsRaw, totalRaw] = await Promise.all([
      db.$queryRawUnsafe(
        `SELECT "id", "name", "phone", "email", "idNumber", "idType",
                "nationality", "region", "zone", "woreda", "kebele",
                "houseNumber", "streetName", "plateNumber", "weapon",
                "vip", "totalSpent", "totalStays", "providerId",
                "createdAt", "updatedAt"
         FROM "Guest"${whereClause}
         ORDER BY "createdAt" DESC
         LIMIT $${pi++} OFFSET $${pi++}`,
        ...params, limit, skip
      ),
      db.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM "Guest"${whereClause}`,
        ...params
      ),
    ]);

    const guests = (guestsRaw as Record<string, unknown>[]).map((g) => ({
      id: String(g.id),
      name: String(g.name || ""),
      phone: String(g.phone || ""),
      email: String(g.email || ""),
      idNumber: String(g.idNumber || ""),
      idType: normalizeIdType(String(g.idType || "")) || "",
      nationality: String(g.nationality || ""),
      region: String(g.region || ""),
      zone: String(g.zone || ""),
      woreda: String(g.woreda || ""),
      kebele: String(g.kebele || ""),
      houseNumber: String(g.houseNumber || ""),
      streetName: String(g.streetName || ""),
      plateNumber: String(g.plateNumber || ""),
      weapon: String(g.weapon || ""),
      vip: Boolean(g.vip),
      totalSpent: Number(g.totalSpent),
      totalStays: Number(g.totalStays),
      providerId: g.providerId ? String(g.providerId) : null,
      createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : String(g.createdAt || ""),
      updatedAt: g.updatedAt instanceof Date ? g.updatedAt.toISOString() : String(g.updatedAt || ""),
    }));

    const total = Array.isArray(totalRaw) ? (totalRaw[0] as Record<string, number>)?.count ?? 0 : 0;

    return NextResponse.json({ guests, total, page, limit });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch guests";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    // Staff need either 'guests' or 'reservations' permission to create guests.
    // 'guests' was removed from the operator's permission UI (redundant with
    // 'reservations'), so we accept both keys for backwards compatibility.
    try {
      checkWritePermission(auth, { staffPermissionKey: "guests" });
    } catch {
      checkWritePermission(auth, { staffPermissionKey: "reservations" });
    }

    const body = await req.json();
    const { name, phone, email, idNumber, idType, nationality, region, zone, woreda, kebele, houseNumber, streetName, plateNumber, weapon, address, notes, vip } = body;

    // ── Required field: name only ──
    // Phone, nationality, and ID type are OPTIONAL — the group-bookings
    // inline registration form only requires a name (operator can fill in
    // the rest later). When these fields are omitted, they default to
    // empty strings in the DB (all are nullable/empty-default in the schema).
    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    // Validate phone FORMAT only if provided
    if (phone && phone.trim() && !isValidPhone(phone)) {
      return NextResponse.json({ error: "Invalid phone number format" }, { status: 400 });
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email address format" }, { status: 400 });
    }

    // ── AUTO-DEDUP: find or create by phone number ──
    // The #1 cause of duplicate guest records was the reservation flow:
    // every time an operator created a reservation in "New Guest" mode,
    // a new Guest row was inserted — even if a guest with the same phone
    // already existed at the same guesthouse.
    //
    // This "find or create" logic fixes that:
    //   1. Search for an existing guest with the same phone + providerId
    //   2. If found → UPDATE that guest with the new data (enrich any
    //      previously-empty fields like ID number, nationality, address)
    //      and return the existing guest. The reservation flow then
    //      links to this existing guest — no duplicate.
    //   3. If not found → create a new Guest row as before.
    //
    // Phone is the natural unique key per provider because:
    //   - Two different people at the same guesthouse won't share a phone
    //   - The same person across multiple stays WILL have the same phone
    //
    // When phone is empty (group-bookings inline registration — name only),
    // we SKIP dedup entirely and create a new guest. This prevents matching
    // against other guests who also have empty phones.
    const existingGuest = phone && phone.trim()
      ? await db.guest.findFirst({
          where: { phone, providerId },
          include: { provider: { select: { name: true } } },
        })
      : null;

    if (existingGuest) {
      // ── Enrich the existing guest with any new data ──
      // Only update fields that were previously empty OR have new values.
      // This way the guest record gets richer over time without
      // overwriting existing data with empty strings.
      const updated = await db.guest.update({
        where: { id: existingGuest.id },
        data: {
          // Always update name (in case of typo correction)
          name: name || existingGuest.name,
          // Enrich only if the existing value was empty AND the new value is non-empty
          email: !existingGuest.email && email ? email : existingGuest.email,
          idNumber: !existingGuest.idNumber && idNumber ? idNumber : existingGuest.idNumber,
          idType: normalizeIdType(idType || "") || existingGuest.idType,
          nationality: normalizeNationality(nationality || "") || existingGuest.nationality,
          region: !existingGuest.region && region ? region : existingGuest.region,
          zone: !existingGuest.zone && zone ? zone : existingGuest.zone,
          woreda: !existingGuest.woreda && woreda ? woreda : existingGuest.woreda,
          kebele: !existingGuest.kebele && kebele ? kebele : existingGuest.kebele,
          houseNumber: !existingGuest.houseNumber && houseNumber ? houseNumber : existingGuest.houseNumber,
          streetName: !existingGuest.streetName && streetName ? streetName : existingGuest.streetName,
          plateNumber: !existingGuest.plateNumber && plateNumber ? plateNumber : existingGuest.plateNumber,
          weapon: !existingGuest.weapon && weapon ? weapon : existingGuest.weapon,
          notes: notes || existingGuest.notes,
        },
      });

      // ── Suspect check intentionally NOT fired here ──
      // The guest already existed and was already checked against the
      // suspect watchlist when they were first created. Re-checking on
      // every enrichment would fire duplicate alerts — the reservation
      // creation endpoint (POST /api/reservations) fires checkSuspectMatch
      // with the full reservation context (room, dates, provider) which
      // is more useful to the police than a bare guest-enrichment event.
      //
      // If a NEW suspect was added to the watchlist AFTER this guest was
      // first created, the reservation creation will catch it — that's
      // the right time to re-check, not during guest-profile enrichment.

      return NextResponse.json({ ...updated, _reused: true }, { status: 200 });
    }

    // ── No existing guest found — create a new one ──
    // ID number validation — only validate FORMAT if provided.
    // ID number is optional in the group-bookings inline registration flow
    // (operator may only enter a name). The DB allows empty strings.
    if (idNumber && idNumber.trim()) {
      if (idNumber.trim().length < 4) {
        return NextResponse.json({ error: "ID number is too short. Please enter a valid ID number." }, { status: 400 });
      }
      // National ID validation — 16 digits in "FAN XX XX XX XX XX XX XX XX" format
      // when the ID type is National ID. Other ID types (passport, driver's license,
      // etc.) are accepted as-is.
      if (isNationalIdType(idType) && !isValidNationalId(idNumber)) {
        return NextResponse.json(
          {
            error: "National ID must be exactly 16 digits in FAN format (e.g. FAN 12 34 56 78 90 12 34 56)",
            code: "INVALID_NATIONAL_ID",
          },
          { status: 400 }
        );
      }
    }

    // Auto-compose address from normalized fields if not explicitly provided
    const composedAddress = address || composeAddress({ region, zone, woreda, kebele, houseNumber, streetName });

    const guest = await db.guest.create({
      data: {
        name,
        // phone column is NOT nullable in the schema (String, no default).
        // When the caller omits phone (group-bookings inline registration —
        // name only), store empty string instead of undefined/null.
        phone: phone || "",
        email: email || "",
        idNumber: idNumber || "",
        // Normalize the ID type to the canonical form ("National ID",
        // "Kebele ID", "Passport", "Driver's License", "Other") so the
        // ID Type Distribution chart groups all variations together.
        // Previously the raw frontend value was stored, so the chart
        // showed NATIONAL, NATIONAL_ID, and National ID as 3 separate
        // slices for what is really the same ID type.
        idType: normalizeIdType(idType || "") || "",
        // Normalize nationality to canonical form (Ethiopian/Pakistani/
        // Kenyan/Indian) so the Nationality chart groups all variants
        // together. Previously stored the raw frontend value.
        nationality: normalizeNationality(nationality || ""),
        region: region || "",
        zone: zone || "",
        woreda: woreda || "",
        kebele: kebele || "",
        houseNumber: houseNumber || "",
        streetName: streetName || "",
        plateNumber: plateNumber || "",
        weapon: weapon || "",
        address: composedAddress,
        notes: notes || "",
        vip: vip || false,
        providerId,
      },
    });

    // Background: check if guest matches any suspected person (fire-and-forget)
    checkSuspectMatch({
      name,
      phone: phone || "",
      idNumber: idNumber || "",
      idType: idType || "",
      matchType: "GUEST_CHECKIN",
      providerId,
      extraDetails: {
        email: email || "",
        // Normalize nationality to canonical form (Ethiopian/Pakistani/
        // Kenyan/Indian) so the Nationality chart groups all variants
        // together. Previously stored the raw frontend value.
        nationality: normalizeNationality(nationality || ""),
        address: composedAddress,
      },
    }).catch(() => {});

    // Staff activity log — who created/enriched this guest
    logStaffActivity({
      req, userId: auth.userId, userName: auth.userName, action: "GUEST_CREATE", targetType: "GUEST", targetId: guest.id,
      details: { guestName: name, phone: phone || "", idNumber: idNumber || "" },
      providerId,
    });

    return NextResponse.json(guest, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create guest";
    const status = message.includes("required") ? 400 : message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}