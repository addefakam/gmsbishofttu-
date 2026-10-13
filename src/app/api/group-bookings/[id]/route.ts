import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";
import { ensureNewTables } from "@/lib/ensure-tables";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);

    const { id } = await params;
    const booking = await db.groupBooking.findFirst({
      where: {
        id,
        ...(filter.isPolice ? {} : { providerId: filter.providerId }),
      },
      include: {
        reservations: {
          include: {
            guest: { select: { id: true, name: true, phone: true, email: true } },
            // Include `room` so consumers can render `res.room.number` without
            // crashing with "cannot read properties of undefined (reading 'number')".
            // Reservations without a room return room: null — guards in the UI
            // already handle that case.
            room: { select: { id: true, number: true, name: true, type: true, pricePerNight: true } },
          },
          orderBy: { checkIn: "asc" },
        },
      },
    });

    if (!booking) return NextResponse.json({ error: "Group booking not found" }, { status: 404 });
    return NextResponse.json(booking);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[group-bookings GET by id]", error);
    return NextResponse.json({ error: "Failed to fetch group booking" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    if (!providerId) return NextResponse.json({ error: "Provider required" }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    const { name, contactName, contactPhone, contactEmail, startDate, endDate, notes, status, discountType, discountAmount } = body;

    const existing = await db.groupBooking.findFirst({ where: { id, providerId } });
    if (!existing) return NextResponse.json({ error: "Group booking not found" }, { status: 404 });

    // Validate discount fields if provided
    const validDiscountTypes = ["AMOUNT", "PERCENT"];
    const finalDiscountType = discountType && validDiscountTypes.includes(String(discountType)) ? String(discountType) : existing.discountType || "AMOUNT";
    let finalDiscountAmount = existing.discountAmount || 0;
    if (discountAmount !== undefined) {
      finalDiscountAmount = !isNaN(Number(discountAmount)) && Number(discountAmount) > 0 ? Number(discountAmount) : 0;
    }
    if (finalDiscountType === "PERCENT" && finalDiscountAmount > 100) {
      return NextResponse.json({ error: "Discount percentage cannot exceed 100%" }, { status: 400 });
    }

    const reservations = await db.reservation.findMany({
      where: { groupBookingId: id },
    });
    const totalRooms = new Set(reservations.map((r) => r.roomId)).size;
    const totalGuests = new Set(reservations.map((r) => r.guestId)).size;
    const totalCost = reservations.reduce((sum, r) => sum + r.totalCost, 0);

    const updated = await db.groupBooking.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(contactName !== undefined ? { contactName } : {}),
        ...(contactPhone !== undefined ? { contactPhone } : {}),
        ...(contactEmail !== undefined ? { contactEmail } : {}),
        ...(startDate !== undefined ? { startDate } : {}),
        ...(endDate !== undefined ? { endDate } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(discountType !== undefined ? { discountType: finalDiscountType } : {}),
        ...(discountAmount !== undefined ? { discountAmount: finalDiscountAmount } : {}),
        totalRooms,
        totalGuests,
        totalCost,
      },
    });

    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req, userId, userName,
      action: "UPDATE_GROUP_BOOKING",
      targetType: "GROUP_BOOKING",
      targetId: id,
      details: { changes: body, totalRooms, totalGuests, totalCost, discountType: finalDiscountType, discountAmount: finalDiscountAmount },
      providerId,
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[group-bookings PUT]", error);
    return NextResponse.json({ error: "Failed to update group booking" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    if (!providerId) return NextResponse.json({ error: "Provider required" }, { status: 403 });

    const { id } = await params;
    const existing = await db.groupBooking.findFirst({ where: { id, providerId } });
    if (!existing) return NextResponse.json({ error: "Group booking not found" }, { status: 404 });

    await db.reservation.updateMany({
      where: { groupBookingId: id },
      data: { groupBookingId: null },
    });

    await db.groupBooking.delete({ where: { id } });

    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req, userId, userName,
      action: "DELETE_GROUP_BOOKING",
      targetType: "GROUP_BOOKING",
      targetId: id,
      details: { name: existing.name },
      providerId,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[group-bookings DELETE]", error);
    return NextResponse.json({ error: "Failed to delete group booking" }, { status: 500 });
  }
}
