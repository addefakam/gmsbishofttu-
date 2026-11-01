import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { uploadFile } from "@/lib/storage";
import { isValidPhone, isValidEmail } from "@/lib/utils";
import { logStaffActivity } from "@/lib/staff-log";

const DEFAULT_SETTINGS = {
  guestHouseName: "Guest House",
  ownerName: "",
  address: "",
  phone: "",
  email: "",
  currency: "ETB",
  taxRate: 0,
  language: "en",
  logo: null,
  checkInTime: "14:00",
  checkOutTime: "12:00",
};

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);

    // SUPERUSER → manage system-wide config JSON.
    // (Was: `auth.role === "SUPERUSER" && !auth.providerId` — too strict.
    //  If a SUPERUSER happened to have a providerId set (legacy account,
    //  or selected during creation), the PUT silently fell through to the
    //  per-provider branch, which extracts body.guestHouseName/ownerName
    //  etc. — none of which exist on the system config payload — so it
    //  saved DEFAULTS and never persisted configJson. Returned 200 OK,
    //  so the frontend showed "saved" but nothing was actually stored.
    //  The /api/providers FormData registration path then couldn't find
    //  the auto-approve flag, and new registrations stayed PENDING.)
    if (auth.role === "SUPERUSER") {
      const sysSettings = await db.settings.findFirst({
        where: { providerId: null },
      });

      if (sysSettings?.configJson && typeof sysSettings.configJson === "object") {
        return NextResponse.json(sysSettings.configJson as Record<string, unknown>);
      }

      // No system config stored yet — return empty object so frontend uses defaults
      return NextResponse.json({});
    }

    const { providerId } = getProviderFilter(auth);

    const settings = await db.settings.findFirst({
      where: providerId ? { providerId } : {},
    });

    if (!settings) {
      return NextResponse.json({ ...DEFAULT_SETTINGS, providerId, id: null });
    }

    return NextResponse.json(settings);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { allowSuperuser: true });

    const body = await req.json();

    // SUPERUSER → store as system config JSON (see GET handler for rationale).
    // Was: `auth.role === "SUPERUSER" && !auth.providerId` — see GET for why
    // the !auth.providerId check broke auto-approve in production.
    if (auth.role === "SUPERUSER") {
      const existing = await db.settings.findFirst({
        where: { providerId: null },
      });

      if (existing) {
        await db.settings.update({
          where: { id: existing.id },
          data: { configJson: body },
        });
      } else {
        await db.settings.create({
          data: { configJson: body },
        });
      }

      return NextResponse.json({ success: true });
    }

    const { providerId } = getProviderFilter(auth);

    const existing = await db.settings.findFirst({
      where: providerId ? { providerId } : {},
    });

    // Validate phone format if provided
    if (body.phone && !isValidPhone(body.phone)) {
      return NextResponse.json({ error: "Invalid phone number format" }, { status: 400 });
    }
    // Validate email format if provided
    if (body.email && !isValidEmail(body.email)) {
      return NextResponse.json({ error: "Invalid email address format" }, { status: 400 });
    }

    const data = {
      guestHouseName: body.guestHouseName ?? DEFAULT_SETTINGS.guestHouseName,
      ownerName: body.ownerName ?? DEFAULT_SETTINGS.ownerName,
      address: body.address ?? DEFAULT_SETTINGS.address,
      phone: body.phone ?? DEFAULT_SETTINGS.phone,
      email: body.email ?? DEFAULT_SETTINGS.email,
      currency: body.currency ?? DEFAULT_SETTINGS.currency,
      taxRate: body.taxRate ?? DEFAULT_SETTINGS.taxRate,
      language: body.language ?? DEFAULT_SETTINGS.language,
      logo: body.logo?.startsWith("data:") ? await uploadFile(body.logo, "logos") : (body.logo ?? DEFAULT_SETTINGS.logo),
      checkInTime: body.checkInTime ?? DEFAULT_SETTINGS.checkInTime,
      checkOutTime: body.checkOutTime ?? DEFAULT_SETTINGS.checkOutTime,
      ...(providerId ? { providerId } : {}),
    };

    let settings;
    if (existing) {
      settings = await db.settings.update({
        where: { id: existing.id },
        data,
      });
    } else {
      settings = await db.settings.create({ data });
    }

    // Staff activity log — operational settings change (currency, tax, language, etc.)
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "SETTINGS_UPDATE",
      targetType: "PROVIDER",
      targetId: providerId || "",
      details: { guestHouseName: settings.guestHouseName || "" },
      providerId: providerId || "",
    });

    return NextResponse.json(settings);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to save settings";
    const status =
      message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
