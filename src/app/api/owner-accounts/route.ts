import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, AuthError } from "@/lib/tenant";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
// GET /api/owner-accounts — OPERATOR lists providers with owner accounts + police accounts
export async function GET(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER" && auth.role !== "OPERATOR" && auth.role !== "POLICE") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Fetch all providers with their SUPERUSER (owner) user accounts
    const providers = await db.provider.findMany({
      select: {
        id: true,
        name: true,
        ownerName: true,
        phone: true,
        email: true,
        status: true,
        createdAt: true,
        users: {
          where: { role: { in: ["SUPERUSER", "OPERATOR"] } },
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
            providerId: true,
            permissions: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Fetch all POLICE user accounts (with rank info)
    const policeUsers = await db.user.findMany({
      where: { role: "POLICE" },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        policeRank: true,
        permissions: true,
        providerId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ providers, policeUsers });
  } catch (error: unknown) {
        if (error instanceof AuthError) {
          return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
    const message = error instanceof Error ? error.message : "Failed to fetch accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}