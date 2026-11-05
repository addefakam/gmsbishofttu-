import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { logStaffActivity } from "@/lib/staff-log";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { staffPermissionKey: "reservations", staffCanCreate: true });

    const { id } = await params;
    const { providerId } = getProviderFilter(auth);

    const reservation = await db.reservation.findFirst({
      where: { id, providerId },
      // Include the room relation — needed below to check whether to
      // release it back to AVAILABLE (only if it was RESERVED/OCCUPIED).
      // Previously this `include` was missing, so `reservation.room`
      // was undefined → accessing `reservation.room.status` threw
      // "Cannot read properties of undefined (reading 'status')" and
      // the cancel request 500'd before reaching the status update.
      include: { room: { select: { id: true, number: true, name: true, status: true } } },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    if (reservation.status === "COMPLETED" || reservation.status === "CANCELLED" || reservation.status === "DELETED") {
      return NextResponse.json(
        { error: `Cannot cancel a reservation with status '${reservation.status}'` },
        { status: 409 }
      );
    }

    // Update reservation status to CANCELLED
    const updated = await db.reservation.update({
      where: { id },
      data: {
        status: "CANCELLED",
      },
      include: {
        guest: { select: { id: true, name: true, phone: true } },
      },
    });

    // Release room back to AVAILABLE if it was RESERVED or OCCUPIED
    if (
      reservation.room.status === "OCCUPIED" || reservation.room.status === "RESERVED"
    ) {
      await db.room.update({ select: { id: true, number: true, status: true, providerId: true },
        where: { id: reservation.roomId },
        data: { status: "AVAILABLE" },
      });
    }

    // Mark SuspectMatch as unread again (status changed to CANCELLED)
    try {
      await db.suspectMatch.updateMany({
        where: { reservationId: id },
        data: { isRead: false },
      });
    } catch {
      // Non-blocking
    }

    // Staff activity log
    logStaffActivity({
      req, userId: auth.userId, userName: auth.userName, action: "RESERVATION_CANCEL", targetType: "RESERVATION", targetId: id,
      details: { guestName: updated.guest?.name ?? "" },
      providerId,
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to cancel reservation";
    const status = message.includes("not found") ? 404 : message.includes("Cannot cancel") ? 409 : message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}