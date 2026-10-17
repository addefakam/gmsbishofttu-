import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, checkWritePermission, AuthError } from "@/lib/tenant";
import { ensureNewTables } from "@/lib/ensure-tables";
import { logStaffActivity, getLogUserInfo } from "@/lib/staff-log";
import { todayStr } from "@/lib/reservation-maintenance";

export const dynamic = "force-dynamic";

/**
 * GET /api/shift-handover
 * Returns:
 *   - current: the active (not-yet-ended) shift for this provider, or null
 *   - history: the most recent 14 ended shifts
 *
 * Owners + staff can read. Police cannot.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);
    if (filter.isPolice) {
      return NextResponse.json({ error: "Police role cannot access shift handover" }, { status: 403 });
    }
    if (!filter.providerId) {
      return NextResponse.json({ error: "Provider required" }, { status: 403 });
    }

    const current = await db.shiftHandover.findFirst({
      where: {
        providerId: filter.providerId,
        endedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });

    const history = await db.shiftHandover.findMany({
      where: {
        providerId: filter.providerId,
        endedAt: { not: null },
      },
      orderBy: { startedAt: "desc" },
      take: 14,
    });

    return NextResponse.json({ current, history });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[shift-handover GET]", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return NextResponse.json({ current: null, history: [], migrationPending: true });
    }
    return NextResponse.json({ error: "Failed to fetch shift handover data" }, { status: 500 });
  }
}

/**
 * POST /api/shift-handover
 * Body: { action: "start" | "end", shiftType?, openingCash?, closingCash?, handoverNotes? }
 *
 * start: creates a new ShiftHandover row if no active shift exists.
 * end: closes the current shift with closingCash + handoverNotes.
 *
 * Both actions are logged to StaffLog for audit.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);
    if (filter.isPolice) {
      return NextResponse.json({ error: "Police role cannot manage shifts" }, { status: 403 });
    }
    if (!filter.providerId) {
      return NextResponse.json({ error: "Provider required" }, { status: 403 });
    }
    checkWritePermission(auth, { staffPermissionKey: "reservations" });

    const body = await req.json();
    const { action, shiftType, openingCash, closingCash, handoverNotes } = body as {
      action?: "start" | "end";
      shiftType?: string;
      openingCash?: number;
      closingCash?: number;
      handoverNotes?: string;
    };

    if (action !== "start" && action !== "end") {
      return NextResponse.json({ error: "action must be 'start' or 'end'" }, { status: 400 });
    }

    const { userId, userName } = getLogUserInfo(req);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (action === "start") {
      // Prevent starting a new shift if one is already active.
      const existing = await db.shiftHandover.findFirst({
        where: { providerId: filter.providerId, endedAt: null },
      });
      if (existing) {
        return NextResponse.json({
          error: "A shift is already active. End the current shift first.",
          current: existing,
        }, { status: 409 });
      }

      // Infer shift type from the current hour (Africa/Addis_Ababa, UTC+3)
      const hour = new Date().getUTCHours() + 3; // approximate; true tz handled by client
      const inferredShiftType = shiftType || (
        hour >= 6 && hour < 14 ? "DAY"
        : hour >= 14 && hour < 22 ? "EVENING"
        : "NIGHT"
      );

      // Carry forward the last shift's closing cash as this shift's opening.
      const lastShift = await db.shiftHandover.findFirst({
        where: { providerId: filter.providerId, endedAt: { not: null } },
        orderBy: { endedAt: "desc" },
        select: { closingCash: true },
      });
      const openCash = openingCash != null ? Number(openingCash) : (lastShift?.closingCash || 0);

      const shift = await db.shiftHandover.create({
        data: {
          providerId: filter.providerId,
          shiftDate: todayStr(),
          shiftType: inferredShiftType,
          staffStartId: userId,
          openingCash: openCash,
        },
      });

      logStaffActivity({
        req, userId, userName,
        action: "SHIFT_START",
        targetType: "PROVIDER",
        targetId: filter.providerId,
        details: { shiftId: shift.id, shiftType: inferredShiftType, openingCash: openCash },
        providerId: filter.providerId,
      });

      return NextResponse.json({ success: true, shift });
    }

    // action === "end"
    const current = await db.shiftHandover.findFirst({
      where: { providerId: filter.providerId, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (!current) {
      return NextResponse.json({ error: "No active shift to end." }, { status: 404 });
    }

    const closeCash = closingCash != null ? Number(closingCash) : current.openingCash;
    const discrepancy = closeCash - current.openingCash;

    const updated = await db.shiftHandover.update({
      where: { id: current.id },
      data: {
        staffEndId: userId,
        closingCash: closeCash,
        discrepancy,
        handoverNotes: handoverNotes || "",
        endedAt: new Date(),
        signedOffAt: new Date(),
      },
    });

    logStaffActivity({
      req, userId, userName,
      action: "SHIFT_END",
      targetType: "PROVIDER",
      targetId: filter.providerId,
      details: {
        shiftId: updated.id,
        openingCash: current.openingCash,
        closingCash: closeCash,
        discrepancy,
        notes: handoverNotes || "",
      },
      providerId: filter.providerId,
    });

    return NextResponse.json({ success: true, shift: updated });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[shift-handover POST]", error);
    return NextResponse.json({ error: "Failed to update shift" }, { status: 500 });
  }
}
