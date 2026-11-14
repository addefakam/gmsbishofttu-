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
 * GET /api/v1/reservations/:id
 * Fetch a single reservation by id. The provider must be APPROVED
 * for the record to be externally visible.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now();

  const auth = await validateApiKey(req);
  if (!auth) {
    return unauthorized(req, start);
  }
  if (!hasScope(auth, "reservations")) {
    return forbidden(req, start, auth, "reservations");
  }

  try {
    const { id } = await params;

    const reservation = await db.reservation.findFirst({
      where: { id, provider: { status: "APPROVED" } },
      include: {
        room: { select: { id: true, number: true, name: true, type: true } },
        provider: {
          select: {
            id: true, name: true, subCity: true, woreda: true,
            type: true, phone: true, address: true,
          },
        },
      },
    });

    const responseTimeMs = Date.now() - start;

    if (!reservation) {
      logApiRequest(auth, req, 404, responseTimeMs);
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Reservation not found" },
          meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), responseTimeMs },
        },
        { status: 404 }
      );
    }

    // NOTE: the guest relation is intentionally excluded here — guest PII
    // is never exposed via the reservations endpoint. Use the /guests routes
    // (with the "guests" scope) to fetch guest data with proper filtering.
    const filteredRes = filterFields(
      reservation as unknown as Record<string, any>,
      "reservations",
      auth.dataSharing
    ) as Record<string, any>;

    if (reservation.room) {
      filteredRes.room = filterFields(
        reservation.room as unknown as Record<string, any>,
        "rooms",
        auth.dataSharing
      );
    }
    if (reservation.provider) {
      filteredRes.provider = filterFields(
        reservation.provider as unknown as Record<string, any>,
        "providers",
        auth.dataSharing
      );
    }

    logApiRequest(auth, req, 200, responseTimeMs);

    return NextResponse.json({
      success: true,
      data: filteredRes,
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
