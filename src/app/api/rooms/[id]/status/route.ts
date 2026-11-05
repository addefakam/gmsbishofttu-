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
    checkWritePermission(auth, { staffPermissionKey: "rooms" });

    const { id } = await params;
    const body = await req.json();
    const { status } = body;

    if (!status) {
      return NextResponse.json(
        { error: "Status is required" },
        { status: 400 }
      );
    }

    const validStatuses = ["AVAILABLE", "OCCUPIED", "MAINTENANCE", "RESERVED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const filter = getProviderFilter(auth);
    const where: Record<string, unknown> = filter.isPolice
      ? { id }
      : { id, providerId: filter.providerId };

    const existing = await db.room.findFirst({ where, select: { id: true, number: true, status: true, providerId: true } });
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const room = await db.room.update({ select: { id: true, number: true, status: true, providerId: true },
      where: { id },
      data: { status },
    });

    // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "ROOM_STATUS_CHANGE",
      targetType: "ROOM",
      targetId: id,
      details: { roomNumber: room.number || "", status: room.status || "" },
      providerId: room.providerId,
    });

    return NextResponse.json({ room });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Update room status error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("permission") || message.includes("cannot")
      ? 403
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}