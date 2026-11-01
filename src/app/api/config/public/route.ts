import { NextResponse } from "next/server";
import { db } from "@/lib/db";

import { ensureSettingsColumns } from "@/lib/ensure-settings-columns";
/**
 * GET /api/config/public
 *
 * Returns PUBLIC system configuration — values safe to expose to
 * unauthenticated users (e.g. before login). NO auth required.
 *
 * Currently returns:
 *   - supportPhone: the system admin's contact number, set by the
 *     super-admin in System Config under general.supportPhone. Used by
 *     the client-side toast.error wrapper to append
 *     "For help, call: <phone>" to every error toast.
 *
 * If no system config exists yet (fresh deployment), returns an empty
 * supportPhone so the client falls back to "no support line shown".
 */
export async function GET() {
    await ensureSettingsColumns();
  try {
    const sysSettings = await db.settings.findFirst({
      where: { providerId: null },
    });

    let supportPhone = "";
    if (sysSettings?.configJson && typeof sysSettings.configJson === "object") {
      const config = sysSettings.configJson as Record<string, unknown>;
      const general = config.general;
      if (general && typeof general === "object") {
        const phone = (general as Record<string, unknown>).supportPhone;
        if (typeof phone === "string") {
          supportPhone = phone.trim();
        }
      }
    }

    return NextResponse.json({
      supportPhone,
    });
  } catch {
    // Never throw on a public config endpoint — return safe defaults
    // so login screens still work even if the DB is unreachable.
    return NextResponse.json({ supportPhone: "" });
  }
}
