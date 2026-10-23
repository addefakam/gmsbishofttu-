import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";
import { calcSubscriptionStatus, TRIAL_DAYS } from "@/lib/subscription";
import { todayStr } from "@/lib/reservation-maintenance";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);

    const where = filter.isPolice ? {} : (filter.providerId ? { providerId: filter.providerId } : {});

    // Today (app home timezone, Africa/Addis_Ababa) & month boundaries.
    // toISOString() would give the UTC date, which is still "yesterday"
    // between 00:00 and 03:00 local time — that made Today's Schedule show
    // the wrong day every early morning.
    const now = new Date();
    const today = todayStr();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Last 7 days boundary (start of day 6 days ago)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // ── Run core queries in parallel (all roles) ──
    // Use raw SQL for room status counts to avoid Prisma's prepared-statement
    // cache issue with newly-added enum values .
    const [roomStatusCountsRaw, activeReservations, todayCheckins, todayCheckouts, revenueResult, activityLogs] =
      await Promise.all([
        // Use Prisma.sql / Prisma.empty for fragment composition.
        // Interpolating db.$queryRaw inside another db.$queryRaw binds a
        // PrismaPromise as a $1 SQL parameter → invalid SQL → 500 error.
        // This was the root cause of the dashboard "Internal server error"
        // for guesthouse owners (OPERATOR role with providerId).
        db.$queryRaw<{ status: string; count: bigint }[]>`
          SELECT status, COUNT(*)::bigint as count FROM "Room"
          ${where.providerId ? Prisma.sql`WHERE "providerId" = ${where.providerId}` : Prisma.empty}
          GROUP BY status
        `,
        db.reservation.count({ where: { ...where, status: "ACTIVE" } }),
        // Arrivals scheduled for today: still pending (UPCOMING) or already
        // checked in (ACTIVE). Counting only UPCOMING made the number drop
        // to zero as soon as the guest was checked in. CANCELLED/DELETED
        // never count; checkIn is a plain YYYY-MM-DD string.
        db.reservation.count({ where: { ...where, status: { in: ["UPCOMING", "ACTIVE"] }, checkIn: today } }),
        // Departures scheduled for today: in-house (ACTIVE), never-checked-in
        // bookings ending today (UPCOMING), and guests who already checked
        // out today (COMPLETED) so the schedule stays stable through the day.
        db.reservation.count({ where: { ...where, status: { in: ["UPCOMING", "ACTIVE", "COMPLETED"] }, checkOut: today } }),
        db.reservation.aggregate({
          _sum: { paidAmount: true },
          where: { ...where, status: "COMPLETED", actualCheckOut: { gte: monthStart, lte: monthEnd } },
        }),
        db.activityLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 15,
        }),
      ]);

    // ── Revenue last 7 days (safe wrapper) ──
    let revenueLast7DaysRaw: { date: string; amount: number }[] = [];
    try {
      if (filter.isPolice) {
        revenueLast7DaysRaw = await db.$queryRawUnsafe<{ date: string; amount: number }[]>(
          `SELECT DATE("createdAt")::text AS date, COALESCE(SUM("amount"), 0)::float AS amount FROM "Payment" WHERE "createdAt" >= $1 GROUP BY DATE("createdAt") ORDER BY date ASC`,
          sevenDaysAgo.toISOString()
        );
      } else if (filter.providerId) {
        revenueLast7DaysRaw = await db.$queryRawUnsafe<{ date: string; amount: number }[]>(
          `SELECT DATE("createdAt")::text AS date, COALESCE(SUM("amount"), 0)::float AS amount FROM "Payment" WHERE "providerId" = $1 AND "createdAt" >= $2 GROUP BY DATE("createdAt") ORDER BY date ASC`,
          filter.providerId,
          sevenDaysAgo.toISOString()
        );
      }
    } catch (err) {
      console.error("[dashboard] Revenue 7-day query failed (non-fatal):", err instanceof Error ? err.message : err);
      revenueLast7DaysRaw = [];
    }

    // ── Subscription + provider info (OPERATOR/STAFF only, safe wrapper) ──
    // When the global subscription system is disabled (super-admin toggled
    // it off in System Config → Payment & Billing), short-circuit to exempt
    // so no banner/lockout/sidebar-status is shown to operators.
    let subResult: { subscription: any; provider: any } | null = null;
    let subscriptionSystemDisabled = false;
    if (auth.role !== "SUPERUSER" && auth.role !== "POLICE" && auth.providerId) {
      try {
        // Read the global subscriptionEnabled flag from Settings.configJson
        const sysSettings = await db.settings.findFirst({ where: { providerId: null } });
        let subscriptionEnabled = true;
        if (sysSettings?.configJson && typeof sysSettings.configJson === "object") {
          const config = sysSettings.configJson as Record<string, unknown>;
          const payment = config.payment;
          if (payment && typeof payment === "object") {
            const p = payment as Record<string, unknown>;
            subscriptionEnabled = p.subscriptionEnabled !== false;
          }
        }
        if (!subscriptionEnabled) {
          subscriptionSystemDisabled = true;
          // Skip the subscription query entirely — operator is exempt
          subResult = null;
        } else {
          const [sub, prov] = await Promise.all([
            db.subscription.findFirst({ where: { providerId: auth.providerId } }),
            db.provider.findFirst({
              where: { id: auth.providerId },
              select: { name: true, ownerName: true, phone: true, status: true },
            }),
          ]);
          let finalSub = sub;
          if (!sub && prov?.status === "APPROVED") {
            const trialEnd = new Date();
            trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
            try {
              finalSub = await db.subscription.create({
                data: { providerId: auth.providerId, startDate: new Date(), endDate: trialEnd, cycle: "MONTHLY", price: 0 },
              });
            } catch {
              finalSub = await db.subscription.findFirst({ where: { providerId: auth.providerId } });
            }
          }
          subResult = { subscription: finalSub, provider: prov };
        }
      } catch (err) {
        console.error("[dashboard] Subscription query failed (non-fatal):", err instanceof Error ? err.message : err);
        subResult = null;
      }
    }

    // Process room status
    const roomsByStatus: Record<string, number> = {
      AVAILABLE: 0, OCCUPIED: 0, MAINTENANCE: 0, RESERVED: 0,
    };
    for (const item of roomStatusCountsRaw) {
      roomsByStatus[item.status] = Number(item.count);
    }
    const totalRooms = Object.values(roomsByStatus).reduce((a, b) => a + b, 0);
    const occupancyRate = totalRooms > 0
      ? Math.round((roomsByStatus.OCCUPIED / totalRooms) * 100) : 0;

    // Build last 7 days revenue array — fill missing days with 0
    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const revenueByDate: Record<string, number> = {};
    for (const row of revenueLast7DaysRaw) {
      revenueByDate[row.date] = row.amount;
    }
    const revenueLast7Days: { day: string; date: string; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      revenueLast7Days.push({
        day: DAY_NAMES[d.getDay()],
        date: dateStr,
        amount: revenueByDate[dateStr] || 0,
      });
    }

    // Build subscription response
    let subscriptionData = null as Record<string, unknown> | null;
    const subscription = subResult?.subscription;
    const providerInfo = subResult?.provider;
    if (subscriptionSystemDisabled) {
      // Global subscription system is disabled — exempt the operator
      subscriptionData = { exempt: true, systemDisabled: true };
    } else if (subscription && providerInfo) {
      const { status, daysRemaining } = calcSubscriptionStatus(subscription.endDate);
      subscriptionData = {
        status,
        daysRemaining,
        endDate: subscription.endDate.toISOString(),
        cycle: subscription.cycle,
        price: subscription.price,
        providerName: providerInfo.name || "",
        ownerName: providerInfo.ownerName || "",
        phone: providerInfo.phone || "",
      };
    } else if (auth.role === "SUPERUSER" || auth.role === "POLICE") {
      subscriptionData = { exempt: true };
    }

    return NextResponse.json({
      roomsByStatus,
      totalRooms,
      activeReservations,
      todayCheckins,
      todayCheckouts,
      totalRevenue: revenueResult._sum.paidAmount || 0,
      occupancyRate,
      activity: activityLogs,
      subscription: subscriptionData,
      revenueLast7Days,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[dashboard] Error:", msg, error);
    return NextResponse.json(
      { error: "Internal server error", debug: msg },
      { status: 500 }
    );
  }
}
