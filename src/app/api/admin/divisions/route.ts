import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { ensureSettingsColumns } from "@/lib/ensure-settings-columns";

/**
 * Default Bishoftu sub-cities + woredas — used when admin hasn't configured any.
 * Source: src/lib/bishoftu-divisions.ts (the hardcoded defaults).
 */
export const DEFAULT_DIVISIONS = [
  {
    name: "Debaayyuu",
    woredas: ["Dhakaa Boora", "Dirree", "Horaa", "Biiftuu"],
  },
  {
    name: "Chalaleka",
    woredas: ["Erere", "Arsedee", "Kilolee"],
  },
  {
    name: "Dukem",
    woredas: ["Odaa Nabee", "Xaddachaa", "Malkaa", "Abbuu Seeraa"],
  },
];

export interface SubCityDivision {
  name: string;
  woredas: string[];
}

/**
 * GET /api/admin/divisions
 *
 * Returns the global Bishoftu sub-cities + woredas list.
 * Requires SUPERUSER auth.
 *
 * Returns:
 *   { divisions: SubCityDivision[] }
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

    const divisions = extractDivisions(sysSettings?.configJson);
    return NextResponse.json({ divisions });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[admin/divisions GET] Error:", error);
    return NextResponse.json({ divisions: DEFAULT_DIVISIONS });
  }
}

/**
 * PUT /api/admin/divisions
 *
 * Body: { divisions: SubCityDivision[] }
 *
 * Saves the global Bishoftu sub-cities + woredas list.
 * Requires SUPERUSER auth.
 */
export async function PUT(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER") {
      return NextResponse.json({ error: "Superuser access required." }, { status: 403 });
    }

    await ensureSettingsColumns();

    const body = await req.json();
    const incomingDivisions = body?.divisions;

    if (!Array.isArray(incomingDivisions)) {
      return NextResponse.json({ error: "divisions must be an array" }, { status: 400 });
    }

    // Sanitize + validate
    const sanitized: SubCityDivision[] = [];
    for (const d of incomingDivisions) {
      if (!d || typeof d !== "object") continue;
      const name = String(d.name || "").trim();
      if (!name) continue;
      const woredas = Array.isArray(d.woredas)
        ? d.woredas.map((w: unknown) => String(w || "").trim()).filter(Boolean)
        : [];
      sanitized.push({ name, woredas });
    }

    // Find the system settings record (providerId = null)
    let sysSettings = await db.settings.findFirst({
      where: { providerId: null },
      select: { id: true, configJson: true },
    });

    if (!sysSettings) {
      sysSettings = await db.settings.create({
        data: {
          id: `sys-config-${Date.now()}`,
          providerId: null,
          configJson: { divisions: sanitized } as any,
        },
        select: { id: true, configJson: true },
      });
    } else {
      const existingConfig =
        sysSettings.configJson && typeof sysSettings.configJson === "object"
          ? { ...(sysSettings.configJson as Record<string, unknown>) }
          : {};
      existingConfig.divisions = sanitized;

      await db.settings.update({
        where: { id: sysSettings.id },
        data: { configJson: existingConfig as any },
      });
    }

    return NextResponse.json({ success: true, divisions: sanitized });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[admin/divisions PUT] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to save divisions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Extracts the divisions array from a configJson object.
 * Falls back to DEFAULT_DIVISIONS if not configured.
 */
export function extractDivisions(configJson: unknown): SubCityDivision[] {
  if (!configJson || typeof configJson !== "object") {
    return DEFAULT_DIVISIONS;
  }
  const config = configJson as Record<string, unknown>;
  const divisions = config.divisions;
  if (!Array.isArray(divisions) || divisions.length === 0) {
    return DEFAULT_DIVISIONS;
  }
  return divisions as SubCityDivision[];
}
