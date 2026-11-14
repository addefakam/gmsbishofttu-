import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { DEFAULT_DATA_SHARING } from "@/lib/api-key-auth";

export const dynamic = "force-dynamic";

/**
 * /api/admin/integrations/:id
 *
 * GET    — fetch a single integration (no apiKeyHash)
 * PUT    — update integration fields
 * DELETE — revoke: set status to REVOKED and wipe apiKeyHash
 *
 * All three require SUPERUSER.
 */

// ── Field projection: NEVER include apiKeyHash. ──
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
  webhookSecret: false,
  createdBy: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const VALID_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "REVOKED", "EXPIRED"];
const VALID_SCOPES = ["providers", "rooms", "reservations", "guests"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Superuser access required" } },
        { status: 403 }
      );
    }

    const { id } = await params;
    const integration = await db.integration.findUnique({
      where: { id },
      select: INTEGRATION_PUBLIC_FIELDS,
    });

    if (!integration) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Integration not found" } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: normalize(integration),
    });
  } catch (error: unknown) {
    return handleError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Superuser access required" } },
        { status: 403 }
      );
    }

    const { id } = await params;
    const existing = await db.integration.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Integration not found" } },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      name,
      description,
      scopes,
      rateLimit,
      dataSharing,
      status,
      ipAllowlist,
      webhookUrl,
    } = body as {
      name?: string;
      description?: string;
      scopes?: string[];
      rateLimit?: number;
      dataSharing?: Record<string, any>;
      status?: string;
      ipAllowlist?: string[];
      webhookUrl?: string | null;
    };

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json(
          { success: false, error: { code: "VALIDATION_ERROR", message: "name cannot be empty" } },
          { status: 400 }
        );
      }
      updateData.name = name.trim();
    }
    if (description !== undefined) {
      updateData.description = typeof description === "string" ? description.trim() : "";
    }
    if (scopes !== undefined) {
      if (!Array.isArray(scopes)) {
        return NextResponse.json(
          { success: false, error: { code: "VALIDATION_ERROR", message: "scopes must be an array" } },
          { status: 400 }
        );
      }
      const cleaned = scopes.filter((s) => typeof s === "string" && VALID_SCOPES.includes(s));
      if (cleaned.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: `scopes must contain at least one of: ${VALID_SCOPES.join(", ")}`,
            },
          },
          { status: 400 }
        );
      }
      updateData.scopes = JSON.stringify(cleaned);
    }
    if (rateLimit !== undefined) {
      if (typeof rateLimit !== "number" || !Number.isFinite(rateLimit) || rateLimit <= 0) {
        return NextResponse.json(
          { success: false, error: { code: "VALIDATION_ERROR", message: "rateLimit must be a positive number" } },
          { status: 400 }
        );
      }
      updateData.rateLimit = Math.floor(rateLimit);
    }
    if (dataSharing !== undefined) {
      if (typeof dataSharing !== "object" || Array.isArray(dataSharing)) {
        return NextResponse.json(
          { success: false, error: { code: "VALIDATION_ERROR", message: "dataSharing must be an object" } },
          { status: 400 }
        );
      }
      updateData.dataSharing = dataSharing;
    }
    if (status !== undefined) {
      if (typeof status !== "string" || !VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
            },
          },
          { status: 400 }
        );
      }
      updateData.status = status;
    }
    if (ipAllowlist !== undefined) {
      if (!Array.isArray(ipAllowlist)) {
        return NextResponse.json(
          { success: false, error: { code: "VALIDATION_ERROR", message: "ipAllowlist must be an array" } },
          { status: 400 }
        );
      }
      updateData.ipAllowlist = JSON.stringify(
        ipAllowlist.filter((ip) => typeof ip === "string")
      );
    }
    if (webhookUrl !== undefined) {
      // Allow null/empty to clear the webhook URL.
      if (webhookUrl === null || webhookUrl === "") {
        updateData.webhookUrl = null;
      } else if (typeof webhookUrl === "string") {
        try {
          // Basic URL validation.
          new URL(webhookUrl);
          updateData.webhookUrl = webhookUrl.trim();
        } catch {
          return NextResponse.json(
            { success: false, error: { code: "VALIDATION_ERROR", message: "webhookUrl must be a valid URL" } },
            { status: 400 }
          );
        }
      }
    }

    const updated = await db.integration.update({
      where: { id },
      data: updateData,
      select: INTEGRATION_PUBLIC_FIELDS,
    });

    return NextResponse.json({ success: true, data: normalize(updated) });
  } catch (error: unknown) {
    return handleError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Superuser access required" } },
        { status: 403 }
      );
    }

    const { id } = await params;
    const existing = await db.integration.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Integration not found" } },
        { status: 404 }
      );
    }

    // Revoke = set status to REVOKED and wipe the apiKeyHash so the key
    // can no longer validate, even if someone recovers it from a backup.
    // We don't hard-delete the row — audit logs reference it via FK.
    await db.integration.update({
      where: { id },
      data: {
        status: "REVOKED",
        apiKeyHash: `revoked:${id}`, // placeholder to satisfy @unique constraint
      },
    });

    return NextResponse.json({
      success: true,
      data: { id, status: "REVOKED", revokedAt: new Date().toISOString() },
    });
  } catch (error: unknown) {
    return handleError(error);
  }
}

// ── helpers ────────────────────────────────────────────────────────

function normalize(i: Record<string, any>) {
  return {
    ...i,
    scopes: safeParse(i.scopes, []),
    permissions: safeParse(i.permissions, ["read"]),
    ipAllowlist: safeParse(i.ipAllowlist, []),
    dataSharing: i.dataSharing ?? DEFAULT_DATA_SHARING,
  };
}

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function handleError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: error.message } },
      { status: error.statusCode }
    );
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json(
    { success: false, error: { code: "INTERNAL_ERROR", message } },
    { status: 500 }
  );
}
