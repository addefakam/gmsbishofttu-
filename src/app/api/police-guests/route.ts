import { checkPolicePermission } from "@/lib/police-module-permissions";
import { resetInitFlag, ensureDatabase } from "@/lib/init-db";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, requirePolice, getJurisdictionFilter, AuthError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 5;

export async function GET(req: NextRequest) {
  try {
    resetInitFlag();
    await ensureReservationIntegrity();
    const auth = await getAuthContext(req);
    requirePolice(auth);
    const permError = checkPolicePermission(auth, "police_guests");
    if (permError) return NextResponse.json({ error: permError }, { status: 403 });

    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE)))
    );
    const skip = (page - 1) * pageSize;

    // ── Jurisdiction filter ──
    // Apply the jurisdiction filter to the Guest query via the Provider relation.
    // CITY → no filter (sees all guests)
    // SUBCITY → only guests whose provider is in auth.subCity
    // WOREDA → only guests whose provider is in auth.subCity + auth.woreda
    const jFilter = getJurisdictionFilter(auth);
    const hasSubCity = !!jFilter.subCity;
    const hasWoreda = !!jFilter.woreda;

    const where: Record<string, unknown> = {};
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { phone: { contains: q } },
        { idNumber: { contains: q } },
      ];
    }

    // Add jurisdiction filter to the where clause
    if (hasSubCity) {
      where.provider = hasWoreda
        ? { subCity: jFilter.subCity, woreda: jFilter.woreda }
        : { subCity: jFilter.subCity };
    }

    const [guests, total] = await Promise.all([
      db.guest.findMany({
        where,
        select: {
          id: true, name: true, phone: true, email: true, idNumber: true, idType: true,
          nationality: true, region: true, zone: true, woreda: true, kebele: true,
          plateNumber: true, weapon: true, vip: true, totalSpent: true, totalStays: true,
          providerId: true, createdAt: true, updatedAt: true,
          provider: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.guest.count({ where }),
    ]);

    logAudit(req, { action: "VIEW_GUESTS", details: q ? `Search: ${q} (page ${page})` : `Viewed guests page ${page}` });

    return NextResponse.json({
      guests,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to search guests";
    const status = message.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
