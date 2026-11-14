import { NextRequest } from "next/server";
import { db } from "./db";
import { createHash, randomBytes } from "crypto";

// ── API Key Generation ──────────────────────────────────────────────

/**
 * Generates a new API key: ghms_live_<32_random_chars>
 */
export function generateApiKey(): string {
  const random = randomBytes(24).toString("base64url").slice(0, 32);
  return `ghms_live_${random}`;
}

/**
 * Hashes an API key with SHA-256 for storage.
 * The plaintext key is NEVER stored — only the hash.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Returns the first 12 characters of the key for display (masked).
 * e.g. "ghms_live_a1b2"
 */
export function getKeyPrefix(key: string): string {
  return key.slice(0, 12);
}

// ── Integration Auth ────────────────────────────────────────────────

export interface IntegrationAuth {
  id: string;
  name: string;
  scopes: string[];
  permissions: string[];
  dataSharing: Record<string, any>;
  rateLimit: number;
}

/**
 * Validates the x-api-key header and returns the integration's config.
 * Returns null if the key is invalid, inactive, or expired.
 */
export async function validateApiKey(req: NextRequest): Promise<IntegrationAuth | null> {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return null;

  const keyHash = hashApiKey(apiKey);

  try {
    const integration = await db.integration.findUnique({
      where: { apiKeyHash: keyHash },
      select: {
        id: true, name: true, scopes: true, permissions: true,
        dataSharing: true, rateLimit: true, status: true, expiresAt: true,
      },
    });

    if (!integration) return null;
    if (integration.status !== "ACTIVE") return null;
    if (integration.expiresAt && integration.expiresAt < new Date()) return null;

    // Update lastUsedAt (fire-and-forget, don't block the request)
    db.integration.update({
      where: { id: integration.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    return {
      id: integration.id,
      name: integration.name,
      scopes: JSON.parse(integration.scopes || "[]"),
      permissions: JSON.parse(integration.permissions || "[\"read\"]"),
      dataSharing: (integration.dataSharing as Record<string, any>) || {},
      rateLimit: integration.rateLimit,
    };
  } catch (err) {
    console.error("[api-key-auth] Validation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Checks if the integration has the required scope.
 */
export function hasScope(auth: IntegrationAuth, scope: string): boolean {
  return auth.scopes.includes(scope);
}

// ── Field-Level Filtering ───────────────────────────────────────────

/**
 * Default data sharing config — applied when an integration is created
 * with no custom config. Defaults to MINIMAL sharing (least privilege).
 */
export const DEFAULT_DATA_SHARING: Record<string, any> = {
  providers: {
    enabled: true,
    fields: {
      name: true, phone: true, address: true, subCity: true, woreda: true,
      type: true, latitude: true, longitude: true, bedCount: true, status: true,
      licenseNo: false, licenseFile: false, rejectionReason: false,
      suspensionReason: false, suspendedBy: false, suspendedAt: false,
    },
    filters: { status: ["APPROVED"] },
  },
  rooms: {
    enabled: true,
    fields: {
      number: true, name: true, type: true, pricePerNight: true,
      pricePerNightWeekend: true, capacity: true, floor: true,
      amenities: true, description: true, image: true, status: true,
    },
    filters: {},
  },
  reservations: {
    enabled: true,
    fields: {
      checkIn: true, checkOut: true, nights: true, status: true,
      totalCost: true, paymentStatus: true,
    },
    filters: { status: ["UPCOMING", "ACTIVE", "COMPLETED"] },
  },
  guests: {
    enabled: true,
    fields: {
      name: true, phone: true, nationality: true, vip: true,
    },
    filters: {},
  },
};

/**
 * Filters a record (or array of records) to only include fields
 * the integration is authorized to see.
 */
export function filterFields(
  records: Record<string, any> | Record<string, any>[],
  entityType: string,
  dataSharing: Record<string, any>
): Record<string, any> | Record<string, any>[] {
  const config = dataSharing[entityType];
  if (!config || !config.enabled) return [];

  const fields = config.fields || {};
  const isArray = Array.isArray(records);
  const arr = isArray ? records : [records];

  const filtered = arr.map((record) => {
    const result: Record<string, any> = {};
    for (const [field, enabled] of Object.entries(fields)) {
      if (enabled && record[field] !== undefined) {
        result[field] = record[field];
      }
    }
    // Always include 'id' (needed for detail lookups)
    if (record.id !== undefined && !result.id) {
      result.id = record.id;
    }
    return result;
  });

  return isArray ? filtered : filtered[0];
}

// ── Audit Logging ───────────────────────────────────────────────────

/**
 * Logs an API request to the ApiLog table.
 * Fire-and-forget — doesn't block the response.
 */
export function logApiRequest(
  auth: IntegrationAuth,
  req: NextRequest,
  statusCode: number,
  responseTimeMs: number
): void {
  const endpoint = req.nextUrl.pathname;
  const method = req.method;
  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = req.headers.get("user-agent") || "";
  const requestParams = req.nextUrl.search || "";

  db.apiLog.create({
    data: {
      integrationId: auth.id,
      integrationName: auth.name,
      endpoint,
      method,
      statusCode,
      responseTimeMs,
      ipAddress,
      userAgent,
      requestParams,
    },
  }).catch(() => {});
}
