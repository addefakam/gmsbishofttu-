import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureSettingsColumns } from "@/lib/ensure-settings-columns";
import { DEFAULT_DIVISIONS, extractDivisions } from "@/app/api/admin/divisions/route";

/**
 * GET /api/public/divisions
 *
 * Public endpoint — NO AUTH REQUIRED.
 *
 * Returns the global Bishoftu sub-cities + woredas list configured by admin.
 * Used by:
 *   - Provider registration form (sub-city + woreda dropdowns)
 *   - Police account creation (jurisdiction selection)
 *   - /find app (sub-city filter)
 *   - Mobile app login (jurisdiction selection)
 *
 * Falls back to DEFAULT_DIVISIONS (hardcoded Bishoftu divisions) if admin
 * hasn't configured any.
 *
 * Response shape:
 *   { divisions: [{ name: "Debaayyuu", woredas: ["Dhakaa Boora", ...] }] }
 */
export async function GET(req: NextRequest) {
  try {
    await ensureSettingsColumns();

    const sysSettings = await db.settings.findFirst({
      where: { providerId: null },
      select: { configJson: true },
    });

    const divisions = extractDivisions(sysSettings?.configJson);

    return NextResponse.json({
      divisions,
      updatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[public/divisions] Error:", error);
    return NextResponse.json({
      divisions: DEFAULT_DIVISIONS,
      updatedAt: new Date().toISOString(),
      fallback: true,
    });
  }
}
