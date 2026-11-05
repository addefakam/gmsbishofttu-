import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { composeAddress } from "@/lib/ethiopian-admin-divisions";
import { isValidPhone, isValidEmail } from "@/lib/utils";
import { normalizeIdType } from "@/lib/national-id";
import { normalizeNationality } from "@/lib/nationalities";
import { logStaffActivity } from "@/lib/staff-log";

import { ensureReservationIntegrity } from "@/lib/ensure-reservation-integrity";
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureReservationIntegrity();
  try {
    const auth = await getAuthContext(req);
    const { providerId } = getProviderFilter(auth);
    // Accept 'guests' OR 'reservations' permission (see guests/route.ts for explanation)
    try {
      checkWritePermission(auth, { staffPermissionKey: "guests" });
    } catch {
      checkWritePermission(auth, { staffPermissionKey: "reservations" });
    }

    const { id } = await params;
    const body = await req.json();

    const existing = await db.guest.findFirst({
      where: { id, providerId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Guest not found" }, { status: 404 });
    }

    const { name, phone, email, idNumber, idType, nationality, region, zone, woreda, kebele, houseNumber, streetName, plateNumber, weapon, address, notes, vip } = body;

    // Validate phone format if provided
    if (phone !== undefined && !isValidPhone(phone)) {
      return NextResponse.json({ error: "Invalid phone number format" }, { status: 400 });
    }
    // Validate email format if provided
    if (email !== undefined && email && !isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email address format" }, { status: 400 });
    }
    // Validate ID type if provided
    if (idType !== undefined && !idType.trim()) {
      return NextResponse.json({ error: "ID type is required" }, { status: 400 });
    }
    // Validate ID number if provided
    if (idNumber !== undefined && !idNumber.trim()) {
      return NextResponse.json({ error: "ID number is required" }, { status: 400 });
    }
    if (idNumber !== undefined && idNumber.trim().length < 4) {
      return NextResponse.json({ error: "ID number is too short. Please enter a valid ID number." }, { status: 400 });
    }

    // Auto-compose address from normalized fields
    const composedAddress = address !== undefined
      ? address
      : composeAddress({ region: existing.region, zone: existing.zone, woreda: existing.woreda, kebele: existing.kebele, houseNumber: existing.houseNumber, streetName: existing.streetName, ...body });

    const guest = await db.guest.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(idNumber !== undefined && { idNumber }),
        // Normalize on update so old records get cleaned up when edited.
        ...(idType !== undefined && { idType: normalizeIdType(idType) }),
        ...(nationality !== undefined && { nationality: normalizeNationality(nationality) }),
        ...(region !== undefined && { region }),
        ...(zone !== undefined && { zone }),
        ...(woreda !== undefined && { woreda }),
        ...(kebele !== undefined && { kebele }),
        ...(houseNumber !== undefined && { houseNumber }),
        ...(streetName !== undefined && { streetName }),
        ...(plateNumber !== undefined && { plateNumber }),
        ...(weapon !== undefined && { weapon }),
        address: composedAddress,
        ...(notes !== undefined && { notes }),
        ...(vip !== undefined && { vip }),
      },
    });

    // Staff activity log
    logStaffActivity({
      req, userId: auth.userId, userName: auth.userName, action: "GUEST_UPDATE", targetType: "GUEST", targetId: id,
      details: { guestName: guest.name },
      providerId,
    });

    return NextResponse.json(guest);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to update guest";
    const status = message.includes("not found") ? 404 : message.includes("permission") || message.includes("cannot") ? 403 : 500;
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
    const { providerId } = getProviderFilter(auth);
    // Accept 'guests' OR 'reservations' permission (see guests/route.ts for explanation)
    try {
      checkWritePermission(auth, { staffPermissionKey: "guests" });
    } catch {
      checkWritePermission(auth, { staffPermissionKey: "reservations" });
    }

    const { id } = await params;

    const existing = await db.guest.findFirst({
      where: { id, providerId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Guest not found" }, { status: 404 });
    }

    // Check for active reservations (UPCOMING or ACTIVE)
    const activeReservations = await db.reservation.count({
      where: {
        guestId: id,
        status: { in: ["UPCOMING", "ACTIVE"] },
      },
    });

    if (activeReservations > 0) {
      return NextResponse.json(
        { error: "Cannot delete guest with active reservations" },
        { status: 409 }
      );
    }

        // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "GUEST_DELETE",
      targetType: "GUEST",
      targetId: id,
      details: { guestName: existing.name || "" },
      providerId,
    });
    await db.guest.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to delete guest";
    const status = message.includes("not found") ? 404 : message.includes("active reservations") ? 409 : message.includes("permission") || message.includes("cannot") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}