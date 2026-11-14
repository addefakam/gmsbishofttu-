import { checkPolicePermission } from "@/lib/police-module-permissions";
import { resetInitFlag, ensureDatabase } from "@/lib/init-db";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, requirePolice, getJurisdictionFilter, AuthError } from "@/lib/tenant";
import { runReservationMaintenance } from "@/lib/reservation-maintenance";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";

// ── Force dynamic rendering ──
// Prevents Vercel from caching stale dashboard data at the edge.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    resetInitFlag();
    await ensureReservationIntegrity();
    const auth = await getAuthContext(req);
    requirePolice(auth);
    const permError = checkPolicePermission(auth, "police_dashboard");
    if (permError) return NextResponse.json({ error: permError }, { status: 403 });

    // ── Lazy maintenance (global scope, throttled + idempotent) ──
    try {
      await runReservationMaintenance({});
    } catch {
      // Maintenance must never break police dashboard reads.
    }

    // ── Jurisdiction filter ──
    // CITY → sees everything (no WHERE clause)
    // SUBCITY → only providers in auth.subCity
    // WOREDA → only providers in auth.subCity + auth.woreda
    const jFilter = getJurisdictionFilter(auth);
    const hasSubCity = !!jFilter.subCity;
    const hasWoreda = !!jFilter.woreda;
    const subCity = hasSubCity ? String(jFilter.subCity).replace(/'/g, "''") : "";
    const woreda = hasWoreda ? String(jFilter.woreda).replace(/'/g, "''") : "";

    // Build the provider WHERE clause for jurisdiction filtering
    // Used in all SQL queries below to scope data to the user's jurisdiction
    const providerWhere = hasSubCity
      ? (hasWoreda
          ? `WHERE p."subCity" = '${subCity}' AND p."woreda" = '${woreda}'`
          : `WHERE p."subCity" = '${subCity}'`)
      : "";
    // For counts that don't join Provider directly, we need a subquery to get provider IDs
    const providerIdsSubquery = hasSubCity
      ? (hasWoreda
          ? `SELECT "id" FROM "Provider" WHERE "subCity" = '${subCity}' AND "woreda" = '${woreda}'`
          : `SELECT "id" FROM "Provider" WHERE "subCity" = '${subCity}'`)
      : null;

    // ── Build SQL for stats ──
    // When jurisdiction is CITY, no Provider join needed (counts across all)
    // When jurisdiction is SUBCITY/WOREDA, we need to filter by provider
    const statsSQL = providerIdsSubquery
      ? `
        SELECT COUNT(*)::bigint AS count FROM "Provider" WHERE "id" IN (${providerIdsSubquery})
        UNION ALL
        SELECT COUNT(*)::bigint AS count FROM "Room" WHERE "providerId" IN (${providerIdsSubquery})
        UNION ALL
        SELECT COUNT(*)::bigint AS count FROM "Guest" WHERE "providerId" IN (${providerIdsSubquery})
        UNION ALL
        SELECT COUNT(*)::bigint AS count FROM "Reservation" WHERE "providerId" IN (${providerIdsSubquery}) AND "status" IN ('UPCOMING','ACTIVE')
        UNION ALL
        SELECT COALESCE(SUM("paidAmount"), 0)::float AS total FROM "Reservation" WHERE "providerId" IN (${providerIdsSubquery})
        UNION ALL
        SELECT COALESCE(SUM("paidAmount"), 0)::float AS total FROM "DaytimeBooking" WHERE "providerId" IN (${providerIdsSubquery})
      `
      : `
        SELECT COUNT(*)::bigint AS count FROM "Provider"
        UNION ALL
        SELECT COUNT(*)::bigint AS count FROM "Room"
        UNION ALL
        SELECT COUNT(*)::bigint AS count FROM "Guest"
        UNION ALL
        SELECT COUNT(*)::bigint AS count FROM "Reservation" WHERE "status" IN ('UPCOMING','ACTIVE')
        UNION ALL
        SELECT COALESCE(SUM("paidAmount"), 0)::float AS total FROM "Reservation"
        UNION ALL
        SELECT COALESCE(SUM("paidAmount"), 0)::float AS total FROM "DaytimeBooking"
      `;

    const stats = await db.$queryRawUnsafe<Array<{ count?: bigint; total?: number | null }>>(statsSQL);

    const totalProviders = Number(stats[0].count);
    const totalRooms = Number(stats[1].count);
    const totalGuests = Number(stats[2].count);
    const activeReservations = Number(stats[3].count);
    const reservationRevenue = stats[4].total || 0;
    const daytimeRevenue = stats[5].total || 0;
    const revenue = reservationRevenue + daytimeRevenue;

    // Per-provider breakdown — add jurisdiction WHERE clause
    // IMPORTANT: WHERE must come AFTER all LEFT JOINs in SQL
    const breakdownSQL = `
      SELECT
        p."id", p."name", p."status",
        COALESCE(r.c, 0)::int AS "rooms",
        COALESCE(g.c, 0)::int AS "guests",
        COALESCE(rv.c, 0)::int AS "totalReservations",
        COALESCE(ar.c, 0)::int AS "activeReservations",
        COALESCE(rr.total, 0)::float + COALESCE(dr.total, 0)::float AS "revenue"
      FROM "Provider" p
      LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Room" GROUP BY "providerId") r ON r."providerId" = p."id"
      LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Guest" GROUP BY "providerId") g ON g."providerId" = p."id"
      LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Reservation" GROUP BY "providerId") rv ON rv."providerId" = p."id"
      LEFT JOIN (SELECT "providerId", COUNT(*) AS c FROM "Reservation" WHERE "status" IN ('UPCOMING','ACTIVE') GROUP BY "providerId") ar ON ar."providerId" = p."id"
      LEFT JOIN (SELECT "providerId", SUM("paidAmount") AS total FROM "Reservation" GROUP BY "providerId") rr ON rr."providerId" = p."id"
      LEFT JOIN (SELECT "providerId", SUM("paidAmount") AS total FROM "DaytimeBooking" GROUP BY "providerId") dr ON dr."providerId" = p."id"
      ${providerWhere}
      ORDER BY
        CASE p."status"
          WHEN 'PENDING' THEN 0
          WHEN 'REJECTED' THEN 1
          WHEN 'SUSPENDED' THEN 2
          WHEN 'APPROVED' THEN 3
          ELSE 4
        END ASC,
        p."createdAt" DESC
    `;

    const providerBreakdown = await db.$queryRawUnsafe<{
      id: string; name: string; status: string;
      rooms: number; guests: number; totalReservations: number;
      activeReservations: number; revenue: number;
    }[]>(breakdownSQL);

    return NextResponse.json({
      totalProviders,
      totalRooms,
      totalGuests,
      activeReservations,
      revenue,
      providers: providerBreakdown,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch police dashboard";
    const status = message.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
