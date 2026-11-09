import { checkPolicePermission } from "@/lib/police-module-permissions";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, requirePolice, AuthError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { ensureSuspectTables } from "@/lib/suspect-check";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
export async function GET(req: NextRequest) {
    try {
    await ensureReservationIntegrity();
    } catch (migErr) {
      console.warn("[suspect-matches] ensureReservationIntegrity failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
    }
  try {
    const auth = await getAuthContext(req);
    // Allow POLICE, SUPERUSER, and OPERATOR to view suspect matches.
    // POLICE sees ALL matches. OPERATOR/SUPERUSER see only matches
    // for their own provider (guest house).
    await ensureSuspectTables();

    const { searchParams } = req.nextUrl;
    const unreadOnly = searchParams.get("unread") === "true";

    const where: Record<string, unknown> = {};
    if (unreadOnly) {
      where.isRead = false;
    }
    // If the user is an OPERATOR (not POLICE/SUPERUSER), only show
    // matches for their own provider.
    if (auth.role === "OPERATOR" || auth.role === "STAFF") {
      if (auth.providerId) {
        where.providerId = auth.providerId;
      }
    }

    const matches = await db.suspectMatch.findMany({
      where,
      select: {
        id: true, matchType: true, guestName: true, guestPhone: true, guestIdNumber: true,
        providerName: true, providerId: true, reservationId: true, daytimeBookingId: true,
        details: true,
        isRead: true, createdAt: true,
        suspectedPerson: {
          select: { id: true, name: true, phone: true, idNumber: true, severity: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Fetch the current status of each match's reservation so the
    // Suspect Alerts page can show whether the guest is Upcoming,
    // Checked-in, Completed, or Cancelled — in real time.
    const reservationIds = matches
      .map((m) => m.reservationId)
      .filter((id): id is string => !!id);

    const reservations: Record<string, { status: string; checkIn: string; checkOut: string; roomNumber: string }> = {};
    if (reservationIds.length > 0) {
      const resRecords = await db.reservation.findMany({
        where: { id: { in: reservationIds } },
        select: {
          id: true,
          status: true,
          checkIn: true,
          checkOut: true,
          room: { select: { number: true } },
        },
      });
      for (const r of resRecords) {
        reservations[r.id] = {
          status: r.status,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          roomNumber: r.room?.number || "",
        };
      }
    }

    // Attach the current reservation status to each match
    const matchesWithStatus = matches.map((m) => {
      const resInfo = m.reservationId ? reservations[m.reservationId] : null;
      return {
        ...m,
        reservationStatus: resInfo?.status || null,
        reservationCheckIn: resInfo?.checkIn || null,
        reservationCheckOut: resInfo?.checkOut || null,
        reservationRoomNumber: resInfo?.roomNumber || null,
      };
    });

    // Count unread
    const unreadCount = await db.suspectMatch.count({
      where: { isRead: false },
    });

    logAudit(req, { action: "VIEW_MATCHES", details: `Fetched ${matchesWithStatus.length} matches` });
    return NextResponse.json({ matches: matchesWithStatus, unreadCount });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch suspect matches";
    const status = message.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(req: NextRequest) {
    try {
    await ensureReservationIntegrity();
    } catch (migErr) {
      console.warn("[suspect-matches] ensureReservationIntegrity failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
    }
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);
    const permError = checkPolicePermission(auth, "police_suspects");
    if (permError) return NextResponse.json({ error: permError }, { status: 403 });
    await ensureSuspectTables();

    const body = await req.json();
    const { ids, markAllRead } = body;

    if (markAllRead) {
      await db.suspectMatch.updateMany({
        where: { isRead: false },
        data: { isRead: true },
      });
      logAudit(req, { action: "MARK_ALL_READ", details: "All suspect matches marked as read" });
      return NextResponse.json({ success: true, message: "All matches marked as read" });
    }

    if (ids && Array.isArray(ids) && ids.length > 0) {
      await db.suspectMatch.updateMany({
        where: { id: { in: ids } },
        data: { isRead: true },
      });
      logAudit(req, { action: "MARK_READ", details: `Marked ${ids.length} matches as read` });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Provide ids array or markAllRead" }, { status: 400 });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to update suspect matches";
    const status = message.includes("Police") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}