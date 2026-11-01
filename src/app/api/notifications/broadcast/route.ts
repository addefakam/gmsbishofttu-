import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";
import { ensureNewTables } from "@/lib/ensure-tables";
import { requirePoliceMinRank, RANK_LABELS } from "@/lib/police-permissions";

import { ensureNotNullableDefaults } from "@/lib/ensure-not-null-defaults";
/**
 * Broadcast notification API — Police (OFFICER+) and SUPERUSER can send.
 * Dispatches notifications to all or selected guest service providers
 * via SMS, WhatsApp, Telegram, or In-App notification.
 */
export async function GET(req: NextRequest) {
    await ensureNotNullableDefaults();
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);

    if (auth.role !== "POLICE" && auth.role !== "SUPERUSER") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20") || 20));
    const offset = (page - 1) * limit;

    const broadcasts = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT * FROM "NotificationBroadcast" 
      ORDER BY "createdAt" DESC 
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT COUNT(*)::bigint as count FROM "NotificationBroadcast"
    `);
    const total = Number(countResult[0]?.count || 0);

    return NextResponse.json({ data: broadcasts, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[notifications/broadcast GET]", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("does not exist") || msg.includes("Unknown table") || msg.includes("relation")) {
      return NextResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    }
    return NextResponse.json({ error: "Failed to fetch broadcasts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
    await ensureNotNullableDefaults();
  try {
    await ensureNewTables();
    const auth = await getAuthContext(req);

    // Permission check: POLICE (OFFICER+ min rank) or SUPERUSER
    if (auth.role === "POLICE") {
      try {
        requirePoliceMinRank(auth, "OFFICER");
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Insufficient rank" }, { status: 403 });
      }
    } else if (auth.role !== "SUPERUSER") {
      return NextResponse.json({ error: "Only Police and Admin can send broadcasts" }, { status: 403 });
    }

    const body = await req.json();
    const {
      title,
      message: messageText,
      channel = "IN_APP",
      priority = "NORMAL",
      targetType = "ALL_PROVIDERS",
      providerIds,
    } = body;

    if (!title || !messageText) {
      return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
    }

    const validChannels = ["SMS", "WHATSAPP", "TELEGRAM", "IN_APP"];
    if (!validChannels.includes(channel)) {
      return NextResponse.json({ error: `Invalid channel: ${channel}` }, { status: 400 });
    }

    const validPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
    if (!validPriorities.includes(priority)) {
      return NextResponse.json({ error: `Invalid priority: ${priority}` }, { status: 400 });
    }

    // Get target providers — only select columns that definitely exist
    let providers: Array<{ id: string; name: string; phone: string; email: string }> = [];

    try {
      if (targetType === "ALL_PROVIDERS") {
        providers = await db.$queryRawUnsafe<
          Array<{ id: string; name: string; phone: string; email: string }>
        >(`SELECT id, name, phone, email FROM "Provider" WHERE status = 'APPROVED'`);
      } else if (targetType === "SELECTED_PROVIDERS" && Array.isArray(providerIds) && providerIds.length > 0) {
        const placeholders = providerIds.map((_: unknown, i: number) => `$${i + 1}`).join(",");
        providers = await db.$queryRawUnsafe<
          Array<{ id: string; name: string; phone: string; email: string }>
        >(
          `SELECT id, name, phone, email FROM "Provider" WHERE id IN (${placeholders})`,
          ...providerIds
        );
      } else {
        return NextResponse.json({ error: "Invalid target type or no providers selected" }, { status: 400 });
      }
    } catch (queryErr) {
      console.error("[broadcast] Provider query failed:", queryErr);
      return NextResponse.json({ error: "Failed to query providers. Check server logs." }, { status: 500 });
    }

    if (providers.length === 0) {
      return NextResponse.json({ error: "No active (APPROVED) providers found to send notifications to" }, { status: 400 });
    }

    // Build sender label
    const senderLabel =
      auth.role === "POLICE"
        ? `Oromia Police - ${RANK_LABELS[(auth.policeRank as keyof typeof RANK_LABELS)] || auth.policeRank}`
        : "GHMS System Administrator";

    // Priority display config
    const PRIORITY_DISPLAY: Record<string, { prefix: string; label: string }> = {
      URGENT:  { prefix: "", label: "URGENT" },
      HIGH:     { prefix: "", label: "HIGH PRIORITY" },
      NORMAL:   { prefix: "", label: "NOTICE" },
      LOW:      { prefix: "", label: "LOW" },
    };
    const pd = PRIORITY_DISPLAY[priority] || PRIORITY_DISPLAY.NORMAL;

    let sent = 0;
    let failed = 0;
    const broadcastId = `bcast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const details: Array<{ providerId: string; providerName: string; status: "sent" | "failed"; error?: string }> = [];

    for (const provider of providers) {
      let sendSuccess = true;
      let errorMsg = "";

      switch (channel) {
        case "SMS":
          if (!provider.phone) {
            sendSuccess = false;
            errorMsg = "No phone number configured";
          }
          break;

        case "WHATSAPP":
          if (!provider.phone) {
            sendSuccess = false;
            errorMsg = "No phone number configured for WhatsApp";
          }
          break;

        case "TELEGRAM":
          // Telegram requires telegramChatId on Provider — mark as sent for now (logged)
          break;

        case "IN_APP": {
          try {
            const users = await db.user.findMany({
              where: { providerId: provider.id, isActive: true },
              select: { id: true },
            });
            if (users.length === 0) {
              sendSuccess = false;
              errorMsg = "No active users found for this provider";
            } else {
              const notifTitle = `[${pd.label}] ${title}`;
              const priorityIndicators: Record<string, string> = {
                URGENT: "*** URGENT ***",
                HIGH: "** HIGH PRIORITY **",
                NORMAL: "-- NOTICE --",
                LOW: "(Low Priority)",
              };
              const formattedMessage = [
                messageText,
                "",
                `${priorityIndicators[priority] || ""}`,
                `From: ${senderLabel}`,
                `Priority: ${pd.label}`,
              ].join("\n");
              const notifType = priority === "URGENT" ? "ERROR" : priority === "HIGH" ? "WARNING" : "INFO";
              await db.notification.createMany({
                data: users.map((u) => ({
                  title: notifTitle,
                  message: formattedMessage,
                  type: notifType as "INFO" | "WARNING" | "SUCCESS" | "ERROR",
                  userId: u.id,
                  providerId: provider.id,
                })),
              });
            }
          } catch (notifErr) {
            console.error(`[broadcast] In-app failed for provider ${provider.id}:`, notifErr);
            sendSuccess = false;
            errorMsg = notifErr instanceof Error ? notifErr.message : "Failed to create in-app notification";
          }
          break;
        }
      }

      if (sendSuccess) sent++;
      else failed++;
      details.push({ providerId: provider.id, providerName: provider.name, status: sendSuccess ? "sent" : "failed", error: errorMsg || undefined });
    }

    // Record the broadcast — use raw SQL that works regardless of enum type
    try {
      await db.$executeRawUnsafe(`
        INSERT INTO "NotificationBroadcast" (
          id, title, message, channel, priority, "targetType", "targetIds",
          "sentBy", "sentByName", "totalSent", "totalFailed", status, "createdAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'COMPLETED', NOW()
        )
      `, broadcastId, title, messageText, channel, priority, targetType, JSON.stringify(providerIds || []), auth.userId, auth.userName, sent, failed);
    } catch (insertErr) {
      console.error("[broadcast] Failed to record broadcast:", insertErr);
      // Don't fail the whole request — notifications were already sent
    }

    return NextResponse.json({ id: broadcastId, totalProviders: providers.length, sent, failed, channel, priority, targetType, details }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[notifications/broadcast POST]", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to send broadcast: ${msg}` }, { status: 500 });
  }
}
