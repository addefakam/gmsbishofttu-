import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";
import { ensureNewTables } from "@/lib/ensure-tables";
import { isValidPhone, isValidEmail } from "@/lib/utils";
import { calculateStayTotal } from "@/lib/room-pricing";

export async function GET(req: NextRequest) {
  try {
    // ensureNewTables() internally calls ensureOwnerTables() which creates
    // the 3 new owner feature tables on every call.
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);

    const where: Record<string, unknown> = filter.isPolice
      ? {}
      : { providerId: filter.providerId };

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") || "";
    const q = searchParams.get("q") || "";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    if (status) where.status = status;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { contactName: { contains: q, mode: "insensitive" } },
        { contactPhone: { contains: q, mode: "insensitive" } },
      ];
    }

    const [data, total] = await Promise.all([
      db.groupBooking.findMany({
        where,
        include: {
          reservations: {
            include: {
              guest: { select: { id: true, name: true, phone: true, email: true } },
              room: { select: { id: true, number: true, name: true, type: true, pricePerNight: true } },
            },
            orderBy: { checkIn: "asc" },
          },
          _count: { select: { reservations: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.groupBooking.count({ where }),
    ]);

    return NextResponse.json({
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[group-bookings GET]", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("does not exist") || msg.includes("Unknown table") || msg.includes("relation")) {
      return NextResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    }
    return NextResponse.json({ error: "Failed to fetch group bookings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    if (!providerId) return NextResponse.json({ error: "Provider required" }, { status: 403 });

    const body = await req.json();
    const {
      name,
      contactName,
      contactPhone,
      contactEmail,
      startDate,
      endDate,
      notes,
      discountType,
      discountAmount,
      // NEW (count-based group creation):
      //   totalGuests — number of guests in this group (e.g. 10)
      //   roomIds    — array of room IDs the operator picked (length should equal totalGuests)
      //   guestNames — OPTIONAL array of real guest names; if provided, replaces the
      //                "Guest 1, Guest 2..." placeholders. Length should match totalGuests.
      totalGuests,
      roomIds,
      guestNames,
    } = body;

    if (!name || !startDate || !endDate) {
      return NextResponse.json({ error: "Name, startDate, and endDate are required" }, { status: 400 });
    }

    // Validate count-based fields if provided.
    const guestCount = Number(totalGuests) || 0;
    const pickedRoomIds: string[] = Array.isArray(roomIds) ? roomIds.filter((id: unknown) => typeof id === "string" && id.length > 0) : [];
    const pastedNames: string[] = Array.isArray(guestNames) ? guestNames.map((n: unknown) => String(n || "").trim()).filter((n: string) => n.length > 0) : [];

    if (guestCount > 0) {
      if (guestCount < 1 || guestCount > 200) {
        return NextResponse.json({ error: "Total guests must be between 1 and 200." }, { status: 400 });
      }
      if (pickedRoomIds.length !== guestCount) {
        return NextResponse.json(
          { error: `Please pick exactly ${guestCount} room(s) for ${guestCount} guest(s). You selected ${pickedRoomIds.length}.` },
          { status: 400 }
        );
      }
      // Duplicate room IDs would cause unique conflicts at check-in time — reject now.
      const uniqueRoomIds = new Set(pickedRoomIds);
      if (uniqueRoomIds.size !== pickedRoomIds.length) {
        return NextResponse.json({ error: "Duplicate room selected. Each guest needs a different room." }, { status: 400 });
      }
    }

    // Prevent past dates — group bookings are for future stays only.
    // Past-date reservations get auto-cancelled by the maintenance cron,
    // causing confusion for operators (guest appears as "Cancelled").
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (startDate < todayStr) {
      return NextResponse.json(
        { error: "Start date cannot be in the past. Please select today or a future date." },
        { status: 400 }
      );
    }
    if (endDate <= startDate) {
      return NextResponse.json(
        { error: "End date must be after the start date." },
        { status: 400 }
      );
    }

    if (contactPhone && !isValidPhone(contactPhone)) {
      return NextResponse.json({ error: "Invalid phone number format. Use 7-15 digits with optional + prefix." }, { status: 400 });
    }
    if (contactEmail && !isValidEmail(contactEmail)) {
      return NextResponse.json({ error: "Invalid email address format" }, { status: 400 });
    }

    // Validate discount fields if provided
    const validDiscountTypes = ["AMOUNT", "PERCENT"];
    const finalDiscountType = discountType && validDiscountTypes.includes(String(discountType)) ? String(discountType) : "AMOUNT";
    const finalDiscountAmount = discountAmount != null && !isNaN(Number(discountAmount)) && Number(discountAmount) > 0
      ? Number(discountAmount)
      : 0;
    // Cap percent at 100
    if (finalDiscountType === "PERCENT" && finalDiscountAmount > 100) {
      return NextResponse.json({ error: "Discount percentage cannot exceed 100%" }, { status: 400 });
    }

    // Create the group booking — wrap in try/catch in case the discountType/
    // discountAmount columns don't exist yet on the production DB. Fall back
    // to creating without those fields.
    let groupBooking;
    try {
      groupBooking = await db.groupBooking.create({
        data: {
          name,
          contactName: contactName || "",
          contactPhone: contactPhone || "",
          contactEmail: contactEmail || "",
          startDate,
          endDate,
          notes: notes || "",
          discountType: finalDiscountType,
          discountAmount: finalDiscountAmount,
          providerId,
        },
      });
    } catch (createErr: unknown) {
      const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
      if (errMsg.includes("discountType") || errMsg.includes("discountAmount") || errMsg.includes("does not exist")) {
        // Fallback: create without discount fields — the ALTER TABLE in
        // init-db.ts will add them on the next ensureDatabase() call.
        console.warn("[group-bookings POST] discount columns not found — creating without discount fields.");
        groupBooking = await db.groupBooking.create({
          data: {
            name,
            contactName: contactName || "",
            contactPhone: contactPhone || "",
            contactEmail: contactEmail || "",
            startDate,
            endDate,
            notes: notes || "",
            providerId,
          },
        });
      } else {
        throw createErr;
      }
    }

    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req,
      userId,
      userName,
      action: "CREATE_GROUP_BOOKING",
      targetType: "GROUP_BOOKING",
      targetId: groupBooking.id,
      details: { name, startDate, endDate, totalGuests: guestCount },
      providerId,
    });

    // ── Count-based creation: auto-create placeholder guests + reservations ──
    // For each picked room, create a placeholder Guest ("Guest N" or the
    // operator-provided name from the pastedNames array) and a Reservation
    // linking the guest to the room. This lets operators skip the tedious
    // "Add Guest" flow when they just need a block of rooms for a group.
    if (guestCount > 0 && pickedRoomIds.length === guestCount) {
      // Fetch room details (pricePerNight + weekend rate) for cost calculation.
      const roomsData = await db.room.findMany({
        where: { id: { in: pickedRoomIds } },
        select: { id: true, number: true, name: true, pricePerNight: true, pricePerNightWeekend: true, status: true, providerId: true },
      });

      // Validate all rooms exist + belong to this provider.
      if (roomsData.length !== pickedRoomIds.length) {
        return NextResponse.json(
          { error: "One or more selected rooms could not be found. Please refresh and try again." },
          { status: 400 }
        );
      }
      const wrongProvider = roomsData.find((r) => r.providerId !== providerId);
      if (wrongProvider) {
        return NextResponse.json({ error: `Room ${wrongProvider.number} does not belong to your property.` }, { status: 403 });
      }

      // Check for booking conflicts on each room in the [startDate, endDate) window.
      const conflicts: string[] = [];
      for (const roomId of pickedRoomIds) {
        const overlap = await db.reservation.findFirst({
          where: {
            roomId,
            status: { in: ["UPCOMING", "ACTIVE"] },
            checkIn: { lt: endDate },
            checkOut: { gt: startDate },
          },
          select: { id: true },
        });
        if (overlap) {
          const r = roomsData.find((x) => x.id === roomId);
          conflicts.push(r?.number || roomId);
        }
      }
      if (conflicts.length > 0) {
        // Clean up the group we just created — its rooms aren't actually bookable.
        await db.groupBooking.delete({ where: { id: groupBooking.id } }).catch(() => {});
        return NextResponse.json(
          { error: `ROOM_CONFLICT: Rooms already booked: ${conflicts.join(", ")}. Pick different rooms.` },
          { status: 409 }
        );
      }

      // Calculate nights for the stay window (same for all rooms in the group).
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffMs = end.getTime() - start.getTime();
      const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

      // Compute per-room cost using weekend-aware helper. Each room has its
      // own rate (Standard vs Suite etc.), so we can't just multiply.
      const reservationPayloads = pickedRoomIds.map((roomId, idx) => {
        const room = roomsData.find((r) => r.id === roomId)!;
        const subtotal = calculateStayTotal(startDate, endDate, {
          pricePerNight: room.pricePerNight,
          pricePerNightWeekend: room.pricePerNightWeekend,
        });
        // Use real name if operator provided one for this slot, else placeholder.
        const guestName = pastedNames[idx] || `Guest ${idx + 1}`;
        return { roomId, room, subtotal, guestName };
      });

      // Create everything in one transaction so a failure rolls back cleanly.
      await db.$transaction(async (tx) => {
        for (const item of reservationPayloads) {
          // Create the placeholder Guest record.
          const g = await tx.guest.create({
            data: {
              name: item.guestName,
              phone: "",
              providerId: providerId!,
            },
          });
          // Create the Reservation linked to the guest + room + group.
          await tx.reservation.create({
            data: {
              guestId: g.id,
              roomId: item.roomId,
              checkIn: startDate,
              checkOut: endDate,
              nights,
              roomRate: item.room.pricePerNight,
              totalCost: item.subtotal,
              paidAmount: 0,
              balance: item.subtotal,
              paymentStatus: "PENDING",
              status: "UPCOMING",
              notes: "",
              taxAmount: 0,
              discountAmount: 0,
              secondGuestName: "",
              secondGuestPhone: "",
              secondGuestIdNumber: "",
              exceptionallyReserved: false,
              exceptionReason: "",
              providerId: providerId!,
              groupBookingId: groupBooking.id,
            },
          });
          // Mark the room as RESERVED so it doesn't get double-booked.
          await tx.room.update({
            where: { id: item.roomId },
            data: { status: "RESERVED" },
          });
        }
      });

      // Recalculate totals on the group booking (totalRooms, totalGuests, totalCost).
      const finalReservations = await db.reservation.findMany({
        where: { groupBookingId: groupBooking.id },
        select: { roomId: true, guestId: true, totalCost: true },
      });
      const totalRooms = new Set(finalReservations.map((r) => r.roomId)).size;
      const totalGuestsCount = new Set(finalReservations.map((r) => r.guestId)).size;
      const totalCostSum = finalReservations.reduce((sum, r) => sum + r.totalCost, 0);
      await db.groupBooking.update({
        where: { id: groupBooking.id },
        data: { totalRooms, totalGuests: totalGuestsCount, totalCost: totalCostSum },
      });
    }

    return NextResponse.json(groupBooking, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[group-bookings POST]", error);
    return NextResponse.json({ error: "Failed to create group booking" }, { status: 500 });
  }
}
