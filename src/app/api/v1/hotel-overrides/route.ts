import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateApiKey, logApiRequest } from "@/lib/api-key-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/hotel-overrides
 *
 * Returns TMS-local hotel overrides (website URLs, images, etc.)
 * stored in Settings.configJson.hotelOverrides.
 *
 * These are set by the TMS tourism office admin — NOT by the GMS.
 * The GMS just stores them as a key-value store in its Settings table.
 *
 * Response: { success: true, data: { "hotel_id_1": { website: "..." }, ... } }
 */
export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid API key" } }, { status: 401 });
  }

  try {
    const settings = await db.settings.findFirst({
      where: { providerId: null },
      select: { configJson: true },
    });

    const config = settings?.configJson as Record<string, any> | null;
    const overrides = config?.hotelOverrides || {};

    return NextResponse.json({ success: true, data: overrides });
  } catch (err) {
    return NextResponse.json({ success: true, data: {} });
  }
}

/**
 * PUT /api/v1/hotel-overrides
 *
 * Saves TMS-local hotel overrides to Settings.configJson.hotelOverrides.
 * Called by the TMS tourism office admin when they set website URLs.
 *
 * Body: { "hotel_id_1": { website: "https://..." }, "hotel_id_2": { ... } }
 */
export async function PUT(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) {
    return NextResponse.json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid API key" } }, { status: 401 });
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
    }

    // Find or create system settings
    let settings = await db.settings.findFirst({
      where: { providerId: null },
      select: { id: true, configJson: true },
    });

    const existingConfig = (settings?.configJson as Record<string, any>) || {};
    existingConfig.hotelOverrides = body;

    if (settings) {
      await db.settings.update({
        where: { id: settings.id },
        data: { configJson: existingConfig as any },
      });
    } else {
      await db.settings.create({
        data: {
          id: `sys-config-${Date.now()}`,
          providerId: null,
          configJson: { hotelOverrides: body } as any,
        },
      });
    }

    return NextResponse.json({ success: true, data: body });
  } catch (err) {
    return NextResponse.json({ success: false, error: "Failed to save" }, { status: 500 });
  }
}
