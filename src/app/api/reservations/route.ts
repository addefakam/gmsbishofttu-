import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { checkSuspectMatch } from "@/lib/suspect-check";
import { runAnomalyDetection } from "@/lib/anomaly-engine";
import { isValidPhone } from "@/lib/utils";
import { runReservationMaintenance } from "@/lib/reservation-maintenance";
import { logStaffActivity } from "@/lib/staff-log";
import { calculateStayTotal } from "@/lib/room-pricing";

// ── Force dynamic rendering ──
// Prevents Vercel from caching stale reservation data at the edge.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const { isPolice, providerId } = getProviderFilter(auth);

    // Lazy maintenance: cancel past-checkout reservations, release their rooms
    // and create overdue check-in reminders so list data is never stale.
    // Throttled in the lib — repeated reads are cheap no-ops.
    //
    // Fire-and-forget (not awaited) — see rooms/route.ts for the same fix.
    // Awaiting this caused the "previous guest was cancelled" bug in group
    // bookings: when fetchRooms()/fetchReservations() ran after adding a
    // new guest, the maintenance cancelled stale UPCOMING reservations
    // synchronously, and the group list showed them as CANCELLED.
    try {
      runReservationMaintenance(isPolice ? {} : { providerId });
    } catch {
      // Never block reads on maintenance failures.
    }

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") || "";
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";
    const roomId = searchParams.get("roomId") || "";

    const where: Record<string, unknown> = {};
    if (!isPolice) {
      where.providerId = providerId;
    }
    if (status) {
      where.status = status;
    }
    if (roomId) {
      where.roomId = roomId;
    }
    if (dateFrom || dateTo) {
      const checkInFilter: Record<string, unknown> = {};
      if (dateFrom) checkInFilter.gte = dateFrom;
      if (dateTo) checkInFilter.lte = dateTo;
      where.checkIn = checkInFilter;
    }

    // Pagination
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    // ── Cap raised from 100 → 999 ──
    // The frontend helper apiGetReservations() requests limit=999 to fetch
    // ALL reservations for client-side search/filter. The previous cap of
    // 100 silently truncated the list — guesthouses with 200+ reservations
    // would only see the first 100, causing rooms to appear AVAILABLE when
    // they actually had a RESERVED booking that was cut off.
    const limit = Math.min(999, Math.max(1, parseInt(searchParams.get("limit") || "999")));
    const skip = (page - 1) * limit;

    // Use raw SQL to avoid Prisma's enum cache issue with RoomType (FAMILY).
    const conditions: string[] = [];
    const params: unknown[] = [];
    let pi = 1;

    if (where.providerId) {
      conditions.push(`r."providerId" = $${pi++}`);
      params.push(where.providerId);
    }
    if (where.status) {
      if (where.status.in && Array.isArray(where.status.in)) {
        conditions.push(`r."status" = ANY($${pi++}::text[])`);
        params.push(where.status.in);
      } else if (typeof where.status === "string") {
        conditions.push(`r."status" = $${pi++}`);
        params.push(where.status);
      }
    }
    // Per-room filter — REQUIRED for the room detail dialog (mobile + web)
    // so that opening Room 102 only returns Room 102's reservations, not
    // every reservation in the guesthouse. Previously this `roomId` value
    // was stored in `where.roomId` but never appended to the SQL conditions,
    // which caused every room's detail to display the same first ACTIVE
    // reservation as every other room.
    if (where.roomId) {
      conditions.push(`r."roomId" = $${pi++}`);
      params.push(where.roomId);
    }
    // Date-range filter on checkIn (YYYY-MM-DD strings compare correctly).
    // Cast to a typed record so TS doesn't complain about `.gte` / `.lte`
    // accessors on the loose `Record<string, unknown>` parent.
    if (where.checkIn) {
      const checkInFilter = where.checkIn as { gte?: string; lte?: string };
      if (checkInFilter.gte) {
        conditions.push(`r."checkIn" >= $${pi++}`);
        params.push(checkInFilter.gte);
      }
      if (checkInFilter.lte) {
        conditions.push(`r."checkIn" <= $${pi++}`);
        params.push(checkInFilter.lte);
      }
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";

    const [reservations, totalResult] = await Promise.all([
      db.$queryRawUnsafe(
        `SELECT r.*, g."name" AS "guestName", g."phone" AS "guestPhone", g."idNumber" AS "guestIdNumber",
                rm."number" AS "roomNumber", rm."name" AS "roomName",
                rm."type"::text AS "roomType", rm."id" AS "roomId",
                gb."name" AS "groupBookingName"
         FROM "Reservation" r
         LEFT JOIN "Guest" g ON g."id" = r."guestId"
         LEFT JOIN "Room" rm ON rm."id" = r."roomId"
         LEFT JOIN "GroupBooking" gb ON gb."id" = r."groupBookingId"
         ${whereClause}
         ORDER BY r."createdAt" DESC
         LIMIT $${pi++} OFFSET $${pi++}`,
        ...params, limit, skip
      ),
      db.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM "Reservation" r ${whereClause}`,
        ...params
      ),
    ]);

    const total = Array.isArray(totalResult) ? (totalResult[0] as Record<string, number>)?.count ?? 0 : 0;

    // Map raw SQL results to the format the frontend expects
    const formattedReservations = (reservations as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      guestId: r.guestId ? String(r.guestId) : null,
      roomId: r.roomId ? String(r.roomId) : null,
      checkIn: r.checkIn instanceof Date ? r.checkIn.toISOString().slice(0, 10) : String(r.checkIn || ""),
      checkOut: r.checkOut instanceof Date ? r.checkOut.toISOString().slice(0, 10) : String(r.checkOut || ""),
      nights: Number(r.nights),
      roomRate: Number(r.roomRate),
      totalCost: Number(r.totalCost),
      paidAmount: Number(r.paidAmount),
      balance: Number(r.balance),
      paymentStatus: String(r.paymentStatus || "PENDING"),
      paymentMethod: r.paymentMethod,
      status: String(r.status || ""),
      taxAmount: Number(r.taxAmount),
      discountAmount: Number(r.discountAmount),
      providerId: r.providerId ? String(r.providerId) : null,
      actualCheckIn: r.actualCheckIn instanceof Date ? r.actualCheckIn.toISOString() : (r.actualCheckIn ? String(r.actualCheckIn) : null),
      actualCheckOut: r.actualCheckOut instanceof Date ? r.actualCheckOut.toISOString() : (r.actualCheckOut ? String(r.actualCheckOut) : null),
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ""),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt || ""),
      secondGuestName: r.secondGuestName ? String(r.secondGuestName) : "",
      secondGuestPhone: r.secondGuestPhone ? String(r.secondGuestPhone) : "",
      secondGuestIdNumber: r.secondGuestIdNumber ? String(r.secondGuestIdNumber) : "",
      exceptionallyReserved: Boolean(r.exceptionallyReserved),
      exceptionReason: r.exceptionReason ? String(r.exceptionReason) : "",
      guest: r.guestName ? { id: String(r.guestId), name: String(r.guestName), phone: String(r.guestPhone || ""), idNumber: String(r.guestIdNumber || "") } : null,
      room: r.roomId ? { id: String(r.roomId), number: String(r.roomNumber || ""), name: String(r.roomName || ""), type: String(r.roomType || "") } : null,
      // Group booking info — groupBookingId comes from r.* (Reservation's own
      // foreign key column), groupBookingName comes from the LEFT JOIN to
      // GroupBooking. Used by the UI to show the organization name instead
      // of placeholder "Guest 1", "Guest 2", ... for group bookings.
      groupBookingId: r.groupBookingId ? String(r.groupBookingId) : null,
      groupBookingName: r.groupBookingName ? String(r.groupBookingName) : null,
    }));

    return NextResponse.json({ data: formattedReservations, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch reservations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    checkWritePermission(auth, { staffPermissionKey: "reservations" });

    const body = await req.json();
    const {
      guestId, roomId, checkIn, checkOut, roomRate, taxAmount, discountAmount,
      paymentMethod, notes, groupBookingId,
      secondGuestName, secondGuestPhone, secondGuestIdNumber,
      exceptionallyReserved, exceptionReason,
    } = body;

    if (!guestId || !roomId || !checkIn || !checkOut) {
      return NextResponse.json({ error: "guestId, roomId, checkIn, and checkOut are required" }, { status: 400 });
    }

    // Normalize to YYYY-MM-DD (dates are stored as plain date strings)
    const checkInDay = String(checkIn).slice(0, 10);
    const checkOutDay = String(checkOut).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkInDay) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOutDay)) {
      return NextResponse.json({ error: "checkIn and checkOut must be valid dates (YYYY-MM-DD)" }, { status: 400 });
    }
    if (checkOutDay <= checkInDay) {
      return NextResponse.json({ error: "Check-out date must be after the check-in date" }, { status: 400 });
    }

    // Get room to check type. Wrap in try/catch — if the pricePerNightWeekend
    // column doesn't exist yet on the production DB, retry without selecting
    // that column (the weekend calc will fall back to the weekday rate).
    let room;
    try {
      room = await db.room.findUnique({ where: { id: roomId }, select: { id: true, number: true, name: true, pricePerNight: true, pricePerNightWeekend: true, floor: true, capacity: true, status: true, providerId: true } });
    } catch (findErr: unknown) {
      const errMsg = findErr instanceof Error ? findErr.message : String(findErr);
      if (errMsg.includes("pricePerNightWeekend") && errMsg.includes("does not exist")) {
        console.warn("[reservations POST] pricePerNightWeekend column not found — retrying without it. init-db.ts should add it on the next ensureDatabase() call.");
        room = await db.room.findUnique({ where: { id: roomId }, select: { id: true, number: true, name: true, pricePerNight: true, floor: true, capacity: true, status: true, providerId: true } });
      } else {
        throw findErr;
      }
    }
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Second guest is NOT mandatory for any room type or capacity.
    // The frontend sends secondGuestName/Phone only when the user explicitly
    // chose "Two guests". If provided, validate the phone format.
    if (secondGuestName && secondGuestName.trim() && secondGuestPhone && secondGuestPhone.trim()) {
      if (!isValidPhone(secondGuestPhone.trim())) {
        return NextResponse.json({ error: "Invalid second guest phone number format. Use 7-15 digits with optional + prefix." }, { status: 400 });
      }
    }

    // Calculate nights
    const startDate = new Date(checkInDay);
    const endDate = new Date(checkOutDay);
    const diffMs = endDate.getTime() - startDate.getTime();
    const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    // Get room rate if not provided.
    // If the operator passed an explicit `roomRate` in the request body
    // (e.g. custom negotiated rate), we honor it for every night — bypassing
    // the weekend-aware calculation. Otherwise we use the new
    // weekend-aware calculation that picks the right rate per night.
    let subtotal: number;
    if (roomRate && roomRate > 0) {
      subtotal = roomRate * nights;
    } else {
      // Use the shared helper — iterates each night and picks weekday or
      // weekend rate based on the day of week (Fri+Sat = weekend).
      subtotal = calculateStayTotal(checkIn, checkOut, {
        pricePerNight: room.pricePerNight,
        pricePerNightWeekend: room.pricePerNightWeekend,
      });
    }

    const tax = taxAmount || 0;
    const discount = discountAmount || 0;
    const totalCost = subtotal + tax - discount;
    const paidAmount = 0;
    const balance = totalCost - paidAmount;

    // Check for overlapping reservations on this room (double-booking prevention).
    // True per-day overlap on half-open intervals [checkIn, checkOut):
    //   overlap ⇔ existing.checkIn < new.checkOut && existing.checkOut > new.checkIn
    // A previous guest's checkout day itself stays bookable as a new arrival
    // (existing.checkOut === new.checkIn does NOT overlap).
    const overlapping = await db.reservation.findFirst({
      where: {
        roomId,
        status: { in: ["UPCOMING", "ACTIVE"] },
        checkIn: { lt: checkOutDay },
        checkOut: { gt: checkInDay },
      },
      include: {
        guest: { select: { name: true, phone: true } },
      },
    });

    if (overlapping) {
      return NextResponse.json({
        error: "ROOM_CONFLICT",
        code: "ROOM_CONFLICT",
        conflict: { roomId, checkIn: overlapping.checkIn, checkOut: overlapping.checkOut, roomNumber: overlapping.room.number, roomName: overlapping.room.name },
      }, { status: 409 });
    }

    // ── Create reservation + update room status in a single transaction ──
    // Previously these were 2 separate DB operations — if the reservation
    // succeeded but the room-status update failed, the room would stay
    // AVAILABLE even though it had a booking. Now both succeed or both
    // roll back atomically.
    //
    // The suspect check (checkSuspectMatch) stays OUTSIDE the transaction
    // — it's fire-and-forget and should never block or roll back the
    // reservation if it fails.
    const reservation = await db.$transaction(async (tx) => {
      const res = await tx.reservation.create({
        data: {
          guestId,
          roomId,
          checkIn: checkInDay,
          checkOut: checkOutDay,
          nights,
          // Store the baseline rate used for cost calculation:
          // - If operator passed a custom roomRate, store that (it was applied to every night)
          // - Otherwise store the room's pricePerNight as the baseline (weekend premium is captured in totalCost)
          roomRate: roomRate && roomRate > 0 ? roomRate : room.pricePerNight,
          totalCost,
          paidAmount,
          balance,
          paymentStatus: "PENDING" as const,
          paymentMethod: paymentMethod || null,
          status: "UPCOMING" as const,
          notes: notes || "",
          taxAmount: tax,
          discountAmount: discount,
          secondGuestName: secondGuestName || "",
          secondGuestPhone: secondGuestPhone || "",
          secondGuestIdNumber: secondGuestIdNumber || "",
          exceptionallyReserved: exceptionallyReserved === true,
          exceptionReason: exceptionReason || "",
          providerId: providerId!,
          ...(groupBookingId ? { groupBookingId } : {}),
        },
        include: {
          guest: { select: { id: true, name: true, phone: true, idNumber: true, idType: true } },
          room: { select: { id: true, number: true, name: true } },
        },
      });

      // Update room status to RESERVED atomically — if this fails, the
      // entire transaction (including the reservation creation) rolls back.
      await tx.$queryRawUnsafe(
        `UPDATE "Room" SET "status" = 'RESERVED' WHERE "id" = $1`,
        roomId
      );

      return res;
    });


    // Check if guest matches any suspected person SYNCHRONOUSLY so the
    // alert appears in the suspect list BEFORE the API response returns.
    try {
      console.log("[reservations] Running suspect check for:", {
        name: reservation.guest?.name ?? "",
        phone: reservation.guest?.phone ?? "",
        idNumber: reservation.guest?.idNumber ?? "",
      });
      await checkSuspectMatch({
        name: reservation.guest?.name ?? "",
        phone: reservation.guest?.phone ?? "",
        idNumber: reservation.guest?.idNumber ?? "",
        idType: reservation.guest?.idType ?? "",
        matchType: "RESERVATION",
        providerId,
        reservationId: reservation.id,
        extraDetails: {
          checkIn: checkInDay,
          checkOut: checkOutDay,
          nights,
          roomNumber: reservation.room?.number ?? "",
          roomName: reservation.room?.name ?? "",
          totalCost,
        },
      });
      console.log("[reservations] Suspect check completed for reservation:", reservation.id);
    } catch (suspectErr) {
      console.error("[reservations] Suspect check failed (non-blocking):", suspectErr instanceof Error ? suspectErr.message : String(suspectErr));
      // Non-blocking — reservation was still created successfully
    }

    // Background: run anomaly detection (fire-and-forget)
    runAnomalyDetection({
      guestName: reservation.guest?.name ?? "",
      guestPhone: reservation.guest?.phone ?? "",
      providerId,
      reservationId: reservation.id,
      trigger: "RESERVATION",
    }).catch(() => {});

    // Staff activity log — who created this reservation
    logStaffActivity({
      req, userId: auth.userId, userName: auth.userName, action: "RESERVATION_CREATE", targetType: "RESERVATION", targetId: reservation.id,
      details: { guestName: reservation.guest?.name ?? "", roomNumber: reservation.room?.number ?? "", checkIn: checkInDay, checkOut: checkOutDay },
      providerId,
    });

    return NextResponse.json(reservation, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to create reservation";
    let status = 500;
    if (message.includes("required") || message.includes("not found")) status = 400;
    else if (message.includes("permission") || message.includes("cannot") || message.includes("Staff")) status = 403;
    else if (message.includes("ROOM_CONFLICT")) status = 409;
    return NextResponse.json({ error: message }, { status });
  }
}