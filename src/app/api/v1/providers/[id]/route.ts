import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import {
  validateApiKey,
  hasScope,
  filterFields,
  logApiRequest,
} from "@/lib/api-key-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/providers/:id
 * Fetch a single APPROVED provider by id.
 * Field access is restricted by the integration's data-sharing config.
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
  if (!hasScope(auth, "providers")) {
    return forbidden(req, start, auth, "providers");
  }

  try {
    const { id } = await params;

    // Only APPROVED providers are externally visible.
    const provider = await db.provider.findFirst({
      where: { id, status: "APPROVED" },
    });

    const responseTimeMs = Date.now() - start;

    if (!provider) {
      logApiRequest(auth, req, 404, responseTimeMs);
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Provider not found or not approved" },
          meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), responseTimeMs },
        },
        { status: 404 }
      );
    }

    const filtered = filterFields(
      provider as unknown as Record<string, any>,
      "providers",
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

function forbidden(req: NextRequest, start: number, auth: { id: string; name: string }, scope: string) {
  const responseTimeMs = Date.now() - start;
  logApiRequest(auth as any, req, 403, responseTimeMs);
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: `Missing required scope: ${scope}`,
      },
      meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), responseTimeMs },
    },
    { status: 403 }
  );
}
