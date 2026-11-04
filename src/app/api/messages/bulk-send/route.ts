import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
/**
 * Bulk send messages to guests matching a reservation status filter.
 * Uses a template and renders it per guest.
 */
export async function POST(req: NextRequest) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    if (!providerId) return NextResponse.json({ error: "Provider required" }, { status: 403 });

    const body = await req.json();
    const { templateId, status, channel } = body;

    if (!templateId || !status) {
      return NextResponse.json({ error: "Template ID and status filter are required" }, { status: 400 });
    }

    // Get template
    const tmpl = await db.messageTemplate.findFirst({ where: { id: templateId, providerId, isActive: true } });
    if (!tmpl) return NextResponse.json({ error: "Template not found or inactive" }, { status: 404 });

    // Get settings
    const settings = await db.settings.findFirst({ where: { providerId } });
    const ghName = settings?.guestHouseName || "Guest House";
    const ghPhone = settings?.phone || "";
    const ciTime = settings?.checkInTime || "14:00";
    const coTime = settings?.checkOutTime || "12:00";

    // Get reservations matching status
    const reservations = await db.reservation.findMany({
      where: { providerId, status, guest: { phone: { not: "" } } },
      include: { guest: true },
      take: 100,
    });

    if (reservations.length === 0) {
      return NextResponse.json({ sent: 0, message: "No guests found with phone numbers for status: " + status });
    }

    let sent = 0;
    let failed = 0;

    for (const r of reservations) {
      if (!r.guest.phone) continue;

      const msg = tmpl.body
        .replaceAll("{{guestName}}", r.guest.name)
        .replaceAll("{{roomNumber}}", r.room.number)
        .replaceAll("{{roomName}}", r.room.name)
        .replaceAll("{{nights}}", String(r.nights))
        .replaceAll("{{checkIn}}", r.checkIn)
        .replaceAll("{{checkOut}}", r.checkOut)
        .replaceAll("{{totalCost}}", String(r.totalCost))
        .replaceAll("{{guestHouseName}}", ghName)
        .replaceAll("{{guestHousePhone}}", ghPhone)
        .replaceAll("{{checkInTime}}", ciTime)
        .replaceAll("{{checkOutTime}}", coTime);

      try {
        await db.messageLog.create({
          data: {
            templateId: tmpl.id,
            recipient: r.guest.phone,
            channel: channel || tmpl.channel,
            message: msg,
            status: "SENT",
            reservationId: r.id,
            guestId: r.guest.id,
            providerId,
            sentAt: new Date(),
          },
        });
        sent++;
      } catch {
        failed++;
      }
    }

    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req, userId, userName,
      action: "BULK_SEND_MESSAGES",
      targetType: "MESSAGE_TEMPLATE",
      targetId: templateId,
      details: { template: tmpl.name, status, sent, failed },
      providerId,
    });

    return NextResponse.json({ sent, failed, total: reservations.length });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[messages/bulk-send POST]", error);
    return NextResponse.json({ error: "Failed to send bulk messages" }, { status: 500 });
  }
}
