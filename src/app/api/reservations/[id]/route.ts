import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { ensureReservationStatusEnum } from "@/lib/ensure-enum-values";

import { logStaffActivity } from "@/lib/staff-log";
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    checkWritePermission(auth, { staffPermissionKey: "reservations" });

    const { id } = await params;
    const body = await req.json();

    const existing = await db.reservation.findFirst({
      where: { id, providerId },
      include: {
        room: { select: { id: true, number: true, name: true, status: true, providerId: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    const { guestId, roomId, checkIn, checkOut, roomRate, taxAmount, discountAmount, paymentMethod, notes, groupBookingId } = body;

    // ── Status guard ──
    // Booking details of PENDING (UPCOMING) and ACTIVE stays may be edited.
    // COMPLETED / CANCELLED / DELETED records are history (police reports,
    // revenue) and must stay immutable. Exception: unlinking a reservation
    // from a group booking (groupBookingId-only payload) is metadata-only and
    // stays available for every status.
    const onlyUnlink =
      groupBookingId !== undefined &&
      Object.keys(body).every((k) => k === "groupBookingId");
    if (!onlyUnlink && existing.status !== "UPCOMING" && existing.status !== "ACTIVE") {
      return NextResponse.json(
        { error: `Only upcoming or active reservations can be edited (current status: '${existing.status}')` },
        { status: 409 }
      );
    }
    // NOTE: `status` is intentionally NOT an accepted field here — status
    // transitions must go through the dedicated checkin / checkout / cancel
    // / delete endpoints so room state and side effects stay consistent
    // (writing an invalid enum value here once caused SQLSTATE 22P02).

    const newCheckIn = checkIn || existing.checkIn;
    const newCheckOut = checkOut || existing.checkOut;

    // ── Overlap guard (true per-day overlap on [checkIn, checkOut)) ──
    // Runs when dates or room change — e.g. extending a stay into another
    // booking must be rejected. The checkout day of another reservation stays
    // bookable as an arrival, so equal dates on either boundary are allowed.
    if (checkIn || checkOut || roomId !== undefined) {
      const inDay = String(newCheckIn).slice(0, 10);
      const outDay = String(newCheckOut).slice(0, 10);
      if (outDay <= inDay) {
        return NextResponse.json(
          { error: "Check-out date must be after the check-in date" },
          { status: 400 }
        );
      }
      const targetRoomId = roomId || existing.roomId;
      const overlapping = await db.reservation.findFirst({
        where: {
          id: { not: id },
          roomId: targetRoomId,
          status: { in: ["UPCOMING", "ACTIVE"] },
          checkIn: { lt: outDay },
          checkOut: { gt: inDay },
        },
        include: {
          room: { select: { number: true, name: true } },
        },
      });
      if (overlapping) {
        return NextResponse.json(
          {
            error: "ROOM_CONFLICT",
            code: "ROOM_CONFLICT",
            message: `Room ${overlapping.room?.number ?? ""} already has a reservation from ${overlapping.checkIn} to ${overlapping.checkOut}`,
            conflict: {
              roomId: targetRoomId,
              checkIn: overlapping.checkIn,
              checkOut: overlapping.checkOut,
              roomNumber: overlapping.room?.number ?? "",
              roomName: overlapping.room?.name ?? "",
            },
          },
          { status: 409 }
        );
      }
    }

    // Recalculate if dates or rates changed
    let nights = existing.nights;
    let totalCost = existing.totalCost;
    let balance = existing.balance;

    const newRate = roomRate !== undefined ? roomRate : existing.roomRate;
    const newTax = taxAmount !== undefined ? taxAmount : existing.taxAmount;
    const newDiscount = discountAmount !== undefined ? discountAmount : existing.discountAmount;

    if (checkIn || checkOut || roomRate !== undefined) {
      const startDate = new Date(newCheckIn);
      const endDate = new Date(newCheckOut);
      const diffMs = endDate.getTime() - startDate.getTime();
      nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

      const subtotal = newRate * nights;
      totalCost = subtotal + newTax - newDiscount;
      balance = totalCost - existing.paidAmount;
    }

    const reservation = await db.reservation.update({
      where: { id },
      data: {
        ...(guestId !== undefined && { guestId }),
        ...(roomId !== undefined && { roomId }),
        ...(checkIn !== undefined && { checkIn }),
        ...(checkOut !== undefined && { checkOut }),
        nights,
        roomRate: newRate,
        totalCost,
        balance,
        ...(taxAmount !== undefined && { taxAmount }),
        ...(discountAmount !== undefined && { discountAmount }),
        ...(paymentMethod !== undefined && { paymentMethod: paymentMethod || null }),
        ...(notes !== undefined && { notes }),
        ...(groupBookingId !== undefined && { groupBookingId: groupBookingId || null }),
      },
      include: {
        guest: { select: { id: true, name: true, phone: true } },
      },
    });

    // ── Room-change side effects ──
    // Keep room.status consistent when a reservation moves rooms, mirroring
    // the cancel (release) and check-in (occupy) semantics:
    //   • old room → AVAILABLE once no other UPCOMING/ACTIVE booking holds it
    //   • new room → OCCUPIED when an ACTIVE (checked-in) guest moves in,
    //                RESERVED when an UPCOMING (not yet checked in) guest moves in.
    //                This is the fix for the bug where shifting an UPCOMING
    //                reservation from Room A → Room B left Room B in AVAILABLE
    //                status (it should be RESERVED so it appears in the
    //                reserved-rooms list and can't be double-booked).
    const roomChanged =
      roomId !== undefined && roomId !== null && roomId !== existing.roomId;
    if (roomChanged) {
      const othersOnOldRoom = await db.reservation.count({
        where: {
          roomId: existing.roomId,
          id: { not: id },
          status: { in: ["UPCOMING", "ACTIVE"] },
        },
      });
      if (
        othersOnOldRoom === 0 &&
        (existing.room.status === "OCCUPIED" || existing.room.status === "RESERVED")
      ) {
        await db.room.update({ select: { id: true, number: true, status: true, providerId: true },
          where: { id: existing.roomId },
          data: { status: "AVAILABLE" },
        });
      }
      // Determine the correct target status for the new room based on the
      // reservation's current status. ACTIVE → OCCUPIED (guest is in-house),
      // UPCOMING → RESERVED (guest will arrive later). Other statuses
      // (COMPLETED/CANCELLED/DELETED) shouldn't normally be shifted, but if
      // they are, leave the new room alone (it's a historical record change).
      const targetRoomStatus =
        existing.status === "ACTIVE" ? "OCCUPIED"
        : existing.status === "UPCOMING" ? "RESERVED"
        : null;
      if (targetRoomStatus) {
        const newRoom = await db.room.findUnique({
          where: { id: roomId },
          select: { id: true, number: true, name: true, pricePerNight: true, floor: true, capacity: true, status: true, providerId: true },
        });
        // Only update if the new room is currently AVAILABLE or RESERVED —
        // don't downgrade an OCCUPIED or MAINTENANCE room (those need
        // operator attention first).
        if (newRoom && (newRoom.status === "AVAILABLE" || newRoom.status === "RESERVED")) {
          await db.room.update({ select: { id: true, number: true, status: true, providerId: true },
            where: { id: roomId },
            data: { status: targetRoomStatus },
          });
        }
      }
    }

    // Staff activity log — general reservation update (PUT).
    // Check-in/check-out/cancel have their own dedicated routes and log
    // different actions; this log is for edits to the reservation itself
    // (e.g. changing check-in date, swapping the room, editing guest info).
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "RESERVATION_UPDATE",
      targetType: "RESERVATION",
      targetId: id,
      details: { guestName: reservation.guestName || "", roomId: reservation.roomId || "" },
      providerId,
    });
    return NextResponse.json(reservation);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to update reservation";
    const status = message.includes("not found") ? 404 : message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { requireSuperuserOrOperator: true });

    const { id } = await params;
    const { providerId } = getProviderFilter(auth);

    const existing = await db.reservation.findFirst({
      where: { id, providerId },
      include: {
        room: { select: { id: true, number: true, name: true, status: true, providerId: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED" || existing.status === "DELETED") {
      return NextResponse.json(
        { error: `Cannot delete a reservation with status '${existing.status}'` },
        { status: 409 }
      );
    }

    // Soft-delete: update status to DELETED instead of removing the record.
    // The DELETED enum value may not exist in the database yet (Vercel builds
    // never run prisma db push), so make sure it does before writing it.
    await ensureReservationStatusEnum();
    const updated = await db.reservation.update({
      where: { id },
      data: { status: "DELETED" },
      include: {
        guest: { select: { id: true, name: true, phone: true } },
      },
    });

    // Release room back to AVAILABLE if it was RESERVED or OCCUPIED
    if (
      existing.room.status === "RESERVED" ||
      existing.room.status === "OCCUPIED"
    ) {
      await db.room.update({ select: { id: true, number: true, status: true, providerId: true },
        where: { id: existing.roomId },
        data: { status: "AVAILABLE" },
      });
    }

        // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "RESERVATION_DELETE",
      targetType: "RESERVATION",
      targetId: id,
      details: { guestName: existing.guestName || "", roomId: updated.roomId || "" },
      providerId,
    });
    return NextResponse.json(updated);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to delete reservation";
    const status = message.includes("not found") ? 404 : message.includes("permission") || message.includes("cannot") || message.includes("required") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}