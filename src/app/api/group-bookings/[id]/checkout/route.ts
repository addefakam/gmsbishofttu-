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
    const { providerId } = getProviderFilter(auth);

    const { id } = await params;

    const groupBooking = await db.groupBooking.findFirst({
      where: { id, ...(providerId ? { providerId } : {}) },
      include: {
        reservations: {
          where: { status: "ACTIVE" },
          include: {
            guest: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    });

    if (!groupBooking) {
      return NextResponse.json({ error: "Group booking not found" }, { status: 404 });
    }

    const activeReservations = groupBooking.reservations;
    if (activeReservations.length === 0) {
      return NextResponse.json({ error: "No active reservations to check out" }, { status: 409 });
    }

    const now = new Date();
    const results: { reservationId: string; guestName: string; roomNumber: string; success: boolean; error?: string }[] = [];
    let checkedOutCount = 0;

    for (const reservation of activeReservations) {
      try {
        const updated = await db.reservation.update({
          where: { id: reservation.id },
          data: { status: "COMPLETED", actualCheckOut: now },
        });

        // Free up the room
        await db.room.update({ select: { id: true, number: true, status: true, providerId: true },
          where: { id: reservation.roomId },
          data: { status: "AVAILABLE" },
        });

        // Update guest stats
        await db.guest.update({
          where: { id: reservation.guestId },
          data: {
            totalStays: { increment: 1 },
            totalSpent: { increment: reservation.totalCost },
          },
        });

        results.push({
          reservationId: reservation.id,
          guestName: reservation.guest?.name || "Unknown",
          roomNumber: reservation.room?.number || "?",
          success: true,
        });
        checkedOutCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({
          reservationId: reservation.id,
          guestName: reservation.guest?.name || "Unknown",
          roomNumber: reservation.room?.number || "?",
          success: false,
          error: msg,
        });
      }
    }

    // Update group booking status
    await db.groupBooking.update({
      where: { id },
      data: { status: "COMPLETED" },
    });

    // Staff log
    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req, userId, userName,
      action: "GROUP_CHECKOUT",
      targetType: "GROUP_BOOKING",
      targetId: id,
      details: { groupName: groupBooking.name, checkedOut: checkedOutCount, total: activeReservations.length },
      providerId,
    });

    return NextResponse.json({
      message: `${checkedOutCount} reservation(s) checked out successfully`,
      checkedOut: checkedOutCount,
      total: activeReservations.length,
      results,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[group-checkout POST]", error);
    return NextResponse.json({ error: "Group checkout failed" }, { status: 500 });
  }
}
