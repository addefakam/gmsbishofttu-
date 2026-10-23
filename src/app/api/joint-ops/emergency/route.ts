import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { verifyToken } from "@/lib/auth-utils";
import { getAuthContext, AuthError } from "@/lib/tenant";

import { ensureProviderStatusEnum } from "@/lib/ensure-provider-enum";
/**
 * POST /api/joint-ops/emergency
 *
 * Emergency actions requiring dual authorization:
 * - suspend-all: Suspend all APPROVED guesthouses
 * - unsuspend-all: Unsuspend all SUSPENDED guesthouses
 */
export async function POST(req: NextRequest) {
    await ensureProviderStatusEnum();
  try {
    // ── Deploy-blocker fix: require authenticated session first ──
    const auth = await getAuthContext(req);
    if (auth.role !== "SUPERUSER" && auth.role !== "POLICE") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Verify joint session (SUPERUSER + POLICE ADMIN dual auth)
    const primaryToken = req.cookies.get("ghms_token")?.value;
    const jointToken = req.cookies.get("ghms_token_joint")?.value;
    if (!primaryToken || !jointToken) {
      return NextResponse.json(
        { error: "Joint session required." },
        { status: 403 }
      );
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
      (isPrimarySuperuser && isJointPoliceAdmin) ||
      (isPrimaryPoliceAdmin && isJointSuperuser);

    if (!validCombo) {
      return NextResponse.json(
        { error: "Invalid role combination." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { action } = body;

    if (action === "suspend-all") {
      const result = await db.provider.updateMany({
        where: { status: "APPROVED" },
        data: { status: "SUSPENDED" },
      });

      const superuserName = isPrimarySuperuser ? primary.name : joint.name;
      const policeAdminName = isPrimaryPoliceAdmin ? primary.name : joint.name;

      await logAudit(req, {
        action: "EMERGENCY_SUSPEND_ALL",
        targetId: "all-providers",
        targetType: "Provider",
        details: `Emergency suspend ALL guesthouses by joint session: ${superuserName} + ${policeAdminName}. Affected: ${result.count} providers.`,
      });

      return NextResponse.json({
        message: `All guesthouses suspended. ${result.count} providers affected.`,
        affected: result.count,
      });
    }

    if (action === "unsuspend-all") {
      const result = await db.provider.updateMany({
        where: { status: "SUSPENDED" },
        data: { status: "APPROVED" },
      });

      const superuserName = isPrimarySuperuser ? primary.name : joint.name;
      const policeAdminName = isPrimaryPoliceAdmin ? primary.name : joint.name;

      await logAudit(req, {
        action: "EMERGENCY_UNSUSPEND_ALL",
        targetId: "all-providers",
        targetType: "Provider",
        details: `Emergency unsuspend ALL guesthouses by joint session: ${superuserName} + ${policeAdminName}. Affected: ${result.count} providers.`,
      });

      return NextResponse.json({
        message: `All guesthouses unsuspended. ${result.count} providers restored.`,
        affected: result.count,
      });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Emergency action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
