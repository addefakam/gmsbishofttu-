import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { ensureNewTables } from "@/lib/ensure-tables";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";
import { todayStr } from "@/lib/reservation-maintenance";

export const dynamic = "force-dynamic";

/**
 * GET /api/owner-eod?date=YYYY-MM-DD
 *
 * Returns the End-of-Day report for the given date (defaults to today).
 * If no report exists yet, returns a "draft" object built from live data
 * (payments by method, activity counts) — the operator can then enter
 * the counted cash + sign off.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);
    if (filter.isPolice) {
      return NextResponse.json({ error: "Police role cannot access EoD reports" }, { status: 403 });
    }
    if (!filter.providerId) {
      return NextResponse.json({ error: "Provider required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || todayStr();

    let report = await db.endOfDayReport.findFirst({
      where: { reportDate: date, providerId: filter.providerId },
    });

    if (!report) {
      const paymentAgg = await db.$queryRaw<{
        cash: number; telebirr: number; cbe: number; card: number; total: number;
      }[]>`
        SELECT
          COALESCE(SUM(CASE WHEN "paymentMethod" = 'CASH' THEN "amount" ELSE 0 END), 0)::float AS cash,
          COALESCE(SUM(CASE WHEN "paymentMethod" IN ('TELEBIRR','MOBILE') THEN "amount" ELSE 0 END), 0)::float AS telebirr,
          COALESCE(SUM(CASE WHEN "paymentMethod" IN ('BANK_TRANSFER','CBE') THEN "amount" ELSE 0 END), 0)::float AS cbe,
          COALESCE(SUM(CASE WHEN "paymentMethod" = 'CARD' THEN "amount" ELSE 0 END), 0)::float AS card,
          COALESCE(SUM("amount"), 0)::float AS total
        FROM "Payment"
        WHERE "providerId" = ${filter.providerId}
          AND DATE("createdAt") = ${date}::date
      `;

      const [checkins, checkouts, newReservations, cancellations] = await Promise.all([
        db.reservation.count({
          where: {
            providerId: filter.providerId, status: "ACTIVE",
            actualCheckIn: { gte: new Date(`${date}T00:00:00`), lte: new Date(`${date}T23:59:59`) },
          },
        }),
        db.reservation.count({
          where: {
            providerId: filter.providerId, status: "COMPLETED",
            actualCheckOut: { gte: new Date(`${date}T00:00:00`), lte: new Date(`${date}T23:59:59`) },
          },
        }),
        db.reservation.count({
          where: {
            providerId: filter.providerId,
            createdAt: { gte: new Date(`${date}T00:00:00`), lte: new Date(`${date}T23:59:59`) },
          },
        }),
        db.reservation.count({
          where: {
            providerId: filter.providerId, status: "CANCELLED",
            updatedAt: { gte: new Date(`${date}T00:00:00`), lte: new Date(`${date}T23:59:59`) },
          },
        }),
      ]);

      const expensesAgg = await db.expense.aggregate({
        _sum: { amount: true },
        where: { providerId: filter.providerId, paymentMethod: "CASH", date },
      });

      const cashPayments = paymentAgg[0]?.cash || 0;
      const pettyCashExpenses = expensesAgg._sum.amount || 0;
      const lastReport = await db.endOfDayReport.findFirst({
        where: { providerId: filter.providerId, reportDate: { lt: date } },
        orderBy: { reportDate: "desc" },
        select: { countedCash: true },
      });
      const openingCash = lastReport?.countedCash || 0;

      report = {
        id: `draft-${date}`,
        reportDate: date,
        providerId: filter.providerId,
        openingCash,
        cashPayments,
        cashRefunds: 0,
        pettyCashExpenses,
        expectedCash: openingCash + cashPayments - pettyCashExpenses,
        countedCash: 0,
        discrepancy: 0,
        telebirrPayments: paymentAgg[0]?.telebirr || 0,
        cbePayments: paymentAgg[0]?.cbe || 0,
        cardPayments: paymentAgg[0]?.card || 0,
        totalPayments: paymentAgg[0]?.total || 0,
        checkins, checkouts, newReservations, cancellations, noShows: 0,
        signedOffById: null, signedOffAt: null, closingShiftId: null, notes: "",
        createdAt: new Date(), updatedAt: new Date(),
      } as typeof report;
    }

    return NextResponse.json({ report, isDraft: report.id.startsWith("draft-") });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[owner-eod GET]", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return NextResponse.json({ report: null, isDraft: true, migrationPending: true });
    }
    return NextResponse.json({ error: "Failed to fetch EoD report" }, { status: 500 });
  }
}

/**
 * POST /api/owner-eod
 * Body: { reportDate, countedCash, notes }
 * Signs off the End-of-Day report for the given date.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);
    if (filter.isPolice) {
      return NextResponse.json({ error: "Police role cannot sign off EoD reports" }, { status: 403 });
    }
    if (!filter.providerId) {
      return NextResponse.json({ error: "Provider required" }, { status: 403 });
    }
    checkWritePermission(auth, { staffPermissionKey: "reservations" });

    const body = await req.json();
    const { reportDate, countedCash, notes } = body as {
      reportDate?: string; countedCash?: number; notes?: string;
    };

    if (!reportDate) return NextResponse.json({ error: "reportDate is required" }, { status: 400 });
    if (countedCash == null || isNaN(Number(countedCash))) {
      return NextResponse.json({ error: "countedCash must be a number" }, { status: 400 });
    }

    const paymentAgg = await db.$queryRaw<{
      cash: number; telebirr: number; cbe: number; card: number; total: number;
    }[]>`
      SELECT
        COALESCE(SUM(CASE WHEN "paymentMethod" = 'CASH' THEN "amount" ELSE 0 END), 0)::float AS cash,
        COALESCE(SUM(CASE WHEN "paymentMethod" IN ('TELEBIRR','MOBILE') THEN "amount" ELSE 0 END), 0)::float AS telebirr,
        COALESCE(SUM(CASE WHEN "paymentMethod" IN ('BANK_TRANSFER','CBE') THEN "amount" ELSE 0 END), 0)::float AS cbe,
        COALESCE(SUM(CASE WHEN "paymentMethod" = 'CARD' THEN "amount" ELSE 0 END), 0)::float AS card,
        COALESCE(SUM("amount"), 0)::float AS total
      FROM "Payment"
      WHERE "providerId" = ${filter.providerId}
        AND DATE("createdAt") = ${reportDate}::date
    `;

    const [checkins, checkouts, newReservations, cancellations] = await Promise.all([
      db.reservation.count({
        where: {
          providerId: filter.providerId, status: "ACTIVE",
          actualCheckIn: { gte: new Date(`${reportDate}T00:00:00`), lte: new Date(`${reportDate}T23:59:59`) },
        },
      }),
      db.reservation.count({
        where: {
          providerId: filter.providerId, status: "COMPLETED",
          actualCheckOut: { gte: new Date(`${reportDate}T00:00:00`), lte: new Date(`${reportDate}T23:59:59`) },
        },
      }),
      db.reservation.count({
        where: {
          providerId: filter.providerId,
          createdAt: { gte: new Date(`${reportDate}T00:00:00`), lte: new Date(`${reportDate}T23:59:59`) },
        },
      }),
      db.reservation.count({
        where: {
          providerId: filter.providerId, status: "CANCELLED",
          updatedAt: { gte: new Date(`${reportDate}T00:00:00`), lte: new Date(`${reportDate}T23:59:59`) },
        },
      }),
    ]);

    const expensesAgg = await db.expense.aggregate({
      _sum: { amount: true },
      where: { providerId: filter.providerId, paymentMethod: "CASH", date: reportDate },
    });

    const cashPayments = paymentAgg[0]?.cash || 0;
    const pettyCashExpenses = expensesAgg._sum.amount || 0;
    const lastReport = await db.endOfDayReport.findFirst({
      where: { providerId: filter.providerId, reportDate: { lt: reportDate } },
      orderBy: { reportDate: "desc" },
      select: { countedCash: true },
    });
    const openingCash = lastReport?.countedCash || 0;
    const expectedCash = openingCash + cashPayments - pettyCashExpenses;
    const countedNum = Number(countedCash);
    const discrepancy = countedNum - expectedCash;

    const { userId, userName } = getLogUserInfo(req);

    const existing = await db.endOfDayReport.findFirst({
      where: { reportDate, providerId: filter.providerId },
    });

    const data = {
      openingCash, cashPayments, cashRefunds: 0, pettyCashExpenses, expectedCash,
      countedCash: countedNum, discrepancy,
      telebirrPayments: paymentAgg[0]?.telebirr || 0,
      cbePayments: paymentAgg[0]?.cbe || 0,
      cardPayments: paymentAgg[0]?.card || 0,
      totalPayments: paymentAgg[0]?.total || 0,
      checkins, checkouts, newReservations, cancellations, noShows: 0,
      signedOffById: userId || null,
      signedOffAt: new Date(),
      notes: notes || "",
    };

    let report;
    if (existing) {
      report = await db.endOfDayReport.update({ where: { id: existing.id }, data });
    } else {
      report = await db.endOfDayReport.create({
        data: { reportDate, providerId: filter.providerId, ...data },
      });
    }

    logStaffActivity({
      req, userId, userName,
      action: "EOD_SIGNOFF",
      targetType: "PAYMENT",
      targetId: report.id,
      details: { reportDate, countedCash: countedNum, expectedCash, discrepancy, totalPayments: data.totalPayments },
      providerId: filter.providerId,
    });

    return NextResponse.json({ success: true, report });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[owner-eod POST]", error);
    return NextResponse.json({ error: "Failed to sign off EoD report" }, { status: 500 });
  }
}
