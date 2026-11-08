import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyToken } from "@/lib/auth-utils";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";

/**
 * POST /api/public/reservations
 *
 * Auth required: ghms_guest_token cookie (set by /api/guest-auth/otp/verify).
 *
 * Body: {
 *   roomId: "abc123",
 *   checkIn: "2026-12-01",
 *   checkOut: "2026-12-03",
 *   guestNotes: "I'll arrive around 6pm"
 * }
 *
 * Creates a PENDING reservation (status: UPCOMING, paymentStatus: PENDING).
 * The provider must approve it via their dashboard before it becomes active.
 *
 * Returns the created reservation with room + provider info.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureReservationIntegrity();

    // ── Auth: verify guest token ──
    const token = req.cookies.get("ghms_guest_token")?.value;
    if (!token) {
      return NextResponse.json(
        { error: "Please sign in to book a room.", code: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Session expired. Please sign in again.", code: "TOKEN_EXPIRED" },
        { status: 401 }
      );
    }

    const guestId = payload.userId;

    // ── Parse body ──
    const body = await req.json();
    const roomId = (body?.roomId || "").trim();
    const checkIn = (body?.checkIn || "").trim();
    const checkOut = (body?.checkOut || "").trim();
    const guestNotes = (body?.guestNotes || "").trim();

    if (!roomId || !checkIn || !checkOut) {
      return NextResponse.json(
        { error: "Room ID, check-in date, and check-out date are required." },
        { status: 400 }
      );
    }

    // Validate date format (YYYY-MM-DD).
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(checkIn) || !dateRegex.test(checkOut)) {
      return NextResponse.json(
        { error: "Dates must be in YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    // Check-out must be after check-in.
    if (checkOut <= checkIn) {
      return NextResponse.json(
        { error: "Check-out date must be after check-in date." },
        { status: 400 }
      );
    }

    // ── Fetch room + verify provider is APPROVED ──
    const room = await db.room.findUnique({
      where: { id: roomId },
      select: {
        id: true, number: true, name: true, type: true,
        pricePerNight: true, pricePerNightWeekend: true,
        capacity: true, providerId: true,
        provider: { select: { id: true, name: true, status: true } },
      },
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    if (room.provider.status !== "APPROVED") {
      return NextResponse.json(
        { error: "This guesthouse is not currently accepting bookings." },
        { status: 403 }
      );
    }

    // ── Check availability (no overlapping reservation) ──
    const overlapping = await db.reservation.findFirst({
      where: {
        roomId: room.id,
        status: { in: ["UPCOMING", "ACTIVE"] },
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
      select: { id: true },
    });

    if (overlapping) {
      return NextResponse.json(
        { error: "This room is already booked for the selected dates. Please choose different dates or another room.", code: "ROOM_UNAVAILABLE" },
        { status: 409 }
      );
    }

    // ── Calculate nights + total cost ──
    const checkInDate = new Date(checkIn + "T00:00:00");
    const checkOutDate = new Date(checkOut + "T00:00:00");
    const diffMs = checkOutDate.getTime() - checkInDate.getTime();
    const nights = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));

    // Apply weekend pricing (Friday + Saturday nights) if configured.
    let totalCost = 0;
    for (let i = 0; i < nights; i++) {
      const nightDate = new Date(checkInDate);
      nightDate.setDate(nightDate.getDate() + i);
      const dayOfWeek = nightDate.getDay(); // 0=Sun, 5=Fri, 6=Sat
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
      if (isWeekend && room.pricePerNightWeekend && room.pricePerNightWeekend > 0) {
        totalCost += room.pricePerNightWeekend;
      } else {
        totalCost += room.pricePerNight;
      }
    }

    // ── Create the reservation (PENDING approval from provider) ──
    const reservation = await db.reservation.create({
      data: {
        guestId,
        roomId: room.id,
        checkIn,
        checkOut,
        nights,
        roomRate: room.pricePerNight,
        totalCost,
        paidAmount: 0,
        balance: totalCost,
        paymentStatus: "PENDING",
        status: "UPCOMING", // PENDING until provider approves
        notes: guestNotes || "Booked via Bishoftu Rooms app",
        providerId: room.providerId,
      },
      select: {
        id: true, checkIn: true, checkOut: true, nights: true,
        roomRate: true, totalCost: true, balance: true,
        paymentStatus: true, status: true, notes: true,
        createdAt: true,
        room: { select: { id: true, number: true, name: true, type: true } },
        provider: { select: { id: true, name: true, phone: true, address: true } },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Booking request submitted! The guesthouse will review and confirm your reservation shortly.",
      reservation,
    }, { status: 201 });
  } catch (error: unknown) {
    console.error("[public/reservations] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to create reservation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
