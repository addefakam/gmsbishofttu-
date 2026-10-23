import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getAuthContext, requirePolice, AuthError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);

    // All queries are capped to prevent OOM. Dashboard doesn't need exhaustive data.
    const [frequentStays, auditLogs, allProviders] = await Promise.all([
      db.frequentStayAlert.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" }, take: 50,
        select: { id: true, officerName: true, action: true, targetId: true, targetType: true, ipAddress: true, createdAt: true },
      }),
      db.provider.findMany({
        where: { status: "APPROVED" },
        select: {
          id: true, name: true, address: true, phone: true, type: true,
          latitude: true, longitude: true,
          _count: { select: { guests: true, rooms: true, reservations: true } },
        },
      }),
    ]);

    // Hotspot: group suspect matches by provider (capped at 5000 recent matches)
    const matches = await db.suspectMatch.findMany({
      select: { providerName: true, providerId: true, createdAt: true, id: true, suspectedPerson: { select: { severity: true } } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const hotspotMap = new Map<string, {
      providerName: string; providerId: string;
      matchCount: number; criticalCount: number; highCount: number;
      lastMatchDate: string | null;
    }>();
    for (const m of matches) {
      const key = m.providerId || m.providerName;
      if (!hotspotMap.has(key)) {
        hotspotMap.set(key, { providerName: m.providerName, providerId: m.providerId, matchCount: 0, criticalCount: 0, highCount: 0, lastMatchDate: null });
      }
      const entry = hotspotMap.get(key)!;
      entry.matchCount++;
      const sev = m.suspectedPerson?.severity || "";
      if (sev === "CRITICAL") entry.criticalCount++;
      if (sev === "HIGH") entry.highCount++;
      if (!entry.lastMatchDate || new Date(m.createdAt) > new Date(entry.lastMatchDate)) {
        entry.lastMatchDate = m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt);
      }
    }

    // Merge provider geo data with hotspot data
    const providerGeoMap = new Map(allProviders.map((p) => [p.id, p]));
    const hotspotData = Array.from(hotspotMap.values()).map((h) => {
      const provider = providerGeoMap.get(h.providerId);
      return {
        ...h,
        address: provider?.address || "",
        latitude: provider?.latitude || 9.02,
        longitude: provider?.longitude || 38.75,
        guestCount: provider?._count.guests || 0,
        roomCount: provider?._count.rooms || 0,
        hasCoordinates: !!(provider?.latitude && provider?.longitude && provider.latitude !== 9.02),
      };
    }).sort((a, b) => b.matchCount - a.matchCount);

    // All providers for map display (even those without matches)
    const allProviderLocations = allProviders.map((p) => {
      const hotspot = hotspotMap.get(p.id);
      return {
        id: p.id,
        name: p.name,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        type: p.type,
        phone: p.phone,
        guestCount: p._count.guests,
        roomCount: p._count.rooms,
        matchCount: hotspot?.matchCount || 0,
        criticalCount: hotspot?.criticalCount || 0,
        highCount: hotspot?.highCount || 0,
        hasCoordinates: !!(p.latitude && p.longitude && p.latitude !== 9.02),
      };
    });

    // Occupancy vs Crime correlation (last 6 months) — uses SQL GROUP BY for efficiency
    // instead of loading all records into memory.
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const reservationCounts = await db.$queryRaw<{month: string; count: bigint}[]>(
      Prisma.sql`SELECT TO_CHAR("createdAt", 'YYYY-MM') as month, COUNT(*) as count
       FROM "Reservation"
       WHERE "createdAt" >= ${sixMonthsAgo.toISOString()}
       GROUP BY TO_CHAR("createdAt", 'YYYY-MM')`
    );
    const suspectMatchCounts = await db.$queryRaw<{month: string; count: bigint}[]>(
      Prisma.sql`SELECT TO_CHAR("createdAt", 'YYYY-MM') as month, COUNT(*) as count
       FROM "SuspectMatch"
       WHERE "createdAt" >= ${sixMonthsAgo.toISOString()}
       GROUP BY TO_CHAR("createdAt", 'YYYY-MM')`
    );

    // Build last 6 months data
    const resMap = new Map(reservationCounts.map(r => [r.month, Number(r.count)]));
    const matchMap = new Map(suspectMatchCounts.map(m => [m.month, Number(m.count)]));
    const monthlyData: { month: string; reservations: number; suspectMatches: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const monthStr = d.toLocaleString("en-US", { month: "short", year: "2-digit" });
      monthlyData.push({
        month: monthStr,
        reservations: resMap.get(monthKey) || 0,
        suspectMatches: matchMap.get(monthKey) || 0,
      });
    }

    return NextResponse.json({
      frequentStays,
      hotspotData,
      allProviderLocations,
      occupancyCrimeCorrelation: monthlyData,
      recentActivity: auditLogs,
    });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch intelligence";
    const status = message.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
