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
    checkWritePermission(auth, { staffPermissionKey: "reservations" });
    const { providerId } = getProviderFilter(auth);

    const { id } = await params;
    const body = await req.json();
    const { amount, method, referenceNo, notes } = body;

    if (!amount || !method) {
      return NextResponse.json({ error: "Amount and method are required" }, { status: 400 });
    }

    const groupBooking = await db.groupBooking.findFirst({
      where: { id, ...(providerId ? { providerId } : {}) },
      include: {
        reservations: {
          where: { status: { in: ["UPCOMING", "ACTIVE"] } },
          },
      },
    });

    if (!groupBooking) {
      return NextResponse.json({ error: "Group booking not found" }, { status: 404 });
    }

    const activeReservations = groupBooking.reservations;
    if (activeReservations.length === 0) {
      return NextResponse.json({ error: "No active reservations in this group" }, { status: 409 });
    }

    // Distribute payment evenly across reservations (proportional to cost)
    const totalGroupCost = activeReservations.reduce((sum, r) => sum + r.totalCost, 0);
    const paymentAmount = Number(amount);
    const paymentMethod = String(method);

    // Create individual payments per reservation, distributed proportionally
    const payments = [];
    let remaining = paymentAmount;

    for (let i = 0; i < activeReservations.length; i++) {
      const res = activeReservations[i];
      let share: number;

      if (i === activeReservations.length - 1) {
        // Last reservation gets the remainder
        share = remaining;
      } else {
        // Proportional distribution
        const ratio = totalGroupCost > 0 ? res.totalCost / totalGroupCost : 1 / activeReservations.length;
        share = Math.round(paymentAmount * ratio * 100) / 100;
        remaining = Math.round((remaining - share) * 100) / 100;
      }

      if (share <= 0) continue;

      const payment = await db.payment.create({
        data: {
          reservationId: res.id,
          amount: share,
          method: paymentMethod,
          referenceNo: referenceNo || "",
          notes: notes ? `[Group: ${groupBooking.name}] ${notes}` : `[Group: ${groupBooking.name}]`,
          providerId,
        },
      });

      // Update reservation paid amount
      const newPaid = res.paidAmount + share;
      const newBalance = res.totalCost - newPaid;
      let pStatus: string = "PARTIAL";
      if (newBalance <= 0) pStatus = "PAID";
      else if (newPaid <= 0) pStatus = "PENDING";

      await db.reservation.update({
        where: { id: res.id },
        data: { paidAmount: newPaid, balance: Math.max(0, newBalance), paymentStatus: pStatus },
      });

      payments.push({
        reservationId: res.id,
        amount: share,
        newPaid,
        newBalance: Math.max(0, newBalance),
        paymentStatus: pStatus,
      });
    }

    // Staff log
    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req, userId, userName,
      action: "GROUP_PAYMENT",
      targetType: "GROUP_BOOKING",
      targetId: id,
      details: { groupName: groupBooking.name, amount: paymentAmount, method: paymentMethod, reservationCount: payments.length },
      providerId,
    });

    return NextResponse.json({
      message: `Payment of ${paymentAmount} ETB distributed across ${payments.length} reservation(s)`,
      totalPaid: paymentAmount,
      distributed: payments,
    }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[group-payment POST]", error);
    return NextResponse.json({ error: "Group payment failed" }, { status: 500 });
  }
}
