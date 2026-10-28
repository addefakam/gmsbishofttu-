import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, getProviderFilter, AuthError } from "@/lib/tenant";
import { ensureNewTables } from "@/lib/ensure-tables";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
import { autoFixEnumColumns } from "@/lib/auto-fix-enum";
export const dynamic = "force-dynamic";

/**
 * Force-creates the ProviderMessage table if it doesn't exist yet.
 * Bypasses the _initDone cache in ensureDatabase() which can skip
 * new table creation on Vercel warm instances.
 */
async function ensureProviderMessageTable(): Promise<void> {
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ProviderMessage" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "fromProviderId" TEXT NOT NULL,
        "toProviderId" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "isRead" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Indexes (idempotent)
    try { await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProviderMessage_fromProviderId_idx" ON "ProviderMessage" ("fromProviderId")`); } catch {}
    try { await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProviderMessage_toProviderId_idx" ON "ProviderMessage" ("toProviderId")`); } catch {}
    try { await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProviderMessage_isRead_idx" ON "ProviderMessage" ("isRead")`); } catch {}
    try { await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProviderMessage_createdAt_idx" ON "ProviderMessage" ("createdAt")`); } catch {}
    // FKs (idempotent)
    try { await db.$executeRawUnsafe(`ALTER TABLE "ProviderMessage" ADD CONSTRAINT "ProviderMessage_fromProviderId_fkey" FOREIGN KEY ("fromProviderId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE`); } catch {}
    try { await db.$executeRawUnsafe(`ALTER TABLE "ProviderMessage" ADD CONSTRAINT "ProviderMessage_toProviderId_fkey" FOREIGN KEY ("toProviderId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE`); } catch {}
  } catch (err) {
    console.warn("[provider-messages] ensureProviderMessageTable failed (non-blocking):", err instanceof Error ? err.message : err);
  }
}

/**
 * GET /api/provider-messages?with=<providerId>
 *
 * Without ?with= → returns a conversation list (all providers the current
 *   user has exchanged messages with, with last message + unread count).
 * With ?with=<id> → returns the full message thread between the current
 *   provider and the specified provider. Also marks received messages as read.
 */
export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    const { searchParams } = new URL(req.url);
    const withProviderId = searchParams.get("with");
    const unreadOnly = searchParams.get("unread");

    // ── Unread count mode (lightweight — NO table creation, NO ensureNewTables) ──
    // This is called on page load by the sidebar. It must be FAST — no DDL
    // statements, no migrations. If the ProviderMessage table doesn't exist
    // yet, the count query will fail and we return 0.
    if (unreadOnly === "true") {
      const auth = await getAuthContext(req);
      const filter = getProviderFilter(auth);
      if (filter.isPolice || !filter.providerId) {
        return NextResponse.json({ unreadCount: 0 });
      }
      try {
        const count = await db.providerMessage.count({
          where: { toProviderId: filter.providerId, isRead: false },
        });
        return NextResponse.json({ unreadCount: count });
      } catch {
        // Table doesn't exist yet — return 0 (no unread messages)
        return NextResponse.json({ unreadCount: 0 });
      }
    }

    // ── Full conversation/thread mode ──
    // Only run table creation for the full mode (not the lightweight unread count)
    await ensureProviderMessageTable();
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);
    if (filter.isPolice) {
      return NextResponse.json({ error: "Police role cannot access provider messages" }, { status: 403 });
    }
    if (!filter.providerId) {
      return NextResponse.json({ error: "Provider required" }, { status: 403 });
    }

    const myProviderId = filter.providerId;

    // ── Thread mode: fetch full conversation between two providers ──
    if (withProviderId) {
      // CRITICAL: run auto-fix before the findFirst (filters by status)
      try {
        await autoFixEnumColumns();
      } catch (fixErr: unknown) {
        console.error("[provider-messages GET] autoFixEnumColumns failed (thread mode):", fixErr instanceof Error ? fixErr.message : fixErr);
      }

      // Verify the other provider exists
      let otherProvider: { id: string; name: string; ownerName: string; phone: string } | null = null;
      try {
        otherProvider = await db.provider.findFirst({
          where: { id: withProviderId, status: "APPROVED" },
          select: { id: true, name: true, ownerName: true, phone: true },
        });
      } catch (providerErr: unknown) {
        // Fallback: raw SQL with cast-then-no-cast
        console.error("[provider-messages GET] db.provider.findFirst failed. Falling back to raw SQL. Error:", providerErr instanceof Error ? providerErr.message : providerErr);
        try {
          const rows = await db.$queryRawUnsafe<Array<{ id: string; name: string; ownerName: string; phone: string }>>(
            `SELECT "id", "name", "ownerName", "phone" FROM "Provider" WHERE "id" = $1 AND "status" = 'APPROVED'::"ProviderStatus" LIMIT 1`,
            withProviderId
          );
          otherProvider = rows[0] || null;
        } catch (castErr: unknown) {
          const castMsg = castErr instanceof Error ? castErr.message : String(castErr);
          if (castMsg.includes("42804") || castMsg.includes("42883") || castMsg.includes("does not exist") || castMsg.includes("is of type")) {
            const rows = await db.$queryRawUnsafe<Array<{ id: string; name: string; ownerName: string; phone: string }>>(
              `SELECT "id", "name", "ownerName", "phone" FROM "Provider" WHERE "id" = $1 AND "status" = 'APPROVED' LIMIT 1`,
              withProviderId
            );
            otherProvider = rows[0] || null;
          } else {
            console.error("[provider-messages GET] Raw SQL fallback also failed:", castMsg);
          }
        }
      }
      if (!otherProvider) {
        return NextResponse.json({ error: "Provider not found" }, { status: 404 });
      }

      const messages = await db.providerMessage.findMany({
        where: {
          OR: [
            { fromProviderId: myProviderId, toProviderId: withProviderId },
            { fromProviderId: withProviderId, toProviderId: myProviderId },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      });

      // Mark received messages as read
      await db.providerMessage.updateMany({
        where: { fromProviderId: withProviderId, toProviderId: myProviderId, isRead: false },
        data: { isRead: true },
      }).catch(() => {});

      return NextResponse.json({ messages, otherProvider });
    }

    // ── Conversation list mode ──
    // Fetch all providers FIRST (this doesn't depend on the ProviderMessage
    // table existing) so the "New Chat" picker always has data — even if
    // the messages table hasn't been migrated yet.
    //
    // CRITICAL: run autoFixEnumColumns() BEFORE db.provider.findMany()
    // because the WHERE clause filters by status="APPROVED". Prisma emits
    // WHERE status = $1::"ProviderStatus" — if the DB column is TEXT,
    // Postgres throws 42883 and the dropdown comes back empty. The auto-fix
    // converts the TEXT column to enum (idempotent, cached per-instance).
    try {
      await autoFixEnumColumns();
    } catch (fixErr: unknown) {
      console.error("[provider-messages GET] autoFixEnumColumns failed:", fixErr instanceof Error ? fixErr.message : fixErr);
    }

    let allProviders: Array<{ id: string; name: string; ownerName: string; phone: string }> = [];
    try {
      allProviders = await db.provider.findMany({
        where: { status: "APPROVED", id: { not: myProviderId } },
        select: { id: true, name: true, ownerName: true, phone: true },
        orderBy: { name: "asc" },
      });
    } catch (providerErr: unknown) {
      // Fallback: if Prisma's findMany STILL fails after the auto-fix
      // (e.g., enum type cache not invalidated), use raw SQL with
      // literal+cast. 2-way fallback: try with cast (works for enum
      // column), fall back to no-cast (works for TEXT column).
      console.error("[provider-messages GET] db.provider.findMany failed. Falling back to raw SQL. Error:", providerErr instanceof Error ? providerErr.message : providerErr);
      try {
        // Try with cast (enum column)
        const rows = await db.$queryRawUnsafe<Array<{ id: string; name: string; ownerName: string; phone: string }>>(
          `SELECT "id", "name", "ownerName", "phone" FROM "Provider" WHERE "status" = 'APPROVED'::"ProviderStatus" AND "id" != $1 ORDER BY "name" ASC`,
          myProviderId
        );
        allProviders = rows;
      } catch (castErr: unknown) {
        // Fall back to no-cast (TEXT column)
        const castMsg = castErr instanceof Error ? castErr.message : String(castErr);
        if (castMsg.includes("42804") || castMsg.includes("42883") || castMsg.includes("does not exist") || castMsg.includes("is of type")) {
          const rows = await db.$queryRawUnsafe<Array<{ id: string; name: string; ownerName: string; phone: string }>>(
            `SELECT "id", "name", "ownerName", "phone" FROM "Provider" WHERE "status" = 'APPROVED' AND "id" != $1 ORDER BY "name" ASC`,
            myProviderId
          );
          allProviders = rows;
        } else {
          // Different error — return empty list (the dropdown will show
          // "no providers available" but at least the page loads)
          console.error("[provider-messages GET] Raw SQL fallback also failed:", castMsg);
        }
      }
    }

    // Fetch all messages where the current provider is sender or recipient.
    // Wrap in try/catch — if the ProviderMessage table doesn't exist yet,
    // return an empty conversations list (but still return allProviders).
    let conversations: Array<{
      providerId: string; providerName: string; ownerName: string; phone: string;
      lastMessage: string; lastMessageAt: string; lastMessageFromMe: boolean;
      unreadCount: number;
    }> = [];
    try {
      const allMessages = await db.providerMessage.findMany({
        where: {
          OR: [
            { fromProviderId: myProviderId },
            { toProviderId: myProviderId },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        include: {
          fromProvider: { select: { id: true, name: true, ownerName: true, phone: true } },
          toProvider: { select: { id: true, name: true, ownerName: true, phone: true } },
        },
      });

      // Group by the other provider's ID
      const conversationMap = new Map<string, {
        providerId: string; providerName: string; ownerName: string; phone: string;
        lastMessage: string; lastMessageAt: string; lastMessageFromMe: boolean;
        unreadCount: number;
      }>();

      for (const msg of allMessages) {
        const isFromMe = msg.fromProviderId === myProviderId;
        const otherProvider = isFromMe ? msg.toProvider : msg.fromProvider;
        if (!otherProvider) continue;

        const existing = conversationMap.get(otherProvider.id);
        if (!existing) {
          conversationMap.set(otherProvider.id, {
            providerId: otherProvider.id,
            providerName: otherProvider.name,
            ownerName: otherProvider.ownerName || "",
            phone: otherProvider.phone || "",
            lastMessage: msg.message,
            lastMessageAt: msg.createdAt.toISOString(),
            lastMessageFromMe: isFromMe,
            unreadCount: isFromMe ? 0 : (msg.isRead ? 0 : 1),
          });
        } else if (!isFromMe && !msg.isRead) {
          existing.unreadCount++;
        }
      }

      conversations = Array.from(conversationMap.values()).sort((a, b) =>
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );
    } catch (msgErr) {
      // ProviderMessage table might not exist yet — return empty conversations
      // but still return allProviders so the picker works.
      console.warn("[provider-messages] Message query failed (non-blocking — allProviders still returned):", msgErr instanceof Error ? msgErr.message : msgErr);
    }

    return NextResponse.json({ conversations, allProviders });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[provider-messages GET]", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("does not exist") || msg.includes("relation")) {
      return NextResponse.json({ conversations: [], allProviders: [], migrationPending: true });
    }
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

/**
 * POST /api/provider-messages
 * Body: { toProviderId, message }
 * Sends a message from the current provider to the specified provider.
 */
export async function POST(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    await ensureProviderMessageTable();
    await ensureNewTables();
    const auth = await getAuthContext(req);
    const filter = getProviderFilter(auth);
    if (filter.isPolice) {
      return NextResponse.json({ error: "Police role cannot send provider messages" }, { status: 403 });
    }
    if (!filter.providerId) {
      return NextResponse.json({ error: "Provider required" }, { status: 403 });
    }

    const body = await req.json();
    const { toProviderId, message } = body as { toProviderId?: string; message?: string };

    if (!toProviderId || !message || !message.trim()) {
      return NextResponse.json({ error: "toProviderId and message are required" }, { status: 400 });
    }
    if (toProviderId === filter.providerId) {
      return NextResponse.json({ error: "Cannot send a message to yourself" }, { status: 400 });
    }
    if (message.length > 1000) {
      return NextResponse.json({ error: "Message too long (max 1000 characters)" }, { status: 400 });
    }

    // Verify recipient exists + is approved
    // CRITICAL: run autoFix first because the WHERE clause filters by
    // status="APPROVED". Prisma emits WHERE status = $1::"ProviderStatus"
    // — fails with 42883 if the DB column is TEXT. The route returns
    // "Failed to send message" 500 — looks like the network broke but
    // actually it's the schema/DB drift.
    try {
      await autoFixEnumColumns();
    } catch (fixErr: unknown) {
      console.error("[provider-messages POST] autoFixEnumColumns failed:", fixErr instanceof Error ? fixErr.message : fixErr);
    }

    let recipient: { id: string; name: string } | null = null;
    try {
      recipient = await db.provider.findFirst({
        where: { id: toProviderId, status: "APPROVED" },
        select: { id: true, name: true },
      });
    } catch (providerErr: unknown) {
      // Fallback: raw SQL with cast-then-no-cast
      console.error("[provider-messages POST] db.provider.findFirst failed. Falling back to raw SQL. Error:", providerErr instanceof Error ? providerErr.message : providerErr);
      try {
        const rows = await db.$queryRawUnsafe<Array<{ id: string; name: string }>>(
          `SELECT "id", "name" FROM "Provider" WHERE "id" = $1 AND "status" = 'APPROVED'::"ProviderStatus" LIMIT 1`,
          toProviderId
        );
        recipient = rows[0] || null;
      } catch (castErr: unknown) {
        const castMsg = castErr instanceof Error ? castErr.message : String(castErr);
        if (castMsg.includes("42804") || castMsg.includes("42883") || castMsg.includes("does not exist") || castMsg.includes("is of type")) {
          const rows = await db.$queryRawUnsafe<Array<{ id: string; name: string }>>(
            `SELECT "id", "name" FROM "Provider" WHERE "id" = $1 AND "status" = 'APPROVED' LIMIT 1`,
            toProviderId
          );
          recipient = rows[0] || null;
        } else {
          console.error("[provider-messages POST] Raw SQL fallback also failed:", castMsg);
        }
      }
    }
    if (!recipient) {
      return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
    }

    const msg = await db.providerMessage.create({
      data: {
        fromProviderId: filter.providerId,
        toProviderId,
        message: message.trim(),
      },
    });

    return NextResponse.json({ success: true, message: msg }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[provider-messages POST]", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
