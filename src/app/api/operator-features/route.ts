import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { checkWritePermission } from "@/lib/tenant";

export const dynamic = "force-dynamic";

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
] as const;

export type OwnerFeatureFlagKey = (typeof OWNER_FEATURE_FLAGS)[number]["key"];

// Default: all features enabled. Used when no row exists yet or when the
// stored JSON is missing a key (forward-compatible — new flags default ON).
export const DEFAULT_OWNER_FEATURE_FLAGS: Record<OwnerFeatureFlagKey, boolean> = {
  ownerDashboard: true,
  endOfDayReport: true,
  shiftHandover: true,
  maintenanceTickets: true,
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
      // Treat only explicit `false` as disabled — anything else (true,
      // undefined, null, wrong type) keeps the default `true`. This means
      // disabling a feature requires the admin to set it explicitly to false.
      if (v === false) result[k] = false;
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
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER" && auth.role !== "OPERATOR" && auth.role !== "STAFF") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const config = await db.policeAlertConfig.findFirst();
    let disabledPages: string[] = [];
    try {
      disabledPages = config?.disabledOperatorPages
        ? JSON.parse(config.disabledOperatorPages)
        : [];
    } catch {
      disabledPages = [];
    }

    // Filter out any page keys that are no longer in TOGGLABLE_PAGES
    // (e.g. 'users' was removed from the togglable list but might still
    // be in the stored config from a previous version). This ensures
    // the owner always sees Account Management even if it was disabled
    // before the key was removed.
    const validKeys = new Set(TOGGLABLE_PAGES.map((p) => p.key));
    disabledPages = disabledPages.filter((k) => validKeys.has(k));

    // Parse the owner feature flags — visible to all roles so the
    // operator/staff frontend can hide/show features accordingly.
    const ownerFeatureFlags = parseOwnerFeatureFlags(config?.operatorFeatureFlags);

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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { allowSuperuser: true });

    const body = await req.json();
    const { disabledPages, ownerFeatureFlags } = body as {
      disabledPages?: string[];
      ownerFeatureFlags?: Record<string, boolean>;
    };

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
    const data: Record<string, string> = {};
    if (Array.isArray(disabledPages)) {
      data.disabledOperatorPages = JSON.stringify(disabledPages);
    }
    if (validatedFlags) {
      data.operatorFeatureFlags = JSON.stringify(validatedFlags);
    }

    const existing = await db.policeAlertConfig.findFirst();
    if (existing) {
      await db.policeAlertConfig.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await db.policeAlertConfig.create({ data });
    }

    return NextResponse.json({
      success: true,
      disabledPages: Array.isArray(disabledPages) ? disabledPages : undefined,
      ownerFeatureFlags: validatedFlags,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof Error && error.message.includes("cannot perform")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("[operator-features] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
