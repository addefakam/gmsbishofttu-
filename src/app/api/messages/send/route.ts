import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
interface TemplateVars {
  guestName?: string;
  roomNumber?: string;
  roomName?: string;
  nights?: number;
  checkIn?: string;
  checkOut?: string;
  totalCost?: number;
  guestHouseName?: string;
  guestHousePhone?: string;
  checkInTime?: string;
  checkOutTime?: string;
}

function renderTemplate(body: string, vars: TemplateVars): string {
  let rendered = body;
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{{${key}}}`;
    rendered = rendered.replaceAll(placeholder, String(value ?? ""));
  }
  return rendered;
}

export async function POST(req: NextRequest) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    if (!providerId) return NextResponse.json({ error: "Provider required" }, { status: 403 });

    const body = await req.json();
    const { templateId, recipient, channel, message, reservationId, guestId } = body;

    if (!recipient || !message) {
      return NextResponse.json({ error: "Recipient and message are required" }, { status: 400 });
    }

    // Look up template if provided
    let templateBody = message;
    let templateName = "Custom";
    if (templateId) {
      const tmpl = await db.messageTemplate.findFirst({ where: { id: templateId, providerId } });
      if (tmpl) {
        templateName = tmpl.name;
        templateBody = tmpl.body;
      }
    }

    // Get guest/room/settings info for template variables
    const vars: TemplateVars = {};
    if (reservationId) {
      const res = await db.reservation.findFirst({
        where: { id: reservationId, providerId },
        include: { guest: true, provider: true },
      });
      if (res) {
        vars.guestName = res.guest.name;
        vars.roomNumber = res.room.number;
        vars.roomName = res.room.name;
        vars.nights = res.nights;
        vars.checkIn = res.checkIn;
        vars.checkOut = res.checkOut;
        vars.totalCost = res.totalCost;
        vars.guestHouseName = res.provider.name;
        vars.guestHousePhone = res.provider.phone;
      }
    }
    if (guestId && !vars.guestName) {
      const guest = await db.guest.findFirst({ where: { id: guestId, providerId } });
      if (guest) vars.guestName = guest.name;
    }

    // Get settings for check-in/out times
    const settings = await db.settings.findFirst({ where: { providerId } });
    if (settings) {
      vars.checkInTime = settings.checkInTime || "14:00";
      vars.checkOutTime = settings.checkOutTime || "12:00";
      if (!vars.guestHouseName) vars.guestHouseName = settings.guestHouseName || "Guest House";
      if (!vars.guestHousePhone) vars.guestHousePhone = settings.phone || "";
    }

    // If templateId was provided, render the template with variables
    let finalMessage = message;
    if (templateId && templateBody !== message) {
      finalMessage = renderTemplate(templateBody, vars);
    }

    // Create message log entry
    // Note: Actual SMS/WhatsApp sending requires external API integration
    // (e.g., Africa's Talking, Twilio, Meta WhatsApp Business API)
    // For now, we log the message and mark as SENT (simulated)
    const msgLog = await db.messageLog.create({
      data: {
        templateId: templateId || null,
        recipient,
        channel: channel || "SMS",
        message: finalMessage,
        status: "SENT", // Simulated — real implementation would call external API
        reservationId: reservationId || null,
        guestId: guestId || null,
        providerId,
        sentAt: new Date(),
      },
    });

    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req, userId, userName,
      action: "SEND_MESSAGE",
      targetType: "MESSAGE_LOG",
      targetId: msgLog.id,
      details: { template: templateName, recipient, channel: channel || "SMS" },
      providerId,
    });

    return NextResponse.json(msgLog, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[messages/send POST]", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
