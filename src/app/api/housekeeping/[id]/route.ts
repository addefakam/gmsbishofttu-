import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logStaffActivity } from "@/lib/staff-log";
import { getAuthContext,
  getProviderFilter,
  checkWritePermission, AuthError } from "@/lib/tenant";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, {
      blockSuperuser: true,
      staffPermissionKey: "housekeeping",
    });

    const { id } = await params;
    const body = await req.json();

    const filter = getProviderFilter(auth);
    const where: Record<string, unknown> = filter.isPolice
      ? { id }
      : { id, providerId: filter.providerId };

    const existing = await db.housekeepingTask.findFirst({ where });
    if (!existing) {
      return NextResponse.json(
        { error: "Housekeeping task not found" },
        { status: 404 }
      );
    }

    const task = await db.housekeepingTask.update({
      where: { id },
      data: {
        ...(body.roomId !== undefined && { roomId: body.roomId }),
        ...(body.type !== undefined && { type: body.type }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.assignedTo !== undefined && {
          assignedTo: body.assignedTo || null,
        }),
        ...(body.scheduledDate !== undefined && {
          scheduledDate: body.scheduledDate,
        }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.status === "COMPLETED" && { completedAt: new Date() }),
      },
      include: {},
    });

    // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "HOUSEKEEPING_UPDATE",
      targetType: "HOUSEKEEPING",
      targetId: id,
      details: { status: task.status || "" },
      providerId: task.providerId,
    });

    return NextResponse.json({ task });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Update housekeeping task error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("permission") || message.includes("cannot")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, {
      blockSuperuser: true,
      staffPermissionKey: "housekeeping",
    });

    const { id } = await params;

    const filter = getProviderFilter(auth);
    const where: Record<string, unknown> = filter.isPolice
      ? { id }
      : { id, providerId: filter.providerId };

    const existing = await db.housekeepingTask.findFirst({ where });
    if (!existing) {
      return NextResponse.json(
        { error: "Housekeeping task not found" },
        { status: 404 }
      );
    }

    await db.housekeepingTask.delete({ where: { id } });

        // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "HOUSEKEEPING_DELETE",
      targetType: "HOUSEKEEPING",
      targetId: id,
      details: { roomNumber: existing.roomNumber || "" },
      providerId: existing.providerId,
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Delete housekeeping task error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("permission") || message.includes("cannot")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}