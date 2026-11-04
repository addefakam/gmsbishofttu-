import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { runAnomalyDetection } from "@/lib/anomaly-engine";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
/**
 * POST /api/reservations/bulk-action
 *
 * Apply one of three actions — "checkin", "checkout", or "cancel" — to a
 * set of reservation IDs. Used by the bulk-action bar on the Reservations
 * page (web + mobile) when the operator selects multiple reservations and
 * taps Check In / Check Out / Early Check Out / Cancel.
 *
 * Behavior:
 *   - Atomic per reservation: one failure doesn't block others. Each
 *     reservation is processed in its own try/catch and the result is
 *     reported back per-id.
 *   - Same validation logic as the single-action endpoints
 *     (/api/reservations/[id]/checkin, /checkout, /cancel). A reservation
 *     in the wrong state for the requested action is reported as
 *     `skipped: true` rather than `success: false` — the action didn't
 *     fail, it just wasn't applicable.
 *   - "checkout" covers BOTH "Check Out" (when checkout date is due) and
 *     "Early Check Out" (any ACTIVE reservation). They map to the same
 *     server-side behavior — the client decides which one to offer based
 *     on isCheckoutDue(res.checkOut).
 *
 * Request body:
 *   { ids: string[], action: "checkin" | "checkout" | "cancel" }
 *
 * Response:
 *   {
 *     action: string,
 *     total: number,           // ids.length
 *     successCount: number,     // applied successfully
 *     skippedCount: number,     // wrong state for the action
 *     failedCount: number,      // actual errors
 *     results: [{
 *       id: string,
 *       guestName: string,
 *       roomNumber: string,
 *       success: boolean,
 *       skipped?: boolean,
 *       error?: string
 *     }]
 *   }
 */
export async function POST(req: NextRequest) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { staffPermissionKey: "reservations", staffCanCreate: true });
    const { providerId } = getProviderFilter(auth);

    const body = await req.json().catch(() => ({}));
    const { ids, action } = body as { ids?: string[]; action?: string };

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "Missing or empty 'ids' array" }, { status: 400 });
    }
    if (action !== "checkin" && action !== "checkout" && action !== "cancel") {
      return NextResponse.json(
        { error: "Invalid 'action'. Must be one of: checkin, checkout, cancel" },
        { status: 400 }
      );
    }

    // Cap to a sane max so a misbehaving client can't lock up the DB
    // for minutes. 200 is well above any realistic operator selection.
    if (ids.length > 200) {
      return NextResponse.json(
        { error: "Too many reservations selected (max 200 per bulk action)" },
        { status: 413 }
      );
    }

    // ── Fetch all reservations in one query ──
    // We pull the reservation + its room + guest so per-item processing
    // doesn't need extra round-trips. We filter by providerId so a user
    // can't act on another provider's reservations.
    const reservations = await db.reservation.findMany({
      where: { id: { in: ids }, providerId: providerId || undefined },
      include: {
        room: { select: { id: true, number: true, name: true, status: true } },
        guest: { select: { id: true, name: true, phone: true } },
      },
    });

    // Build a map for O(1) lookup by id (some ids may not exist or belong
    // to another provider — those become "failed: not found").
    const resMap = new Map(reservations.map((r) => [r.id, r]));

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const results: {
      id: string;
      guestName: string;
      roomNumber: string;
      success: boolean;
      skipped?: boolean;
      error?: string;
    }[] = [];

    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // We deliberately do NOT wrap the whole loop in a $transaction.
    // Each reservation's update is independent — if one fails mid-way
    // (e.g. DB constraint), the ones already processed should stay
    // applied. The client gets a per-id report so it knows which ones
    // succeeded and which need a retry.
    for (const id of ids) {
      const reservation = resMap.get(id);
      if (!reservation) {
        results.push({
          id,
          guestName: "—",
          roomNumber: "—",
          success: false,
          error: "Reservation not found",
        });
        failedCount++;
        continue;
      }

      const guestName = reservation.guest?.name || "—";
      const roomNumber = reservation.room?.number || "—";

      try {
        // ── CHECKIN ──
        if (action === "checkin") {
          if (reservation.status !== "UPCOMING") {
            results.push({
              id, guestName, roomNumber,
              success: false, skipped: true,
              error: `Cannot check in a reservation with status '${reservation.status}'`,
            });
            skippedCount++;
            continue;
          }
          // Same date-window enforcement as single checkin endpoint
          if (todayStr < reservation.checkIn) {
            results.push({
              id, guestName, roomNumber,
              success: false, skipped: true,
              error: `Cannot check in before ${reservation.checkIn}`,
            });
            skippedCount++;
            continue;
          }
          if (todayStr > reservation.checkOut) {
            results.push({
              id, guestName, roomNumber,
              success: false, skipped: true,
              error: `Cannot check in after checkout date ${reservation.checkOut}`,
            });
            skippedCount++;
            continue;
          }
          // Room conflict check — skip if room is OCCUPIED by another active res
          if (reservation.room?.status === "OCCUPIED") {
            const otherActive = await db.reservation.findFirst({
              where: {
                roomId: reservation.roomId,
                status: "ACTIVE",
                id: { not: reservation.id },
              },
              select: { id: true, guest: { select: { name: true } } },
            });
            if (otherActive) {
              results.push({
                id, guestName, roomNumber,
                success: false, skipped: true,
                error: `Room ${reservation.room.number} occupied by ${otherActive.guest?.name || "another guest"}`,
              });
              skippedCount++;
              continue;
            }
          }

          const updated = await db.reservation.update({
            where: { id },
            data: { status: "ACTIVE", actualCheckIn: now },
          });
          await db.room.update({
            where: { id: reservation.roomId },
            data: { status: "OCCUPIED" },
          });
          try {
            await db.suspectMatch.updateMany({
              where: { reservationId: id },
              data: { isRead: false },
            });
          } catch {
            // Non-blocking
          }
          // Fire-and-forget anomaly detection (mirror single checkin)
          runAnomalyDetection({
            guestName: reservation.guest?.name ?? "",
            guestPhone: reservation.guest?.phone ?? "",
            providerId,
            reservationId: id,
            trigger: "CHECKIN",
          }).catch(() => {});

          results.push({ id, guestName, roomNumber, success: true });
          successCount++;
          continue;
        }

        // ── CHECKOUT ──
        // Covers both "Check Out" (due) and "Early Check Out" (not due).
        // Client-side decides which label to show; server behavior is identical.
        if (action === "checkout") {
          if (reservation.status !== "ACTIVE") {
            results.push({
              id, guestName, roomNumber,
              success: false, skipped: true,
              error: `Cannot check out a reservation with status '${reservation.status}'`,
            });
            skippedCount++;
            continue;
          }

          await db.reservation.update({
            where: { id },
            data: { status: "COMPLETED", actualCheckOut: now },
          });
          await db.room.update({
            where: { id: reservation.roomId },
            data: { status: "AVAILABLE" },
          });
          await db.guest.update({
            where: { id: reservation.guestId },
            data: {
              totalStays: { increment: 1 },
              totalSpent: { increment: reservation.totalCost },
            },
          });
          try {
            await db.suspectMatch.updateMany({
              where: { reservationId: id },
              data: { isRead: false },
            });
          } catch {
            // Non-blocking
          }

          results.push({ id, guestName, roomNumber, success: true });
          successCount++;
          continue;
        }

        // ── CANCEL ──
        if (action === "cancel") {
          if (
            reservation.status === "COMPLETED" ||
            reservation.status === "CANCELLED" ||
            reservation.status === "DELETED"
          ) {
            results.push({
              id, guestName, roomNumber,
              success: false, skipped: true,
              error: `Cannot cancel a reservation with status '${reservation.status}'`,
            });
            skippedCount++;
            continue;
          }

          await db.reservation.update({
            where: { id },
            data: { status: "CANCELLED" },
          });
          // Release room if it was RESERVED/OCCUPIED by this reservation
          if (
            reservation.room?.status === "OCCUPIED" ||
            reservation.room?.status === "RESERVED"
          ) {
            await db.room.update({
              where: { id: reservation.roomId },
              data: { status: "AVAILABLE" },
            });
          }
          try {
            await db.suspectMatch.updateMany({
              where: { reservationId: id },
              data: { isRead: false },
            });
          } catch {
            // Non-blocking
          }

          results.push({ id, guestName, roomNumber, success: true });
          successCount++;
          continue;
        }

        // Should never reach here (action validated above), defensive only
        results.push({
          id, guestName, roomNumber,
          success: false,
          error: `Unknown action '${action}'`,
        });
        failedCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({
          id, guestName, roomNumber,
          success: false,
          error: msg,
        });
        failedCount++;
      }
    }

    // ── Staff log ──
    // One log entry for the whole bulk action — not N entries. The
    // details contain the count breakdown for auditability.
    const { userId, userName } = getLogUserInfo(req);
    logStaffActivity({
      req, userId, userName,
      action: `BULK_${action.toUpperCase()}`,
      targetType: "RESERVATION",
      targetId: ids.join(",").slice(0, 200), // cap for log column width
      details: {
        action,
        total: ids.length,
        success: successCount,
        skipped: skippedCount,
        failed: failedCount,
      },
      providerId,
    });

    return NextResponse.json({
      action,
      total: ids.length,
      successCount,
      skippedCount,
      failedCount,
      results,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[bulk-action POST]", error);
    const message = error instanceof Error ? error.message : "Bulk action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
