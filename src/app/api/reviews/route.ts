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

    const { searchParams } = req.nextUrl;
    const reservationId = searchParams.get("reservationId");

    const where: Record<string, unknown> = {};
    if (isPolice) {
      if (reservationId) where.reservationId = reservationId;
    } else {
      where.reservationId = reservationId || undefined;
    }

    // For non-police, only show reviews for reservations belonging to their provider
    if (!isPolice && !reservationId) {
      const reservations = await db.reservation.findMany({
        where: { providerId },
        select: { id: true },
      });
      where.reservationId = { in: reservations.map((r) => r.id) };
    } else if (!isPolice && reservationId) {
      // Verify the reservation belongs to this provider
      const reservation = await db.reservation.findFirst({
        where: { id: reservationId, providerId },
      });
      if (!reservation) {
        return NextResponse.json([]);
      }
    }

    // Pagination
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      db.review.findMany({
        where,
        select: {
          id: true, guestId: true, reservationId: true, rating: true,
          createdAt: true,
          guest: { select: { id: true, name: true } },
          reservation: { select: { id: true, checkIn: true, checkOut: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.review.count({ where }),
    ]);

    return NextResponse.json({ data: reviews, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch reviews";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { requireSuperuserOrOperator: true, staffPermissionKey: "reservations", staffCanCreate: true });

    const body = await req.json();
    const { guestId, reservationId, rating, comment } = body;

    if (!guestId || !reservationId || rating == null) {
      return NextResponse.json(
        { error: "guestId, reservationId, and rating are required" },
        { status: 400 }
      );
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    const review = await db.review.create({
      data: {
        guestId,
        reservationId,
        rating: Number(rating),
        comment: comment || "",
      },
    });

        // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "REVIEW_CREATE",
      targetType: "RESERVATION",
      targetId: id,
      details: { rating: review.rating || 0, comment: review.comment || "" },
      providerId,
    });
    return NextResponse.json(review, { status: 201 });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to create review";
    const status =
      message.includes("required") || message.includes("between") ? 400 :
      message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}