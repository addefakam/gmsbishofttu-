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

const ALLOWED_STATUSES = ["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED", "DELETED"];

/**
 * GET /api/v1/reservations
 * Lists reservations from APPROVED providers.
 *
 * Query params:
 *   page        (default 1)
 *   limit       (default 50, max 100)
 *   status      — ReservationStatus enum value
 *   providerId  — exact match
 *   dateFrom    — ISO date; filter checkIn >= dateFrom
 *   dateTo      — ISO date; filter checkIn <= dateTo
 *
 * Response fields restricted by `dataSharing.reservations`.
 */
export async function GET(req: NextRequest) {
  const start = Date.now();

  const auth = await validateApiKey(req);
  if (!auth) {
    return unauthorized(req, start);
  }
  if (!hasScope(auth, "reservations")) {
    return forbidden(req, start, auth, "reservations");
  }

  try {
    const { searchParams } = req.nextUrl;
    const page = clampPage(parseInt(searchParams.get("page") || "1", 10));
    const limit = clampLimit(parseInt(searchParams.get("limit") || "50", 10), 100);
    const status = searchParams.get("status")?.trim() || undefined;
    const providerId = searchParams.get("providerId")?.trim() || undefined;
    const dateFrom = searchParams.get("dateFrom")?.trim() || undefined;
    const dateTo = searchParams.get("dateTo")?.trim() || undefined;

    if (status && !ALLOWED_STATUSES.includes(status)) {
      return validationError(
        req, start, auth,
        `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}`
      );
    }

    const where: Record<string, unknown> = {
      provider: { status: "APPROVED" },
    };
    if (status) where.status = status;
    if (providerId) where.providerId = providerId;

    // Reservation.checkIn is stored as an ISO string, so string comparison works.
    if (dateFrom || dateTo) {
      const range: Record<string, string> = {};
      if (dateFrom) range.gte = dateFrom;
      if (dateTo) range.lte = dateTo;
      where.checkIn = range;
    }

    const [total, records] = await Promise.all([
      db.reservation.count({ where }),
      db.reservation.findMany({
        where,
        include: {
          room: { select: { id: true, number: true, name: true, type: true } },
          provider: { select: { id: true, name: true, subCity: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const filteredReservations = filterFields(
      records as unknown as Record<string, any>[],
      "reservations",
      auth.dataSharing
    ) as Record<string, any>[];

    const filtered = filteredReservations.map((res, i) => {
      // Attach room + provider (filtered) if data sharing allows.
      const rawRoom = records[i]?.room;
      const rawProvider = records[i]?.provider;
      if (rawRoom) {
        res.room = filterFields(
          rawRoom as unknown as Record<string, any>,
          "rooms",
          auth.dataSharing
        );
      }
      if (rawProvider) {
        res.provider = filterFields(
          rawProvider as unknown as Record<string, any>,
          "providers",
          auth.dataSharing
        );
      }
      return res;
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
