import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, requirePolice, AuthError } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureProviderStatusEnum();
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "POLICE" && auth.role !== "SUPERUSER") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const { id } = await params;
    const provider = await db.provider.findUnique({
      where: { id },
      select: { id: true, licenseFile: true },
    });
    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }
    return NextResponse.json({ id: provider.id, licenseFile: provider.licenseFile });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Failed to fetch provider" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureProviderStatusEnum();
  try {
    const auth = await getAuthContext(req);

    // Both POLICE and SUPERUSER can update providers, but with different constraints
    if (auth.role !== "POLICE" && auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await req.json();

    const { status, rejectionReason, latitude, longitude } = body;

    if (!status || !["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].includes(status)) {
      return NextResponse.json(
        { error: "Valid status is required (PENDING, APPROVED, REJECTED, SUSPENDED)" },
        { status: 400 }
      );
    }

    // SUPERUSER can ONLY suspend guesthouses.
    // They cannot approve, reject, or re-activate guesthouses.
    // Reactivation of a suspended guesthouse must be done by the Police module.
    if (auth.role === "SUPERUSER" && status !== "SUSPENDED") {
      return NextResponse.json(
        { error: "Superuser can only suspend guesthouses. Approve, reject, and reactivate are reserved for the Police module." },
        { status: 403 }
      );
    }

    const existing = await db.provider.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {
      status,
      rejectionReason: rejectionReason || "",
    };

    if (typeof latitude === "number" && typeof longitude === "number") {
      updateData.latitude = latitude;
      updateData.longitude = longitude;
    }

    if (status === "APPROVED") {
      updateData.approvedBy = auth.role;
      updateData.approvedAt = new Date();
      // If reactivating from suspended, clear suspension fields
      if (existing.status === "SUSPENDED") {
        updateData.suspensionReason = "";
        updateData.suspendedAt = null;
        updateData.suspendedBy = "";
      }
    }

    const provider = await db.provider.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(provider);
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to update provider";
    const status =
      message.includes("not found") ? 404 :
      message.includes("denied") ? 403 :
      message.includes("Superuser") ? 403 :
      message.includes("required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// ── DELETE /api/providers/[id] ──
// Permanently deletes a guesthouse record AND all related data:
//   - All Users belonging to this provider (operator + staff accounts)
//   - All Reservations (including their history)
//   - All Guests
//   - All Rooms
//   - All Expenses, Resources, DaytimeServices, DaytimeBookings,
//     HousekeepingTasks, Notifications
//   - The Provider record itself
//
// Safeguards (defense-in-depth — refuse rather than silently cascade):
//   1. Only POLICE or SUPERUSER can call this endpoint (matches PUT).
//   2. We REFUSE the delete if the provider has any ACTIVE or UPCOMING
//      reservations — the operator must check out / cancel those first.
//      This prevents accidental data loss while a guest is in-house.
//   3. The delete is wrapped in a transaction so partial failures roll
//      back — we never leave orphaned users without their provider.
//   4. An audit log entry is written recording who deleted what.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    await ensureProviderStatusEnum();
  try {
    const auth = await getAuthContext(req);

    // Both POLICE and SUPERUSER can delete providers (matches PUT perms).
    if (auth.role !== "POLICE" && auth.role !== "SUPERUSER") {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const { id } = await params;

    const existing = await db.provider.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        ownerName: true,
        status: true,
        licenseNo: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    // ── Safeguard: refuse if there are active/upcoming reservations ──
    // The operator must check out / cancel any in-house or upcoming
    // guests first. This is the strongest protection against accidental
    // data loss while a guest is physically staying at the guesthouse.
    const activeCount = await db.reservation.count({
      where: { providerId: id, status: { in: ["ACTIVE", "UPCOMING"] } },
    });
    if (activeCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: this guesthouse has ${activeCount} active or upcoming reservation(s). Check out or cancel them first.`,
          code: "PROVIDER_HAS_ACTIVE_RESERVATIONS",
          details: { activeCount },
        },
        { status: 409 }
      );
    }

    // ── Cascade delete in a single transaction ──
    // Order matters for foreign-key constraints: child tables first,
    // then the parent Provider. Each delete is batched for efficiency
    // on guesthouses with large amounts of historical data.
    await db.$transaction(async (tx) => {
      // Reservation-scoped children
      await tx.payment.deleteMany({ where: { reservation: { providerId: id } } }).catch(() => {});
      await tx.reservation.deleteMany({ where: { providerId: id } });

      // Daytime-service scoped children
      await tx.daytimeBooking.deleteMany({ where: { providerId: id } });
      await tx.daytimeService.deleteMany({ where: { providerId: id } });

      // Provider-direct children
      await tx.housekeepingTask.deleteMany({ where: { providerId: id } }).catch(() => {});
      await tx.expense.deleteMany({ where: { providerId: id } });
      await tx.resource.deleteMany({ where: { providerId: id } });
      await tx.room.deleteMany({ where: { providerId: id } });
      await tx.guest.deleteMany({ where: { providerId: id } });
      await tx.notification.deleteMany({ where: { providerId: id } }).catch(() => {});

      // Users belonging to this provider (operator + staff accounts)
      await tx.user.deleteMany({ where: { providerId: id } });

      // Finally, the provider record itself
      await tx.provider.delete({ where: { id } });
    });

    // Audit log (fire-and-forget — never blocks the response)
    await logAudit(req, {
      action: "DELETE_PROVIDER",
      targetId: id,
      targetType: "Provider",
      details: JSON.stringify({
        name: existing.name,
        ownerName: existing.ownerName,
        licenseNo: existing.licenseNo,
        previousStatus: existing.status,
        deletedBy: auth.userName || auth.userId || "unknown",
      }),
    }).catch(() => {});

    return NextResponse.json({ success: true, id, deletedAt: new Date().toISOString() });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Failed to delete provider";
    const status =
      message.includes("not found") ? 404 :
      message.includes("denied") ? 403 :
      message.includes("Cannot delete") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}