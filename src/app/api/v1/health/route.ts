import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  validateApiKey,
  logApiRequest,
} from "@/lib/api-key-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health
 * Lightweight liveness probe for integration partners.
 * Requires a valid API key — used to verify the key works before
 * issuing data-fetch requests.
 */
export async function GET(req: NextRequest) {
  const start = Date.now();

  const auth = await validateApiKey(req);
  if (!auth) {
    const responseTimeMs = Date.now() - start;
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Missing or invalid API key",
        },
      },
      { status: 401, headers: { "X-Response-Time-Ms": String(responseTimeMs) } }
    );
  }

  const responseTimeMs = Date.now() - start;
  logApiRequest(auth, req, 200, responseTimeMs);

  return NextResponse.json({
    success: true,
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "v1",
      integration: {
        id: auth.id,
        name: auth.name,
        scopes: auth.scopes,
      },
    },
    meta: {
      requestId: randomUUID(),
      timestamp: new Date().toISOString(),
      responseTimeMs,
    },
  });
}
