import { checkPolicePermission } from "@/lib/police-module-permissions";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getAuthContext, requirePolice, getJurisdictionFilter, AuthError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { resetInitFlag, ensureDatabase } from "@/lib/init-db";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    resetInitFlag();
    await ensureDatabase();

    const auth = await getAuthContext(req);
    requirePolice(auth);
    const permError = checkPolicePermission(auth, "police_reports");
    if (permError) return NextResponse.json({ error: permError }, { status: 403 });

    const sp = req.nextUrl.searchParams;
    const period = sp.get("period") || "monthly"; // daily | monthly | yearly
    const date = sp.get("date") || new Date().toISOString().slice(0, 10);
    const providerId = sp.get("providerId") || "";

    // Build date range based on period
    const now = new Date(date + "T00:00:00.000Z");
    let startDate: Date;
    let endDate: Date;
    let label: string;

    if (period === "daily") {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      label = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    } else if (period === "yearly") {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      label = String(now.getFullYear());
    } else {
      // monthly
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      label = now.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    }

    // ── Jurisdiction filter ──
    // Merge the jurisdiction filter with the explicit providerId filter.
    // If the user specifies a providerId, it takes precedence (they're
    // drilling down into a specific provider). Otherwise, apply the
    // jurisdiction filter (CITY/SUBCITY/WOREDA).
    //
    // Not all models (SuspectMatch, DaytimeBooking) have a Prisma `provider`
    // relation — they only have `providerId` (string). So we fetch the
    // list of provider IDs in the jurisdiction first, then use
    // `providerId: { in: [...] }` for all queries.
    const jFilter = getJurisdictionFilter(auth);

    let providerIdFilter: string | undefined = undefined;
    let jurisdictionProviderIds: string[] | undefined = undefined;

    if (providerId) {
      // User explicitly selected a provider — use it
      providerIdFilter = providerId;
    } else if (jFilter.subCity) {
      // Fetch provider IDs matching the jurisdiction
      const matchingProviders = await db.provider.findMany({
        where: jFilter,
        select: { id: true },
      });
      jurisdictionProviderIds = matchingProviders.map((p) => p.id);
    }

    // Build the Prisma where filter for models WITH a provider relation
    // (Guest, Reservation have `provider: Provider` relation)
    const relationFilter = providerIdFilter
      ? { providerId: providerIdFilter }
      : jurisdictionProviderIds
        ? { providerId: { in: jurisdictionProviderIds } }
        : {};

    // Build the Prisma where filter for models WITHOUT a provider relation
    // (SuspectMatch, DaytimeBooking have only `providerId` string)
    const idFilter = providerIdFilter
      ? { providerId: providerIdFilter }
      : jurisdictionProviderIds
        ? { providerId: { in: jurisdictionProviderIds } }
        : {};

    const providerFilter = relationFilter;

    // ── 1. Summary KPIs ──
    const [totalGuests, totalReservations, totalCheckIns, totalCheckOuts, totalMatches, totalProviders, totalRooms] =
      await Promise.all([
        db.guest.count({
          where: { ...providerFilter, createdAt: { lte: endDate } },
        }),
        db.reservation.count({
          where: { ...providerFilter, createdAt: { gte: startDate, lte: endDate } },
        }),
        db.reservation.count({
          where: { ...providerFilter, actualCheckIn: { gte: startDate, lte: endDate } },
        }),
        db.reservation.count({
          where: { ...providerFilter, actualCheckOut: { gte: startDate, lte: endDate } },
        }),
        db.suspectMatch.count({
          where: { ...idFilter, createdAt: { gte: startDate, lte: endDate } },
        }),
        providerId ? Promise.resolve(0) : db.provider.count({ where: { status: "APPROVED", ...(jFilter.subCity ? { subCity: jFilter.subCity as string, ...(jFilter.woreda ? { woreda: jFilter.woreda as string } : {}) } : {}) } }),
        providerId ? db.room.count({ where: { providerId } }) : (jFilter.subCity ? db.room.count({ where: { provider: { subCity: jFilter.subCity as string, ...(jFilter.woreda ? { woreda: jFilter.woreda as string } : {}) } } }) : db.room.count()),
      ]);

    // Active guests (checked in and not checked out during this period)
    const activeGuests = await db.reservation.count({
      where: {
        ...providerFilter,
        status: "ACTIVE",
      },
    });

    // ── 2. Guest registration trend (time series) ──
    let guestTrend: { date: string; count: number }[] = [];
    if (period === "daily") {
      // Hourly for daily view
      guestTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT
          TO_CHAR("createdAt", 'HH24:00') AS date,
          COUNT(*)::int AS count
        FROM "Guest"
        WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("createdAt", 'HH24:00')
        ORDER BY date
      `);
    } else if (period === "monthly") {
      guestTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT
          TO_CHAR("createdAt", 'YYYY-MM-DD') AS date,
          COUNT(*)::int AS count
        FROM "Guest"
        WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD')
        ORDER BY date
      `);
    } else {
      // yearly: monthly breakdown
      guestTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT
          TO_CHAR("createdAt", 'YYYY-MM') AS date,
          COUNT(*)::int AS count
        FROM "Guest"
        WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM')
        ORDER BY date
      `);
    }

    // ── 3. Check-in / Check-out trend ──
    let checkInTrend: { date: string; count: number }[] = [];
    let checkOutTrend: { date: string; count: number }[] = [];
    if (period === "daily") {
      checkInTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT TO_CHAR("actualCheckIn", 'HH24:00') AS date, COUNT(*)::int AS count
        FROM "Reservation" WHERE "actualCheckIn" >= ${startDate} AND "actualCheckIn" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("actualCheckIn", 'HH24:00') ORDER BY date
      `);
      checkOutTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT TO_CHAR("actualCheckOut", 'HH24:00') AS date, COUNT(*)::int AS count
        FROM "Reservation" WHERE "actualCheckOut" >= ${startDate} AND "actualCheckOut" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("actualCheckOut", 'HH24:00') ORDER BY date
      `);
    } else if (period === "monthly") {
      checkInTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT TO_CHAR("actualCheckIn", 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
        FROM "Reservation" WHERE "actualCheckIn" >= ${startDate} AND "actualCheckIn" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("actualCheckIn", 'YYYY-MM-DD') ORDER BY date
      `);
      checkOutTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT TO_CHAR("actualCheckOut", 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
        FROM "Reservation" WHERE "actualCheckOut" >= ${startDate} AND "actualCheckOut" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("actualCheckOut", 'YYYY-MM-DD') ORDER BY date
      `);
    } else {
      checkInTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT TO_CHAR("actualCheckIn", 'YYYY-MM') AS date, COUNT(*)::int AS count
        FROM "Reservation" WHERE "actualCheckIn" >= ${startDate} AND "actualCheckIn" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("actualCheckIn", 'YYYY-MM') ORDER BY date
      `);
      checkOutTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT TO_CHAR("actualCheckOut", 'YYYY-MM') AS date, COUNT(*)::int AS count
        FROM "Reservation" WHERE "actualCheckOut" >= ${startDate} AND "actualCheckOut" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("actualCheckOut", 'YYYY-MM') ORDER BY date
      `);
    }

    // ── 4. Nationality breakdown ──
    // Group by the CANONICAL nationality form, mirroring the JS-side
    // normalizeNationality() helper in src/lib/nationalities.ts. Previously
    // this grouped by TRIM("nationality") directly, so 'Ethiopian',
    // 'Ethiopia', 'ethi', 'ETH' all appeared as separate slices even
    // though they refer to the same nationality.
    //
    // The CASE expression normalizes on the fly so existing data doesn't
    // need a migration to display correctly. Upper-cases the input after
    // removing spaces/underscores/hyphens so 'Ethiopia' / 'ETHIOPIA' /
    // 'ethiopia' / 'Ethiopian' all collapse to the same key.
    //
    // Also catches JUNK data — purely numeric values (e.g. '25874174572'
    // mistakenly entered in the nationality field) are grouped as
    // 'Unknown' instead of polluting the chart with phone-number slices.
    const nationalities = await db.$queryRaw<{ name: string; count: number }[]>(Prisma.sql`
      SELECT
        CASE
          WHEN "nationality" IS NULL OR TRIM("nationality") = '' THEN 'Unknown'
          WHEN TRIM("nationality") ~ '^[0-9]+$' THEN 'Unknown'
          WHEN UPPER(REPLACE(REPLACE(REPLACE(TRIM("nationality"), ' ', ''), '_', ''), '-', '')) IN
               ('ETHIOPIAN', 'ETHIOPIA', 'ETHI', 'ETH', 'ETHIO') THEN 'Ethiopian'
          WHEN UPPER(REPLACE(REPLACE(REPLACE(TRIM("nationality"), ' ', ''), '_', ''), '-', '')) IN
               ('PAKISTANI', 'PAKISTAN') THEN 'Pakistani'
          WHEN UPPER(REPLACE(REPLACE(REPLACE(TRIM("nationality"), ' ', ''), '_', ''), '-', '')) IN
               ('KENYAN', 'KENYA') THEN 'Kenyan'
          WHEN UPPER(REPLACE(REPLACE(REPLACE(TRIM("nationality"), ' ', ''), '_', ''), '-', '')) IN
               ('INDIAN', 'INDIA') THEN 'Indian'
          ELSE TRIM("nationality")
        END AS name,
        COUNT(*)::int AS count
      FROM "Guest"
      WHERE 1=1
        ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        ${period !== "yearly" ? Prisma.sql`AND "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}` : Prisma.sql``}
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 15
    `);

    // ── 5. Provider-level guest distribution ──
    const providerBreakdown = providerId
      ? []
      : await db.$queryRaw<{ name: string; address: string; guests: number; checkIns: number; checkOuts: number; matches: number; rooms: number; upcoming: number }[]>(Prisma.sql`
        SELECT
          p."name",
          COALESCE(p."address", '') AS "address",
          COALESCE(g.c, 0)::int AS "guests",
          COALESCE(ci.c, 0)::int AS "checkIns",
          COALESCE(co.c, 0)::int AS "checkOuts",
          COALESCE(sm.c, 0)::int AS "matches",
          COALESCE(r.c, 0)::int AS "rooms",
          COALESCE(up.c, 0)::int AS "upcoming"
        FROM "Provider" p
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Guest" ${period !== "yearly" ? Prisma.sql`WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}` : Prisma.sql``} GROUP BY "providerId") g ON g."providerId" = p."id"
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Reservation" WHERE "actualCheckIn" >= ${startDate} AND "actualCheckIn" <= ${endDate} GROUP BY "providerId") ci ON ci."providerId" = p."id"
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Reservation" WHERE "actualCheckOut" >= ${startDate} AND "actualCheckOut" <= ${endDate} GROUP BY "providerId") co ON co."providerId" = p."id"
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "SuspectMatch" WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate} GROUP BY "providerId") sm ON sm."providerId" = p."id"
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Room" GROUP BY "providerId") r ON r."providerId" = p."id"
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Reservation" WHERE "status" = 'UPCOMING' AND "checkIn" >= ${startDate.toISOString().slice(0, 10)} AND "checkIn" <= ${endDate.toISOString().slice(0, 10)} GROUP BY "providerId") up ON up."providerId" = p."id"
        WHERE p."status" = 'APPROVED'
        ORDER BY "guests" DESC
      `);

    // ── 6. Suspect match severity breakdown ──
    const suspectSeverities = await db.$queryRaw<{ severity: string; count: number }[]>(Prisma.sql`
      SELECT sp."severity", COUNT(sm."id")::int AS count
      FROM "SuspectMatch" sm
      JOIN "SuspectedPerson" sp ON sp."id" = sm."suspectedPersonId"
      WHERE sm."createdAt" >= ${startDate} AND sm."createdAt" <= ${endDate}
        ${providerId ? Prisma.sql`AND sm."providerId" = ${providerId}` : Prisma.sql``}
      GROUP BY sp."severity"
      ORDER BY count DESC
    `);

    // ── 7. Room occupancy by provider ──
    const occupancyByProvider = providerId
      ? []
      : await db.$queryRaw<{ name: string; total: number; occupied: number; available: number; reserved: number; maintenance: number; rate: number }[]>(Prisma.sql`
        SELECT
          p."name",
          COALESCE(r_total.c, 0)::int AS "total",
          COALESCE(r_occ.c, 0)::int AS "occupied",
          COALESCE(r_avail.c, 0)::int AS "available",
          COALESCE(r_res.c, 0)::int AS "reserved",
          COALESCE(r_maint.c, 0)::int AS "maintenance",
          CASE WHEN r_total.c > 0 THEN ROUND((COALESCE(r_occ.c, 0)::numeric / r_total.c) * 100, 1) ELSE 0 END AS rate
        FROM "Provider" p
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Room" GROUP BY "providerId") r_total ON r_total."providerId" = p."id"
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Room" WHERE "status" = 'OCCUPIED' GROUP BY "providerId") r_occ ON r_occ."providerId" = p."id"
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Room" WHERE "status" = 'AVAILABLE' GROUP BY "providerId") r_avail ON r_avail."providerId" = p."id"
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Room" WHERE "status" = 'RESERVED' GROUP BY "providerId") r_res ON r_res."providerId" = p."id"
        LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Room" WHERE "status" = 'MAINTENANCE' GROUP BY "providerId") r_maint ON r_maint."providerId" = p."id"
        WHERE p."status" = 'APPROVED'
        ORDER BY rate DESC
      `);

    // ── 8. Peak check-in hours (for daily/monthly: aggregate all check-ins by hour) ──
    const peakHours = period === "yearly"
      ? []
      : await db.$queryRaw<{ hour: string; count: number }[]>(Prisma.sql`
        SELECT
          TO_CHAR("actualCheckIn", 'HH24:00') AS "hour",
          COUNT(*)::int AS count
        FROM "Reservation"
        WHERE "actualCheckIn" >= ${startDate} AND "actualCheckIn" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("actualCheckIn", 'HH24:00')
        ORDER BY "hour"
      `);

    // ── 9. ID type distribution ──
    // Group by the CANONICAL idType form, mirroring the JS-side
    // normalizeIdType() helper in src/lib/national-id.ts. Previously
    // this grouped by TRIM("idType") directly, so NATIONAL,
    // NATIONAL_ID, and "National ID" appeared as 3 separate slices
    // even though they're the same ID type.
    //
    // The CASE expression normalizes on the fly so existing data
    // doesn't need a migration to display correctly. A separate
    // one-time data-cleanup script (scripts/normalize_id_types.js)
    // backfills the DB so new aggregations match the writes.
    // Upper-cases the input after removing spaces and underscores so
    // 'National ID', 'NATIONAL_ID', 'national id', and 'NationalID'
    // all collapse to 'NATIONALID' → mapped to 'National ID'.
    const idTypes = await db.$queryRaw<{ name: string; count: number }[]>(Prisma.sql`
      SELECT
        CASE
          WHEN "idType" IS NULL OR TRIM("idType") = '' THEN 'Not Provided'
          WHEN UPPER(REPLACE(REPLACE(TRIM("idType"), ' ', ''), '_', '')) IN ('NATIONALID', 'NATIONAL') THEN 'National ID'
          WHEN UPPER(REPLACE(REPLACE(TRIM("idType"), ' ', ''), '_', '')) IN ('KEBELEID', 'KEBELE') THEN 'Kebele ID'
          WHEN UPPER(REPLACE(REPLACE(TRIM("idType"), ' ', ''), '_', '')) = 'PASSPORT' THEN 'Passport'
          WHEN UPPER(REPLACE(REPLACE(TRIM("idType"), ' ', ''), '_', '')) IN ('DRIVER', 'DRIVERSLICENSE', 'DRIVERLICENSE') THEN 'Driver''s License'
          WHEN UPPER(REPLACE(REPLACE(TRIM("idType"), ' ', ''), '_', '')) = 'OTHER' THEN 'Other'
          ELSE TRIM("idType")
        END AS name,
        COUNT(*)::int AS count
      FROM "Guest"
      WHERE 1=1
        ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        ${period !== "yearly" ? Prisma.sql`AND "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}` : Prisma.sql``}
      GROUP BY 1
      ORDER BY count DESC
    `);

    // ── 10. Frequent stay alerts in period ──
    const frequentStayAlerts = await db.frequentStayAlert.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      orderBy: { stayCount: "desc" },
      take: 20,
    });

    // ── 11. Reservation status distribution ──
    const reservationStatuses = await db.$queryRaw<{ status: string; count: number }[]>(Prisma.sql`
      SELECT "status", COUNT(*)::int AS count
      FROM "Reservation"
      WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
        ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
      GROUP BY "status"
      ORDER BY count DESC
    `);

    // ── 12. Suspect match trend (time series, same grain as check-in trend) ──
    let suspectTrend: { date: string; count: number }[] = [];
    if (period === "daily") {
      suspectTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT TO_CHAR("createdAt", 'HH24:00') AS date, COUNT(*)::int AS count
        FROM "SuspectMatch" WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("createdAt", 'HH24:00') ORDER BY date
      `);
    } else if (period === "monthly") {
      suspectTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
        FROM "SuspectMatch" WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM-DD') ORDER BY date
      `);
    } else {
      suspectTrend = await db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`
        SELECT TO_CHAR("createdAt", 'YYYY-MM') AS date, COUNT(*)::int AS count
        FROM "SuspectMatch" WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
          ${providerId ? Prisma.sql`AND "providerId" = ${providerId}` : Prisma.sql``}
        GROUP BY TO_CHAR("createdAt", 'YYYY-MM') ORDER BY date
      `);
    }

    // ── 13. Provider list for filter dropdown ──
    const providers = await db.provider.findMany({
      where: { status: "APPROVED" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    // Log audit
    logAudit(req, {
      action: "VIEW_REPORT",
      details: `${period} report for ${label}${providerId ? ` (provider: ${providerId})` : ""}`,
    });

    return NextResponse.json({
      period,
      date: date,
      label,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      summary: {
        totalGuests,
        totalReservations,
        totalCheckIns,
        totalCheckOuts,
        activeGuests,
        totalMatches,
        totalProviders,
        totalRooms,
      },
      guestTrend,
      checkInTrend,
      checkOutTrend,
      suspectTrend,
      nationalities,
      idTypes,
      providerBreakdown,
      suspectSeverities,
      occupancyByProvider,
      peakHours,
      frequentStayAlerts,
      reservationStatuses,
      providers,
    });
  } catch (e: unknown) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    }
    const msg = e instanceof Error ? e.message : "Failed to fetch police reports";
    const status = msg.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
