import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError, checkWritePermission } from "@/lib/tenant";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
/**
 * POST /api/group-bookings/[id]/auto-assign
 * Automatically assigns available rooms to guests in a group booking.
 * Guests without a reservation get one; guests with a reservation but no room conflict keep theirs.
 * Returns the full assignment map: guest → room.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
    await ensureReservationIntegrity();
    } catch (migErr) {
      console.warn("[auto-assign] ensureReservationIntegrity failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
    }
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    if (!providerId) return NextResponse.json({ error: "Provider required" }, { status: 403 });
    checkWritePermission(auth, { staffPermissionKey: "reservations" });

    const { id } = await params;

    const booking = await db.groupBooking.findFirst({
      where: { id, providerId },
    });
    if (!booking) return NextResponse.json({ error: "Group booking not found" }, { status: 404 });

    const { startDate, endDate } = booking;

    // Guests already in the group (from existing reservations)
    const guestsWithReservation = new Map<string, string>(); // guestId → reservationId
    for (const r of booking.reservations) {
      guestsWithReservation.set(r.guestId, r.id);
    }

    // If no guests yet, check if there are guests in the body
    const body = await req.json().catch(() => ({}));
    const guestIds: string[] = body.guestIds || [];

    // All guest IDs that need rooms = existing + new from body
    const allGuestIds = [...new Set([...guestsWithReservation.keys(), ...guestIds])];

    if (allGuestIds.length === 0) {
      return NextResponse.json({ error: "No guests to assign. Add guests to the group first." }, { status: 400 });
    }

    // Verify all guests exist and belong to this provider
    const guests = await db.guest.findMany({
      where: { id: { in: allGuestIds }, providerId },
      select: { id: true, name: true, phone: true },
    });
    if (guests.length === 0) {
      return NextResponse.json({ error: "No valid guests found" }, { status: 400 });
    }

    // Find rooms that are AVAILABLE and not conflicting with the date range
    const conflictingRoomIds = await db.reservation.findMany({
      where: {
        status: { in: ["UPCOMING", "ACTIVE"] },
        checkIn: { lte: endDate },
        checkOut: { gte: startDate },
      },
      select: { roomId: true },
    }).then((res) => new Set(res.map((r) => r.roomId)));

    const availableRooms = await db.room.findMany({ select: { id: true, number: true, name: true, pricePerNight: true, capacity: true, status: true, providerId: true, floor: true },
      where: {
        providerId,
        status: { in: ["AVAILABLE", "RESERVED"] },
        id: { notIn: [...conflictingRoomIds] },
      },
      select: { id: true, number: true, name: true, pricePerNight: true, capacity: true },
      orderBy: [{ capacity: "desc" }, { pricePerNight: "asc" }],
    });

    // Guests that still need a new reservation
    const guestsNeedingRoom = guests.filter((g) => !guestsWithReservation.has(g.id));
    const canAssign = Math.min(guestsNeedingRoom.length, availableRooms.length);

    if (canAssign === 0 && guestsNeedingRoom.length > 0) {
      return NextResponse.json({
        error: "No available rooms for the selected dates. All rooms are booked or occupied.",
        code: "NO_ROOMS",
        requested: guestsNeedingRoom.length,
        available: 0,
      }, { status: 409 });
    }

    // Calculate nights
    const start = new Date(startDate);
    const end = new Date(endDate);
    const nights = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

    // Create reservations for unassigned guests
    const assignments: Array<{
      guestId: string;
      guestName: string;
      guestPhone: string;
      roomId: string;
      roomNumber: string;
      roomName: string;
      roomType: string;
      pricePerNight: number;
      totalCost: number;
      isNew: boolean;
    }> = [];

    // Add existing reservations to assignments
    for (const r of booking.reservations) {
      assignments.push({
        guestId: r.guestId,
        guestName: r.guest.name,
        guestPhone: r.guest.phone,
        roomId: r.roomId,
        roomNumber: r.room.number,
        roomName: r.room.name,
        roomType: r.room.type,
        pricePerNight: r.room.pricePerNight,
        totalCost: r.totalCost,
        isNew: false,
      });
    }

    // Assign rooms to guests needing them
    for (let i = 0; i < canAssign; i++) {
      const guest = guestsNeedingRoom[i];
      const room = availableRooms[i];
      const totalCost = room.pricePerNight * nights;

      const reservation = await db.reservation.create({
        data: {
          guestId: guest.id,
          roomId: room.id,
          checkIn: startDate,
          checkOut: endDate,
          nights,
          roomRate: room.pricePerNight,
          totalCost,
          paidAmount: 0,
          balance: totalCost,
          paymentStatus: "PENDING",
          status: "UPCOMING",
          providerId,
          groupBookingId: id,
        },
        include: {
          guest: { select: { name: true, phone: true } },
        },
      });

      assignments.push({
        guestId: guest.id,
        guestName: reservation.guest.name,
        guestPhone: reservation.guest.phone,
        roomId: room.id,
        roomNumber: reservation.room.number,
        roomName: reservation.room.name,
        roomType: reservation.room.type,
        pricePerNight: room.pricePerNight,
        totalCost,
        isNew: true,
      });
    }

    // Recalculate group booking totals
    const allReservations = await db.reservation.findMany({ where: { groupBookingId: id } });
    await db.groupBooking.update({
      where: { id },
      data: {
        totalRooms: new Set(allReservations.map((r) => r.roomId)).size,
        totalGuests: new Set(allReservations.map((r) => r.guestId)).size,
        totalCost: allReservations.reduce((s, r) => s + r.totalCost, 0),
      },
    });

    const unassigned = guestsNeedingRoom.slice(canAssign).map((g) => ({
      guestId: g.id,
      guestName: g.name,
      reason: "No available rooms",
    }));

    return NextResponse.json({
      assigned: assignments,
      unassigned,
      totalAssigned: assignments.length,
      totalGuests: allGuestIds.length,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[group-bookings auto-assign]", error);
    const msg = error instanceof Error ? error.message : "Auto-assign failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
