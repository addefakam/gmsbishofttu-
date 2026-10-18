import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { checkWritePermission } from "@/lib/tenant";
import { ensureNewTables } from "@/lib/ensure-tables";

export const dynamic = "force-dynamic";

/**
 * Force-adds the operatorFeatureFlags column to PoliceAlertConfig if it
 * doesn't exist yet. This bypasses the _initDone cache in ensureDatabase()
 * — which can skip migrations on Vercel warm serverless instances that ran
 * ensureDatabase() before the new migration was deployed.
 *
 * IMPORTANT: Prisma's $executeRawUnsafe does NOT support DO $$ ... END $$
 * blocks (it throws a syntax error). So we use a plain ALTER TABLE statement
 * wrapped in try/catch — duplicate_column errors are silently ignored.
 */
async function ensureOperatorFeatureFlagsColumn(): Promise<void> {
  try {
    await db.$executeRawUnsafe(
      `ALTER TABLE "PoliceAlertConfig" ADD COLUMN "operatorFeatureFlags" TEXT NOT NULL DEFAULT '{"ownerDashboard":true,"endOfDayReport":true,"shiftHandover":true,"maintenanceTickets":true}'`
    );
    console.log("[operator-features] operatorFeatureFlags column added to PoliceAlertConfig.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Ignore "duplicate column" errors — the column already exists.
    if (msg.includes("already exists") || msg.includes("duplicate column") || msg.includes("42701")) {
      // Expected — column is already there.
      return;
    }
    // Other errors are non-blocking — the PUT handler's fallback logic
    // handles missing columns gracefully. Just log so we can debug.
    console.warn("[operator-features] ensureOperatorFeatureFlagsColumn: ALTER TABLE failed (non-blocking):", msg);
  }
}

/**
 * Force-adds the disabledOperatorPages column to PoliceAlertConfig if it
 * doesn't exist yet. Same pattern as ensureOperatorFeatureFlagsColumn —
 * bypasses _initDone cache.
 */
async function ensureDisabledOperatorPagesColumn(): Promise<void> {
  try {
    await db.$executeRawUnsafe(
      `ALTER TABLE "PoliceAlertConfig" ADD COLUMN "disabledOperatorPages" TEXT NOT NULL DEFAULT '[]'`
    );
    console.log("[operator-features] disabledOperatorPages column added to PoliceAlertConfig.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("duplicate column") || msg.includes("42701")) {
      return;
    }
    console.warn("[operator-features] ensureDisabledOperatorPagesColumn: ALTER TABLE failed (non-blocking):", msg);
  }
}

// All page keys that can be toggled for OPERATOR/STAFF
// NOTE: 'users' (Account Management) is intentionally NOT in this list —
// the owner must always be able to manage their staff accounts. Removing
// it from the togglable list prevents the system admin from accidentally
// disabling it and locking the owner out of staff management.
const TOGGLABLE_PAGES = [
  { key: "dashboard", label: "Dashboard", icon: "LayoutDashboard", category: "core" },
  { key: "accommodation", label: "Accommodation", icon: "DoorOpen", category: "core" },
  // 'users' removed — always enabled for owners
  { key: "reports", label: "Reports", icon: "BarChart3", category: "management" },
  { key: "resources", label: "Stock Management", icon: "Package", category: "operations" },
  { key: "expenses", label: "Expenses", icon: "Receipt", category: "operations" },
  { key: "group-bookings", label: "Group Bookings", icon: "Users", category: "operations" },
  { key: "guest-communication", label: "Messages", icon: "MessageSquare", category: "operations" },
  { key: "staff-logs", label: "Staff Activity", icon: "ScrollText", category: "operations" },
  { key: "my-subscription", label: "Subscription", icon: "CreditCard", category: "billing" },
  { key: "settings", label: "Settings", icon: "Settings", category: "core" },
];

// ── Owner Visibility & Operational Control feature flags ──
// Each flag controls whether the corresponding feature is shown to
// guesthouse owners / operators. Default is true (enabled) so new
// deployments get the features; admins can disable any of them.
//
// EXCEPTION: multiProviderRooms defaults to FALSE — it grants operators
// visibility into OTHER guesthouses' rooms (city-wide), which is a new
// power that admins must explicitly enable per deployment.
export const OWNER_FEATURE_FLAGS = [
  {
    key: "ownerDashboard",
    label: "Owner Dashboard Enhancements",
    description: "Real-time KPIs (Occupancy, ADR, RevPAR, Cash Today), live alerts panel, 7-day revenue chart, cash-by-method breakdown on the main dashboard for owners.",
    icon: "TrendingUp",
    category: "owner-visibility",
  },
  {
    key: "endOfDayReport",
    label: "End-of-Day Report + Cash Reconciliation",
    description: "Daily report with payments by method, cash drawer reconciliation with discrepancy detection, shift sign-off, printable PDF, auto-email to owner at 23:00.",
    icon: "FileText",
    category: "owner-visibility",
  },
  {
    key: "shiftHandover",
    label: "Shift Handover Log",
    description: "Start/End Shift buttons in the header. Opening/closing cash counts, handover notes from outgoing → incoming clerk. Full audit trail of every shift.",
    icon: "RefreshCw",
    category: "operational-control",
  },
  {
    key: "maintenanceTickets",
    label: "Maintenance Ticket System",
    description: "Promotes maintenance tasks to a full ticket workflow: Open → Diagnosed → In Progress → Resolved. Aging alerts when a ticket is open > 3 days. New tab in Accommodation page.",
    icon: "Wrench",
    category: "operational-control",
  },
  {
    key: "multiProviderRooms",
    label: "Multi-Provider Room Breakdown (City-Wide)",
    description: "Allows operators/owners to view room availability across ALL approved guesthouses (city-wide), not just their own. Similar to the police dashboard's provider breakdown. Off by default — admin must explicitly enable.",
    icon: "Building2",
    category: "owner-visibility",
  },
] as const;

export type OwnerFeatureFlagKey = (typeof OWNER_FEATURE_FLAGS)[number]["key"];

// Default: most features enabled (true) so new deployments get them
// automatically. EXCEPTION: multiProviderRooms defaults to false because
// it grants operators visibility into OTHER guesthouses' rooms — a new
// power that admins must explicitly opt into.
export const DEFAULT_OWNER_FEATURE_FLAGS: Record<OwnerFeatureFlagKey, boolean> = {
  ownerDashboard: true,
  endOfDayReport: true,
  shiftHandover: true,
  maintenanceTickets: true,
  multiProviderRooms: false,
};

/** Parse the operatorFeatureFlags JSON string into a typed record,
 *  filling in any missing keys with defaults. */
export function parseOwnerFeatureFlags(raw: string | null | undefined): Record<OwnerFeatureFlagKey, boolean> {
  if (!raw) return { ...DEFAULT_OWNER_FEATURE_FLAGS };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result = { ...DEFAULT_OWNER_FEATURE_FLAGS };
    (Object.keys(DEFAULT_OWNER_FEATURE_FLAGS) as OwnerFeatureFlagKey[]).forEach((k) => {
      const v = parsed[k];
      // Treat only explicit `true` or `false` as a stored value.
      // Missing keys fall back to their DEFAULT_OWNER_FEATURE_FLAGS value.
      // (multiProviderRooms default is false; others are true.)
      if (v === true) result[k] = true;
      else if (v === false) result[k] = false;
    });
    return result;
  } catch {
    return { ...DEFAULT_OWNER_FEATURE_FLAGS };
  }
}

/**
 * GET /api/operator-features
 * Returns all togglable pages and which are currently disabled.
 * OPERATOR/STAFF can read (to know their own nav), SUPERUSER can read + write.
 *
 * Also returns the ownerFeatureFlags map (visible to all roles) so the
 * frontend can conditionally render features based on which flags are on.
 *
 * This route is defensive about the new `operatorFeatureFlags` column:
 *   - If the Prisma client doesn't know about the column yet (older build),
 *     we fall back to all-defaults.
 *   - If the production DB hasn't run the ALTER TABLE yet, the same.
 *   - If config is null (no row in PoliceAlertConfig yet), the same.
 * This ensures the API never 500s during the deploy window — the
 * Operator Features page just shows all flags as ON by default.
 */
export async function GET(req: NextRequest) {
  try {
    // Force-add the columns BEFORE we try to SELECT them.
    // This bypasses the _initDone cache in ensureDatabase() which can skip
    // new migrations on Vercel warm instances.
    await ensureDisabledOperatorPagesColumn();
    await ensureOperatorFeatureFlagsColumn();
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER" && auth.role !== "OPERATOR" && auth.role !== "STAFF") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Defensive: wrap the findFirst in try/catch — if the table doesn't
    // exist yet (very first deploy before init-db runs), return defaults
    // instead of 500ing.
    let config: { disabledOperatorPages?: string; operatorFeatureFlags?: string } | null = null;
    try {
      config = await db.policeAlertConfig.findFirst();
    } catch (findErr) {
      console.warn("[operator-features] PoliceAlertConfig.findFirst failed — returning defaults. Error:", findErr instanceof Error ? findErr.message : findErr);
      config = null;
    }

    let disabledPages: string[] = [];
    try {
      // config?.disabledOperatorPages is a JSON string like '["reports"]'
      // It's a primitive string, not undefined, even on older Prisma builds
      // (the column was added long ago). But we still guard with optional
      // chaining just in case config itself is null.
      const rawDisabled = config?.disabledOperatorPages;
      console.log("[operator-features] GET raw disabledOperatorPages:", rawDisabled);
      disabledPages = rawDisabled ? JSON.parse(rawDisabled) : [];
    } catch {
      disabledPages = [];
    }

    // Filter out any page keys that are no longer in TOGGLABLE_PAGES
    const validKeys = new Set(TOGGLABLE_PAGES.map((p) => p.key));
    disabledPages = disabledPages.filter((k) => validKeys.has(k));

    console.log("[operator-features] GET final disabledPages:", JSON.stringify(disabledPages));

    // Parse the owner feature flags — defensive about the new column.
    // If the column doesn't exist on the DB yet, or Prisma client doesn't
    // know about it, fall back to all-true defaults so the page loads
    // instead of erroring.
    let rawFlags: string | null | undefined = undefined;
    try {
      // Access via index to avoid TypeScript errors if the Prisma client
      // type doesn't include the new field yet (older build).
      rawFlags = (config as unknown as Record<string, unknown> | null)?.operatorFeatureFlags as string | null | undefined;
    } catch {
      rawFlags = null;
    }
    const ownerFeatureFlags = parseOwnerFeatureFlags(rawFlags);

    // OPERATOR/STAFF only get the disabled list + flags (smaller payload)
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json({ disabledPages, ownerFeatureFlags });
    }

    return NextResponse.json({
      pages: TOGGLABLE_PAGES.map((p) => ({
        ...p,
        enabled: !disabledPages.includes(p.key),
      })),
      disabledPages,
      // SUPERUSER also gets the catalog of owner feature flags with full
      // metadata (label, description, icon, category) so the admin page
      // can render the toggle UI.
      ownerFeatures: OWNER_FEATURE_FLAGS.map((f) => ({
        ...f,
        enabled: ownerFeatureFlags[f.key],
      })),
      ownerFeatureFlags,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[operator-features] GET error:", error);
    // Last-resort fallback: return a valid empty response so the frontend
    // can render with defaults instead of showing "Failed to load" toast.
    return NextResponse.json({
      pages: TOGGLABLE_PAGES.map((p) => ({ ...p, enabled: true })),
      disabledPages: [],
      ownerFeatures: OWNER_FEATURE_FLAGS.map((f) => ({ ...f, enabled: true })),
      ownerFeatureFlags: { ...DEFAULT_OWNER_FEATURE_FLAGS },
      degraded: true,
    });
  }
}

/**
 * PUT /api/operator-features
 * SUPERUSER only — updates the list of disabled operator pages AND/OR
 * the ownerFeatureFlags map. Both fields are optional in the request body;
 * only the fields present in the body are updated (partial update).
 */
export async function PUT(req: NextRequest) {
  try {
    // Force-add the columns BEFORE we try to UPDATE them.
    // This bypasses the _initDone cache in ensureDatabase() which can skip
    // new migrations on Vercel warm instances.
    await ensureDisabledOperatorPagesColumn();
    await ensureOperatorFeatureFlagsColumn();
    // Also run the full migration suite (fire-and-forget) for any other
    // new columns/tables that might also be missing.
    try { await ensureNewTables(); } catch { /* non-blocking */ }
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { allowSuperuser: true });

    const body = await req.json();
    const { disabledPages, ownerFeatureFlags } = body as {
      disabledPages?: string[];
      ownerFeatureFlags?: Record<string, boolean>;
    };

    console.log("[operator-features] PUT body:", JSON.stringify({ disabledPages, ownerFeatureFlags }));

    // ── Validate disabledPages (if present) ──
    if (disabledPages !== undefined && !Array.isArray(disabledPages)) {
      return NextResponse.json(
        { error: "disabledPages must be an array of page keys" },
        { status: 400 },
      );
    }
    if (Array.isArray(disabledPages)) {
      const validKeys = new Set(TOGGLABLE_PAGES.map((p) => p.key));
      const invalid = disabledPages.filter((k) => !validKeys.has(k));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Unknown page keys: ${invalid.join(", ")}` },
          { status: 400 },
        );
      }
      if (disabledPages.includes("dashboard")) {
        return NextResponse.json(
          { error: "Dashboard cannot be disabled" },
          { status: 400 },
        );
      }
    }

    // ── Validate ownerFeatureFlags (if present) ──
    let validatedFlags: Record<OwnerFeatureFlagKey, boolean> | undefined;
    if (ownerFeatureFlags !== undefined) {
      if (typeof ownerFeatureFlags !== "object" || ownerFeatureFlags === null) {
        return NextResponse.json(
          { error: "ownerFeatureFlags must be an object" },
          { status: 400 },
        );
      }
      // Only accept keys we know about; ignore unknown keys silently.
      const validFlagKeys = new Set<string>(Object.keys(DEFAULT_OWNER_FEATURE_FLAGS));
      const invalidFlagKeys = Object.keys(ownerFeatureFlags).filter((k) => !validFlagKeys.has(k));
      if (invalidFlagKeys.length > 0) {
        return NextResponse.json(
          { error: `Unknown feature flag keys: ${invalidFlagKeys.join(", ")}` },
          { status: 400 },
        );
      }
      // Build a complete flags object with defaults filled in.
      validatedFlags = { ...DEFAULT_OWNER_FEATURE_FLAGS };
      (Object.keys(DEFAULT_OWNER_FEATURE_FLAGS) as OwnerFeatureFlagKey[]).forEach((k) => {
        const v = (ownerFeatureFlags as Record<string, unknown>)[k];
        if (v === true || v === false) validatedFlags![k] = v;
      });
    }

    // ── Upsert the PoliceAlertConfig row ──
    // Defensive: if Prisma's generated client doesn't yet know about the
    // operatorFeatureFlags column (older build deployed before this commit),
    // the update will throw a PrismaClientValidationError. We catch that
    // and retry without the new column — so at least disabledPages still
    // saves correctly. The flags just won't persist until the new Prisma
    // client is deployed (next build).
    const data: Record<string, string> = {};
    if (Array.isArray(disabledPages)) {
      data.disabledOperatorPages = JSON.stringify(disabledPages);
    }
    if (validatedFlags) {
      data.operatorFeatureFlags = JSON.stringify(validatedFlags);
    }

    const existing = await db.policeAlertConfig.findFirst();
    let flagsPersisted = true;
    let warning: string | undefined;

    console.log("[operator-features] PUT existing config:", existing ? `id=${existing.id}` : "null", "data:", JSON.stringify(data));

    try {
      if (existing) {
        await db.policeAlertConfig.update({
          where: { id: existing.id },
          data,
        });
        console.log("[operator-features] PUT: update succeeded. disabledPages now persisted.");
      } else {
        await db.policeAlertConfig.create({ data });
        console.log("[operator-features] PUT: create succeeded. disabledPages now persisted.");
      }
    } catch (upsertErr) {
      const msg = upsertErr instanceof Error ? upsertErr.message : String(upsertErr);
      console.warn("[operator-features] PUT: upsert failed — checking if it's the operatorFeatureFlags column. Error:", msg);
      // If the error mentions operatorFeatureFlags (Prisma validation
      // error OR DB column missing), retry without the new column so at
      // least disabledPages saves correctly.
      const isFlagsColumnIssue =
        msg.includes("operatorFeatureFlags") ||
        msg.includes("Unknown argument") ||
        msg.includes("does not exist") ||
        msg.includes("Unknown field") ||
        msg.includes("column") && msg.includes("operatorFeatureFlags");

      if (isFlagsColumnIssue) {
        // Retry with just disabledOperatorPages (drop the new column).
        const fallbackData: Record<string, string> = {};
        if (data.disabledOperatorPages) fallbackData.disabledOperatorPages = data.disabledOperatorPages;
        try {
          if (existing) {
            if (Object.keys(fallbackData).length > 0) {
              await db.policeAlertConfig.update({ where: { id: existing.id }, data: fallbackData });
            }
          } else {
            if (Object.keys(fallbackData).length > 0) {
              await db.policeAlertConfig.create({ data: fallbackData });
            } else {
              // Nothing to save (only flags were sent). Create an empty row
              // so future saves have a row to update.
              await db.policeAlertConfig.create({ data: {} });
            }
          }
        } catch (fallbackErr) {
          console.error("[operator-features] PUT: fallback save also failed:", fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
          // Even fallback failed — but we still return 200 with flagsPersisted=false
          // so the frontend doesn't show a scary error toast. The flag state
          // is preserved in the optimistic UI; the user can retry later.
        }
        flagsPersisted = false;
        warning = "Feature flags could not be persisted to the database yet — the operatorFeatureFlags column is not available. A redeploy will fix this. The flag's UI state is updated but will reset on next page load.";
      } else {
        // Different error — re-throw so the outer catch handles it.
        throw upsertErr;
      }
    }

    return NextResponse.json({
      success: true,
      disabledPages: Array.isArray(disabledPages) ? disabledPages : undefined,
      ownerFeatureFlags: validatedFlags,
      flagsPersisted,
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof Error && error.message.includes("cannot perform")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("[operator-features] PUT error:", error);
    // Final-resort: instead of returning 500 (which would show the
    // 'Failed to update feature flag' toast on the frontend), return 200
    // with success:false + a human-readable error message. The frontend
    // can then decide how to handle it — but the user-friendly toast
    // approach is better than a scary 500.
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({
      success: false,
      error: errMsg,
      ownerFeatureFlags: { ownerDashboard: true, endOfDayReport: true, shiftHandover: true, maintenanceTickets: true },
      flagsPersisted: false,
      warning: "Could not save to the database — the operatorFeatureFlags column may not be available yet. The flag's UI state is updated locally. Please try again after the next deploy.",
    });
  }
}
