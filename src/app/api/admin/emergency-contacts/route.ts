import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { ensureSettingsColumns } from "@/lib/ensure-settings-columns";

/**
 * Default emergency contacts — used when admin hasn't configured any.
 * These are the Bishoftu city emergency numbers.
 */
export const DEFAULT_EMERGENCY_CONTACTS = [
  {
    id: "police",
    type: "police",
    label: "Bishoftu Police",
    labelAm: "የቢሾፍቱ ፖሊስ",
    phone: "9141",
    icon: "shield",
    color: "red",
    sortOrder: 1,
  },
  {
    id: "hospital",
    type: "hospital",
    label: "Bishoftu Hospital",
    labelAm: "የቢሾፍቱ ሆስፒታል",
    phone: "5645",
    icon: "heart-pulse",
    color: "orange",
    sortOrder: 2,
  },
];

export interface EmergencyContact {
  id: string;
  type: "police" | "hospital" | "custom";
  label: string;
  labelAm?: string;
  phone: string;
  icon: string;     // lucide icon name: shield, heart-pulse, flame, ambulance, phone
  color: string;    // tailwind color name: red, orange, amber, rose, emerald, sky
  sortOrder: number;
}

/**
 * GET /api/admin/emergency-contacts
 *
 * Returns the global emergency contacts list.
 * Requires SUPERUSER auth.
 *
 * Returns:
 *   { contacts: EmergencyContact[] }
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json({ error: "Superuser access required." }, { status: 403 });
    }

    await ensureSettingsColumns();

    const sysSettings = await db.settings.findFirst({
      where: { providerId: null },
      select: { id: true, configJson: true },
    });

    const contacts = extractContacts(sysSettings?.configJson);
    return NextResponse.json({ contacts });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[admin/emergency-contacts GET] Error:", error);
    return NextResponse.json({ contacts: DEFAULT_EMERGENCY_CONTACTS });
  }
}

/**
 * PUT /api/admin/emergency-contacts
 *
 * Body: { contacts: EmergencyContact[] }
 *
 * Saves the global emergency contacts list.
 * Requires SUPERUSER auth.
 *
 * Returns:
 *   { success: true, contacts: EmergencyContact[] }
 */
export async function PUT(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json({ error: "Superuser access required." }, { status: 403 });
    }

    await ensureSettingsColumns();

    const body = await req.json();
    const incomingContacts = body?.contacts;

    if (!Array.isArray(incomingContacts)) {
      return NextResponse.json({ error: "contacts must be an array" }, { status: 400 });
    }

    // Validate + sanitize each contact
    const sanitized: EmergencyContact[] = [];
    for (let i = 0; i < incomingContacts.length; i++) {
      const c = incomingContacts[i];
      if (!c || typeof c !== "object") continue;

      const phone = String(c.phone || "").trim();
      const label = String(c.label || "").trim();

      if (!phone || !label) continue; // skip invalid

      sanitized.push({
        id: String(c.id || `contact-${i + 1}-${Date.now()}`),
        type: (c.type === "police" || c.type === "hospital" ? c.type : "custom") as
          | "police" | "hospital" | "custom",
        label,
        labelAm: c.labelAm ? String(c.labelAm).trim() : undefined,
        phone,
        icon: String(c.icon || "phone"),
        color: String(c.color || "sky"),
        sortOrder: typeof c.sortOrder === "number" ? c.sortOrder : i + 1,
      });
    }

    // Sort by sortOrder
    sanitized.sort((a, b) => a.sortOrder - b.sortOrder);

    // Find the system settings record (providerId = null)
    let sysSettings = await db.settings.findFirst({
      where: { providerId: null },
      select: { id: true, configJson: true },
    });

    // If no system settings record exists, create one
    if (!sysSettings) {
      sysSettings = await db.settings.create({
        data: {
          id: `sys-config-${Date.now()}`,
          providerId: null,
          configJson: { emergencyContacts: sanitized } as any,
        },
        select: { id: true, configJson: true },
      });
    } else {
      // Merge emergencyContacts into existing configJson
      const existingConfig =
        sysSettings.configJson && typeof sysSettings.configJson === "object"
          ? { ...(sysSettings.configJson as Record<string, unknown>) }
          : {};

      existingConfig.emergencyContacts = sanitized;

      await db.settings.update({
        where: { id: sysSettings.id },
        data: { configJson: existingConfig as any },
      });
    }

    return NextResponse.json({ success: true, contacts: sanitized });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[admin/emergency-contacts PUT] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to save emergency contacts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Extracts the emergency contacts array from a configJson object.
 * Falls back to DEFAULT_EMERGENCY_CONTACTS if not configured.
 */
export function extractContacts(configJson: unknown): EmergencyContact[] {
  if (!configJson || typeof configJson !== "object") {
    return DEFAULT_EMERGENCY_CONTACTS;
  }
  const config = configJson as Record<string, unknown>;
  const contacts = config.emergencyContacts;
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return DEFAULT_EMERGENCY_CONTACTS;
  }
  return contacts as EmergencyContact[];
}
