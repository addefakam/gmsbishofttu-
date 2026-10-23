import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getAuthContext, requirePolice, AuthError } from "@/lib/tenant";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
export async function POST(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    const auth = await getAuthContext(req);
    requirePolice(auth);

    const body = await req.json();
    const { providerId, suspensionReason, providerMessage } = body;

    if (!providerId || !suspensionReason || !suspensionReason.trim()) {
      return NextResponse.json(
        { error: "Provider ID and suspension reason are required" },
        { status: 400 }
      );
    }

    // Validate suspension reason length
    if (suspensionReason.trim().length < 5) {
      return NextResponse.json(
        { error: "Suspension reason must be at least 5 characters" },
        { status: 400 }
      );
    }

    // Look up the provider
    const provider = await db.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    if (provider.status === "SUSPENDED") {
      return NextResponse.json(
        { error: "Provider is already suspended" },
        { status: 400 }
      );
    }

    if (provider.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Only APPROVED providers can be suspended" },
        { status: 400 }
      );
    }

    // Suspend the provider with reason, timestamp, and officer info
    const officerName = auth.userName || "Unknown Officer";
    const updatedProvider = await db.provider.update({
      where: { id: providerId },
      data: {
        status: "SUSPENDED",
        suspensionReason: suspensionReason.trim(),
        suspendedAt: new Date(),
        suspendedBy: `${auth.role}:${officerName}`,
      },
    });

    // Auto-create a notification for the provider with the short message
    const notificationTitle = "Guesthouse Suspended";
    const notificationMessage = providerMessage?.trim()
      ? providerMessage.trim()
      : `Your guesthouse "${provider.name}" has been suspended by the Police Department. Reason: ${suspensionReason.trim()}. Please contact the Police Department for further information.`;

    await db.notification.create({
      data: {
        title: notificationTitle,
        message: notificationMessage,
        type: "WARNING",
        providerId: providerId,
        link: null,
      },
    });

    // Also create an audit log entry
    await db.$executeRaw(
      Prisma.sql`INSERT INTO "AuditLog" ("id", "officerName", "action", "targetId", "targetType", "details", "ipAddress", "createdAt")
       VALUES (${crypto.randomUUID()}, ${officerName}, ${"SUSPEND_PROVIDER"}, ${providerId}, ${"Provider"}, ${`Suspended provider "${provider.name}" (ID: ${providerId}). Reason: ${suspensionReason.trim()}. Message sent to provider: ${notificationMessage.substring(0, 200)}`}, ${req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || ""}, CURRENT_TIMESTAMP)`
    );

    return NextResponse.json({
      success: true,
      provider: updatedProvider,
      notification: { title: notificationTitle, message: notificationMessage },
    });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to suspend provider";
    const status =
      message.includes("not found") ? 404 :
      message.includes("Police") ? 403 :
      message.includes("required") ? 400 :
      message.includes("already") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
