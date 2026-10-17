import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext,
  getProviderFilter,
  checkWritePermission, AuthError } from "@/lib/tenant";
import { logStaffActivity } from "@/lib/staff-log";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);

    const where: Record<string, unknown> = filter.isPolice
      ? {}
      : { providerId: filter.providerId };

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    if (status) {
      where.status = status;
    }
    // Optional type filter — e.g. ?type=MAINTENANCE for the maintenance
    // ticket workflow tab. Without this filter, all task types are returned.
    const type = searchParams.get("type");
    if (type) {
      where.type = type;
    }
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const skip = (page - 1) * limit;

    const [tasks, total] = await Promise.all([
      db.housekeepingTask.findMany({
        where,
        orderBy: { scheduledDate: "asc" },
        include: { room: { select: { id: true, number: true, name: true, type: true, status: true } } },
        skip,
        take: limit,
      }),
      db.housekeepingTask.count({ where }),
    ]);

    return NextResponse.json({ tasks, total, page, limit });
  } catch (error) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("List housekeeping tasks error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    checkWritePermission(auth, {
      blockSuperuser: true,
      staffPermissionKey: "housekeeping",
    });

    const body = await req.json();
    const {
      roomId, type, assignedTo, scheduledDate, notes,
      // Maintenance ticket fields (only used when type=MAINTENANCE):
      reportedBy, priority, diagnosis, partsUsed, resolutionNotes,
    } = body;

    if (!roomId || !type || !scheduledDate) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: roomId, type, scheduledDate",
        },
        { status: 400 }
      );
    }

    if (!auth.providerId) {
      return NextResponse.json(
        { error: "No provider assigned to this user" },
        { status: 403 }
      );
    }

    const task = await db.housekeepingTask.create({
      data: {
        roomId,
        type,
        assignedTo: assignedTo || null,
        scheduledDate,
        notes: notes || "",
        providerId: auth.providerId,
        // Maintenance ticket fields — only populated when type=MAINTENANCE
        ...(type === "MAINTENANCE" ? {
          reportedBy: reportedBy || auth.userName || null,
          priority: priority || "MEDIUM",
          diagnosis: diagnosis || "",
          partsUsed: partsUsed || "",
          resolutionNotes: resolutionNotes || "",
        } : {}),
      },
      include: { room: { select: { id: true, number: true, name: true, type: true, status: true } } },
    });

    // Staff activity log
    logStaffActivity({
      req,
      userId: auth.userId,
      userName: auth.userName,
      action: "HOUSEKEEPING_CREATE",
      targetType: "HOUSEKEEPING",
      targetId: task.id,
      details: { type: task.type || "", assignedTo: task.assignedTo || "", scheduledDate: task.scheduledDate || "" },
      providerId: auth.providerId || "",
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    console.error("Create housekeeping task error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status =
      message.includes("permission") || message.includes("cannot")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}