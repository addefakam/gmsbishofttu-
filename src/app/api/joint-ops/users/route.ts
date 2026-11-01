import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyToken } from "@/lib/auth-utils";
import { getAuthContext, AuthError } from "@/lib/tenant";

import { ensureNotNullableDefaults } from "@/lib/ensure-not-null-defaults";
/**
 * GET /api/joint-ops/users
 *
 * Returns all user accounts in the system. Requires active joint session.
 */
export async function GET(req: NextRequest) {
    await ensureNotNullableDefaults();
  try {
    // ── Deploy-blocker fix: require authenticated session first ──
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER" && auth.role !== "POLICE") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Verify joint session
    const primaryToken = req.cookies.get("ghms_token")?.value;
    const jointToken = req.cookies.get("ghms_token_joint")?.value;
    if (!primaryToken || !jointToken) {
      return NextResponse.json({ error: "Joint session required." }, { status: 403 });
    }

    const [primary, joint] = await Promise.all([
      verifyToken(primaryToken),
      verifyToken(jointToken),
    ]);
    if (!primary || !joint) {
      return NextResponse.json({ error: "Sessions expired." }, { status: 401 });
    }

    const isPrimarySuperuser = primary.role === "SUPERUSER";
    const isPrimaryPoliceAdmin = primary.role === "POLICE" && primary.policeRank === "ADMIN";
    const isJointSuperuser = joint.role === "SUPERUSER";
    const isJointPoliceAdmin = joint.role === "POLICE" && joint.policeRank === "ADMIN";

    const validCombo =
      (isPrimarySuperuser && isJointPoliceAdmin) || (isPrimaryPoliceAdmin && isJointSuperuser);
    if (!validCombo) {
      return NextResponse.json({ error: "Invalid role combination." }, { status: 403 });
    }

    const users = await db.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        policeRank: true,
        providerId: true,
        createdAt: true,
        provider: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      users: users.map((u) => ({
        ...u,
        providerName: u.provider?.name || null,
      })),
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Joint ops users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
