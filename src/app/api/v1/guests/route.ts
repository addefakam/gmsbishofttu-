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
 * GET /api/v1/guests
 * Lists guests belonging to APPROVED providers.
 *
 * ⚠️ Privacy note: guests carry PII (id numbers, address, etc).
 * The default data-sharing config exposes only minimal fields
 * (name, phone, nationality, vip). Integrations must be granted
 * additional fields explicitly by a SUPERUSER to see more.
 *
 * Query params:
 *   page        (default 1)
 *   limit       (default 50, max 100)
 *   nationality — exact match (case-insensitive)
 *   q           — search on name (case-insensitive contains)
 */
export async function GET(req: NextRequest) {
  const start = Date.now();

  const auth = await validateApiKey(req);
  if (!auth) {
    return unauthorized(req, start);
  }
  if (!hasScope(auth, "guests")) {
    return forbidden(req, start, auth, "guests");
  }

  try {
    const { searchParams } = req.nextUrl;
    const page = clampPage(parseInt(searchParams.get("page") || "1", 10));
    const limit = clampLimit(parseInt(searchParams.get("limit") || "50", 10), 100);
    const nationality = searchParams.get("nationality")?.trim() || undefined;
    const q = searchParams.get("q")?.trim() || undefined;

    const where: Record<string, unknown> = {
      provider: { status: "APPROVED" },
    };
    if (nationality) where.nationality = { equals: nationality, mode: "insensitive" };
    if (q) where.name = { contains: q, mode: "insensitive" };

    const [total, records] = await Promise.all([
      db.guest.count({ where }),
      db.guest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const filtered = filterFields(
      records as unknown as Record<string, any>[],
      "guests",
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
