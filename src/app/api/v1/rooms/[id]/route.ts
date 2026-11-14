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
 * GET /api/v1/rooms/:id
 * Fetch a single room (must belong to an APPROVED provider).
 * Includes filtered provider info.
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
  if (!hasScope(auth, "rooms")) {
    return forbidden(req, start, auth, "rooms");
  }

  try {
    const { id } = await params;

    const room = await db.room.findFirst({
      where: { id, provider: { status: "APPROVED" } },
      include: {
        provider: {
          select: {
            id: true, name: true, type: true, subCity: true, woreda: true,
            phone: true, address: true, latitude: true, longitude: true,
            status: true, bedCount: true,
          },
        },
      },
    });

    const responseTimeMs = Date.now() - start;

    if (!room) {
      logApiRequest(auth, req, 404, responseTimeMs);
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Room not found or provider not approved" },
          meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), responseTimeMs },
        },
        { status: 404 }
      );
    }

    // Filter the room's own fields first.
    const filteredRoom = filterFields(
      room as unknown as Record<string, any>,
      "rooms",
      auth.dataSharing
    ) as Record<string, any>;

    // Attach the provider (also filtered) — separate so filterFields works on top-level keys.
    const filteredProvider = filterFields(
      room.provider as unknown as Record<string, any>,
      "providers",
      auth.dataSharing
    );
    filteredRoom.provider = filteredProvider;

    logApiRequest(auth, req, 200, responseTimeMs);

    return NextResponse.json({
      success: true,
      data: filteredRoom,
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
