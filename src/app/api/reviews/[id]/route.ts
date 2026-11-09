import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";

import { logStaffActivity } from "@/lib/staff-log";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
    await ensureReservationIntegrity();
    } catch (migErr) {
      console.warn("[[id]] ensureReservationIntegrity failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
    }
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { requireSuperuserOrOperator: true });

    const { id } = await params;

    const existing = await db.review.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    // Verify the review belongs to a reservation from this provider (unless police)
    const { isPolice, providerId } = getProviderFilter(auth);
    if (!isPolice) {
      const reservation = await db.reservation.findFirst({
        where: { id: existing.reservationId, providerId },
      });
      if (!reservation) {
        return NextResponse.json({ error: "Review not found" }, { status: 404 });
      }
    }

    await db.review.delete({ where: { id } });

        // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "REVIEW_DELETE",
      targetType: "RESERVATION",
      targetId: id,
      details: { rating: existing.rating || 0 },
      providerId,
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to delete review";
    const status =
      message.includes("not found") ? 404 :
      message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
