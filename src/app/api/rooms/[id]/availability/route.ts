import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";
import { runReservationMaintenance, todayStr } from "@/lib/reservation-maintenance";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
/**
 * Per-room availability — returns the booked date ranges that block new
 * bookings for this room.
 *
 * Occupancy model (checkout day is bookable as the next arrival):
 *   a reservation [checkIn, checkOut) occupies the NIGHTS checkIn … checkOut-1.
 *   The checkOut day itself is a turnover day and stays selectable as the
 *   arrival date of a new reservation.
 *
 * Only UPCOMING / ACTIVE reservations block dates. CANCELLED, COMPLETED and
 * DELETED reservations free their dates again.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    const { isPolice, providerId } = getProviderFilter(auth);

    const { id } = await params;

    // Lazy maintenance (throttled) so stale reservations / stuck room flags
    // are healed before their date ranges are computed. Never blocks the read.
    try {
      await runReservationMaintenance(isPolice ? {} : { providerId });
    } catch {
      // Ignore — maintenance must not break availability reads.
    }

    const room = await db.room.findUnique({
      where: { id },
      select: { id: true, number: true, name: true, status: true, providerId: true },
    });
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (!isPolice && room.providerId !== providerId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const reservations = await db.reservation.findMany({
      where: {
        roomId: id,
        status: { in: ["UPCOMING", "ACTIVE"] },
      },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        status: true,
        guest: { select: { name: true, phone: true } },
      },
      orderBy: { checkIn: "asc" },
    });

    return NextResponse.json({
      roomId: room.id,
      roomNumber: room.number,
      roomName: room.name,
      today: todayStr(),
      // checkIn/checkOut are half-open: [checkIn, checkOut) — the checkout
      // day is NOT occupied (new arrivals may book it).
      bookedRanges: reservations.map((r) => ({
        id: r.id,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        status: r.status,
        guestName: r.guest?.name || "",
        guestPhone: r.guest?.phone || "",
      })),
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to load availability";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
