import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
export async function GET(req: NextRequest) {
    try {
    await ensureReservationIntegrity();
    } catch (migErr) {
      console.warn("[reports] ensureReservationIntegrity failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
    }
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);

    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";

    // Build date filter for Prisma ORM (no raw SQL)
    const dateFilter = from || to ? {
      checkIn: { gte: from || undefined, lte: to || undefined },
    } : {};

    // Run all independent queries in parallel
    const [
      reservationRevenue,
      totalRooms,
      occupiedRooms,
      activeReservations,
      allReservations,
      expenseTotalResult,
      expenseBreakdownRaw,
    ] = await Promise.all([
      // Reservation revenue (aggregated at DB level)
      db.reservation.aggregate({
        _sum: { paidAmount: true },
        where: { providerId, ...dateFilter, status: "COMPLETED" },
      }),
      db.room.count({ where: { providerId } }),
      db.room.count({ where: { providerId, status: "OCCUPIED" } }),
      // Active reservations
      db.reservation.findMany({
        where: { providerId, status: { in: ["ACTIVE", "UPCOMING"] } },
        select: {
          id: true, checkIn: true, checkOut: true, nights: true, totalCost: true,
          paidAmount: true, paymentStatus: true, status: true, notes: true,
          guest: { select: { id: true, name: true, phone: true, email: true, idNumber: true, idType: true, nationality: true, address: true, notes: true, vip: true, createdAt: true } },
        },
        orderBy: { checkIn: "desc" },
        take: 50,
      }),
      // All reservations in date range (for status breakdown + served guests)
      db.reservation.findMany({
        where: { providerId, ...dateFilter },
        select: {
          id: true, checkIn: true, checkOut: true, nights: true, totalCost: true,
          paidAmount: true, paymentStatus: true, status: true, notes: true,
          guest: { select: { id: true, name: true, phone: true, email: true, idNumber: true, idType: true, nationality: true, address: true, notes: true, vip: true, createdAt: true } },
        },
        orderBy: { checkIn: "desc" },
        take: 500,
      }),
      // Expenses total
      db.expense.aggregate({
        _sum: { amount: true },
        where: {
          providerId,
          ...(from || to ? { date: { gte: from || undefined, lte: to || undefined } } : {}),
        },
      }),
      // Expense breakdown by category
      db.expense.groupBy({
        by: ["category"],
        _sum: { amount: true },
        where: {
          providerId,
          ...(from || to ? { date: { gte: from || undefined, lte: to || undefined } } : {}),
        },
      }),
    ]);

    // Daytime booking revenue (separate — may fail if table doesn't exist yet)
    let daytimeRevenue = 0;
    try {
      const dayRes = await db.daytimeBooking.aggregate({
        _sum: { paidAmount: true },
        where: {
          providerId,
          ...(from || to ? { date: { gte: from || undefined, lte: to || undefined } } : {}),
        },
      });
      daytimeRevenue = dayRes._sum.paidAmount || 0;
    } catch {
      // DaytimeBooking table may not exist yet — skip
    }

    const revenue = (reservationRevenue._sum.paidAmount || 0) + daytimeRevenue;
    const expensesTotal = expenseTotalResult._sum.amount || 0;
    const profit = revenue - expensesTotal;
    const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

    // Expense breakdown
    const expenseBreakdown = expenseBreakdownRaw.map((g) => ({
      category: g.category || "Other",
      amount: g._sum.amount || 0,
    }));

    // Daily revenue from allReservations (avoid extra query)
    const dailyMap = new Map<string, number>();
    for (const r of allReservations) {
      if (r.status === "COMPLETED" && r.paidAmount > 0) {
        const d = r.checkIn?.split("T")[0] || r.checkIn;
        if (d) dailyMap.set(d, (dailyMap.get(d) || 0) + r.paidAmount);
      }
    }
    const dailyRevenue = Array.from(dailyMap.entries())
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      revenue,
      expenses: expensesTotal,
      profit,
      occupancyRate: Math.round(occupancyRate * 100) / 100,
      reservations: allReservations,
      activeGuests: activeReservations,
      expenseBreakdown,
      dailyRevenue,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to generate report";
    console.error("[reports]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
