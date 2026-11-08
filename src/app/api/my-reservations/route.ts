import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyToken } from "@/lib/auth-utils";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";

/**
 * GET /api/my-reservations
 *
 * Auth required: ghms_guest_token cookie.
 *
 * Returns all reservations for the logged-in guest, newest first.
 * Includes room + provider info for display.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureReservationIntegrity();

    const token = req.cookies.get("ghms_guest_token")?.value;
    if (!token) {
      return NextResponse.json(
        { error: "Please sign in to view your reservations." },
        { status: 401 }
      );
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Session expired. Please sign in again." },
        { status: 401 }
      );
    }

    const guestId = payload.userId;

    const reservations = await db.reservation.findMany({
      where: { guestId },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        roomRate: true,
        totalCost: true,
        paidAmount: true,
        balance: true,
        paymentStatus: true,
        status: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        actualCheckIn: true,
        actualCheckOut: true,
        room: {
          select: {
            id: true,
            number: true,
            name: true,
            type: true,
            image: true,
            provider: {
              select: { id: true, name: true, phone: true, address: true, subCity: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ reservations });
  } catch (error: unknown) {
    console.error("[my-reservations] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch reservations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
