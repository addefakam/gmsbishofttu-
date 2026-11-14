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
 * GET /api/v1/guests/:id
 * Fetch a single guest by id. Only visible if the guest belongs to an
 * APPROVED provider (guests created without a provider — e.g. via the
 * Guest Room Finder app — are also visible).
 *
 * Fields are filtered through the integration's `dataSharing.guests` config.
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
  if (!hasScope(auth, "guests")) {
    return forbidden(req, start, auth, "guests");
  }

  try {
    const { id } = await params;

    // Either the guest has no provider (providerId null) or the provider
    // is APPROVED. Suspended/pending providers' guests are not exposed.
    const guest = await db.guest.findFirst({
      where: {
        id,
        OR: [
          { providerId: null },
          { provider: { status: "APPROVED" } },
        ],
      },
    });

    const responseTimeMs = Date.now() - start;

    if (!guest) {
      logApiRequest(auth, req, 404, responseTimeMs);
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Guest not found" },
          meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), responseTimeMs },
        },
        { status: 404 }
      );
    }

    const filtered = filterFields(
      guest as unknown as Record<string, any>,
      "guests",
      auth.dataSharing
    );

    logApiRequest(auth, req, 200, responseTimeMs);

    return NextResponse.json({
      success: true,
      data: filtered,
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
