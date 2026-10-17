import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext,
  getProviderFilter,
  checkWritePermission, AuthError } from "@/lib/tenant";
import { logStaffActivity } from "@/lib/staff-log";

export const dynamic = "force-dynamic";

/**
 * Force-adds the maintenance ticket fields to HousekeepingTask if they
 * don't exist yet. Same pattern as ensureOperatorFeatureFlagsColumn —
 * bypasses the _initDone cache in ensureDatabase() which can skip new
 * migrations on Vercel warm instances.
 *
 * Uses plain ALTER TABLE statements (no DO $$ blocks — Prisma's driver
 * doesn't support them in $executeRawUnsafe).
 */
async function ensureMaintenanceTicketColumns(): Promise<void> {
  const columns: Array<{ name: string; type: string; default?: string }> = [
    { name: "reportedBy", type: "TEXT" },
    { name: "priority", type: "TEXT", default: "'MEDIUM'" },
    { name: "diagnosis", type: "TEXT", default: "''" },
    { name: "partsUsed", type: "TEXT", default: "''" },
    { name: "resolutionNotes", type: "TEXT", default: "''" },
    { name: "resolvedAt", type: "TIMESTAMP(3)" },
    { name: "resolvedById", type: "TEXT" },
  ];
  for (const col of columns) {
    try {
      const defaultClause = col.default ? ` DEFAULT ${col.default}` : "";
      await db.$executeRawUnsafe(
        `ALTER TABLE "HousekeepingTask" ADD COLUMN "${col.name}" ${col.type}${defaultClause}`
      );
      console.log(`[housekeeping] Added column ${col.name} to HousekeepingTask.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("duplicate column") || msg.includes("42701")) {
        // Expected — column already there.
        continue;
      }
      console.warn(`[housekeeping] Failed to add column ${col.name} (non-blocking):`, msg);
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    // Force-migrate the maintenance ticket columns before querying —
    // otherwise the SELECT will fail with "column does not exist".
    await ensureMaintenanceTicketColumns();
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
    // Force-migrate the maintenance ticket columns before writing —
    // otherwise the INSERT will fail with "column does not exist".
    await ensureMaintenanceTicketColumns();
    const auth = await getAuthContext(req);
    checkWritePermission(auth, {
      allowSuperuser: true,
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

    // Validate that the roomId actually exists + belongs to this provider.
    // Without this, Prisma's create() with `include: { room: ... }` will throw
    // 'Inconsistent query result: Field room is required to return data, got
    // null instead.' when the FK doesn't match any row.
    const room = await db.room.findFirst({
      where: { id: roomId, providerId: auth.providerId },
      select: { id: true, number: true, name: true, type: true, status: true },
    });
    if (!room) {
      return NextResponse.json(
        { error: "Room not found. Please select a valid room from the dropdown." },
        { status: 400 }
      );
    }

    // Try to create with all maintenance ticket fields. If the DB columns
    // don't exist yet (shouldn't happen after ensureMaintenanceTicketColumns,
    // but defensive), retry without them.
    let task;
    try {
      task = await db.housekeepingTask.create({
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
    } catch (createErr) {
      const msg = createErr instanceof Error ? createErr.message : String(createErr);
      console.warn("[housekeeping POST] First create failed — retrying without maintenance fields. Error:", msg);
      // Retry without the maintenance fields
      task = await db.housekeepingTask.create({
        data: {
          roomId,
          type,
          assignedTo: assignedTo || null,
          scheduledDate,
          notes: notes || "",
          providerId: auth.providerId,
        },
        include: { room: { select: { id: true, number: true, name: true, type: true, status: true } } },
      });
    }

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