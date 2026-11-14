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
 * GET /api/v1/rooms/available
 * Returns rooms (from APPROVED providers) that have NO overlapping
 * UPCOMING/ACTIVE reservations in the supplied date range.
 *
 * Required query params:
 *   checkIn   — ISO date string
 *   checkOut  — ISO date string (must be after checkIn)
 *
 * Optional:
 *   providerId
 *   type       — RoomType enum value
 *   page, limit
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
    const checkIn = searchParams.get("checkIn")?.trim();
    const checkOut = searchParams.get("checkOut")?.trim();

    if (!checkIn || !checkOut) {
      return validationError(
        req, start, auth,
        "Both checkIn and checkOut are required (ISO date strings)."
      );
    }
    if (new Date(checkIn).toString() === "Invalid Date" || new Date(checkOut).toString() === "Invalid Date") {
      return validationError(req, start, auth, "checkIn and checkOut must be valid ISO dates.");
    }
    if (checkIn >= checkOut) {
      return validationError(req, start, auth, "checkOut must be after checkIn.");
    }

    const where: Record<string, unknown> = {
      provider: { status: "APPROVED" },
      NOT: {
        reservations: {
          some: {
            status: { in: ["UPCOMING", "ACTIVE"] },
            AND: [
              { checkOut: { gt: checkIn } },
              { checkIn: { lt: checkOut } },
            ],
          },
        },
      },
    };
    if (providerId) where.providerId = providerId;
    if (type) where.type = type;

    const [total, records] = await Promise.all([
      db.room.count({ where }),
      db.room.findMany({
        where,
        include: {
          provider: {
            select: {
              id: true, name: true, subCity: true, woreda: true,
              type: true, phone: true, address: true,
              latitude: true, longitude: true, status: true,
            },
          },
        },
        orderBy: { pricePerNight: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const filteredRooms = filterFields(
      records as unknown as Record<string, any>[],
      "rooms",
      auth.dataSharing
    ) as Record<string, any>[];

    const filtered = filteredRooms.map((room, i) => {
      const rawProvider = records[i]?.provider;
      if (rawProvider) {
        room.provider = filterFields(
          rawProvider as unknown as Record<string, any>,
          "providers",
          auth.dataSharing
        );
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

function clampPage(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function clampLimit(n: number, max: number): number {
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, max);
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
