import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { ensureNewTables } from "@/lib/ensure-tables";
import { parseOwnerFeatureFlags } from "@/app/api/operator-features/route";
import { runReservationMaintenance } from "@/lib/reservation-maintenance";

export const dynamic = "force-dynamic";

/**
 * GET /api/operator-room-availability
 *
 * Returns the same shape as /api/police-room-availability (city-wide room
 * breakdown across all approved guesthouses) — but gated behind the
 * `multiProviderRooms` owner feature flag.
 *
 * Access:
 *   - OPERATOR + SUPERUSER-with-providerId: allowed IF the flag is enabled
 *   - POLICE + system-admin SUPERUSER (no providerId): not allowed (use the
 *     police endpoint instead)
 *   - STAFF: not allowed
 *
 * Returns 403 if the flag is OFF or if the user lacks permission.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);

    // Only operators/owners can use this endpoint. Police + system admin
    // should use /api/police-room-availability instead.
    if (auth.role !== "OPERATOR" && !(auth.role === "SUPERUSER" && auth.providerId)) {
      return NextResponse.json(
        { error: "Access denied. This endpoint is for operators/owners only." },
        { status: 403 }
      );
    }

    // Check the multiProviderRooms feature flag — read from PoliceAlertConfig.
    // Default is FALSE (opt-in), so this endpoint 403s unless the admin has
    // explicitly enabled the flag from the Operator Features admin page.
    let multiProviderRoomsEnabled = false;
    try {
      const config = await db.policeAlertConfig.findFirst();
      const rawFlags = (config as unknown as Record<string, unknown> | null)?.operatorFeatureFlags as string | null | undefined;
      const flags = parseOwnerFeatureFlags(rawFlags);
      multiProviderRoomsEnabled = flags.multiProviderRooms === true;
    } catch (flagErr) {
      console.warn("[operator-room-availability] Failed to read ownerFeatureFlags — treating as disabled:", flagErr instanceof Error ? flagErr.message : flagErr);
    }

    if (!multiProviderRoomsEnabled) {
      return NextResponse.json(
        {
          error: "Multi-Provider Room Breakdown is not enabled. Ask the system admin to enable the 'multiProviderRooms' feature flag from Operator Features.",
          flagDisabled: true,
        },
        { status: 403 }
      );
    }

    // Lazy maintenance (global scope, throttled + idempotent) so room
    // statuses reflect past-checkout auto-releases even between cron runs.
    try {
      await runReservationMaintenance({});
    } catch {
      // Maintenance must never break room availability reads.
    }

    // ── Count ALL providers (regardless of status) ──
    const allProvidersCountRaw = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM "Provider"`;
    const allProvidersCount = Number(allProvidersCountRaw[0].count);

    // ── Room statistics (city-wide — no jurisdiction filter for operators) ──
    const statsRaw = await db.$queryRaw<{ status: string; count: bigint }[]>`SELECT "status", COUNT(*)::bigint as count FROM "Room" GROUP BY "status"`;
    const statsMap: Record<string, number> = {};
    for (const s of statsRaw) {
      statsMap[s.status] = Number(s.count);
    }
    const totalRooms = Object.values(statsMap).reduce((a, b) => a + b, 0);
    const availableRooms = statsMap["AVAILABLE"] || 0;
    const occupiedRooms = statsMap["OCCUPIED"] || 0;
    const reservedRooms = statsMap["RESERVED"] || 0;
    const maintenanceRooms = statsMap["MAINTENANCE"] || 0;

    // ── Room type breakdown ──
    const roomTypesRaw = await db.$queryRaw<{ type: string; count: bigint }[]>`SELECT type, COUNT(*)::bigint as count FROM "Room" GROUP BY type`;
    const roomTypes = roomTypesRaw.map((r) => ({ type: r.type, _count: { id: Number(r.count) } }));

    // ── Per-provider room breakdown (APPROVED providers only) ──
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
      WHERE p."status" = 'APPROVED'
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
        totalProviders: allProvidersCount,
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
    console.error("[operator-room-availability] GET error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return NextResponse.json({ error: "Database tables not yet initialized. Please try again in a moment." }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to fetch room availability" }, { status: 500 });
  }
}
