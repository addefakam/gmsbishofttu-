import { checkPolicePermission } from "@/lib/police-module-permissions";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, requirePolice, getJurisdictionFilter, AuthError } from "@/lib/tenant";
import { runReservationMaintenance } from "@/lib/reservation-maintenance";
import { ensureNewTables } from "@/lib/ensure-tables";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
// ── Force dynamic rendering ──
// Prevents Vercel from caching stale room availability data at the edge.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    requirePolice(auth);
    const permError = checkPolicePermission(auth, "police_dashboard");
    if (permError) return NextResponse.json({ error: permError }, { status: 403 });

    try {
      await runReservationMaintenance({});
    } catch {
      // Maintenance must never break police room availability reads.
    }

    // ── Jurisdiction filter ──
    const jFilter = getJurisdictionFilter(auth);
    const hasSubCity = !!jFilter.subCity;
    const hasWoreda = !!jFilter.woreda;
    const subCity = hasSubCity ? String(jFilter.subCity).replace(/'/g, "''") : "";
    const woreda = hasWoreda ? String(jFilter.woreda).replace(/'/g, "''") : "";
    // Provider WHERE clause for jurisdiction
    const providerJurisdictionWhere = hasSubCity
      ? (hasWoreda
          ? `AND p."subCity" = '${subCity}' AND p."woreda" = '${woreda}'`
          : `AND p."subCity" = '${subCity}'`)
      : "";
    const providerIdsSubquery = hasSubCity
      ? (hasWoreda
          ? `SELECT "id" FROM "Provider" WHERE "subCity" = '${subCity}' AND "woreda" = '${woreda}'`
          : `SELECT "id" FROM "Provider" WHERE "subCity" = '${subCity}'`)
      : null;

    // ── Count ALL providers (regardless of status) ──
    const allProvidersCountSQL = providerIdsSubquery
      ? `SELECT COUNT(*)::bigint AS count FROM "Provider" WHERE "id" IN (${providerIdsSubquery})`
      : `SELECT COUNT(*)::bigint AS count FROM "Provider"`;
    const allProvidersCountRaw = await db.$queryRawUnsafe<{ count: bigint }[]>(allProvidersCountSQL);
    const allProvidersCount = Number(allProvidersCountRaw[0].count);

    // ── Room statistics (filtered by jurisdiction) ──
    const statsSQL = providerIdsSubquery
      ? `SELECT "status", COUNT(*)::bigint as count FROM "Room" WHERE "providerId" IN (${providerIdsSubquery}) GROUP BY "status"`
      : `SELECT "status", COUNT(*)::bigint as count FROM "Room" GROUP BY "status"`;
    const statsRaw = await db.$queryRawUnsafe<{ status: string; count: bigint }[]>(statsSQL);
    const statsMap: Record<string, number> = {};
    for (const s of statsRaw) {
      statsMap[s.status] = Number(s.count);
    }
    const totalRooms = Object.values(statsMap).reduce((a, b) => a + b, 0);
    const availableRooms = statsMap["AVAILABLE"] || 0;
    const occupiedRooms = statsMap["OCCUPIED"] || 0;
    const reservedRooms = statsMap["RESERVED"] || 0;
    const maintenanceRooms = statsMap["MAINTENANCE"] || 0;

    // ── Room type breakdown (filtered by jurisdiction) ──
    const roomTypesSQL = providerIdsSubquery
      ? `SELECT type, COUNT(*)::bigint as count FROM "Room" WHERE "providerId" IN (${providerIdsSubquery}) GROUP BY type`
      : `SELECT type, COUNT(*)::bigint as count FROM "Room" GROUP BY type`;
    const roomTypesRaw = await db.$queryRawUnsafe<{ type: string; count: bigint }[]>(roomTypesSQL);
    const roomTypes = roomTypesRaw.map(r => ({ type: r.type, _count: { id: Number(r.count) } }));

    // ── Per-provider room breakdown (filtered by jurisdiction) ──
    const providersSQL = `
      SELECT
        p."id", p."name", p."ownerName", p."phone",
        p."address", p."licenseNo", p."latitude", p."longitude", p."bedCount",
        r."id" AS "roomId", r."number" AS "roomNumber", r."name" AS "roomName",
        r."type"::text AS "roomType", r."status" AS "roomStatus",
        r."floor" AS "roomFloor", r."capacity" AS "roomCapacity",
        r."pricePerNight" AS "roomPrice"
      FROM "Provider" p
      LEFT JOIN "Room" r ON r."providerId" = p."id"
      WHERE p."status" = 'APPROVED' ${providerJurisdictionWhere}
      ORDER BY p."name" ASC, r."number" ASC
    `;

    const providersRaw = await db.$queryRawUnsafe<{
      id: string; name: string; ownerName: string; phone: string;
      address: string; licenseNo: string; latitude: number; longitude: number;
      roomId: string; roomNumber: string; roomName: string; roomType: string;
      roomStatus: string; roomFloor: number; roomCapacity: number; roomPrice: number;
    }[]>(providersSQL);

    // Group rooms by provider
    const providerMap = new Map<string, {
      id: string; name: string; ownerName: string; phone: string;
      address: string; licenseNo: string; latitude: number; longitude: number;
      rooms: { id: string; number: string; name: string; type: string; status: string; floor: number; capacity: number; pricePerNight: number; }[];
    }>();

    for (const row of providersRaw) {
      if (!providerMap.has(row.id)) {
        providerMap.set(row.id, {
          id: row.id, name: row.name, ownerName: row.ownerName, phone: row.phone,
          address: row.address, licenseNo: row.licenseNo, latitude: row.latitude, longitude: row.longitude,
          rooms: [],
        });
      }
      if (row.roomId) {
        providerMap.get(row.id)!.rooms.push({
          id: row.roomId, number: row.roomNumber, name: row.roomName,
          type: row.roomType, status: row.roomStatus, floor: row.roomFloor,
          capacity: row.roomCapacity, pricePerNight: row.roomPrice,
        });
      }
    }

    const providers = Array.from(providerMap.values());

    // Fetch Provider.bedCount overrides (manual admin-set bed counts)
    // so we can use them instead of auto-calculating from room types.
    const providerIds = providers.map((p) => p.id);
    const providerOverrides = providerIds.length > 0
      ? await db.provider.findMany({
          where: { id: { in: providerIds } },
          select: { id: true, bedCount: true },
        })
      : [];
    const bedCountOverrides = new Map<string, number | null>();
    for (const p of providerOverrides) {
      bedCountOverrides.set(p.id, p.bedCount);
    }

    // Build per-provider stats with room counts by status
    const providerStats = providers.map((p) => {
      const rooms = p.rooms;
      const total = rooms.length;
      const available = rooms.filter((r) => r.status === "AVAILABLE").length;
      const occupied = rooms.filter((r) => r.status === "OCCUPIED").length;
      const reserved = rooms.filter((r) => r.status === "RESERVED").length;
      const maintenance = rooms.filter((r) => r.status === "MAINTENANCE").length;
      const utilizationRate = total > 0 ? Math.round(((occupied + reserved) / total) * 100) : 0;

      // Bed count: priority 1) admin override (Provider.bedCount)
      //                    2) auto-calc (DOUBLE + TWIN = 2 beds, all others = 1)
      const override = bedCountOverrides.get(p.id);
      const totalCapacity = (override != null && override > 0)
        ? override
        : rooms.reduce((sum, r) => sum + ((r.type === "DOUBLE" || r.type === "TWIN") ? 2 : 1), 0);

      const avgPrice = total > 0 ? Math.round(rooms.reduce((sum, r) => sum + r.pricePerNight, 0) / total) : 0;

      return {
        id: p.id,
        name: p.name,
        ownerName: p.ownerName,
        phone: p.phone,
        address: p.address,
        licenseNo: p.licenseNo,
        latitude: p.latitude,
        longitude: p.longitude,
        total,
        available,
        occupied,
        reserved,
        maintenance,
        utilizationRate,
        totalCapacity,
        avgPrice,
        rooms,
      };
    });

    // ── Capacity stats ──
    const totalCapacity = providerStats.reduce((sum, p) => sum + p.totalCapacity, 0);
    const totalOccupied = providerStats.reduce((sum, p) => sum + p.occupied, 0);
    const totalReserved = providerStats.reduce((sum, p) => sum + p.reserved, 0);
    const totalUtilizationRate = totalRooms > 0 ? Math.round(((totalOccupied + totalReserved) / totalRooms) * 100) : 0;

    return NextResponse.json({
      // City-wide summary
      summary: {
        // totalProviders = ALL providers (regardless of status), so the
        // police app's "Guesthouses" KPI matches the main system's
        // providers page total. The per-provider rooms breakdown below
        // is filtered to APPROVED only (PENDING/REJECTED providers have
        // no operational rooms to show), but the count shown to the user
        // includes every registered guesthouse in the city.
        totalProviders: allProvidersCount,
        // approvedProviders = the count of APPROVED providers only, kept
        // for reference so the police app can show "22 of 31 approved"
        // if needed.
        approvedProviders: providers.length,
        totalRooms,
        totalCapacity,
        availableRooms,
        occupiedRooms,
        reservedRooms,
        maintenanceRooms,
        utilizationRate: totalUtilizationRate,
      },
      // Room type distribution
      roomTypes: roomTypes.map((rt) => ({
        type: rt.type,
        count: rt._count.id,
      })),
      // Per-provider breakdown
      providers: providerStats,
    });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch room availability";
    const status = message.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
