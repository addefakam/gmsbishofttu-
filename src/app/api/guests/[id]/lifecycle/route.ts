import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
/**
 * GET /api/guests/[id]/lifecycle
 *
 * Returns the full status-change history for a guest — every check-in,
 * check-out, cancellation, extension, room shift, and payment event
 * related to this guest across ALL their reservations.
 *
 * Used by the guest search table on both the operator side and police
 * side to surface "what happened to this guest" beyond the current
 * reservation's status — e.g. an early exit, a cancelled booking, a
 * stay that was extended, or a room shift mid-stay.
 *
 * Data sources:
 *   1. Reservation records for this guest (status, dates, actual
 *      check-in/out, original vs. current room)
 *   2. StaffLog entries (CHECKIN, CHECKOUT, CANCEL_RESERVATION,
 *      UPDATE_RESERVATION, etc.) — these capture WHO did WHAT and WHEN
 *
 * The endpoint merges these two sources into a single timeline ordered
 * by date descending (most recent first).
 *
 * Auth:
 *   - Operator/staff: only sees data for their own provider's guests
 *   - Police: sees all data city-wide (providerId filter is omitted)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    const { isPolice, providerId } = getProviderFilter(auth);
    const { id } = await params;

    // ── 1. Verify the guest exists + belongs to the caller's provider ──
    const guest = await db.guest.findFirst({
      where: isPolice ? { id } : { id, providerId },
      select: {
        id: true,
        name: true,
        phone: true,
        idNumber: true,
        providerId: true,
      },
    });
    if (!guest) {
      return NextResponse.json({ error: "Guest not found" }, { status: 404 });
    }

    // ── 2. Pull all reservations for this guest ──
    // For police, return all reservations regardless of provider.
    // For operator/staff, only return reservations for their own provider
    // (the guest query above already enforced that the guest belongs to
    // their provider — but a guest could in principle have reservations
    // at multiple providers; the operator only sees their own).
    const reservations = await db.reservation.findMany({
      where: isPolice ? { guestId: id } : { guestId: id, providerId },
      select: {
        id: true,
        status: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        totalCost: true,
        roomRate: true,
        actualCheckIn: true,
        actualCheckOut: true,
        createdAt: true,
        updatedAt: true,
        roomId: true,
        room: { select: { id: true, number: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // ── 3. Pull all StaffLog entries for this guest's reservations ──
    // The StaffLog's `targetId` is the reservation ID, so we filter by
    // the list of reservation IDs we just fetched. This captures every
    // CHECKIN, CHECKOUT, CANCEL_RESERVATION, UPDATE_RESERVATION, and
    // CREATE_PAYMENT event that affected this guest.
    const reservationIds = reservations.map((r) => r.id);
    const staffLogs = reservationIds.length > 0
      ? await db.staffLog.findMany({
          where: {
            targetType: "RESERVATION",
            targetId: { in: reservationIds },
            // Only relevant actions — filter out irrelevant entries
            action: {
              in: [
                "CHECKIN",
                "CHECKOUT",
                "CANCEL_RESERVATION",
                "UPDATE_RESERVATION",
                "CREATE_RESERVATION",
                "CREATE_PAYMENT",
                "EARLY_CHECKOUT",
                "EXTEND_STAY",
                "SHIFT_ROOM",
              ],
            },
          },
          select: {
            id: true,
            action: true,
            targetId: true,
            details: true,
            userName: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

    // ── 4. Merge into a unified timeline ──
    // Each event is normalized to: { type, timestamp, label, details }
    type Event = {
      type: "RESERVATION_CREATED" | "CHECKED_IN" | "CHECKED_OUT" | "EARLY_CHECKOUT" | "CANCELLED" | "EXTENDED" | "ROOM_SHIFTED" | "PAYMENT" | "RESERVATION_UPDATED";
      timestamp: string;
      label: string;
      details: Record<string, unknown>;
      source: "STAFF_LOG" | "RESERVATION";
      reservationId: string;
      roomNumber?: string;
      actorName?: string;
    };

    const events: Event[] = [];

    // ── 4a. Derive events from reservation state ──
    // These are derived from comparing actualCheckIn/Out vs. scheduled
    // checkIn/checkOut — captures early checkouts and extensions even
    // when StaffLog was missed.
    for (const r of reservations) {
      const roomNumber = r.room?.number;

      // Reservation created
      events.push({
        type: "RESERVATION_CREATED",
        timestamp: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        label: `Reserved Room ${roomNumber || "?"}: ${r.checkIn} → ${r.checkOut}`,
        details: { checkIn: r.checkIn, checkOut: r.checkOut, nights: r.nights, totalCost: r.totalCost },
        source: "RESERVATION",
        reservationId: r.id,
        roomNumber,
      });

      // Checked in
      if (r.actualCheckIn) {
        const actualIn = r.actualCheckIn instanceof Date ? r.actualCheckIn.toISOString() : String(r.actualCheckIn);
        events.push({
          type: "CHECKED_IN",
          timestamp: actualIn,
          label: `Checked in to Room ${roomNumber || "?"}`,
          details: { scheduledCheckIn: r.checkIn, actualCheckIn: actualIn },
          source: "RESERVATION",
          reservationId: r.id,
          roomNumber,
        });
      }

      // Checked out — determine if early or normal
      if (r.actualCheckOut) {
        const actualOut = r.actualCheckOut instanceof Date ? r.actualCheckOut.toISOString() : String(r.actualCheckOut);
        // Compare date-only strings: scheduled checkout is YYYY-MM-DD,
        // actualCheckOut is an ISO timestamp — slice to YYYY-MM-DD for compare.
        const actualOutDay = actualOut.slice(0, 10);
        const isEarly = actualOutDay < r.checkOut;
        events.push({
          type: isEarly ? "EARLY_CHECKOUT" : "CHECKED_OUT",
          timestamp: actualOut,
          label: isEarly
            ? `Early checkout from Room ${roomNumber || "?"} (scheduled ${r.checkOut})`
            : `Checked out of Room ${roomNumber || "?"}`,
          details: {
            scheduledCheckOut: r.checkOut,
            actualCheckOut: actualOut,
            isEarly,
            totalCost: r.totalCost,
          },
          source: "RESERVATION",
          reservationId: r.id,
          roomNumber,
        });
      }

      // Cancelled (no actual check-in, status is CANCELLED)
      if (r.status === "CANCELLED" && !r.actualCheckIn) {
        events.push({
          type: "CANCELLED",
          timestamp: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
          label: `Reservation for Room ${roomNumber || "?"} cancelled`,
          details: { status: r.status, scheduledCheckIn: r.checkIn, scheduledCheckOut: r.checkOut },
          source: "RESERVATION",
          reservationId: r.id,
          roomNumber,
        });
      }
    }

    // ── 4b. Add StaffLog events (for actor name + extra detail) ──
    // The action constants map to our normalized event types.
    const ACTION_TO_TYPE: Record<string, Event["type"]> = {
      CHECKIN: "CHECKED_IN",
      CHECKOUT: "CHECKED_OUT",
      CANCEL_RESERVATION: "CANCELLED",
      UPDATE_RESERVATION: "RESERVATION_UPDATED",
      CREATE_RESERVATION: "RESERVATION_CREATED",
      CREATE_PAYMENT: "PAYMENT",
      EARLY_CHECKOUT: "EARLY_CHECKOUT",
      EXTEND_STAY: "EXTENDED",
      SHIFT_ROOM: "ROOM_SHIFTED",
    };

    for (const log of staffLogs) {
      const type = ACTION_TO_TYPE[log.action];
      if (!type) continue;
      let details: Record<string, unknown> = {};
      try {
        details = log.details ? JSON.parse(log.details) : {};
      } catch {
        details = { rawDetails: log.details };
      }
      events.push({
        type,
        timestamp: log.createdAt instanceof Date ? log.createdAt.toISOString() : String(log.createdAt),
        label: actionToLabel(log.action, details),
        details,
        source: "STAFF_LOG",
        reservationId: log.targetId,
        actorName: log.userName || undefined,
        roomNumber: typeof details.roomNumber === "string" ? details.roomNumber : undefined,
      });
    }

    // ── 5. Deduplicate + sort by timestamp descending ──
    // The same event may appear both as a RESERVATION-derived event and
    // a STAFF_LOG entry — dedupe by (type + reservationId + day-level
    // timestamp). Prefer STAFF_LOG when both exist (it has actor info).
    const seen = new Set<string>();
    const deduped = events
      .filter((e) => {
        const dayKey = e.timestamp.slice(0, 10);
        const key = `${e.type}|${e.reservationId}|${dayKey}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    // ── 6. Compute summary badges ──
    // These power the inline badges on the guest search table — quick
    // flags for "this guest had an early exit", "extended their stay",
    // "shifted rooms", "had a cancellation", etc.
    const summary = {
      totalReservations: reservations.length,
      totalCheckIns: deduped.filter((e) => e.type === "CHECKED_IN").length,
      totalCheckOuts: deduped.filter((e) => e.type === "CHECKED_OUT" || e.type === "EARLY_CHECKOUT").length,
      hasEarlyCheckout: deduped.some((e) => e.type === "EARLY_CHECKOUT"),
      hasExtension: deduped.some((e) => e.type === "EXTENDED"),
      hasRoomShift: deduped.some((e) => e.type === "ROOM_SHIFTED"),
      hasCancellation: deduped.some((e) => e.type === "CANCELLED"),
      hasUpdate: deduped.some((e) => e.type === "RESERVATION_UPDATED"),
      lastEventAt: deduped[0]?.timestamp || null,
      lastEventType: deduped[0]?.type || null,
    };

    return NextResponse.json({
      guest: {
        id: guest.id,
        name: guest.name,
        phone: guest.phone,
        idNumber: guest.idNumber,
      },
      events: deduped,
      summary,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch guest lifecycle";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Helpers ──
function actionToLabel(action: string, details: Record<string, unknown>): string {
  switch (action) {
    case "CHECKIN":
      return `Checked in to Room ${details.roomNumber ?? "?"}`;
    case "CHECKOUT":
      return `Checked out of Room ${details.roomNumber ?? "?"}`;
    case "EARLY_CHECKOUT":
      return `Early checkout from Room ${details.roomNumber ?? "?"}`;
    case "EXTEND_STAY":
      return `Stay extended (new checkout: ${details.newCheckOut ?? "?"})`;
    case "SHIFT_ROOM":
      return `Room shifted to ${details.newRoomNumber ?? "?"}`;
    case "CANCEL_RESERVATION":
      return `Reservation for Room ${details.roomNumber ?? "?"} cancelled`;
    case "UPDATE_RESERVATION":
      return `Reservation updated`;
    case "CREATE_RESERVATION":
      return `Reservation created for Room ${details.roomNumber ?? "?"}`;
    case "CREATE_PAYMENT":
      return `Payment recorded: ${details.amount ?? ""} ETB`;
    default:
      return action;
  }
}
