import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { logStaffActivity } from "@/lib/staff-log";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
export async function GET(req: NextRequest) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    const { isPolice, providerId } = getProviderFilter(auth);

    const where: Record<string, unknown> = {};
    if (!isPolice) {
      where.providerId = providerId;
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      db.payment.findMany({
        where,
        include: {
          reservation: {
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              guest: { select: { id: true, name: true, phone: true } },
            },
          },
          daytimeBooking: {
            select: {
              id: true,
              guestName: true,
              date: true,
              service: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.payment.count({ where }),
    ]);

    return NextResponse.json({ payments, total, page, limit });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch payments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    checkWritePermission(auth, { staffPermissionKey: "reservations" });

    const body = await req.json();
    const { reservationId, daytimeBookingId, amount, method, referenceNo, notes } = body;

    if (!amount || !method) {
      return NextResponse.json({ error: "Amount and method are required" }, { status: 400 });
    }

    if (!reservationId && !daytimeBookingId) {
      return NextResponse.json(
        { error: "Either reservationId or daytimeBookingId is required" },
        { status: 400 }
      );
    }

    const payment = await db.payment.create({
      data: {
        reservationId: reservationId || null,
        daytimeBookingId: daytimeBookingId || null,
        amount: Number(amount),
        method,
        referenceNo: referenceNo || "",
        notes: notes || "",
        providerId,
      },
    });

    // Update reservation paid amount and payment status
    if (reservationId) {
      const reservation = await db.reservation.findUnique({
        where: { id: reservationId },
      });
      if (reservation) {
        const newPaidAmount = reservation.paidAmount + Number(amount);
        const newBalance = reservation.totalCost - newPaidAmount;

        let paymentStatus: string = "PARTIAL";
        if (newBalance <= 0) {
          paymentStatus = "PAID";
        } else if (newPaidAmount <= 0) {
          paymentStatus = "PENDING";
        }

        await db.reservation.update({
          where: { id: reservationId },
          data: {
            paidAmount: newPaidAmount,
            balance: Math.max(0, newBalance),
            paymentStatus,
          },
        });
      }
    }

    // Update daytime booking paid amount and payment status
    if (daytimeBookingId) {
      const booking = await db.daytimeBooking.findUnique({
        where: { id: daytimeBookingId },
      });
      if (booking) {
        const newPaidAmount = booking.paidAmount + Number(amount);
        const newBalance = booking.totalCost - newPaidAmount;

        let paymentStatus: string = "PARTIAL";
        if (newBalance <= 0) {
          paymentStatus = "PAID";
        } else if (newPaidAmount <= 0) {
          paymentStatus = "PENDING";
        }

        await db.daytimeBooking.update({
          where: { id: daytimeBookingId },
          data: {
            paidAmount: newPaidAmount,
            paymentStatus,
          },
        });
      }
    }

    // Staff activity log
    logStaffActivity({
      req, userId: auth.userId, userName: auth.userName, action: "PAYMENT_RECORD", targetType: "PAYMENT", targetId: payment.id,
      details: { reservationId, amount, method: method || "" },
      providerId,
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to create payment";
    const status = message.includes("required") ? 400 : message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}