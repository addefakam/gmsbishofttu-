import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";

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

    const reservation = await db.reservation.findFirst({ where: { id, providerId } });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    if (reservation.status !== "ACTIVE") {
      return NextResponse.json(
        { error: `Cannot check out a reservation with status '${reservation.status}'` },
        { status: 409 }
      );
    }

    const now = new Date();

    // Update reservation status and actual check-out time
    const updated = await db.reservation.update({
      where: { id },
      data: {
        status: "COMPLETED",
        actualCheckOut: now,
      },
      include: {
        guest: { select: { id: true, name: true, phone: true } },
      },
    });

    // Update room status to AVAILABLE
    await db.room.update({ select: { id: true, number: true, status: true, providerId: true },
      where: { id: reservation.roomId },
      data: { status: "AVAILABLE" },
    });

    // Staff log
    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req, userId, userName, action: "CHECKOUT", targetType: "RESERVATION", targetId: id,
      details: { guestName: updated.guest?.name ?? "", roomNumber: updated.room?.number ?? "", totalCost: reservation.totalCost },
      providerId,
    });

    // Update guest stats
    await db.guest.update({
      where: { id: reservation.guestId },
      data: {
        totalStays: { increment: 1 },
        totalSpent: { increment: reservation.totalCost },
      },
    });

    // Mark SuspectMatch as unread again (status changed to COMPLETED)
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
    const message = error instanceof Error ? error.message : "Failed to check out";
    const status = message.includes("not found") ? 404 : message.includes("Cannot check out") ? 409 : message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}