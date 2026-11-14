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
 * GET /api/v1/providers
 * Lists APPROVED guesthouse providers only.
 *
 * Query params:
 *   page     (default 1)
 *   limit    (default 50, max 100)
 *   subCity  — filter by sub-city (exact match)
 *   type     — filter by provider type (GUEST_HOUSE, HOTEL, ...)
 *   q        — case-insensitive search on name
 *
 * Response fields are restricted by the integration's `dataSharing.providers`
 * config via `filterFields`.
 */
export async function GET(req: NextRequest) {
  const start = Date.now();

  const auth = await validateApiKey(req);
  if (!auth) {
    return unauthorized(req, start);
  }
  if (!hasScope(auth, "providers")) {
    return forbidden(req, start, auth, "providers");
  }

  try {
    const { searchParams } = req.nextUrl;
    const page = clampPage(parseInt(searchParams.get("page") || "1", 10));
    const limit = clampLimit(parseInt(searchParams.get("limit") || "50", 10), 100);
    const subCity = searchParams.get("subCity")?.trim() || undefined;
    const type = searchParams.get("type")?.trim() || undefined;
    const q = searchParams.get("q")?.trim() || undefined;

    const where: Record<string, unknown> = { status: "APPROVED" };
    if (subCity) where.subCity = subCity;
    if (type) where.type = type;
    if (q) {
      where.name = { contains: q, mode: "insensitive" };
    }

    const [total, records] = await Promise.all([
      db.provider.count({ where }),
      db.provider.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const filtered = filterFields(
      records as unknown as Record<string, any>[],
      "providers",
      auth.dataSharing
    );

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
    return serverError(req, start, err);
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

function serverError(req: NextRequest, start: number, err: unknown) {
  const responseTimeMs = Date.now() - start;
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
