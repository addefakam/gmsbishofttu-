import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateApiKey } from "@/lib/api-key-auth";

export const dynamic = "force-dynamic";

const DEFAULT_CAROUSEL = {
  images: [
    "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1920&q=80",
    "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1920&q=80",
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1920&q=80",
  ],
  interval: 5,
};

export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const settings = await db.settings.findFirst({ where: { providerId: null }, select: { configJson: true } });
    const config = settings?.configJson as Record<string, any> | null;
    const carousel = config?.carouselSettings || DEFAULT_CAROUSEL;
    return NextResponse.json({ success: true, data: carousel });
  } catch { return NextResponse.json({ success: true, data: DEFAULT_CAROUSEL }); }
}

export async function PUT(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    let settings = await db.settings.findFirst({ where: { providerId: null }, select: { id: true, configJson: true } });
    const existingConfig = (settings?.configJson as Record<string, any>) || {};
    existingConfig.carouselSettings = body;
    if (settings) { await db.settings.update({ where: { id: settings.id }, data: { configJson: existingConfig as any } }); }
    else { await db.settings.create({ data: { id: `sys-config-${Date.now()}`, providerId: null, configJson: { carouselSettings: body } as any } }); }
    return NextResponse.json({ success: true, data: body });
  } catch { return NextResponse.json({ success: false, error: "Failed" }, { status: 500 }); }
}
