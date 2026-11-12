import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { runAnomalyDetection } from "@/lib/anomaly-engine";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Ensure schema integrity — wrapped so errors don't escape the handler
  // (would cause Vercel to return plain-text error → frontend JSON parse fail)
  try {
    await ensureReservationIntegrity();
  } catch (migErr) {
    console.warn("[checkin] ensureReservationIntegrity failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
  }

  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { staffPermissionKey: "reservations", staffCanCreate: true });

    const { id } = await params;
    const { providerId } = getProviderFilter(auth);

    const reservation = await db.reservation.findFirst({
      where: { id, providerId },
      include: {
        guest: { select: { id: true, name: true, phone: true } },
        room: { select: { id: true, number: true, name: true, status: true } },
      },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    if (reservation.status !== "UPCOMING") {
      return NextResponse.json(
        { error: `Cannot check in a reservation with status '${reservation.status}'` },
        { status: 409 }
      );
    }

    // ── Check-in date window enforcement ──
    // The guesthouse only allows check-in to happen on or after the
    // scheduled arrival date, AND on or before the scheduled checkout
    // date. Operators cannot check a guest in:
    //   - before their scheduled arrival (e.g. tomorrow's booking today)
    //   - after their scheduled checkout (the booking has effectively lapsed)
    // `reservation.checkIn` / `checkOut` are stored as YYYY-MM-DD strings,
    // so a string comparison against today's local YYYY-MM-DD is correct.
    // Local date is used (not UTC) so the comparison matches the
    // operator's wall clock — e.g. a guest due to arrive on the 15th can
    // still be checked in at 23:00 local time on the 15th even though
    // UTC has already rolled over to the 16th.
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    if (todayStr < reservation.checkIn) {
      return NextResponse.json(
        {
          error: `Cannot check in before the scheduled arrival date (${reservation.checkIn}). Today is ${todayStr}.`,
          code: "CHECKIN_TOO_EARLY",
          details: { scheduledCheckIn: reservation.checkIn, today: todayStr },
        },
        { status: 409 }
      );
    }
    if (todayStr > reservation.checkOut) {
      return NextResponse.json(
        {
          error: `Cannot check in after the scheduled checkout date (${reservation.checkOut}). Today is ${todayStr}.`,
          code: "CHECKIN_TOO_LATE",
          details: { scheduledCheckOut: reservation.checkOut, today: todayStr },
        },
        { status: 409 }
      );
    }

    // ── Atomic check-in with row-level locking ──
    // Wraps the room-occupied check + reservation update + room status
    // update in a single DB transaction with SELECT ... FOR UPDATE on the
    // Room row. This prevents the race condition where two operators
    // simultaneously check in two different guests to the SAME room:
    //   Operator A: locks room row → sees AVAILABLE → updates → commits → unlocks
    //   Operator B: waits for lock → acquires → sees OCCUPIED → returns 409
    // Without this, both could read AVAILABLE concurrently and both succeed.
    const txResult = await db.$transaction(async (tx) => {
      // Lock the room row — prevents concurrent check-ins to the same room.
      // FOR UPDATE holds the lock until the transaction commits/rolls back.
      const rooms = await tx.$queryRaw<
        { id: string; status: string; number: string; name: string }[]
      >`SELECT "id", "status", "number", "name" FROM "Room" WHERE "id" = ${reservation.roomId} FOR UPDATE`;
      const room = rooms[0];
      if (!room) {
        return { error: "Room not found", status: 404 as const };
      }
      if (room.status === "OCCUPIED") {
        // Confirm the occupation is caused by a DIFFERENT reservation
        const otherActive = await tx.reservation.findFirst({
          where: {
            roomId: reservation.roomId,
            status: "ACTIVE",
            id: { not: reservation.id },
          },
          select: { id: true, guest: { select: { name: true } } },
        });
        if (otherActive) {
          return {
            error: `Room ${room.number}${room.name ? ` (${room.name})` : ""} is already occupied by ${otherActive.guest?.name || "another guest"}. Check out the current guest first.`,
            code: "ROOM_OCCUPIED" as const,
            status: 409 as const,
            details: { roomId: reservation.roomId, roomNumber: room.number, otherReservationId: otherActive.id },
          };
        }
      }

      // Update reservation status and actual check-in time
      const updated = await tx.reservation.update({
        where: { id },
        data: {
          status: "ACTIVE",
          actualCheckIn: now,
        },
        include: {
          guest: { select: { id: true, name: true, phone: true } },
          room: { select: { id: true, number: true, name: true, status: true } },
        },
      });

      // Update room status to OCCUPIED
      await tx.room.update({
        where: { id: reservation.roomId },
        data: { status: "OCCUPIED" },
      });

      return { updated };
    });

    // Handle transaction error responses (room not found / room occupied)
    if ("error" in txResult) {
      return NextResponse.json(
        {
          error: txResult.error,
          ...("code" in txResult ? { code: txResult.code } : {}),
          ...("details" in txResult ? { details: txResult.details } : {}),
        },
        { status: txResult.status }
      );
    }

    const updated = txResult.updated;

    // Staff log
    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req, userId, userName, action: "CHECKIN", targetType: "RESERVATION", targetId: id,
      details: { guestName: updated.guest?.name ?? "", roomNumber: updated.room?.number ?? "", checkIn: reservation.checkIn },
      providerId,
    });

    // Background: run anomaly detection on check-in (fire-and-forget)
    // Wrapped in try/catch in case the function throws synchronously
    // (before returning a Promise — .catch() only catches async rejections)
    try {
      await runAnomalyDetection({
        guestName: updated.guest?.name ?? "",
        guestPhone: updated.guest?.phone ?? "",
        providerId,
        reservationId: id,
        trigger: "CHECKIN",
      }).catch(() => {});
    } catch {
      // Non-blocking — anomaly detection is best-effort
    }

    // Note: Suspect matching now runs at RESERVATION CREATION time (not check-in)
    // so the alert appears in the suspect list as soon as the reservation is
    // confirmed. No need to re-check here — the alert already exists.

    // Update the SuspectMatch record to mark it as unread again (new activity)
    try {
      await db.suspectMatch.updateMany({
        where: { reservationId: id },
        data: { isRead: false },
      });
    } catch {
      // Non-blocking
    }

    return NextResponse.json(updated);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to check in";
    const status = message.includes("not found") ? 404 : message.includes("Cannot check in") ? 409 : message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}