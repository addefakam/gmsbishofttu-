import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDatabase } from "@/lib/init-db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";

import { ensureNotNullableDefaults } from "@/lib/ensure-not-null-defaults";
/**
 * /api/tasks/performance
 *
 * Returns per-staff performance metrics for the operator's org:
 *   - total assigned
 *   - completed count + completion rate
 *   - overdue count
 *   - last activity timestamp
 *
 * Operators use this to audit "which staff member did what this week".
 * STAFF cannot access this endpoint — performance review is operator-only.
 */

export async function GET(req: NextRequest) {
    try {
    await ensureNotNullableDefaults();
    } catch (migErr) {
      console.warn("[performance] ensureNotNullableDefaults failed (non-blocking):", migErr instanceof Error ? migErr.message : migErr);
    }
  try {
    await ensureDatabase();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);

    if (auth.role === "STAFF" || auth.role === "POLICE") {
      return NextResponse.json(
        { error: "Only operators and super-users can view performance metrics." },
        { status: 403 },
      );
    }

    const { providerId } = filter;

    // Fetch all tasks for this provider with the assignee relation so we can
    // group by user client-side. Cap at 2000 tasks for safety.
    const tasks = await db.task.findMany({
      where: { providerId },
      select: {
        id: true,
        status: true,
        priority: true,
        dueDate: true,
        assignedToUserId: true,
        completedAt: true,
        createdAt: true,
        assignedToUser: { select: { id: true, name: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });

    // Also fetch all staff logs for this provider in the last 30 days so we
    // can count actions per user (not just task completions).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const logs = await db.staffLog.findMany({
      where: { providerId, createdAt: { gte: thirtyDaysAgo } },
      select: { userId: true, userName: true, action: true, createdAt: true },
      take: 5000,
    });

    // Get all staff users in this org (so we include users with 0 tasks too).
    const staffUsers = await db.user.findMany({
      where: { providerId, role: "STAFF", isActive: true },
      select: { id: true, name: true, username: true, lastLogin: true },
    });

    // Build per-user metrics
    const today = new Date().toISOString().slice(0, 10);
    const byUser = new Map<string, {
      userId: string;
      userName: string;
      username: string;
      tasksAssigned: number;
      tasksCompleted: number;
      tasksPending: number;
      tasksOverdue: number;
      actionsLast30Days: number;
      lastActionAt: Date | null;
      lastLogin: Date | null;
    }>();

    // Initialize with all staff users (so 0-task users still appear).
    for (const u of staffUsers) {
      byUser.set(u.id, {
        userId: u.id,
        userName: u.name || u.username,
        username: u.username,
        tasksAssigned: 0,
        tasksCompleted: 0,
        tasksPending: 0,
        tasksOverdue: 0,
        actionsLast30Days: 0,
        lastActionAt: null,
        lastLogin: u.lastLogin,
      });
    }

    // Aggregate tasks
    for (const t of tasks) {
      if (!t.assignedToUserId) continue;
      const entry = byUser.get(t.assignedToUserId);
      if (!entry) continue;
      entry.tasksAssigned++;
      if (t.status === "COMPLETED") {
        entry.tasksCompleted++;
      } else if (t.status === "PENDING" || t.status === "IN_PROGRESS") {
        entry.tasksPending++;
        if (t.dueDate && t.dueDate < today) {
          entry.tasksOverdue++;
        }
      }
    }

    // Aggregate logs
    for (const log of logs) {
      let entry = byUser.get(log.userId);
      if (!entry) {
        // User not in staff list (maybe operator or non-staff) — add them so
        // their actions are still counted.
        entry = {
          userId: log.userId,
          userName: log.userName || "Unknown",
          username: "",
          tasksAssigned: 0,
          tasksCompleted: 0,
          tasksPending: 0,
          tasksOverdue: 0,
          actionsLast30Days: 0,
          lastActionAt: null,
          lastLogin: null,
        };
        byUser.set(log.userId, entry);
      }
      entry.actionsLast30Days++;
      if (!entry.lastActionAt || log.createdAt > entry.lastActionAt) {
        entry.lastActionAt = log.createdAt;
      }
    }

    const data = Array.from(byUser.values())
      .filter((u) => u.tasksAssigned > 0 || u.actionsLast30Days > 0)
      .sort((a, b) => b.tasksCompleted - a.tasksCompleted || b.actionsLast30Days - a.actionsLast30Days);

    return NextResponse.json({
      data,
      total: data.length,
      totalTasks: tasks.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[tasks/performance GET]", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return NextResponse.json({ data: [], total: 0, totalTasks: 0 });
    }
    return NextResponse.json({ error: "Failed to fetch performance metrics" }, { status: 500 });
  }
}
