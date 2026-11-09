import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureSettingsColumns } from "@/lib/ensure-settings-columns";
import { DEFAULT_EMERGENCY_CONTACTS, extractContacts } from "@/app/api/admin/emergency-contacts/route";

/**
 * GET /api/public/emergency-contacts
 *
 * Public endpoint — NO AUTH REQUIRED.
 *
 * Returns the global emergency contacts list configured by the admin.
 * Used by the EmergencyCallButton component on all pages (/find, /m,
 * /police-app, /owner, web admin).
 *
 * Falls back to DEFAULT_EMERGENCY_CONTACTS (Police 9141, Hospital 5645)
 * if admin hasn't configured any.
 *
 * Response shape:
 *   { contacts: [{ id, type, label, labelAm, phone, icon, color, sortOrder }] }
 */
export async function GET(req: NextRequest) {
  try {
    await ensureSettingsColumns();

    const sysSettings = await db.settings.findFirst({
      where: { providerId: null },
      select: { configJson: true },
    });

    const contacts = extractContacts(sysSettings?.configJson);

    return NextResponse.json({
      contacts,
      // Include a timestamp so the client can cache + revalidate
      updatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[public/emergency-contacts] Error:", error);
    // Fall back to defaults on any error — emergency contacts must always
    // be available, even if the DB is down.
    return NextResponse.json({
      contacts: DEFAULT_EMERGENCY_CONTACTS,
      updatedAt: new Date().toISOString(),
      fallback: true,
    });
  }
}
