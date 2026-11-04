import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext,
  getProviderFilter,
  checkWritePermission, AuthError } from "@/lib/tenant";
import { uploadFile } from "@/lib/storage";
import { logStaffActivity } from "@/lib/staff-log";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { staffPermissionKey: "rooms" });

    const { id } = await params;
    const body = await req.json();

    const filter = getProviderFilter(auth);
    const where: Record<string, unknown> = filter.isPolice
      ? { id }
      : { id, providerId: filter.providerId };

    // Fetch existing room — wrap in try/catch in case the pricePerNightWeekend
    // column hasn't been added to the production DB yet (init-db.ts ALTER
    // TABLE runs on the first ensureDatabase() call, but this route may be
    // hit before that happens). Fall back to a SELECT without the new column.
    let existing;
    try {
      existing = await db.room.findFirst({ where, select: { id: true, number: true, name: true, pricePerNight: true, pricePerNightWeekend: true, floor: true, capacity: true, status: true, providerId: true, type: true } });
    } catch (findErr: unknown) {
      const errMsg = findErr instanceof Error ? findErr.message : String(findErr);
      if (errMsg.includes("pricePerNightWeekend") && errMsg.includes("does not exist")) {
        existing = await db.room.findFirst({ where, select: { id: true, number: true, name: true, pricePerNight: true, floor: true, capacity: true, status: true, providerId: true, type: true } });
      } else {
        throw findErr;
      }
    }
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // ── Capacity cap for SINGLE rooms ──
    // The effective room type is whichever is newer between the existing
    // type and the type being updated to. Same cap as POST: 2 guests max.
    const effectiveType = body.type !== undefined ? body.type : existing.type;
    if (effectiveType === "SINGLE" && body.capacity !== undefined && Number(body.capacity) > 2) {
      return NextResponse.json(
        {
          error: "Single rooms can hold a maximum of 2 guests. Use a DOUBLE or larger room type for higher capacity.",
          code: "SINGLE_ROOM_CAPACITY_EXCEEDED",
          details: { type: effectiveType, requestedCapacity: Number(body.capacity), maxCapacity: 2 },
        },
        { status: 400 }
      );
    }

    // If room number is being changed, check for duplicates
    if (body.number && body.number !== existing.number) {
      const dup = await db.room.findFirst({ select: { id: true, number: true },
        where: {
          number: body.number,
          providerId: existing.providerId,
          NOT: { id },
        },
      });
      if (dup) {
        return NextResponse.json(
          { error: "Room number already exists for this provider" },
          { status: 409 }
        );
      }
    }

    // Update room — wrap in try/catch. If pricePerNightWeekend column doesn't
    // exist on the production DB, retry the update without that field (the
    // weekend price will be silently dropped, but the rest of the update
    // succeeds — better than blocking all room edits until init-db runs).
    //
    // Auto-sync name when number changes (defence-in-depth — the web client
    // already does this in the form's onChange, but the mobile client and
    // any direct API caller bypass that. If the operator changes the number
    // AND the existing name is a default pattern matching the OLD number,
    // we update the name to match the NEW number so the room card doesn't
    // show "Room 1001 — Room 1000" (number ≠ stale auto-generated name).
    let nameOverride: string | undefined = undefined;
    if (body.number !== undefined && body.name === undefined) {
      // Number is changing but the caller didn't pass an explicit name.
      // Check if the existing name is a default pattern (e.g. "Room 1000").
      const oldNumber = existing.number;
      const oldName = existing.name;
      const trimmedName = (oldName || "").trim();
      const lowerName = trimmedName.toLowerCase();
      const isDefaultName =
        !trimmedName ||
        trimmedName === oldNumber ||
        lowerName === `room ${oldNumber}`.toLowerCase() ||
        lowerName === `room${oldNumber}`.toLowerCase();
      if (isDefaultName && body.number !== oldNumber) {
        // Update the name to match the new number.
        nameOverride = body.number ? `Room ${body.number}` : "";
      }
    }

    let room;
    try {
      room = await db.room.update({ select: { id: true, number: true, name: true, pricePerNight: true, pricePerNightWeekend: true, floor: true, capacity: true, status: true, providerId: true },
        where: { id },
        data: {
          ...(body.number !== undefined && { number: body.number }),
          ...(body.name !== undefined && { name: body.name }),
          ...(nameOverride !== undefined && { name: nameOverride }),
          ...(body.type !== undefined && { type: body.type }),
          ...(body.pricePerNight !== undefined && {
            pricePerNight: Number(body.pricePerNight),
          }),
          // Weekend price — null/empty clears it (back to single-rate), any
          // positive number sets the Fri+Sat premium rate.
          ...(body.pricePerNightWeekend !== undefined && {
            pricePerNightWeekend:
              body.pricePerNightWeekend === null ||
              body.pricePerNightWeekend === "" ||
              Number(body.pricePerNightWeekend) === 0
                ? null
                : Number(body.pricePerNightWeekend),
          }),
          ...(body.floor !== undefined && { floor: Number(body.floor) }),
          ...(body.capacity !== undefined && {
            capacity: Number(body.capacity),
          }),
          ...(body.amenities !== undefined && { amenities: body.amenities }),
          ...(body.description !== undefined && {
            description: body.description,
          }),
          ...(body.image !== undefined && {
            image: body.image?.startsWith("data:")
              ? await uploadFile(body.image, "rooms")
              : body.image || "",
          }),
        },
      });
    } catch (updateErr: unknown) {
      const errMsg = updateErr instanceof Error ? updateErr.message : String(updateErr);
      if (errMsg.includes("pricePerNightWeekend") && errMsg.includes("does not exist")) {
        // Retry without the pricePerNightWeekend field — column will be
        // added by init-db.ts on the next ensureDatabase() call.
        console.warn("[rooms PUT] pricePerNightWeekend column not found — retrying update without it.");
        room = await db.room.update({ select: { id: true, number: true, name: true, pricePerNight: true, floor: true, capacity: true, status: true, providerId: true },
          where: { id },
          data: {
            ...(body.number !== undefined && { number: body.number }),
            ...(body.name !== undefined && { name: body.name }),
            ...(nameOverride !== undefined && { name: nameOverride }),
            ...(body.type !== undefined && { type: body.type }),
            ...(body.pricePerNight !== undefined && {
              pricePerNight: Number(body.pricePerNight),
            }),
            ...(body.floor !== undefined && { floor: Number(body.floor) }),
            ...(body.capacity !== undefined && {
              capacity: Number(body.capacity),
            }),
            ...(body.amenities !== undefined && { amenities: body.amenities }),
            ...(body.description !== undefined && {
              description: body.description,
            }),
            ...(body.image !== undefined && {
              image: body.image?.startsWith("data:")
                ? await uploadFile(body.image, "rooms")
                : body.image || "",
            }),
          },
        });
      } else {
        throw updateErr;
      }
    }

    // Staff activity log
    logStaffActivity({
      req, userId: auth.userId, userName: auth.userName, action: "ROOM_UPDATE", targetType: "ROOM", targetId: id,
      details: { roomNumber: room.number },
      providerId: existing.providerId,
    });

    return NextResponse.json({ room });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Update room error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("permission") || message.includes("cannot")
      ? 403
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, { staffPermissionKey: "rooms" });

    const { id } = await params;

    const filter = getProviderFilter(auth);
    const where: Record<string, unknown> = filter.isPolice
      ? { id }
      : { id, providerId: filter.providerId };

    const existing = await db.room.findFirst({ where, select: { id: true, number: true, name: true, pricePerNight: true, floor: true, capacity: true, status: true, providerId: true } });
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Prevent deleting rooms that have active reservations
    const activeReservation = await db.reservation.findFirst({
      where: {
        roomId: id,
        status: { in: ["UPCOMING", "ACTIVE"] },
      },
    });
    if (activeReservation) {
      return NextResponse.json(
        { error: "Cannot delete room with active or upcoming reservations" },
        { status: 409 }
      );
    }

        // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "ROOM_DELETE",
      targetType: "ROOM",
      targetId: id,
      details: { roomNumber: existing.number || "" },
      providerId: existing.providerId,
    });
    await db.room.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Delete room error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("permission") || message.includes("cannot")
      ? 403
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}