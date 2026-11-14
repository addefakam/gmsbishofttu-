import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import {
  validateApiKey,
  hasScope,
  filterFields,
  logApiRequest,
  type IntegrationAuth,
} from "@/lib/api-key-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/rooms
 * Lists rooms belonging to APPROVED providers only.
 *
 * Query params:
 *   page        (default 1)
 *   limit       (default 50, max 100)
 *   providerId  — exact match
 *   type        — RoomType enum (SINGLE, DOUBLE, ...)
 *   minPrice    — pricePerNight >=
 *   maxPrice    — pricePerNight <=
 *   available   — "true" filters out rooms with overlapping UPCOMING/ACTIVE reservations
 *   checkIn     — ISO date, required when available=true (with checkOut)
 *   checkOut    — ISO date, required when available=true (with checkIn)
 *
 * Response fields are restricted by the integration's `dataSharing.rooms` config.
 */
export async function GET(req: NextRequest) {
  const start = Date.now();

  const auth = await validateApiKey(req);
  if (!auth) {
    return unauthorized(req, start);
  }
  if (!hasScope(auth, "rooms")) {
    return forbidden(req, start, auth, "rooms");
  }

  try {
    const { searchParams } = req.nextUrl;
    const page = clampPage(parseInt(searchParams.get("page") || "1", 10));
    const limit = clampLimit(parseInt(searchParams.get("limit") || "50", 10), 100);
    const providerId = searchParams.get("providerId")?.trim() || undefined;
    const type = searchParams.get("type")?.trim() || undefined;
    const minPrice = parseFloatOrNull(searchParams.get("minPrice"));
    const maxPrice = parseFloatOrNull(searchParams.get("maxPrice"));
    const available = searchParams.get("available")?.toLowerCase() === "true";
    const checkIn = searchParams.get("checkIn")?.trim() || undefined;
    const checkOut = searchParams.get("checkOut")?.trim() || undefined;

    // Build the rooms where clause — always scope to APPROVED providers.
    const where: Record<string, unknown> = {
      provider: { status: "APPROVED" },
    };
    if (providerId) where.providerId = providerId;
    if (type) where.type = type;
    if (minPrice !== null || maxPrice !== null) {
      const range: Record<string, number> = {};
      if (minPrice !== null) range.gte = minPrice;
      if (maxPrice !== null) range.lte = maxPrice;
      where.pricePerNight = range;
    }

    // If available=true, exclude rooms with overlapping UPCOMING/ACTIVE reservations.
    if (available) {
      if (!checkIn || !checkOut) {
        return validationError(
          req, start, auth,
          "When available=true, both checkIn and checkOut must be provided as ISO dates."
        );
      }
      where.NOT = {
        reservations: {
          some: buildOverlapFilter(checkIn, checkOut),
        },
      };
    }

    const [total, records] = await Promise.all([
      db.room.count({ where }),
      db.room.findMany({
        where,
        include: { provider: { select: { id: true, name: true, subCity: true, type: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    // Filter rooms fields per data-sharing config; preserve nested provider (filtered too).
    const filteredRooms = filterFields(
      records as unknown as Record<string, any>[],
      "rooms",
      auth.dataSharing
    ) as Record<string, any>[];

    const filtered = filteredRooms.map((room, i) => {
      const rawProvider = records[i]?.provider;
      if (rawProvider) {
        const providerFiltered = filterFields(
          rawProvider as unknown as Record<string, any>,
          "providers",
          auth.dataSharing
        );
        room.provider = providerFiltered;
      }
      return room;
    });

    const responseTimeMs = Date.now() - start;
    logApiRequest(auth, req, 200, responseTimeMs);

    return NextResponse.json({
      success: true,
      data: filtered,
      pagination: { page, limit, total, totalPages },
      meta: {
        requestId: randomUUID(),
        timestamp: new Date().toISOString(),
        responseTimeMs,
      },
    });
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    logApiRequest(auth, req, 500, responseTimeMs);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      {
        success: false,
        error: { code: "INTERNAL_ERROR", message },
        meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), responseTimeMs },
      },
      { status: 500 }
    );
  }
}

// ── helpers ────────────────────────────────────────────────────────

/**
 * Reservation.checkIn/checkOut are stored as ISO strings.
 * Two date ranges [a1, a2) and [b1, b2) overlap iff a1 < b2 AND b1 < a2.
 *
 * We exclude CANCELLED and DELETED reservations — only UPCOMING/ACTIVE count.
 */
function buildOverlapFilter(checkIn: string, checkOut: string) {
  return {
    status: { in: ["UPCOMING", "ACTIVE"] },
    // Lexicographic comparison works for ISO date strings.
    AND: [
      { checkOut: { gt: checkIn } },
      { checkIn: { lt: checkOut } },
    ],
  };
}

function clampPage(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function clampLimit(n: number, max: number): number {
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, max);
}
function parseFloatOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function unauthorized(req: NextRequest, start: number) {
  const responseTimeMs = Date.now() - start;
  return NextResponse.json(
    {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
      meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), responseTimeMs },
    },
    { status: 401 }
  );
}

function forbidden(req: NextRequest, start: number, auth: IntegrationAuth, scope: string) {
  const responseTimeMs = Date.now() - start;
  logApiRequest(auth, req, 403, responseTimeMs);
  return NextResponse.json(
    {
      success: false,
      error: { code: "FORBIDDEN", message: `Missing required scope: ${scope}` },
      meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), responseTimeMs },
    },
    { status: 403 }
  );
}

function validationError(
  req: NextRequest,
  start: number,
  auth: IntegrationAuth,
  message: string
) {
  const responseTimeMs = Date.now() - start;
  logApiRequest(auth, req, 400, responseTimeMs);
  return NextResponse.json(
    {
      success: false,
      error: { code: "VALIDATION_ERROR", message },
      meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), responseTimeMs },
    },
    { status: 400 }
  );
}
