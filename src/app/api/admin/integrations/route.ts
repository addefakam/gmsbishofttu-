import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import {
  generateApiKey,
  hashApiKey,
  getKeyPrefix,
  DEFAULT_DATA_SHARING,
} from "@/lib/api-key-auth";

export const dynamic = "force-dynamic";

/**
 * /api/admin/integrations
 *
 * GET    — list all integrations (without apiKeyHash)
 * POST   — create a new integration; returns the plaintext API key ONCE.
 *
 * Both require SUPERUSER.
 */

// ── Field projection: NEVER include apiKeyHash in responses. ──
const INTEGRATION_PUBLIC_FIELDS = {
  id: true,
  name: true,
  description: true,
  apiKeyPrefix: true,
  scopes: true,
  permissions: true,
  status: true,
  rateLimit: true,
  ipAllowlist: true,
  dataSharing: true,
  webhookUrl: true,
  webhookSecret: false, // never expose the webhook secret either
  createdBy: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { apiLogs: true } },
} as const;

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Superuser access required" } },
        { status: 403 }
      );
    }

    const integrations = await db.integration.findMany({
      select: INTEGRATION_PUBLIC_FIELDS,
      orderBy: { createdAt: "desc" },
    });

    // Normalize JSON-string fields for the client.
    const data = integrations.map((i) => ({
      ...i,
      scopes: safeParse(i.scopes, []),
      permissions: safeParse(i.permissions, ["read"]),
      ipAllowlist: safeParse(i.ipAllowlist, []),
      dataSharing: i.dataSharing ?? DEFAULT_DATA_SHARING,
      logCount: i._count.apiLogs,
      _count: undefined,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: error.message } },
        { status: error.statusCode }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to list integrations";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Superuser access required" } },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { name, description, scopes, rateLimit, dataSharing } = body as {
      name?: string;
      description?: string;
      scopes?: string[];
      rateLimit?: number;
      dataSharing?: Record<string, any>;
    };

    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "name is required" } },
        { status: 400 }
      );
    }

    // Normalize scopes — must be a non-empty array of known scope strings.
    const VALID_SCOPES = ["providers", "rooms", "reservations", "guests"];
    const finalScopes = Array.isArray(scopes)
      ? scopes.filter((s) => typeof s === "string" && VALID_SCOPES.includes(s))
      : [];
    if (finalScopes.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: `scopes must be a non-empty array of: ${VALID_SCOPES.join(", ")}`,
          },
        },
        { status: 400 }
      );
    }

    const finalRateLimit =
      typeof rateLimit === "number" && Number.isFinite(rateLimit) && rateLimit > 0
        ? Math.floor(rateLimit)
        : 1000;

    const finalDataSharing =
      dataSharing && typeof dataSharing === "object" && !Array.isArray(dataSharing)
        ? dataSharing
        : DEFAULT_DATA_SHARING;

    // Generate the API key. The plaintext is returned to the caller ONCE
    // — it is never retrievable again (only the hash is stored).
    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);
    const apiKeyPrefix = getKeyPrefix(apiKey);

    const integration = await db.integration.create({
      data: {
        name: name.trim(),
        description: typeof description === "string" ? description.trim() : "",
        apiKeyHash,
        apiKeyPrefix,
        scopes: JSON.stringify(finalScopes),
        permissions: JSON.stringify(["read"]),
        status: "ACTIVE", // admin-created integrations are active immediately
        rateLimit: finalRateLimit,
        ipAllowlist: "[]",
        dataSharing: finalDataSharing,
        createdBy: auth.userId,
      },
      select: INTEGRATION_PUBLIC_FIELDS,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          ...integration,
          scopes: safeParse(integration.scopes, []),
          permissions: safeParse(integration.permissions, ["read"]),
          ipAllowlist: safeParse(integration.ipAllowlist, []),
          dataSharing: integration.dataSharing ?? DEFAULT_DATA_SHARING,
          logCount: integration._count.apiLogs,
          _count: undefined,
          apiKey, // ⚠️ plaintext — shown only this once
        },
        warning:
          "Store this API key securely. It will not be shown again. The hash is stored server-side.",
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: error.message } },
        { status: error.statusCode }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to create integration";
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

// ── helpers ────────────────────────────────────────────────────────

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
